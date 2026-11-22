/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The page that copies the documents of indexes, data streams or aliases into another index: all
 * of them or the ones a query finds, as they are or through an ingest pipeline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton, Panel } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Checkbox, RadioGroup, TextField } from '../../components/form';
import { Flyout } from '../../components/overlay';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { ExternalLink, JsonEditor, Labeled, go, ism, toasts } from './common';
import { type IndexOption } from './index_options';
import { IndexForm, createIndex, type IndexFormHandle } from './index_pages';
import { IndexSelect, loadIndexOptions } from './index_select';
import { addJob, clusterInfo, startedToast } from './job_handlers';
import { NotificationConfig, type NotificationHandle } from './notification_config';
import {
  DEFAULT_REINDEX_QUERY,
  REINDEX_ERRORS,
  destinationError,
  reindexRequest,
  reindexSourceIndexes,
  reindexTarget,
  slicesError,
  sourceErrors,
} from './operation_model';
import { CRUMBS, ROUTES } from './routes';

const DOCS = 'https://opensearch.org/docs/latest/opensearch/reindex-data/';
const UNIQUE_DOCS = `${DOCS}#reindex-only-unique-documents`;
const TRANSFORM_DOCS = `${DOCS}#transform-documents-during-reindexing`;
const QUERY_DOCS = 'https://opensearch.org/docs/latest/opensearch/query-dsl/index/';

// A destination is an index, a data stream or an alias: never an index behind a data stream
const loadDestinations = (search: string) => loadIndexOptions(search, false);

/** The options as the page holds them: what it already knows of a name is kept */
const kept = (names: string[], given: IndexOption[], held: IndexOption[]): IndexOption[] =>
  names.map((name, at) => held.find((option) => option.label === name) ?? given[at]);

/** A new index for the copy to go to, made without leaving the page */
function CreateIndexFlyout({
  sourceIndices,
  onCreated,
  onClose,
}: {
  sourceIndices: string[];
  onCreated: (index: string) => void;
  onClose: () => void;
}) {
  const form = useRef<IndexFormHandle>(null);
  const [busy, setBusy] = useState(false);
  const here = useRef(true);
  useEffect(
    () => () => {
      here.current = false;
    },
    []
  );
  const submit = async () => {
    setBusy(true);
    const created = await createIndex(form.current);
    if (here.current) setBusy(false);
    if (created) onCreated(created);
  };
  return (
    <Flyout
      wide
      title="Create Index"
      onClose={onClose}
      footer={
        <div className="atlRow" style={{ marginLeft: 'auto', gap: 'var(--space-2)' }}>
          <Button variant="empty" size="s" onClick={onClose} testId="flyout-footer-cancel-button">
            Cancel
          </Button>
          <Button variant="primary" size="s" loading={busy} onClick={submit} testId="flyout-footer-action-button">
            Create
          </Button>
        </div>
      }
    >
      <div className="ismPage ismPage--form ismPage--flyout">
        <IndexForm ref={form} sourceIndices={sourceIndices} />
      </div>
    </Flyout>
  );
}

export function Reindex() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDICES, CRUMBS.REINDEX]);
  const preset = useLocation().hashParams.source;
  const [sources, setSources] = useState<IndexOption[]>([]);
  const [destination, setDestination] = useState<IndexOption[]>([]);
  const [sourceWrong, setSourceWrong] = useState<string[]>([]);
  const [destinationWrong, setDestinationWrong] = useState<string>();
  const [subset, setSubset] = useState(false);
  const [query, setQuery] = useState(DEFAULT_REINDEX_QUERY);
  const [queryWrong, setQueryWrong] = useState<string>();
  const [slices, setSlices] = useState<string>();
  const [slicesWrong, setSlicesWrong] = useState<string>();
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<string>();
  const [uniqueOnly, setUniqueOnly] = useState(false);
  const [ignoreConflicts, setIgnoreConflicts] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const notifications = useRef<NotificationHandle>(null);
  const here = useRef(true);
  const now = useRef({ sources, destination });
  now.current = { sources, destination };
  useEffect(
    () => () => {
      here.current = false;
    },
    []
  );

  /** Says what is wrong with the sources, and whether nothing is */
  const judgeSources = useCallback(async (chosen: IndexOption[]): Promise<boolean> => {
    if (chosen.length === 0) {
      setSourceWrong([REINDEX_ERRORS.SOURCE_REQUIRED]);
      return false;
    }
    const open = chosen.filter((item) => item.status !== 'close').map((item) => item.label);
    const answer = await ism.call('indices.getFieldMapping', { fields: '_source', index: open.join(',') });
    if (!here.current) return false;
    if (!answer.ok) toasts.danger(answer.error || "can't validate whether _source is enabled for source");
    const errors = sourceErrors(chosen, answer.ok ? answer.response : undefined);
    const overlap = destinationError(now.current.destination, chosen);
    if (now.current.destination.length > 0 && overlap?.includes('both exists')) setDestinationWrong(overlap);
    setSourceWrong(errors);
    return errors.length === 0;
  }, []);

  const judgeDestination = (chosen: IndexOption[], from: IndexOption[] = sources): boolean => {
    const wrong = destinationError(chosen, from);
    setDestinationWrong(wrong);
    return !wrong;
  };

  /** Asks OpenSearch whether the query can be run on the sources */
  const judgeQuery = async (text: string, on: IndexOption[]): Promise<boolean> => {
    if (!text) return true;
    let body: Record<string, unknown>;
    try {
      body = { ...JSON.parse(text) };
    } catch {
      setQueryWrong(REINDEX_ERRORS.QUERY);
      return false;
    }
    const answer = await ism.call<{ valid?: boolean }>('indices.validateQuery', {
      index: on.map((item) => item.label).join(','),
      body,
    });
    if (answer.ok && !answer.response?.valid) {
      setQueryWrong(REINDEX_ERRORS.QUERY);
      return false;
    }
    return true;
  };

  // An address that names indexes starts with them as the sources
  useEffect(() => {
    if (typeof preset !== 'string') return;
    let gone = false;
    const names = preset.split(',');
    void loadIndexOptions(preset).then((found) => {
      if (gone) return;
      const chosen = found.filter((option) => option.group === 'indices' && names.includes(option.label));
      setSources(chosen);
      void judgeSources(chosen);
    });
    return () => {
      gone = true;
    };
  }, [judgeSources, preset]);

  useEffect(() => {
    let gone = false;
    void ism.call<Record<string, unknown>>('ingest.getPipeline').then((answer) => {
      if (gone) return;
      if (answer.ok) setPipelines(Object.keys(answer.response ?? {}));
      else if (!answer.error?.includes('Not Found')) toasts.danger(`fetch pipelines error Error: ${answer.error || ''}`);
    });
    return () => {
      gone = true;
    };
  }, []);

  const changeSlices = (next: string | undefined) => {
    setSlices(next);
    setSlicesWrong(slicesError(next));
  };

  const submit = async () => {
    if (!(await judgeSources(sources)) || !judgeDestination(destination)) return;
    const wrongSlices = slicesError(slices);
    setSlicesWrong(wrongSlices);
    if (wrongSlices) return;
    if (subset && !(await judgeQuery(query, sources))) return;
    if (advanced && notifications.current && !notifications.current.validate()) return;
    const [target] = destination;
    setBusy(true);
    try {
      const request = reindexRequest({
        sources,
        destination: target,
        slices,
        subset,
        query,
        pipeline,
        ignoreConflicts,
        uniqueOnly,
      });
      const result = await ism.request<{ task?: string }>('POST', request.path, request.body);
      if (result.ok) {
        const from = sources.map((item) => item.label).join(',');
        const toastId = startedToast(
          `Successfully started reindexing ${from}. The reindexed index will be named ${target.label}.`
        );
        const taskId = result.response?.task;
        if (advanced) void notifications.current?.associateWithTask(taskId || '');
        addJob({
          type: 'reindex',
          extras: {
            clusterInfo: await clusterInfo(),
            toastId,
            sourceIndex: from,
            destIndex: target.label,
            taskId,
            ...reindexTarget(target),
          },
          interval: 30000,
        });
      } else {
        toasts.danger(`Reindex operation error ${result.error}`);
      }
      go(ROUTES.INDICES);
    } catch (error) {
      toasts.danger(`Reindex operation error happened ${error}`);
    }
    if (here.current) setBusy(false);
  };

  return (
    <div className="ismPage ismPage--form">
      <div className="ismPageHeader ismPageHeader--center">
        <div>
          <h1 className="ismPageTitle">Reindex</h1>
          <div className="ismLabeled__help">
            Use reindex to make extensive changes to your index. Reindex will copy data of the source index into
            another index. <ExternalLink href={DOCS} />
          </div>
        </div>
      </div>
      <Panel>
        <h2 className="ismPanel__heading">Configure source index</h2>
        <hr className="ismRule" />
        <div className="ismForm ismForm--wideHelp">
          <Labeled
            title={<h3 className="ismLabeled__heading">Specify source indexes or data streams</h3>}
            help="Specify one or more indexes or data streams you want to reindex from."
            error={sourceWrong.length > 0 ? sourceWrong.map((text) => <div key={text}>{text}</div>) : undefined}
          >
            <div className="ismField">
              <IndexSelect
                testId="sourceSelector"
                placeholder="Select indexes or data streams"
                value={sources.map((item) => item.label)}
                invalid={sourceWrong.length > 0}
                exclude={destination}
                onChange={(names, given) => {
                  const chosen = kept(names, given, sources);
                  setSources(chosen);
                  setSourceWrong([]);
                  void judgeSources(chosen);
                }}
              />
            </div>
          </Labeled>
          <div data-test-subj="subsetOption">
            <h3 className="ismLabeled__heading ismReindex__legend">Specify a reindex option</h3>
            <RadioGroup
              options={[
                { id: 'all', label: 'Reindex all documents' },
                { id: 'subset', label: 'Reindex a subset of documents (Advanced)' },
              ]}
              value={subset ? 'subset' : 'all'}
              onChange={(id) => setSubset(id === 'subset')}
            />
          </div>
          {subset && (
            <div className="ismReindex__query">
              <div className="ismReindex__queryHead">
                <span className="ismSmallLabel">Query expression</span>
                <ExternalLink href={QUERY_DOCS}>Learn more about query DSL</ExternalLink>
              </div>
              <JsonEditor
                value={query}
                height={200}
                testId="queryJsonEditor"
                onChange={(text) => {
                  setQuery(text);
                  setQueryWrong(undefined);
                  void judgeQuery(text, sources);
                }}
              />
              {queryWrong && <div className="ismLabeled__error">{queryWrong}</div>}
            </div>
          )}
        </div>
      </Panel>
      <Panel>
        <h2 className="ismPanel__heading">Configure destination index</h2>
        <hr className="ismRule" />
        <div className="ismReindex__destination">
          <Labeled
            title={<h3 className="ismLabeled__heading">Specify a destination index or data stream</h3>}
            error={destinationWrong}
          >
            <IndexSelect
              single
              testId="destinationSelector"
              placeholder="Select an index or data stream"
              value={destination.map((item) => item.label)}
              invalid={Boolean(destinationWrong)}
              exclude={sources}
              excludeSystem
              load={loadDestinations}
              onChange={(names, given) => {
                const chosen = kept(names, given, destination);
                setDestination(chosen);
                judgeDestination(chosen);
              }}
            />
          </Labeled>
          <Button size="s" testId="createIndexButton" onClick={() => setCreating(true)}>
            Create index
          </Button>
        </div>
      </Panel>
      <section className="ismPanel ismFold">
        <header className="ismFold__header">
          <IconButton
            icon={advanced ? 'chevronDown' : 'chevronRight'}
            label="drop down icon"
            size="s"
            testId="advanceOptionToggle"
            onClick={() => setAdvanced(!advanced)}
          />
          <h2 className="ismPanel__heading">Advanced settings</h2>
        </header>
        {advanced && (
          <div className="ismFold__body ismForm">
            <Labeled
              title={<h3 className="ismLabeled__heading">Reindex only unique documents</h3>}
              help={
                <>
                  You can choose to copy only the documents that do not exist in the destination index. By default,
                  OpenSearch will copy all documents from the source index. <ExternalLink href={UNIQUE_DOCS} />
                </>
              }
            >
              <Checkbox checked={uniqueOnly} onChange={setUniqueOnly} label="Reindex only unique documents" />
            </Labeled>
            <Labeled
              title={<h3 className="ismLabeled__heading">Version conflicts</h3>}
              help={
                <>
                  Instead of failing the reindexing operation, ignore any version conflicts during reindexing.{' '}
                  <ExternalLink href={UNIQUE_DOCS} />
                </>
              }
            >
              <Checkbox
                checked={ignoreConflicts}
                onChange={setIgnoreConflicts}
                label="Ignore conflicts during reindexing"
              />
            </Labeled>
            <Labeled
              title={<h3 className="ismLabeled__heading">Slice reindexing operation</h3>}
              help="Divide this reindexing operation into smaller subtasks to run in parallel."
            >
              <Checkbox
                checked={slices !== undefined}
                onChange={(sliced) => changeSlices(sliced ? 'auto' : undefined)}
                label="Slice this reindexing operation"
                testId="sliceEnabled"
              />
              {slices !== undefined && (
                <div className="ismReindex__slices" data-test-subj="sliceOption">
                  <RadioGroup
                    options={[
                      { id: 'auto', label: 'Automatic' },
                      { id: 'manual', label: 'Manually slice into subtasks' },
                    ]}
                    value={slices === 'auto' ? 'auto' : 'manual'}
                    onChange={(id) => changeSlices(id === 'auto' ? 'auto' : '')}
                  />
                </div>
              )}
            </Labeled>
            {slices !== undefined && slices !== 'auto' && (
              <Labeled
                title={<h3 className="ismLabeled__heading">Number of subtasks</h3>}
                help="Specify the number of subtasks to divide this operation into."
                error={slicesWrong}
              >
                <TextField
                  compact
                  type="number"
                  min={2}
                  placeholder="Specify a number"
                  value={slices}
                  onChange={changeSlices}
                  invalid={Boolean(slicesWrong)}
                  testId="slices"
                />
              </Labeled>
            )}
            <Labeled
              title={
                <h3 className="ismLabeled__heading">
                  Transform with ingest pipeline<i> – optional</i>
                </h3>
              }
              help={
                <>
                  Select an ingest pipeline to transform documents before writing data to the destination.{' '}
                  <ExternalLink href={TRANSFORM_DOCS} />
                </>
              }
            >
              <ComboBox
                compact
                single
                placeholder="Select an ingest pipeline"
                testId="pipelineCombobox"
                options={pipelines.map((name) => ({ value: name, label: name }))}
                selected={pipeline ? [pipeline] : []}
                onChange={(chosen) => setPipeline(chosen[0])}
              />
            </Labeled>
            <NotificationConfig ref={notifications} actionType="REINDEX" />
          </div>
        )}
      </section>
      <div className="ismButtons">
        <Button variant="empty" size="s" onClick={() => go(ROUTES.INDICES)} testId="reindexCancelButton">
          Cancel
        </Button>
        <Button variant="primary" size="s" loading={busy} onClick={submit} testId="reindexConfirmButton">
          Reindex
        </Button>
      </div>
      {creating && (
        <CreateIndexFlyout
          sourceIndices={reindexSourceIndexes(sources)}
          onClose={() => setCreating(false)}
          onCreated={(index) => {
            setDestination([{ label: index, group: 'indices', isIndex: true }]);
            setDestinationWrong(undefined);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
