/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The notifications of a long operation: what the administrator set for every operation of its
 * kind, and what this one operation may send besides. It is part of the pages that start a
 * reindex, a shrink, a split or a force merge.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Badge, Button, CallOut, IconButton } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Checkbox } from '../../components/form';
import { ism, to, toasts } from './common';
import { SmallRow, Spacer } from './job_parts';
import {
  ACTION_NAMES,
  CHANNELS_LABEL,
  CHANNELS_REQUIRED,
  OPERATION_TITLES,
  hasDefaultNotification,
  lronPath,
  type ActionType,
  type ChannelRef,
  type LronConfig,
  type OperationType,
} from './notification_model';
import { ROUTES } from './routes';

export { ACTION_NAMES, ACTION_TITLES, CHANNELS_REQUIRED, hasDefaultNotification } from './notification_model';
export type { ActionType, LronConfig, OperationType } from './notification_model';

export interface Channel {
  config_id: string;
  name: string;
  config_type?: string;
}

/**
 * The notification channels there are; none where the cluster has no notifications. They are
 * asked for when they are first wanted, and again when they are wanted after a while of not.
 */
export function useChannels(wanted = true): { channels: Channel[]; loading: boolean } {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!wanted) return undefined;
    let gone = false;
    setLoading(true);
    void ism.get<{ channel_list?: Channel[] }>('_notifications/channels').then((answer) => {
      if (gone) return;
      if (answer.ok) setChannels(answer.response?.channel_list ?? []);
      setLoading(false);
    });
    return () => {
      gone = true;
    };
  }, [wanted]);
  return { channels, loading };
}

/** Whether notifications of that kind can be set at all: asked without setting anything */
export async function canSetNotifications(): Promise<boolean> {
  const answer = await ism.request('PUT', `${lronPath(ACTION_NAMES.REINDEX)}?dry_run=true`, {
    lron_config: { lron_condition: {}, action_name: ACTION_NAMES.REINDEX, channels: [{ id: 'test' }] },
  });
  return answer.ok;
}

export function ChannelSelect({
  channels,
  loading,
  value,
  onChange,
  invalid,
  width = 300,
  testId,
}: {
  channels: Channel[];
  loading?: boolean;
  value: ChannelRef[];
  onChange: (value: ChannelRef[]) => void;
  invalid?: boolean;
  width?: number;
  testId?: string;
}) {
  return (
    <div style={{ width, maxWidth: '100%', flex: 'none' }} data-test-subj={testId}>
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
    <>
      <Spacer size="s" />
      <div data-test-subj="defaultNotificationCallout">
        <CallOut icon="info" title={texts[known] ?? <></>} />
      </div>
    </>
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

  // As the plugin's: a heading, what is known of the defaults, the defaults, and what this one
  // operation sends besides, each 8 or 24 px under the one before
  const content = (
    <div className="ismNc">
      <h3 className="ismNc__title">Notifications</h3>
      <NotificationCallout
        title={OPERATION_TITLES[operationType ?? actionType]}
        canView={canView}
        canCreate={canCreate}
        hasDefault={hasDefault}
      />
      {hasDefault && (
        <>
          <Spacer />
          <div className="ismNc__defaults">
            <SmallRow label="Notify when operation">
              <ul className="ismNc__list">
                {config?.lron_condition?.failure ? <li>Has failed</li> : null}
                {config?.lron_condition?.success ? <li>Has completed</li> : null}
              </ul>
            </SmallRow>
            <SmallRow label="Channels to notify">
              <div className="ismNc__badges">
                {selected.map((channel) => (
                  <Badge key={channel.name}>
                    {channel.name} ({channel.config_type})
                  </Badge>
                ))}
              </div>
            </SmallRow>
          </div>
        </>
      )}
      {hasDefault && canCreate && (
        <>
          <Spacer />
          <div className="ismNc__tick">
            <Checkbox
              checked={customize}
              onChange={setCustomize}
              label="Send additional notifications"
              testId="sendAddtionalNotificationsCheckBox"
            />
          </div>
        </>
      )}
      {customize && canCreate && (
        <>
          <Spacer size="s" />
          <SmallRow label={<h4 className="ismSr__heading">Send additional notifications when operation</h4>}>
            <div className="ismNc__tick">
              <Checkbox
                checked={condition.failure}
                onChange={(failure) => change({ ...condition, failure })}
                label="Has failed / timed out"
                testId="notificationCustomConditionHasFailed"
              />
            </div>
            <Spacer size="s" />
            <div className="ismNc__tick">
              <Checkbox
                checked={condition.success}
                onChange={(success) => change({ ...condition, success })}
                label="Has completed"
              />
            </div>
          </SmallRow>
          {(condition.failure || condition.success) && (
            <>
              <Spacer />
              {/* The plugin's field keeps its plain edge when channels are missing */}
              <SmallRow label={CHANNELS_LABEL} error={error}>
                <div className="ismNc__channels">
                  <ChannelSelect
                    channels={channels}
                    loading={loading}
                    value={chosen}
                    onChange={(next) => {
                      setChosen(next);
                      if (next.length > 0) setError(undefined);
                    }}
                    width={292}
                    testId="notificationCustomChannelsSelect"
                  />
                  <Button
                    icon="external"
                    iconSide="right"
                    onClick={() => window.open('/app/notifications-dashboards#/channels')}
                  >
                    Manage channels
                  </Button>
                </div>
              </SmallRow>
            </>
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
