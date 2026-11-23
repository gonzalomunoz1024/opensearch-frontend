/* SPDX-License-Identifier: Apache-2.0 */

/* The page that gives an alias or a data stream a new index to write to. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, CallOut, Panel } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { useBreadcrumbs } from '../../shell/state';
import { go, ism, to, toasts } from './common';
import { TitledPanel } from './content_panel';
import { FormRow } from './form_row';
import { IndexForm, type IndexFormHandle } from './index_pages';
import { SYSTEM_ALIAS, matchesAny } from './model';
import {
  namesItself,
  rolloverPayload,
  rolloverSourceType,
  rolloverSources,
  rolloverTarget,
  rolloverWriteIndex,
  type AliasMember,
  type RolloverSources,
} from './operation_model';
import { CRUMBS, ROUTES } from './routes';

const SOURCE_REQUIRED = 'One alias or data stream should be specified.';

/** The name the next index would get, when OpenSearch can tell */
async function nextIndex(alias: string): Promise<string | undefined> {
  const result = await ism.call<{ new_index?: string }>('indices.rollover', { alias, dry_run: true }, true);
  if (result.ok) return result.response?.new_index;
  const body = result.body as { error?: { index?: string } } | undefined;
  return body?.error?.index;
}

export function Rollover({ source: preset }: { source: string }) {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.ROLLOVER]);
  const [sources, setSources] = useState<RolloverSources>({ alias: [], dataStreams: [] });
  const [source, setSource] = useState<string | undefined>(preset || undefined);
  const [sourceError, setSourceError] = useState<string>();
  const [chosenWrite, setChosenWrite] = useState<string>();
  const [busy, setBusy] = useState(false);
  const form = useRef<IndexFormHandle>(null);

  const refresh = useCallback(async () => {
    const [aliases, dataStreams] = await Promise.all([
      ism.call<AliasMember[]>('cat.aliases', { format: 'json' }),
      ism.get<{ dataStreams: Array<{ name: string }> }>('_data_streams'),
    ]);
    if (aliases.ok && dataStreams.ok) {
      setSources(rolloverSources(aliases.response ?? [], dataStreams.response?.dataStreams ?? []));
    } else {
      toasts.danger(aliases.error || dataStreams.error || '');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const type = rolloverSourceType(sources, source);
  const writeIndex = rolloverWriteIndex(sources, source);
  const members = useMemo(
    () => sources.alias.find((item) => item.label === source)?.aliases ?? [],
    [sources, source]
  );

  // The new index of an alias is named after the one it writes to now
  useEffect(() => {
    if (!writeIndex || !source) return undefined;
    let gone = false;
    void nextIndex(source).then((name) => {
      if (!gone) form.current?.rename(name ?? '');
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeIndex]);

  const assign = async () => {
    if (!chosenWrite) return;
    const result = await ism.call('indices.updateAliases', {
      body: { actions: [{ add: { index: chosenWrite, alias: source, is_write_index: true } }] },
    });
    if (result.ok) {
      toasts.success(`Set ${chosenWrite} as write index successfully.`);
      void refresh();
    } else {
      toasts.danger(result.error);
    }
  };

  const leave = () => go(type === 'alias' ? ROUTES.ALIASES : ROUTES.DATA_STREAMS);

  const submit = async () => {
    setBusy(true);
    const missing = source ? undefined : SOURCE_REQUIRED;
    setSourceError(missing);
    // A name that does not end in a number has no next one: the new index has to be named here
    const formFails = type === 'alias' && !namesItself(writeIndex) && form.current ? !form.current.validate() : false;
    if (missing || formFails) {
      setBusy(false);
      toasts.danger('Some fields does not pass validation, please check fields with red underline.');
      return;
    }
    const target = form.current?.value();
    const payload = rolloverPayload(source, type, target ? rolloverTarget(target) : undefined);
    const result = await ism.call<{ new_index?: string }>('indices.rollover', payload);
    setBusy(false);
    if (result.ok) {
      const made = result.response?.new_index;
      toasts.success(
        <>
          <div>{source} has been successfully rolled over.</div>
          {made ? (
            <div>
              <a href={to(`${ROUTES.INDEX_DETAIL}/${made}`)}>{made}</a> is now the latest write index.
            </div>
          ) : null}
        </>
      );
      leave();
    } else {
      toasts.danger(result.error);
    }
  };

  const withNewIndex = type === 'alias' && Boolean(writeIndex);

  return (
    <div className="ismFormPage ismPage--form">
      <h1 className="ismTextTitle">Roll over</h1>
      <FormRow className="ismRollover__intro" help="Rollover creates a new writing index for a data stream or index alias." />
      <TitledPanel title="Configure source" grouped>
        {type === 'alias' && matchesAny(source || '', SYSTEM_ALIAS) && (
          <>
            <CallOut tone="warning">
              This alias may contain critical system data. Rollovering system aliases may break OpenSearch.
            </CallOut>
            <div className="ismSpacer ismSpacer--l" />
          </>
        )}
        <FormRow
          title="Select an alias or data stream"
          help="Select an alias or data stream to roll over."
          testId="form-name-source"
          error={sourceError}
        >
          <ComboBox
            compact
            single
            placeholder="Select a alias or data stream."
            options={[
              ...sources.alias.map((item) => ({ value: item.label, label: item.label, group: 'aliases' })),
              ...sources.dataStreams.map((item) => ({ value: item.label, label: item.label, group: 'data streams' })),
            ]}
            selected={source ? [source] : []}
            onChange={(next) => {
              setSource(next[0]);
              setChosenWrite(undefined);
              setSourceError(next[0] ? undefined : SOURCE_REQUIRED);
            }}
          />
        </FormRow>
        {type === 'alias' && !writeIndex && (
          <>
            <div className="ismSpacer ismSpacer--l" />
            <CallOut tone="critical" title="This alias does not contain a write index.">
              <div className="ismRollover__assign">
                <div className="ismRollover__choice">
                  Select a write index from this alias before performing rollover.
                  <div className="ismSpacer ismSpacer--s" />
                  <FormRow label="Select an index from this alias">
                    <ComboBox
                      compact
                      single
                      placeholder="Select an index"
                      options={members.map((member) => ({ value: member.index, label: member.index }))}
                      selected={chosenWrite ? [chosenWrite] : []}
                      onChange={(next) => setChosenWrite(next[0])}
                    />
                  </FormRow>
                </div>
                <Button variant="primary" disabled={!chosenWrite} onClick={assign}>
                  Assign as write index
                </Button>
              </div>
            </CallOut>
          </>
        )}
        {withNewIndex && (
          <>
            <div className="ismSpacer ismSpacer--l" />
            <FormRow title="Assigned write index">
              <div className="ismTextS">
                <span>{writeIndex}</span>
              </div>
            </FormRow>
          </>
        )}
      </TitledPanel>
      <div className="ismSpacer ismSpacer--l" />
      {withNewIndex && (
        <>
          <Panel>
            <div className="ismTitleRow">
              <h2 className="ismPanelTitle ismPanelTitle--l">Configure new rollover index</h2>
              <Button onClick={() => form.current?.importSettings(writeIndex ?? '')}>Import from old write index</Button>
            </div>
            <hr className="ismRule" />
            <IndexForm ref={form} withoutPanel />
            <div className="ismSpacer ismSpacer--l" />
          </Panel>
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      <div className="ismEndButtons">
        <Button variant="empty" onClick={leave} testId="rolloverCancelButton">
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={busy || (type === 'alias' && !writeIndex)}
          onClick={submit}
          testId="rolloverSubmitButton"
        >
          Roll over
        </Button>
      </div>
    </div>
  );
}
