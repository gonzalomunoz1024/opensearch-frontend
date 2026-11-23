/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A Vega or Vega-Lite visualization on a page: its spec read with the page's query, filters and
 * time range, its searches made (and kept for Inspect), and the chart drawn by Vega in the panel,
 * drawn again when the panel changes size.
 */

import { useEffect, useRef, useState } from 'react';
import { resolveTimeRange, type TimeRange } from '../../lib/dates';
import type { BoolQuery } from '../../lib/query';
import type { Filter } from '../../lib/types';
import type { Vis } from '../../lib/vis';
import { getServiceSettings } from '../../maps/service_settings';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import type { RequestRecord } from '../../services/search';
import type { VisInput } from '../request';
import { visFailure, type VisFailure } from '../types';
import { TimeCache, contextQuery, type VegaSearchApi, type VegaSearchRequest } from './data_parsers';
import type { VegaDebugValues } from './debug_view';
import { loadVega } from './library';
import { VegaParser } from './parser';
import { extractIndexPatternTitles, findIndexPatternId } from './index_patterns';
import { VegaMapView } from './map_view';
import { VegaChartView, VegaSignalStateManager, type VegaBaseView, type VegaViewOptions } from './view';
import '../../styles/vega.css';

export interface VegaVisProps {
  vis: Vis;
  input: VisInput;
  tick?: number;
  onFilter?: (filters: Filter[]) => void;
  onFiltersChange?: (filters: Filter[]) => void;
  onTimeChange?: (range: TimeRange) => void;
  onData?: (data: { requests: RequestRecord[]; vega?: VegaDebugValues }) => void;
  /** Takes the failure of the page's query, which the original's vega function fails with */
  onError?: (failure: VisFailure | undefined) => void;
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

export function VegaVis({ vis, input, tick, onFilter, onFiltersChange, onTimeChange, onData, onError }: VegaVisProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string>();
  const view = useRef<VegaBaseView | null>(null);
  // A map is drawn anew at a new size, as the original renders it again: what does that, and the size it was drawn at
  const redrawMap = useRef<(() => Promise<void>) | null>(null);
  const drawnSize = useRef('');
  const timeCache = useRef<TimeCache>();
  const signalState = useRef<{ spec?: unknown; manager: VegaSignalStateManager | null }>({ manager: null });
  const callbacks = useRef({ onFilter, onFiltersChange, onTimeChange, onData, onError, input });
  callbacks.current = { onFilter, onFiltersChange, onTimeChange, onData, onError, input };

  const spec = vis.params.spec;
  const key = JSON.stringify([spec, input, vis.source.query, vis.source.filters]);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    // The page's query and filters, read before the spec as the original's request handler does:
    // a query that cannot be read fails the visualization, which keeps what it drew
    let filters: BoolQuery;
    try {
      filters = contextQuery([input.query, vis.source.query], [...input.filters, ...vis.source.filters], services.queryConfig());
    } catch (error) {
      setLoading(false);
      const report = callbacks.current.onError;
      if (report) report(visFailure('vega', error));
      else setFailure(errorMessage(error));
      return undefined;
    }
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
      // the maps service, for files of shapes and for the base map of a spec on a map
      const serviceSettings = getServiceSettings(services.boot.map, services.boot.version);
      const darkMode = services.uiSettings.get<boolean>('theme:darkMode', false) === true;
      const parser = await new VegaParser(spec, {
        libraries,
        searchAPI: createSearchApi(records, controller.signal),
        timeCache: timeCache.current,
        filters,
        getServiceSettings: async () => serviceSettings,
        dark: darkMode,
      }).parseAsync();
      if (!live || !holder.current) return;
      redrawMap.current = null;

      const specText = typeof spec === 'string' ? spec : undefined;
      const state = signalState.current;
      // the values of signals are kept for the same spec, and forgotten when it changes
      const draw = async (newSpec: boolean) => {
        // a new view for new data: the old one is taken down first, keeping its signals' values
        await view.current?.destroy();
        view.current = null;
        const parentEl = holder.current;
        if (!live || !parentEl) return;
        if (newSpec && specText !== undefined && specText !== state.spec) {
          state.manager?.clear();
          state.spec = specText;
        }
        state.manager = parser.restoreSignalValuesOnRefresh ? (state.manager ?? new VegaSignalStateManager()) : null;

        let debug: VegaDebugValues | undefined;
        const options: VegaViewOptions = {
          parentEl,
          parser,
          libraries,
          // vis_type_vega.enableExternalUrls, false unless the server's settings say otherwise
          enableExternalUrls: services.boot.visTypeVega?.enableExternalUrls === true,
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
        };
        // a spec on a map gets the map's view, as in the original
        const created = parser.useMap
          ? new VegaMapView({ ...options, serviceSettings, mapSettings: services.boot.map, darkMode })
          : new VegaChartView(options);
        view.current = created;
        await created.init();
        if (!live) return;
        setFailure(undefined);
        setLoading(false);
        callbacks.current.onError?.(undefined);
        drawnSize.current = `${parentEl.clientWidth}x${parentEl.clientHeight}`;
        callbacks.current.onData?.({ requests: records, vega: debug });
      };
      await draw(true);
      if (live && parser.useMap) redrawMap.current = () => draw(false);
    })().catch((error: unknown) => {
      if (!live || (error as Error).name === 'AbortError') return;
      setFailure(errorMessage(error));
      setLoading(false);
    });
    return () => {
      live = false;
      redrawMap.current = null;
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
      const redraw = redrawMap.current;
      if (redraw) {
        // a map is made again, back where its spec starts, as the original does
        if (`${element.clientWidth}x${element.clientHeight}` !== drawnSize.current) {
          redraw().catch((error: unknown) => setFailure(errorMessage(error)));
        }
        return;
      }
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
      {/* "visualization" as the original's container of a visualization: the styles of maps apply under it */}
      <div className="visualization vgaVis" ref={holder} data-test-subj="vegaVis" />
    </>
  );
}
