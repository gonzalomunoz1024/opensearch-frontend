/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the pages of Snapshot Management share: the names over their fields, the foot of their
 * flyouts, the flyout that registers a repository, the fields that say what a snapshot holds
 * and where it goes, and the three switches of a snapshot.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Accordion, Button, CallOut } from '../../components/basic';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { Checkbox, NumberField, Select, TextField } from '../../components/form';
import { Flyout, Popover } from '../../components/overlay';
import { ExternalLink, JsonEditor, Labeled, ism, toasts } from './common';
import { loadNames } from './job_parts';
import {
  CUSTOM_CONFIGURATION_TEXT,
  FREQUENCY_OPTIONS,
  FS_SETTINGS_TEXT,
  HALF_HOURS,
  POLICY_ERRORS,
  REPOSITORY_KINDS,
  WEEK_DAYS,
  changeCron,
  dayTime,
  parseCron,
  parseDayTime,
  repositoryBody,
  zoneOffset,
  type CronParts,
  type FrequencyType,
  type Repository,
  type RepositoryKind,
} from './snapshot_model';
import { TIME_ZONES } from './time_zones';

export const SNAPSHOT_DOCS =
  'https://opensearch.org/docs/latest/opensearch/snapshots/snapshot-management/';
export const CRON_DOCS = 'https://opensearch.org/docs/latest/monitoring-plugins/alerting/cron/';
export const RESTORE_DOCS =
  'https://opensearch.org/docs/latest/opensearch/snapshots/snapshot-restore/#restore-snapshots';
export const INDEX_SETTINGS_DOCS =
  'https://opensearch.org/docs/latest/install-and-configure/configuring-opensearch/index-settings/#index-level-index-settings';
const REPOSITORY_DOCS =
  'https://opensearch.org/docs/latest/opensearch/snapshots/snapshot-restore/#register-repository';
const FS_REPOSITORY_DOCS =
  'https://opensearch.org/docs/latest/opensearch/snapshots/snapshot-restore/#shared-file-system';
const S3_REPOSITORY_DOCS =
  'https://opensearch.org/docs/latest/opensearch/snapshots/snapshot-restore/#amazon-s3';

/** A field under its name, the name set as a heading */
export function Field({
  title,
  help,
  optional,
  error,
  children,
}: {
  title: ReactNode;
  help?: ReactNode;
  optional?: boolean;
  error?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Labeled
      title={
        <h3>
          {title}
          {optional && <i> – optional</i>}
        </h3>
      }
      help={help}
      error={error || undefined}
    >
      {children}
    </Labeled>
  );
}

/** The label of a tick: what it does, and under it what that means */
export function TickLabel({ title, help }: { title: string; help?: string }) {
  return (
    <span className="ismTickLabel">
      <span>{title}</span>
      {help && <small>{help}</small>}
    </span>
  );
}

/** The two buttons at the foot of a flyout */
export function FlyoutFooter({
  action,
  onCancel,
  onAction,
  disabled,
  busy,
}: {
  action: string;
  onCancel: () => void;
  onAction: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="atlRow ismFlyoutFooter">
      <Button variant="empty" size="s" onClick={onCancel} testId="flyout-footer-cancel-button">
        Cancel
      </Button>
      <Button
        variant="primary"
        size="s"
        disabled={disabled}
        loading={busy}
        onClick={onAction}
        testId="flyout-footer-action-button"
      >
        {action}
      </Button>
    </div>
  );
}

/** Registers a repository: a folder every node can reach, or whatever a repository plugin takes */
export function CreateRepositoryFlyout({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [kind, setKind] = useState<RepositoryKind>('fs');
  const [location, setLocation] = useState('');
  const [locationError, setLocationError] = useState('');
  const [fsText, setFsText] = useState(FS_SETTINGS_TEXT);
  const [customText, setCustomText] = useState(CUSTOM_CONFIGURATION_TEXT);
  const [busy, setBusy] = useState(false);
  const here = useRef(true);
  useEffect(
    () => () => {
      here.current = false;
    },
    []
  );

  const add = async () => {
    if (!name.trim()) {
      setNameError('Required.');
      return;
    }
    if (kind === 'fs' && !location.trim()) {
      setLocationError('Required.');
      return;
    }
    const body = repositoryBody(kind, location, kind === 'fs' ? fsText : customText);
    if (!body) {
      toasts.danger('Invalid Policy JSON');
      return;
    }
    setBusy(true);
    const answer = await ism.put(`_repositores/${encodeURIComponent(name)}`, body);
    if (here.current) setBusy(false);
    if (answer.ok) {
      toasts.success(`Created repository ${name}.`);
      await onCreated(name);
    } else {
      toasts.danger(answer.error || 'There was a problem creating the repository.');
    }
  };

  return (
    <Flyout
      title="Create repository"
      onClose={onClose}
      hideClose
      className="ismSnapshotFlyout"
      footer={
        <FlyoutFooter action="Add" onCancel={onClose} onAction={() => void add()} busy={busy} />
      }
    >
      <div className="ismSnapshotForm">
        <Field title="Repository name" error={nameError}>
          <TextField
            value={name}
            onChange={(value) => {
              setName(value);
              setNameError('');
            }}
            invalid={Boolean(nameError)}
            compact
            testId="repoNameInput"
          />
        </Field>
        <Field
          title="Repository type"
          help={
            <>
              Select a supported repository type. For additional types, install the latest
              repository plugins and choose Custom configuration.{' '}
              <ExternalLink href={REPOSITORY_DOCS} />
            </>
          }
        >
          <Select
            value={kind}
            onChange={(value) => setKind(value as RepositoryKind)}
            options={REPOSITORY_KINDS}
            compact
            aria-label="Repository type"
          />
        </Field>
        {kind === 'fs' ? (
          <>
            <Field title="Location" error={locationError}>
              <TextField
                value={location}
                onChange={(value) => {
                  setLocation(value);
                  setLocationError('');
                }}
                invalid={Boolean(locationError)}
                placeholder="e.g., /mnt/snapshots"
                compact
              />
            </Field>
            <div className="ismSnapshotForm__accordion">
              <Accordion title={<h3>Advanced settings</h3>} initiallyOpen={false}>
                <p className="ismLabeled__help">
                  Define additional settings for this repository.{' '}
                  <ExternalLink href={FS_REPOSITORY_DOCS} />
                </p>
                <JsonEditor value={fsText} onChange={setFsText} height={250} />
              </Accordion>
            </div>
          </>
        ) : (
          <>
            <CallOut tone="accent" title="Install and configure custom repository types">
              <p>
                To use a custom repository, such as Amazon S3, Azure Blob Storage or similar,
                install and configure the respective repository plugin on OpenSearch and then define
                the repository configuration below. <ExternalLink href={REPOSITORY_DOCS} />
              </p>
            </CallOut>
            <Field
              title="Custom configuration"
              help={
                <>
                  Define a repository by custom type and settings.{' '}
                  <ExternalLink href={S3_REPOSITORY_DOCS}>View sample configurations</ExternalLink>
                </>
              }
            >
              <JsonEditor value={customText} onChange={setCustomText} height={250} />
            </Field>
          </>
        )}
      </div>
    </Flyout>
  );
}

/** The names a snapshot may be taken of: what was typed as a pattern and as it is, then the indexes */
export function useSourceOptions(always: string[] = []): {
  options: string[];
  loading: boolean;
  onSearch: (text: string) => void;
} {
  const [options, setOptions] = useState<string[]>(always);
  const [loading, setLoading] = useState(false);
  const turn = useRef(0);
  const fixed = useRef(always);
  const search = (text: string) => {
    const mine = (turn.current += 1);
    setLoading(true);
    setOptions(fixed.current);
    void loadNames(text).then((answer) => {
      if (mine !== turn.current) return;
      setLoading(false);
      if (answer.ok && answer.response) {
        const typed = text.trim() ? [text.endsWith('*') ? text : `${text}*`, text] : [];
        // Of what is always offered, only what the text is part of stays while something is typed
        const kept = fixed.current.filter((name) => name.includes(text.trim()));
        setOptions([...new Set([...kept, ...typed, ...answer.response.indices])]);
      } else if (answer.error?.startsWith('[index_not_found_exception]')) {
        toasts.danger('No index available');
      } else {
        toasts.danger(answer.error);
      }
    });
  };
  useEffect(() => {
    search('');
    return () => {
      turn.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { options, loading, onSearch: search };
}

/** The repositories there are, read as the page opens and again when asked */
export function useRepositories(onLoaded?: (repositories: Repository[]) => void): {
  repositories: Repository[];
  reload: () => Promise<void>;
} {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const here = useRef(true);
  const reload = async () => {
    const answer = await ism.get<Repository[]>('_repositores');
    if (!here.current) return;
    if (answer.ok) {
      const found = answer.response ?? [];
      setRepositories(found);
      onLoaded?.(found);
    } else {
      toasts.danger(answer.error || 'There was a problem loading the snapshots.');
    }
  };
  useEffect(() => {
    here.current = true;
    void reload();
    return () => {
      here.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { repositories, reload };
}

/** What a snapshot is taken of, and the repository it goes to */
export function IndicesRepositoryInput({
  options,
  loading,
  onSearch,
  indices,
  onIndices,
  repositories,
  repository,
  onRepository,
  repositoryError,
  onRepositoryCreated,
}: {
  options: string[];
  loading?: boolean;
  onSearch: (text: string) => void;
  indices: string[];
  onIndices: (indices: string[]) => void;
  repositories: Repository[];
  repository: string;
  onRepository: (repository: string) => void;
  repositoryError?: string;
  /** Called once a repository was registered from here, for the list to be read again */
  onRepositoryCreated: () => void | Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Field title="Select or input source indexes or index patterns">
        <ComboBox
          options={options.map((name) => ({ value: name, label: name }))}
          selected={indices}
          onChange={onIndices}
          onSearch={onSearch}
          searched
          loading={loading}
          allowCustom
          compact
          placeholder="Select or input indexes or index patterns"
          testId="indicesComboBoxInput"
        />
      </Field>
      <div className="ismSnapshotForm__repository">
        <Field title="Select a repository for snapshots" error={repositoryError}>
          <Select
            value={repository}
            onChange={onRepository}
            options={repositories.map((item) => item.id)}
            disabled={repositories.length === 0}
            compact
            aria-label="Select a repository"
          />
        </Field>
        <Button size="s" icon="plus" onClick={() => setCreating(true)}>
          Create repository
        </Button>
      </div>
      {creating && (
        <CreateRepositoryFlyout
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await onRepositoryCreated();
          }}
        />
      )}
    </>
  );
}

export const REPOSITORY_REQUIRED = POLICY_ERRORS.REPO;

/** The three switches of a snapshot */
export function AdvancedSnapshotSettings({
  includeGlobalState,
  ignoreUnavailable,
  partial,
  onChange,
}: {
  includeGlobalState: boolean;
  ignoreUnavailable: boolean;
  partial: boolean;
  onChange: (
    name: 'include_global_state' | 'ignore_unavailable' | 'partial',
    value: boolean
  ) => void;
}) {
  return (
    <div className="ismTicks">
      <Checkbox
        checked={includeGlobalState}
        onChange={(value) => onChange('include_global_state', value)}
        label={<TickLabel title="Include cluster state in snapshots" />}
        testId="include_global_state"
      />
      <Checkbox
        checked={ignoreUnavailable}
        onChange={(value) => onChange('ignore_unavailable', value)}
        label={
          <TickLabel
            title="Ignore unavailable indices"
            help="Instead of failing snapshot, ignore any indexes that are unavailable or do not exist."
          />
        }
        testId="ignore_unavailable"
      />
      <Checkbox
        checked={partial}
        onChange={(value) => onChange('partial', value)}
        label={
          <TickLabel
            title="Allow partial snapshots"
            help="Allow partial snapshots if one or more shards failed to store."
          />
        }
        testId="partial"
      />
    </div>
  );
}

// --- When a policy runs -----------------------------------------------------------------------------------

/** A time of day: typed, or picked from the half hours */
export function TimeSelect({
  hour,
  minute,
  onChange,
  disabled,
}: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  disabled?: boolean;
}) {
  const value = dayTime(hour, minute);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const typing = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  // What is typed stays as typed until the field is left
  useEffect(() => {
    if (!typing.current) setText(value);
  }, [value]);
  useEffect(() => {
    if (open)
      list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [open]);
  const leave = () => {
    typing.current = false;
    setOpen(false);
    setText(value);
  };
  return (
    <Popover
      open={open && !disabled}
      onClose={leave}
      width={120}
      anchorStyle={{ display: 'flex', width: '100%' }}
      button={
        <TextField
          icon="clock"
          compact
          value={text}
          disabled={disabled}
          aria-label="Start time"
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(next) => {
            typing.current = true;
            setText(next);
            const time = parseDayTime(next);
            if (time) onChange(time.hour, time.minute);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'Tab') leave();
          }}
        />
      }
    >
      <div ref={list} className="atlMenu ismTimeList" role="listbox">
        {HALF_HOURS.map((time) => (
          <button
            key={time}
            type="button"
            role="option"
            className="atlMenu__item"
            aria-selected={time === value}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const picked = parseDayTime(time);
              if (picked) onChange(picked.hour, picked.minute);
              typing.current = false;
              setOpen(false);
              setText(time);
            }}
          >
            {time}
          </button>
        ))}
      </div>
    </Popover>
  );
}

let zoneOptions: ComboOption[] | undefined;

/** The time zones, each with how far it is from UTC now */
function timeZoneOptions(): ComboOption[] {
  zoneOptions ??= TIME_ZONES.map((zone) => {
    const offset = zoneOffset(zone);
    return { value: zone, label: zone, detail: offset ? `(${offset})` : undefined };
  });
  return zoneOptions;
}

/**
 * How often something happens and when: every hour, at a time of every day, of a day of the
 * week or of a day of the month, or as a cron expression says.
 */
export function CronSchedule({
  title,
  frequencyType,
  onFrequencyType,
  expression,
  onExpression,
  timezone,
  onTimezone,
  timezoneError,
  disabled,
}: {
  title: string;
  frequencyType: FrequencyType;
  onFrequencyType: (frequencyType: FrequencyType) => void;
  expression: string;
  onExpression: (expression: string) => void;
  /** Given with `onTimezone` where the schedule has a time zone of its own */
  timezone?: string;
  onTimezone?: (timezone: string) => void;
  timezoneError?: string;
  disabled?: boolean;
}) {
  const parts = parseCron(expression);
  const change = (type: FrequencyType, changes: Partial<CronParts> = {}) => {
    if (!disabled) onExpression(changeCron(expression, type, changes));
  };
  // A schedule that is shown is one that is set
  useEffect(() => {
    change(frequencyType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ismCron">
      <Field title={title}>
        <Select
          id="creationCronScheduleType"
          value={frequencyType}
          options={FREQUENCY_OPTIONS}
          compact
          disabled={disabled}
          onChange={(value) => {
            const type = value as FrequencyType;
            onFrequencyType(type);
            // A schedule of every hour starts with the hour
            change(type, type === 'hourly' ? { minute: 0 } : {});
          }}
        />
      </Field>
      <div className="ismCron__row">
        <div className="ismCron__start">
          {frequencyType === 'custom' ? (
            <Field
              title="Cron expression"
              help={
                <>
                  Use Cron expression to define complex schedule. <ExternalLink href={CRON_DOCS} />
                </>
              }
            >
              <TextField value={expression} onChange={onExpression} compact disabled={disabled} />
            </Field>
          ) : (
            <Field title="Start time">
              {frequencyType === 'hourly' ? (
                <p className="ismCron__text">Starts at the beginning of the hour.</p>
              ) : (
                <TimeSelect
                  hour={parts.hour}
                  minute={parts.minute}
                  disabled={disabled}
                  onChange={(hour, minute) => change(frequencyType, { hour, minute })}
                />
              )}
              {frequencyType === 'weekly' && (
                <div className="ismCron__days">
                  {WEEK_DAYS.map((day) => (
                    <Checkbox
                      key={day}
                      label={day}
                      checked={parts.dayOfWeek === day}
                      disabled={disabled}
                      onChange={() => change(frequencyType, { dayOfWeek: day })}
                    />
                  ))}
                </div>
              )}
              {frequencyType === 'monthly' && (
                <>
                  <h3>On the</h3>
                  <div className="ismCron__monthly">
                    <Select
                      value="day"
                      onChange={() => undefined}
                      options={[{ value: 'day', label: 'Day' }]}
                      compact
                      disabled={disabled}
                      aria-label="On the"
                    />
                    <NumberField
                      value={parts.dayOfMonth}
                      min={1}
                      max={31}
                      compact
                      disabled={disabled}
                      aria-label="Day of the month"
                      onChange={(day) =>
                        change(frequencyType, {
                          dayOfMonth: day === undefined ? 1 : Math.trunc(day),
                        })
                      }
                    />
                  </div>
                </>
              )}
            </Field>
          )}
        </div>
        {onTimezone && (
          <div className="ismCron__zone">
            <Field title="Time zone" error={timezoneError}>
              <ComboBox
                options={timeZoneOptions()}
                selected={timezone ? [timezone] : []}
                onChange={(selected) => onTimezone(selected[0] ?? '')}
                single
                compact
                invalid={Boolean(timezoneError)}
                disabled={disabled}
                placeholder="Select a time zone"
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
