/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The notifications of a long operation: what the administrator set for every operation of its
 * kind, and what this one operation may send besides. It is part of the pages that start a
 * reindex, a shrink, a split or a force merge.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Badge, Button, CallOut, IconButton, cx } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Checkbox } from '../../components/form';
import { Labeled, ism, to, toasts } from './common';
import { ROUTES } from './routes';

export type ActionType = 'REINDEX' | 'RESIZE' | 'FORCEMERGE' | 'OPEN';
export type OperationType = ActionType | 'SHRINK' | 'SPLIT' | 'CLONE';

/** The operations by the names OpenSearch has for them */
export const ACTION_NAMES: Record<ActionType, string> = {
  REINDEX: 'indices:data/write/reindex',
  RESIZE: 'indices:admin/resize',
  FORCEMERGE: 'indices:admin/forcemerge',
  OPEN: 'indices:admin/open',
};

export const ACTION_TITLES: Record<ActionType, string> = {
  REINDEX: 'reindex',
  RESIZE: 'shrink, split, clone',
  FORCEMERGE: 'force merge',
  OPEN: 'open',
};

const OPERATION_TITLES: Record<OperationType, string> = {
  ...ACTION_TITLES,
  SHRINK: 'shrink',
  SPLIT: 'split',
  CLONE: 'clone',
};

export const CHANNELS_REQUIRED = 'One or more channels is required.';

export interface Channel {
  config_id: string;
  name: string;
  config_type?: string;
}

export interface LronConfig {
  lron_condition?: { success?: boolean; failure?: boolean };
  action_name?: string;
  channels?: Array<{ id: string }>;
}

const lronPath = (name: string) => `/_plugins/_im/lron/${encodeURIComponent(`LRON:${name}`)}`;

/** The notification channels there are; none where the cluster has no notifications */
export function useChannels(): { channels: Channel[]; loading: boolean } {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let gone = false;
    void ism.get<{ channel_list?: Channel[] }>('_notifications/channels').then((answer) => {
      if (gone) return;
      if (answer.ok) setChannels(answer.response?.channel_list ?? []);
      setLoading(false);
    });
    return () => {
      gone = true;
    };
  }, []);
  return { channels, loading };
}

/** Whether notifications of that kind can be set at all: asked without setting anything */
export async function canSetNotifications(): Promise<boolean> {
  const answer = await ism.request('PUT', `${lronPath(ACTION_NAMES.REINDEX)}?dry_run=true`, {
    lron_config: { lron_condition: {}, action_name: ACTION_NAMES.REINDEX, channels: [{ id: 'test' }] },
  });
  return answer.ok;
}

export const hasDefaultNotification = (config: LronConfig | undefined): boolean =>
  Boolean(config?.lron_condition?.failure || config?.lron_condition?.success);

export function ChannelSelect({
  channels,
  loading,
  value,
  onChange,
  invalid,
  testId,
}: {
  channels: Channel[];
  loading?: boolean;
  value: Array<{ id: string }>;
  onChange: (value: Array<{ id: string }>) => void;
  invalid?: boolean;
  testId?: string;
}) {
  return (
    <div style={{ width: 300, flex: 'none' }} data-test-subj={testId}>
      <ComboBox
        compact
        placeholder="Select channel"
        loading={loading}
        invalid={invalid}
        options={channels.map((channel) => ({ value: channel.config_id, label: channel.name }))}
        selected={loading ? [] : value.map((item) => item.id)}
        onChange={(ids) => onChange(ids.map((id) => ({ id })))}
      />
    </div>
  );
}

/** What is known of the defaults, and what can be done about them, in a sentence */
function NotificationCallout({
  title,
  canView,
  canCreate,
  hasDefault,
}: {
  title: string;
  canView: boolean;
  canCreate: boolean;
  hasDefault: boolean;
}) {
  const known = `${canView ? 1 : 0}${canCreate ? 1 : 0}${hasDefault ? 1 : 0}`;
  if (known === '110') return null;
  const texts: Record<string, JSX.Element> = {
    '000': (
      <>
        Your administrator may have set default notification settings for {title} operations. Contact your
        administrator to request access.
      </>
    ),
    '010': (
      <>
        Your administrator may have set default notification settings for {title} operations. You can send additional
        notifications for this operation.
      </>
    ),
    '100': <>Your administrator has not set default notification settings for {title} operations.</>,
    '101': (
      <>
        Your administrator has set default notification settings for {title} operations. Contact your administrator
        to request access.
      </>
    ),
    '111': (
      <>
        Default notification settings are set for {title} operations. Configure default settings at{' '}
        <a href={to(ROUTES.NOTIFICATIONS)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
          Notifications settings
        </a>
        .
      </>
    ),
  };
  return (
    <div data-test-subj="defaultNotificationCallout">
      <CallOut title={texts[known] ?? <></>} />
    </div>
  );
}

export interface NotificationHandle {
  /** Whether what is asked for can be sent; says what is missing where it cannot */
  validate(): boolean;
  /** Has the notifications asked for sent when that task ends */
  associateWithTask(taskId: string | undefined): Promise<boolean>;
}

export const NotificationConfig = forwardRef<
  NotificationHandle,
  {
    actionType: ActionType;
    operationType?: OperationType;
    /** Puts the notifications in a panel of their own, closed at first, under this title */
    panelTitle?: string;
  }
>(function NotificationConfig({ actionType, operationType, panelTitle }, ref) {
  const [open, setOpen] = useState(false);
  const { channels, loading } = useChannels();
  const [config, setConfig] = useState<LronConfig>();
  const [canView, setCanView] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [condition, setCondition] = useState({ success: false, failure: false });
  const [chosen, setChosen] = useState<Array<{ id: string }>>([]);
  const [error, setError] = useState<string>();
  const state = useRef({ customize, condition, chosen, canCreate });
  state.current = { customize, condition, chosen, canCreate };

  useEffect(() => {
    let gone = false;
    void ism.request<{ lron_configs?: Array<{ lron_config?: LronConfig }> }>('GET', lronPath(ACTION_NAMES[actionType])).then(
      (answer) => {
        if (gone) return;
        if (answer.ok) {
          const found = answer.response?.lron_configs?.[0]?.lron_config;
          setCanView(true);
          setConfig(found);
          if (!hasDefaultNotification(found)) setCustomize(true);
        } else {
          setCustomize(true);
        }
      }
    );
    void canSetNotifications().then((can) => {
      if (!gone) setCanCreate(can);
    });
    return () => {
      gone = true;
    };
  }, [actionType]);

  useImperativeHandle(ref, () => ({
    validate() {
      const now = state.current;
      const wanted = now.customize && (now.condition.failure || now.condition.success);
      const missing = wanted && now.chosen.length === 0 ? CHANNELS_REQUIRED : undefined;
      setError(missing);
      return !missing;
    },
    async associateWithTask(taskId) {
      const now = state.current;
      if (!now.customize || !now.canCreate) return true;
      const answer = await ism.request('PUT', lronPath(String(taskId)), {
        lron_config: { lron_condition: now.condition, channels: now.chosen, task_id: taskId },
      });
      if (!answer.ok) toasts.danger(answer.error);
      return answer.ok;
    },
  }));

  const hasDefault = hasDefaultNotification(config);
  if (!hasDefault && !canCreate) return null;
  const selected = (config?.channels ?? []).flatMap((item) =>
    channels.filter((channel) => channel.config_id === item.id)
  );
  const change = (next: { success: boolean; failure: boolean }) => {
    setCondition(next);
    // Nothing is missing any more once nothing is asked for
    if (!next.success && !next.failure) setError(undefined);
  };

  const content = (
    <div className="ismNotifications">
      <h3 className="ismDefinition__title">Notifications</h3>
      <NotificationCallout
        title={OPERATION_TITLES[operationType ?? actionType]}
        canView={canView}
        canCreate={canCreate}
        hasDefault={hasDefault}
      />
      {hasDefault && (
        <div className="ismNotifications__defaults">
          <Labeled title="Notify when operation">
            <ul className="ismNotifications__list">
              {config?.lron_condition?.failure ? <li>Has failed</li> : null}
              {config?.lron_condition?.success ? <li>Has completed</li> : null}
            </ul>
          </Labeled>
          <Labeled title="Channels to notify">
            <div className="atlRow" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
              {selected.map((channel) => (
                <Badge key={channel.name}>
                  {channel.name} ({channel.config_type})
                </Badge>
              ))}
            </div>
          </Labeled>
        </div>
      )}
      {hasDefault && canCreate && (
        <Checkbox
          checked={customize}
          onChange={setCustomize}
          label="Send additional notifications"
          testId="sendAddtionalNotificationsCheckBox"
        />
      )}
      {customize && canCreate && (
        <>
          <Labeled title="Send additional notifications when operation">
            <div className="atlStack" style={{ gap: 'var(--space-2)' }}>
              <Checkbox
                checked={condition.failure}
                onChange={(failure) => change({ ...condition, failure })}
                label="Has failed / timed out"
                testId="notificationCustomConditionHasFailed"
              />
              <Checkbox
                checked={condition.success}
                onChange={(success) => change({ ...condition, success })}
                label="Has completed"
              />
            </div>
          </Labeled>
          {(condition.failure || condition.success) && (
            <div className={cx('ismNotifications__channels', error && 'ismNotifications__channels--invalid')}>
              <Labeled title="Notification channels" error={error}>
                <div className="atlRow" style={{ gap: 'var(--space-4)', alignItems: 'center' }}>
                  <ChannelSelect
                    channels={channels}
                    loading={loading}
                    value={chosen}
                    onChange={(next) => {
                      setChosen(next);
                      if (next.length > 0) setError(undefined);
                    }}
                    invalid={Boolean(error)}
                    testId="notificationCustomChannelsSelect"
                  />
                  <Button
                    size="s"
                    icon="external"
                    iconSide="right"
                    onClick={() => window.open('/app/notifications-dashboards#/channels')}
                  >
                    Manage channels
                  </Button>
                </div>
              </Labeled>
            </div>
          )}
        </>
      )}
    </div>
  );
  if (!panelTitle) return content;
  return (
    <section className="ismPanel ismFold">
      <header className="ismFold__header">
        <IconButton
          icon={open ? 'chevronDown' : 'chevronRight'}
          label={panelTitle}
          size="s"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        />
        <h2 className="ismPanel__heading">{panelTitle}</h2>
      </header>
      {open && <div className="ismFold__body ismFold__body--notifications">{content}</div>}
    </section>
  );
});
