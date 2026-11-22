/* SPDX-License-Identifier: Apache-2.0 */

/* One document on a page of its own, and a document among those just before and after it. */

import { useEffect, useState } from 'react';
import { Button, CallOut, Loading, Panel } from '../../components/basic';
import { NumberField } from '../../components/form';
import type { RawHit } from '../../lib/docs';
import type { IndexPattern } from '../../lib/types';
import { appUrl } from '../../lib/url';
import { services } from '../../services';
import { useBreadcrumbs } from '../../shell/state';
import { DocDetails, DocViewer } from './doc_viewer';
import { DocTable } from './doc_table';
import { documentFields } from './search';

function usePattern(id: string) {
  const [pattern, setPattern] = useState<IndexPattern>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    services.indexPatterns
      .get(id)
      .then((loaded) => live && setPattern(loaded))
      .catch((failure) => live && setError((failure as Error).message));
    return () => {
      live = false;
    };
  }, [id]);
  return { pattern, error };
}

export function DocPage({
  indexPatternId,
  index,
  id,
  basePath,
}: {
  indexPatternId: string;
  index: string;
  id: string;
  basePath: string;
}) {
  const { pattern, error: patternError } = usePattern(indexPatternId);
  const [hit, setHit] = useState<RawHit | null>();
  const [error, setError] = useState<string>();
  useBreadcrumbs([{ text: 'Discover', to: appUrl(basePath, '/') }, { text: `${index}#${id}` }]);

  useEffect(() => {
    if (!pattern) return undefined;
    let live = true;
    services.search
      .search(index, { ...documentFields(pattern), size: 1, query: { ids: { values: [id] } } })
      .then((response) => live && setHit((response.hits.hits[0] as RawHit | undefined) ?? null))
      .catch((failure) => live && setError((failure as Error).message));
    return () => {
      live = false;
    };
  }, [pattern, index, id]);

  const problem = patternError ?? error;
  return (
    <div className="shlPage dscDocPage" data-test-subj="doc-hit">
      <h1 className="atlTitleM" style={{ marginBottom: 'var(--space-4)' }}>
        Single document
      </h1>
      {problem ? (
        <CallOut tone="critical" title="The document could not be loaded">
          {problem}
        </CallOut>
      ) : hit === null ? (
        <CallOut tone="warning" title="Cannot find document">
          No document in {index} has the id {id}.
        </CallOut>
      ) : !hit || !pattern ? (
        <Loading />
      ) : (
        <Panel>
          <DocViewer hit={hit} indexPattern={pattern} />
        </Panel>
      )}
    </div>
  );
}

export function ContextPage({ indexPatternId, id, basePath }: { indexPatternId: string; id: string; basePath: string }) {
  const { pattern, error: patternError } = usePattern(indexPatternId);
  const [count, setCount] = useState(5);
  const [rows, setRows] = useState<RawHit[]>();
  const [error, setError] = useState<string>();
  useBreadcrumbs([{ text: 'Discover', to: appUrl(basePath, '/') }, { text: `Context of ${id}` }]);

  useEffect(() => {
    if (!pattern) return undefined;
    const timeField = pattern.timeFieldName;
    if (!timeField) {
      setError('This index pattern has no time field, so documents have no order to be next to each other in.');
      return undefined;
    }
    let live = true;
    const fields = documentFields(pattern);
    (async () => {
      const anchorAnswer = await services.search.search(pattern.title, {
        ...fields,
        size: 1,
        query: { ids: { values: [id] } },
        sort: [{ [timeField]: { order: 'desc', unmapped_type: 'boolean' } }, { _doc: 'desc' }],
      });
      const anchor = anchorAnswer.hits.hits[0] as RawHit | undefined;
      if (!anchor) throw new Error(`No document has the id ${id}`);
      const around = async (direction: 'asc' | 'desc') => {
        const answer = await services.search.search(pattern.title, {
          ...fields,
          size: count,
          query: { match_all: {} },
          search_after: anchor.sort,
          sort: [{ [timeField]: { order: direction, unmapped_type: 'boolean' } }, { _doc: direction }],
        });
        return answer.hits.hits as RawHit[];
      };
      const [newer, older] = await Promise.all([around('asc'), around('desc')]);
      if (live) setRows([...newer.reverse(), anchor, ...older]);
    })().catch((failure) => live && setError((failure as Error).message));
    return () => {
      live = false;
    };
  }, [pattern, id, count]);

  const problem = patternError ?? error;
  return (
    <div className="shlPage shlPage--wide" data-test-subj="discoverContextApp">
      <div className="atlRow atlRowBetween" style={{ marginBottom: 'var(--space-3)' }}>
        <h1 className="atlTitleM">Surrounding documents</h1>
        <div className="atlRow">
          <span className="atlSubdued">Documents before and after</span>
          <NumberField value={count} min={0} max={500} onChange={(next) => setCount(Math.max(0, Math.min(500, next ?? 5)))} style={{ width: 88 }} aria-label="Documents on each side" />
          <Button variant="empty" to={appUrl(basePath, '/')}>
            Back to Discover
          </Button>
        </div>
      </div>
      {problem ? (
        <CallOut tone="critical" title="The surrounding documents could not be loaded">
          {problem}
        </CallOut>
      ) : !rows || !pattern ? (
        <Loading />
      ) : (
        <Panel flush>
          <DocTable
            rows={rows}
            indexPattern={pattern}
            columns={['_source']}
            sort={[]}
            details={(hit) => <DocDetails hit={hit} indexPattern={pattern} basePath={basePath} />}
          />
        </Panel>
      )}
    </div>
  );
}
