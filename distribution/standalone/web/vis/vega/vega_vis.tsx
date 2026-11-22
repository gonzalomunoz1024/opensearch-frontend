/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A Vega or Vega-Lite visualization on a page: its spec read with the page's query, filters and
 * time range, its searches made (and kept for Inspect), and the chart drawn by Vega in the panel,
 * drawn again when the panel changes size.
 */

import { useEffect, useRef, useState } from 'react';
import { ChartMessage } from '../../charts/core';
import { resolveTimeRange, type TimeRange } from '../../lib/dates';
import { buildQuery, type BoolQuery } from '../../lib/query';
import type { Filter, Query } from '../../lib/types';
import type { Vis } from '../../lib/vis';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import type { RequestRecord } from '../../services/search';
import type { VisInput } from '../request';
import { TimeCache, type MapsServiceSettings, type VegaSearchApi, type VegaSearchRequest } from './data_parsers';
import type { VegaDebugValues } from './debug_view';
import { loadVega } from './library';
import { VegaParser } from './parser';
import { extractIndexPatternTitles, findIndexPatternId } from './index_patterns';
import { VegaChartView, VegaSignalStateManager, type VegaBaseView } from './view';
import '../../styles/vega.css';

export interface VegaVisProps {
  vis: Vis;
  input: VisInput;
  tick?: number;
  onFilter?: (filters: Filter[]) => void;
  onFiltersChange?: (filters: Filter[]) => void;
  onTimeChange?: (range: TimeRange) => void;
  onData?: (data: { requests: RequestRecord[]; vega?: VegaDebugValues }) => void;
}

/** The answer of PPL as rows: one object per row, keyed by the names of the schema */
function pplRows(response: { schema?: Array<{ name: string }>; datarows?: unknown[][] }) {
  const schema = response.schema ?? [];
  return (response.datarows ?? []).map((row) =>
    row.reduce<Record<string, unknown>>((record, item, index) => {
      if (index < schema.length) {
        record[schema[index].name] = typeof item === 'object' ? JSON.stringify(item) : typeof item === 'boolean' ? item.toString() : item;
      }
      return record;
    }, {})
  );
}

/** The searches of a spec, made as the original makes them and recorded for Inspect */
function createSearchApi(records: RequestRecord[], signal: AbortSignal): VegaSearchApi {
  return {
    async search(requests: VegaSearchRequest[], options?: { strategy?: string }) {
      return Promise.all(
        requests.map(async (request) => {
          const name = request.name;
          if (request.data_source_name) throw new Error('data_source_name cannot be used because data_source.enabled is false');
          const target = request.index as { title?: unknown } | undefined;
          // as the original reads it: an index pattern's title, or the index itself
          const index = (target as { title?: unknown }).title || target;
          const indexText = Array.isArray(index) ? index.join(',') : String(index);
          const body = request.body as Record<string, unknown>;
          const record: RequestRecord = { name, index: indexText, body, startedAt: Date.now() };
          records.push(record);
          if (options?.strategy === 'pplraw') {
            const started = Date.now();
            try {
              const response = await services.search.request<Record<string, unknown>>('POST', '_plugins/_ppl', body, { signal });
              const rawResponse = { ...response, jsonData: pplRows(response as Parameters<typeof pplRows>[0]) };
              record.response = rawResponse;
              record.tookMs = Date.now() - started;
              return { name, rawResponse };
            } catch (failure) {
              record.error = (failure as Error).message;
              record.tookMs = Date.now() - started;
              throw failure;
            }
          }
          const rawResponse = await services.search.search(indexText, body, { signal, record });
          return { name, rawResponse };
        })
      );
    },
    resetSearchStats() {
      records.length = 0;
    },
  };
}

// The maps service is not reached by this build yet: it has no region files
const NO_MAPS: MapsServiceSettings = {
  getFileLayers: async () => [],
  getUrlForRegionLayer: async () => '',
};

/** The page's queries without repeats, as the original merges them */
function uniqueQueries(queries: Array<Query | undefined>): Query[] {
  const seen = new Set<string>();
  const result: Query[] = [];
  for (const query of queries) {
    if (!query) continue;
    const key = JSON.stringify(query.query);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(query);
  }
  return result;
}

/** The page's query and filters as one boolean query: what %context% and the dashboard clauses stand for */
export function contextQuery(vis: Vis, input: VisInput): BoolQuery {
  const queries = uniqueQueries([input.query, vis.source.query]);
  const filters = [...input.filters, ...vis.source.filters].filter((filter) => !filter.meta?.disabled);
  const query = buildQuery(undefined, queries, filters, services.queryConfig());
  // An empty query in the query language is a match_all in the original, as it parses one
  const emptyKuery = queries.filter((item) => item.language !== 'lucene' && typeof item.query === 'string' && item.query.trim() === '');
  if (emptyKuery.length) {
    query.bool.filter = [...emptyKuery.map(() => ({ match_all: {} })), ...query.bool.filter];
  }
  return query;
}

export function VegaVis({ vis, input, tick, onFilter, onFiltersChange, onTimeChange, onData }: VegaVisProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string>();
  // A spec drawn on a map: the map view is not part of this build yet
  const [onMap, setOnMap] = useState(false);
  const view = useRef<VegaBaseView | null>(null);
  const timeCache = useRef<TimeCache>();
  const signalState = useRef<{ spec?: unknown; manager: VegaSignalStateManager | null }>({ manager: null });
  const callbacks = useRef({ onFilter, onFiltersChange, onTimeChange, onData, input });
  callbacks.current = { onFilter, onFiltersChange, onTimeChange, onData, input };

  const spec = vis.params.spec;
  const key = JSON.stringify([spec, input, vis.source.query, vis.source.filters]);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    (async () => {
      const libraries = await loadVega();
      if (!live) return;
      // the bounds of the time range, kept three seconds so that searches together ask for the same
      if (!timeCache.current) {
        const cache: TimeCache = new TimeCache(() => {
          const range = resolveTimeRange(cache.timeRange as TimeRange, { weekStart: services.weekStart() });
          return { min: range?.from.getTime() ?? NaN, max: range?.to.getTime() ?? NaN };
        }, 3 * 1000);
        timeCache.current = cache;
      }
      timeCache.current.setTimeRange(input.time);
      const records: RequestRecord[] = [];
      const parser = await new VegaParser(spec, {
        libraries,
        searchAPI: createSearchApi(records, controller.signal),
        timeCache: timeCache.current,
        filters: contextQuery(vis, input),
        getServiceSettings: async () => NO_MAPS,
        dark: services.uiSettings.get<boolean>('theme:darkMode', false) === true,
      }).parseAsync();
      if (!live || !holder.current) return;

      // a new view for new data: the old one is taken down first, keeping its signals' values
      await view.current?.destroy();
      view.current = null;
      if (!live || !holder.current) return;
      // a map is drawn by a view of its own; a spec that could not be read shows its error as any other
      if (parser.useMap && !parser.error) {
        holder.current.replaceChildren();
        setOnMap(true);
        setFailure(undefined);
        setLoading(false);
        callbacks.current.onData?.({ requests: records });
        return;
      }
      setOnMap(false);
      const specText = typeof spec === 'string' ? spec : undefined;
      const state = signalState.current;
      if (specText !== undefined && specText !== state.spec) {
        state.manager?.clear();
        state.spec = specText;
      }
      state.manager = parser.restoreSignalValuesOnRefresh ? (state.manager ?? new VegaSignalStateManager()) : null;

      let debug: VegaDebugValues | undefined;
      const created = new VegaChartView({
        parentEl: holder.current,
        parser,
        libraries,
        enableExternalUrls: false,
        applyFilter: (event) => {
          if ('range' in event) callbacks.current.onTimeChange?.(event.range);
          else callbacks.current.onFilter?.(event.filters);
        },
        getFilters: () => callbacks.current.input.filters,
        setFilters: (filters) => callbacks.current.onFiltersChange?.(filters),
        findIndexPattern: (title) => findIndexPatternId(title),
        findSpecIndexPattern: async () => {
          for (const title of extractIndexPatternTitles(parser.isVegaLite ? parser.vlspec : parser.vegaSpec)) {
            const id = await findIndexPatternId(title);
            if (id) return id;
          }
          return undefined;
        },
        signalStateManager: state.manager,
        onDebugValues: (values) => {
          debug = values;
        },
      });
      view.current = created;
      await created.init();
      if (!live) return;
      setFailure(undefined);
      setLoading(false);
      callbacks.current.onData?.({ requests: records, vega: debug });
    })().catch((error: unknown) => {
      if (!live || (error as Error).name === 'AbortError') return;
      setFailure(errorMessage(error));
      setLoading(false);
    });
    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  // Taken down with the panel
  useEffect(
    () => () => {
      void view.current?.destroy();
      view.current = null;
      signalState.current.manager?.clear();
    },
    []
  );

  // Drawn again at the panel's new size
  useEffect(() => {
    const element = holder.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      void view.current?.resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {loading && <div className="atlProgress visRoot__progress" />}
      {failure && (
        <div className="visError" role="alert" data-test-subj="visError">
          <strong>Vega error</strong>
          <span>{failure}</span>
        </div>
      )}
      {onMap && <ChartMessage>Vega maps are not drawn by this build yet.</ChartMessage>}
      <div className="vgaVis" ref={holder} data-test-subj="vegaVis" style={onMap ? { display: 'none' } : undefined} />
    </>
  );
}
