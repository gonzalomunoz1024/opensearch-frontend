/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Notification settings: for each kind of long index operation, whether somebody is told when it
 * fails or when it is over, and through which channels.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, CallOut, EmptyPrompt, Panel, cx } from '../../components/basic';
import { Checkbox } from '../../components/form';
import { useBreadcrumbs } from '../../shell/state';
import { capital, ism, toasts } from './common';
import { SmallRow, Spacer } from './job_parts';
import { ChannelSelect, canSetNotifications, useChannels } from './notification_config';
import {
  ACTION_DESCRIPTIONS,
  ACTION_NAMES,
  CHANNELS_LABEL,
  channelError,
  channelErrors,
  errorLines,
  lronPath,
  submittedRows,
  tickRow,
  toConfigList,
  toPlainList,
  unsavedCount,
  withChannels,
  type ActionType,
  type ChannelRef,
  type LronConfig,
  type PlainConfig,
} from './notification_model';
import { CRUMBS } from './routes';

const DESCRIPTION =
  'Configure the default notification settings on index operation statuses, such as failed or completed. You can configure additional notification settings while performing an index operation.';

const descriptionOf = (row: PlainConfig) =>
  ACTION_DESCRIPTIONS[(Object.keys(ACTION_NAMES) as ActionType[]).find((type) => ACTION_NAMES[type] === row.action_name) ?? 'REINDEX'];

interface Failure {
  status?: number;
  error?: { type?: string };
}

export function NotificationSettings() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.NOTIFICATION_SETTINGS]);
  const [rows, setRows] = useState<PlainConfig[]>([]);
  const [loaded, setLoaded] = useState<PlainConfig[]>([]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [submitClicked, setSubmitClicked] = useState(false);
  const [noPermission, setNoPermission] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [saving, setSaving] = useState(false);
  const gone = useRef(false);
  // The channels are asked for once a row shows the field that picks them
  const { channels, loading: loadingChannels } = useChannels(rows.some((row) => row.failure || row.success));

  const reload = async () => {
    const answer = await ism.request<{ lron_configs?: Array<{ lron_config: LronConfig }> }>('GET', '/_plugins/_im/lron');
    if (gone.current) return;
    const failure = answer.body as Failure | undefined;
    // Before the first of them is saved there is no index of them at all
    if (answer.ok || failure?.error?.type === 'index_not_found_exception') {
      const found = toPlainList(answer.ok ? (answer.response?.lron_configs ?? []).map((item) => item.lron_config) : []);
      setRows(found);
      setLoaded(found);
      setErrors({});
      setSubmitClicked(false);
    } else if (failure?.status === 403) {
      setNoPermission(true);
      toasts.danger(
        'You do not have permissions to view notification settings',
        'Contact your administrator to request permissions.'
      );
    } else {
      toasts.danger(answer.error);
    }
  };

  useEffect(() => {
    gone.current = false;
    void reload();
    void canSetNotifications().then((can) => {
      if (!gone.current) setCanUpdate(can);
    });
    return () => {
      gone.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tick = (index: number, key: 'failure' | 'success', value: boolean) => {
    const next = tickRow(rows, index, key, value);
    setRows(next);
    // A tick that is taken away has every row looked at again, as the plugin does
    if (!value) setErrors(channelErrors(next));
  };
  const pick = (index: number, chosen: ChannelRef[]) => {
    const next = withChannels(rows, index, chosen);
    setRows(next);
    setErrors((before) => {
      const { [index]: _was, ...others } = before;
      const error = channelError(next[index]);
      return error ? { ...others, [index]: error } : others;
    });
  };

  const submit = async () => {
    if (!canUpdate) {
      toasts.danger(
        'You do not have permissions to update notification settings',
        'Contact your administrator to request permissions.'
      );
      return;
    }
    const found = channelErrors(rows);
    setErrors(found);
    setSubmitClicked(Object.keys(found).length > 0);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const answers = await Promise.all(
      toConfigList(submittedRows(rows)).map((config) =>
        ism.request('PUT', lronPath(String(config.action_name)), { lron_config: config })
      )
    );
    if (answers.every((answer) => answer.ok)) {
      toasts.success('Notifications settings for index operations have been successfully updated.');
      await reload();
    } else {
      toasts.danger(
        answers
          .filter((answer) => !answer.ok)
          .map((answer) => answer.error)
          .join(', ')
      );
    }
    if (!gone.current) setSaving(false);
  };

  // What was changed is dropped, and what was said to be wrong with it too
  const cancel = () => {
    setRows(loaded);
    setErrors({});
    setSubmitClicked(false);
  };

  const errorCount = Object.keys(errors).length;
  const unsaved = unsavedCount(rows, loaded);
  // As the plugin's page: the title over what the page is for, a panel with a row for each kind of
  // operation (its name and what it is on the left, its fields on the right), and a bar at the foot
  // of the window while something is not saved
  return (
    <div className={cx('ismNs', unsaved > 0 && 'ismNs--changed')}>
      <div className="ismNs__header">
        <div className="ismNs__headText">
          <h1 className="ismNs__title">Notification settings</h1>
          <div className="ismNs__description">{DESCRIPTION}</div>
        </div>
        <Button icon="external" iconSide="right" onClick={() => window.open('/app/notifications-dashboards#/channels')}>
          Manage channels
        </Button>
      </div>
      <Spacer />

      {noPermission ? (
        <Panel>
          <EmptyPrompt icon="warning" title="Error loading Notification settings">
            <p>
              You do not have permissions to view Notification settings. Contact your administrator to request
              permissions.
            </p>
          </EmptyPrompt>
        </Panel>
      ) : (
        <section className="atlPanel ismNs__panel">
          <h2 className="atlTitleS">Defaults for index operations</h2>
          {submitClicked && errorCount > 0 && (
            <CallOut tone="critical" icon="info" title="Address the following error(s) in the form">
              <ul className="ismNs__errors">
                {errorLines(rows, errors).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </CallOut>
          )}
          <Spacer />
          {rows.map((row) => {
            const error = errors[row.index];
            return (
              <div key={row.action_name} className="ismNsGroup">
                <div className="ismNsGroup__about">
                  <h3 className="ismNsGroup__title">{capital(row.title)}</h3>
                  <div className="ismNsGroup__description">{descriptionOf(row)}</div>
                </div>
                <div className="ismNsGroup__fields">
                  <SmallRow label="Notify when operation">
                    <div className="ismNsGroup__ticks">
                      <Checkbox
                        checked={Boolean(row.failure)}
                        onChange={(value) => tick(row.index, 'failure', value)}
                        label="Has failed"
                        testId={`dataSource.${row.index}.failure`}
                      />
                      <Checkbox
                        checked={Boolean(row.success)}
                        onChange={(value) => tick(row.index, 'success', value)}
                        label="Has completed"
                        testId={`dataSource.${row.index}.success`}
                      />
                    </div>
                  </SmallRow>
                  {(row.failure || row.success) && (
                    <>
                      <Spacer />
                      {/* The plugin's field keeps its plain edge when channels are missing */}
                      <div data-test-subj={`dataSource.${row.index}.channels`}>
                        <SmallRow label={CHANNELS_LABEL} error={error}>
                          <ChannelSelect
                            width={400}
                            channels={channels}
                            loading={loadingChannels}
                            value={row.channels ?? []}
                            onChange={(chosen) => pick(row.index, chosen)}
                          />
                        </SmallRow>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {unsaved > 0 && (
        <section className="ismNsBar">
          <h2 className="atlScreenReaderOnly">Page level controls</h2>
          <div className="ismNsBar__text">
            <span className={cx('ismNsBar__block', errorCount > 0 && 'ismNsBar__block--danger')} />
            {errorCount > 0 ? `${errorCount} form errors.` : `${unsaved} unsaved changes.`}
          </div>
          <Button variant="ghost" icon="cross" onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="check"
            loading={saving}
            disabled={saving}
            onClick={() => void submit()}
            testId="submitNotifcationSettings"
          >
            Save
          </Button>
        </section>
      )}
    </div>
  );
}
