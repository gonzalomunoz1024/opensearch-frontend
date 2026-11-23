/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The page that creates a snapshot policy or changes one: what it takes snapshots of and where
 * they go, when, how long they are kept, whom it tells, and the switches of a snapshot.
 */

import { useEffect, useRef, useState } from 'react';
import { Accordion, Button, IconButton, Panel } from '../../components/basic';
import {
  Checkbox,
  NumberField,
  RadioGroup,
  Select,
  TextArea,
  TextField,
} from '../../components/form';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { ExternalLink, PageTitle, go, ism, toasts } from './common';
import { FormPanel } from './job_parts';
import type { Channel } from './notification_config';
import { CRUMBS, ROUTES } from './routes';
import {
  MAX_AGE_UNITS,
  NOTIFY_PATHS,
  buildPolicy,
  defaultPolicy,
  isOn,
  minCountError,
  newPolicyForm,
  notifies,
  policyError,
  policyFormOf,
  policyIndices,
  setAt,
  type PolicyForm,
  type SMPolicy,
} from './snapshot_model';
import {
  AdvancedSnapshotSettings,
  CronSchedule,
  Field,
  IndicesRepositoryInput,
  REPOSITORY_REQUIRED,
  SNAPSHOT_DOCS,
  useRepositories,
  useSourceOptions,
} from './snapshot_parts';

interface PolicyDocument {
  id: string;
  seqNo?: number;
  primaryTerm?: number;
  policy?: SMPolicy;
}

const policyPath = (id: string) => `smPolicies/${encodeURIComponent(id)}`;

const RETENTION_OPTIONS: Array<{ id: 'retention_disabled' | 'retention_enabled'; label: string }> =
  [
    { id: 'retention_disabled', label: 'Retain all snapshots' },
    { id: 'retention_enabled', label: 'Specify retention conditions' },
  ];

const NOTIFY_TICKS: Array<{ id: string; path: string; label: string }> = [
  {
    id: 'notification-creation',
    path: NOTIFY_PATHS.creation,
    label: 'When a snapshot has been created.',
  },
  {
    id: 'notification-deletion',
    path: NOTIFY_PATHS.deletion,
    label: 'When a snapshots has been deleted.',
  },
  { id: 'notification-failure', path: NOTIFY_PATHS.failure, label: 'When a snapshot has failed.' },
];

export function CreateSnapshotPolicy({ isEdit }: { isEdit: boolean }) {
  const { hashParams } = useLocation();
  const id = hashParams.id ?? '';
  useBreadcrumbs(
    isEdit
      ? [
          CRUMBS.SNAPSHOT_MANAGEMENT,
          CRUMBS.SNAPSHOT_POLICIES,
          CRUMBS.EDIT_SNAPSHOT_POLICY,
          { text: id },
        ]
      : [CRUMBS.SNAPSHOT_MANAGEMENT, CRUMBS.SNAPSHOT_POLICIES, CRUMBS.CREATE_SNAPSHOT_POLICY]
  );
  const [policy, setPolicy] = useState<SMPolicy>(defaultPolicy);
  const [policyId, setPolicyId] = useState('');
  const [version, setVersion] = useState<{ seqNo?: number; primaryTerm?: number }>({});
  const [form, setForm] = useState<PolicyForm>(newPolicyForm);
  const [errors, setErrors] = useState<{
    name?: string;
    repository?: string;
    timezone?: string;
    minCount?: string;
  }>({});
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const here = useRef(true);

  const set = (path: string, value: unknown) => setPolicy((before) => setAt(before, path, value));
  const change = (changes: Partial<PolicyForm>) => setForm((before) => ({ ...before, ...changes }));

  const source = useSourceOptions(['*']);
  // A new policy sends its snapshots to the first repository until another is chosen
  const { repositories, reload } = useRepositories((found) => {
    if (!isEdit) set('snapshot_config.repository', found.length > 0 ? found[0].id : '');
  });

  const loadChannels = async () => {
    setLoadingChannels(true);
    const answer = await ism.get<{ channel_list?: Channel[] }>('_notifications/channels');
    if (!here.current) return;
    if (answer.ok) setChannels(answer.response?.channel_list ?? []);
    else toasts.danger(`Could not load notification channels: ${answer.error}`);
    setLoadingChannels(false);
  };

  useEffect(() => {
    here.current = true;
    const open = async () => {
      if (isEdit) {
        if (!id) {
          toasts.danger(`Invalid policy id: ${id}`);
          go(ROUTES.SNAPSHOT_POLICIES);
          return;
        }
        const answer = await ism.get<PolicyDocument | null>(policyPath(id));
        if (!here.current) return;
        const found = answer.ok ? answer.response?.policy : undefined;
        if (answer.ok && answer.response && found) {
          setPolicy(found);
          setPolicyId(answer.response.id);
          setVersion({ seqNo: answer.response.seqNo, primaryTerm: answer.response.primaryTerm });
          setForm(policyFormOf(found));
        } else {
          toasts.danger(
            answer.ok && !answer.response
              ? 'Could not load the policy'
              : `Could not load the policy: ${answer.ok ? 'Policy was empty' : answer.error}`
          );
          go(ROUTES.SNAPSHOT_POLICIES);
          return;
        }
      }
      await loadChannels();
    };
    void open();
    return () => {
      here.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, id]);

  const submit = async () => {
    const wrong = policyError(policyId, policy, form);
    if (wrong) {
      setErrors((before) => ({ ...before, [wrong.field]: wrong.text }));
      return;
    }
    setBusy(true);
    const body = buildPolicy(policy, form);
    if (isEdit) {
      if (version.seqNo == null || version.primaryTerm == null) {
        toasts.danger('Could not update policy without seqNo and primaryTerm');
        setBusy(false);
        return;
      }
      const answer = await ism.put<PolicyDocument>(policyPath(policyId), body, {
        seqNo: version.seqNo,
        primaryTerm: version.primaryTerm,
      });
      if (!here.current) return;
      setBusy(false);
      if (answer.ok) {
        toasts.success(`Updated policy: ${answer.response?.policy?.name}`);
        go(ROUTES.SNAPSHOT_POLICIES);
      } else {
        toasts.danger(`Failed to update policy: ${answer.error}`);
      }
      return;
    }
    const answer = await ism.post<PolicyDocument>(policyPath(policyId), body);
    if (!here.current) return;
    setBusy(false);
    if (answer.ok) {
      toasts.success(`Created policy: ${answer.response?.policy?.name}`);
      go(ROUTES.SNAPSHOT_POLICIES);
    } else {
      toasts.danger(`Failed to create snapshot policy: ${answer.error}`);
    }
  };

  const condition = policy.deletion?.condition;
  return (
    <div className="ismPage ismPage--form ismSnapshotPolicy">
      <PageTitle title={isEdit ? 'Edit policy' : 'Create policy'}>
        Snapshot policies allow you to define an automated snapshot schedule and retention period.{' '}
        <ExternalLink href={SNAPSHOT_DOCS} />
      </PageTitle>

      <FormPanel title="Policy settings">
        <div className="ismSnapshotForm">
          <Field title="Policy name" error={errors.name}>
            <TextField
              value={policyId}
              onChange={(value) => {
                setPolicyId(value);
                if (value.trim()) setErrors((before) => ({ ...before, name: undefined }));
              }}
              invalid={Boolean(errors.name)}
              placeholder="e.g. daily-snapshot"
              disabled={isEdit}
              compact
            />
          </Field>
          <Field title="Description" optional>
            <TextArea
              value={policy.description ?? ''}
              onChange={(value) => set('description', value)}
              placeholder="Snapshot management daily policy."
              rows={3}
              testId="description"
            />
          </Field>
        </div>
      </FormPanel>

      <FormPanel title="Source and destination">
        <div className="ismSnapshotForm">
          <IndicesRepositoryInput
            options={source.options}
            loading={source.loading}
            onSearch={source.onSearch}
            indices={policyIndices(policy)}
            onIndices={(indices) => set('snapshot_config.indices', indices.join(','))}
            repositories={repositories}
            repository={policy.snapshot_config?.repository ?? ''}
            onRepository={(repository) => {
              set('snapshot_config.repository', repository);
              setErrors((before) => ({
                ...before,
                repository: repository ? undefined : REPOSITORY_REQUIRED,
              }));
            }}
            repositoryError={errors.repository}
            onRepositoryCreated={reload}
          />
        </div>
      </FormPanel>

      <FormPanel title="Snapshot schedule">
        <div className="ismSnapshotForm">
          <CronSchedule
            title="Snapshot frequency"
            frequencyType={form.creationFrequency}
            onFrequencyType={(creationFrequency) =>
              // Snapshots taken every hour are, unless said otherwise, kept by the hour
              change(
                creationFrequency === 'hourly' && !form.retention
                  ? { creationFrequency, maxAgeUnit: 'h' }
                  : { creationFrequency }
              )
            }
            expression={policy.creation?.schedule?.cron?.expression ?? ''}
            onExpression={(expression) => set('creation.schedule.cron.expression', expression)}
            timezone={policy.creation?.schedule?.cron?.timezone ?? ''}
            onTimezone={(timezone) => {
              set('creation.schedule.cron.timezone', timezone);
              if (timezone) setErrors((before) => ({ ...before, timezone: undefined }));
            }}
            timezoneError={errors.timezone}
            disabled={form.deletionOnly}
          />
        </div>
      </FormPanel>

      <FormPanel title="Retention period">
        <div className="ismSnapshotForm">
          <RadioGroup
            options={RETENTION_OPTIONS}
            value={form.retention ? 'retention_enabled' : 'retention_disabled'}
            onChange={(chosen) => change({ retention: chosen === 'retention_enabled' })}
          />
          {form.retention && (
            <>
              <Field title="Maximum age of snapshots retained">
                <div className="ismSnapshotPolicy__age">
                  <NumberField
                    value={Number.isNaN(form.maxAgeNumber) ? '' : form.maxAgeNumber}
                    min={1}
                    compact
                    aria-label="Maximum age of snapshots retained"
                    onChange={(value) =>
                      change({ maxAgeNumber: value === undefined ? NaN : Math.trunc(value) })
                    }
                  />
                  <Select
                    value={form.maxAgeUnit}
                    onChange={(maxAgeUnit) => change({ maxAgeUnit })}
                    options={MAX_AGE_UNITS}
                    compact
                    aria-label="Unit"
                  />
                </div>
              </Field>
              <Accordion title="Additional settings" initiallyOpen={false}>
                <div className="ismSnapshotForm ismSnapshotPolicy__more">
                  <p className="ismSnapshotPolicy__text">Number of snapshots retained</p>
                  <div className="ismSnapshotPolicy__counts">
                    <Field title="Minimum" error={errors.minCount}>
                      <NumberField
                        value={condition?.min_count ?? 1}
                        min={1}
                        compact
                        invalid={Boolean(errors.minCount)}
                        aria-label="Minimum"
                        onChange={(value) => {
                          const count = value === undefined ? undefined : Math.trunc(value);
                          set('deletion.condition.min_count', count);
                          setErrors((before) => ({
                            ...before,
                            minCount: minCountError(count) || undefined,
                          }));
                        }}
                      />
                    </Field>
                    <Field title="Maximum" optional>
                      <NumberField
                        value={condition?.max_count ?? ''}
                        min={1}
                        compact
                        aria-label="Maximum"
                        onChange={(value) =>
                          set(
                            'deletion.condition.max_count',
                            value === undefined ? undefined : Math.trunc(value)
                          )
                        }
                      />
                    </Field>
                  </div>
                  <div>
                    <p className="ismSnapshotPolicy__text">Deletion frequency</p>
                    <p className="ismLabeled__help">
                      Configure when to check retention conditions and delete snapshots.
                    </p>
                  </div>
                  <Checkbox
                    checked={!form.deletionSchedule}
                    onChange={(same) => change({ deletionSchedule: !same })}
                    label="Same as snapshot frequency"
                    testId="delete_schedule_checkbox"
                  />
                  {form.deletionSchedule && (
                    <CronSchedule
                      title="Deletion frequency"
                      frequencyType={form.deletionFrequency}
                      onFrequencyType={(deletionFrequency) => change({ deletionFrequency })}
                      expression={policy.deletion?.schedule?.cron?.expression ?? ''}
                      onExpression={(expression) =>
                        set('deletion.schedule.cron.expression', expression)
                      }
                    />
                  )}
                </div>
              </Accordion>
            </>
          )}
        </div>
      </FormPanel>

      <FormPanel title="Notifications">
        <div className="ismSnapshotForm">
          <h3>Notify on snapshot activities</h3>
          <div className="ismTicks">
            {NOTIFY_TICKS.map((tick) => (
              <Checkbox
                key={tick.id}
                checked={isOn(policy, tick.path)}
                onChange={(on) => set(tick.path, on)}
                label={tick.label}
                testId={tick.id}
              />
            ))}
          </div>
          {notifies(policy) && (
            <Field title="Select notification channels">
              <div className="ismSnapshotPolicy__channels">
                <Select
                  id="channel-id"
                  value={policy.notification?.channel?.id ?? ''}
                  onChange={(channelId) => set('notification.channel.id', channelId)}
                  options={channels.map((channel) => ({
                    value: channel.config_id,
                    label: channel.name,
                  }))}
                  placeholder=""
                  compact
                  aria-label="Select notification channels"
                  testId="create-policy-notification-channel-id"
                />
                <IconButton
                  icon="refresh"
                  label="Refresh"
                  variant="default"
                  size="s"
                  disabled={loadingChannels}
                  onClick={() => void loadChannels()}
                  testId="channel-notification-refresh"
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
            </Field>
          )}
        </div>
      </FormPanel>

      <Panel>
        <div className="ismSnapshotPolicy__fold">
          <IconButton
            icon={advancedOpen ? 'chevronDown' : 'chevronRight'}
            label="drop down icon"
            size="s"
            onClick={() => setAdvancedOpen(!advancedOpen)}
          />
          <h2 className="ismPanel__heading">
            Advanced settings <i>– optional</i>
          </h2>
        </div>
        {advancedOpen && (
          <>
            <hr className="ismRule" />
            <AdvancedSnapshotSettings
              includeGlobalState={isOn(policy, 'snapshot_config.include_global_state')}
              ignoreUnavailable={isOn(policy, 'snapshot_config.ignore_unavailable')}
              partial={isOn(policy, 'snapshot_config.partial')}
              onChange={(name, value) => set(`snapshot_config.${name}`, value)}
            />
          </>
        )}
      </Panel>

      <div className="ismButtons">
        <Button variant="empty" size="s" onClick={() => go(ROUTES.SNAPSHOT_POLICIES)}>
          Cancel
        </Button>
        <Button variant="primary" size="s" loading={busy} onClick={() => void submit()}>
          {isEdit ? 'Update' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
