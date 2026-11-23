/* SPDX-License-Identifier: Apache-2.0 */

/* The page that merges the segments of indexes, or of the indexes behind data streams. */

import { useEffect, useRef, useState } from 'react';
import { Button, CallOut, IconButton, Panel } from '../../components/basic';
import { Checkbox, RadioGroup, TextField } from '../../components/form';
import { useBreadcrumbs } from '../../shell/state';
import { Labeled, go, ism, toasts } from './common';
import { notReadOnly } from './index_options';
import { IndexSelect } from './index_select';
import { addJob, clusterInfo, startedToast } from './job_handlers';
import { NotificationConfig, type NotificationHandle } from './notification_config';
import { forceMergeBody, segmentsError, type ForceMergeOptions } from './operation_model';
import { CRUMBS, ROUTES } from './routes';

const SOURCE_REQUIRED = 'Index or data stream is required.';

/** How many segments to merge to: as OpenSearch sees fit, or a number */
function Segments({
  value,
  onChange,
  invalid,
}: {
  value: number | string | undefined;
  onChange: (value: number | string | undefined) => void;
  invalid: boolean;
}) {
  const [manual, setManual] = useState(Number(value) > 0);
  return (
    <>
      <RadioGroup
        options={[
          { id: 'auto', label: 'Automatic' },
          { id: 'manual', label: 'Manually set number of segments' },
        ]}
        value={manual ? 'manual' : 'auto'}
        onChange={(next) => {
          setManual(next === 'manual');
          onChange(next === 'manual' ? 1 : undefined);
        }}
      />
      {manual && (
        <Labeled
          title="Number of segments"
          help="Specify the number of segments to merge to. To fully merge indexes, set the number of segments to 1."
        >
          <TextField
            compact
            type="number"
            placeholder="Specify a number"
            invalid={invalid}
            value={value === undefined ? '' : String(value)}
            onChange={onChange}
          />
        </Labeled>
      )}
    </>
  );
}

export function ForceMerge({ indexes: preset }: { indexes: string }) {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDICES, CRUMBS.FORCE_MERGE]);
  const [indexes, setIndexes] = useState<string[]>(() => (preset ? preset.split(',') : []));
  const [options, setOptions] = useState<ForceMergeOptions>({ flush: true });
  const [errors, setErrors] = useState<{ indexes?: string; segments?: string }>({});
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writable, setWritable] = useState<string[]>([]);
  const notifications = useRef<NotificationHandle>(null);
  const here = useRef(true);
  useEffect(
    () => () => {
      here.current = false;
    },
    []
  );

  // Merging an index that is still written to leaves it with segments too large to merge again
  const names = indexes.join(',');
  useEffect(() => {
    let gone = false;
    const chosen = names === '' ? [] : names.split(',');
    void ism.call('indices.getSettings', { flat_settings: true, index: chosen }).then((answer) => {
      if (!gone) setWritable(answer.ok ? notReadOnly(answer.response, chosen) : []);
    });
    return () => {
      gone = true;
    };
  }, [names]);

  const set = (changes: ForceMergeOptions) => {
    const next = { ...options, ...changes };
    setOptions(next);
    if ('max_num_segments' in changes) {
      setErrors((had) => ({ ...had, segments: segmentsError(next.max_num_segments) }));
    }
  };

  const submit = async () => {
    const wrong = {
      indexes: indexes.length === 0 ? SOURCE_REQUIRED : undefined,
      segments: segmentsError(options.max_num_segments),
    };
    setErrors(wrong);
    if (advanced && notifications.current && !notifications.current.validate()) return;
    if (wrong.indexes || wrong.segments) {
      if (wrong.segments) setAdvanced(true);
      return;
    }
    setBusy(true);
    const result = await ism.request<{ task?: string }>(
      'POST',
      `/${indexes.join(',')}/_forcemerge?wait_for_completion=false`,
      forceMergeBody(options)
    );
    if (result.ok) {
      const toastId = startedToast(`Successfully started force merging ${indexes.join(', ')}.`);
      const taskId = result.response?.task;
      if (advanced) void notifications.current?.associateWithTask(taskId);
      addJob({
        type: 'forceMerge',
        extras: { clusterInfo: await clusterInfo(), toastId, sourceIndex: indexes, taskId },
        interval: 30000,
      });
      go(ROUTES.INDICES);
    } else {
      toasts.danger(result.error);
    }
    if (here.current) setBusy(false);
  };

  return (
    <div className="ismPage ismPage--form">
      <div className="ismPageHeader ismPageHeader--center">
        <div>
          <h1 className="ismPageTitle">Force merge</h1>
          <div className="ismLabeled__help">
            Manually merge shards of indexes or backing indexes of data streams. You can also use force merge to
            clear up deleted documents within indexes.
          </div>
        </div>
      </div>
      <Panel>
        <h2 className="ismPanel__heading">Configure source index</h2>
        <hr className="ismRule" />
        <div className="ismForm ismForm--wideHelp">
          <Labeled
            title={<h3 className="ismLabeled__heading">Select source indexes or data streams</h3>}
            help="Select one or more indexes or data streams you want to force merge."
            error={errors.indexes}
          >
            <div className="ismField">
              <IndexSelect
                testId="sourceSelector"
                placeholder="Select indexes or data streams"
                value={indexes}
                invalid={Boolean(errors.indexes)}
                onChange={(next) => {
                  setIndexes(next);
                  setErrors((had) => ({ ...had, indexes: next.length === 0 ? SOURCE_REQUIRED : undefined }));
                }}
              />
            </div>
          </Labeled>
          {writable.length > 0 && (
            <CallOut tone="warning" title="We recommend force merge with read-only indexes">
              {writable.join(', ')} is not a read-only index. We recommend only performing force merge with
              read-only indexes to pervent large segments being produced.
            </CallOut>
          )}
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
          <div className="ismFold__body ismForm ismForm--wideHelp">
            <Labeled
              title={<h3 className="ismLabeled__heading">Index segments</h3>}
              help="Define how many segments to merge to."
              error={errors.segments}
            >
              <Segments
                value={options.max_num_segments}
                onChange={(value) => set({ max_num_segments: value })}
                invalid={Boolean(errors.segments)}
              />
            </Labeled>
            <Labeled
              title={<h3 className="ismLabeled__heading">Flush indexes</h3>}
              help="Opensearch will perform a flush on the indexes after the force merge."
            >
              <Checkbox
                checked={options.flush ?? false}
                onChange={(flush) => set({ flush })}
                label="Flush indexes"
              />
            </Labeled>
            <Labeled
              title={<h3 className="ismLabeled__heading">Remove deleted documents</h3>}
              help="Expunge all segments containing more than 10% of deleted documents. The percentage is configurable in the index.merge.policy.expunge_deletes_allowed setting."
            >
              <Checkbox
                checked={options.only_expunge_deletes ?? false}
                onChange={(value) => set({ only_expunge_deletes: value })}
                label="Completely remove deleted documents"
              />
            </Labeled>
            <NotificationConfig ref={notifications} actionType="FORCEMERGE" />
          </div>
        )}
      </section>
      <div className="ismButtons">
        <Button variant="empty" size="s" onClick={() => go(ROUTES.INDICES)} testId="reindexCancelButton">
          Cancel
        </Button>
        <Button variant="primary" size="s" loading={busy} onClick={submit} testId="forceMergeConfirmButton">
          Force merge
        </Button>
      </div>
    </div>
  );
}
