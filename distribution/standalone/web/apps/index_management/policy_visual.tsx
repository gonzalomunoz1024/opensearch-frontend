/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A policy built with forms instead of JSON: its name, who is told when it fails, the indexes
 * it applies itself to, and its states, each with the actions it does and the transitions out.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, CallOut, IconButton, cx } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Icon } from '../../components/icon';
import { FormRow, NumberField, Select, Switch, TextArea, TextField } from '../../components/form';
import { Flyout, Tooltip } from '../../components/overlay';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { ConfirmationModal, go, ism, toasts } from './common';
import {
  ACTION_DEFAULTS,
  ACTION_OPTIONS,
  CONDITION_OPTIONS,
  EMPTY_POLICY,
  actionContent,
  actionIsValid,
  actionType,
  aliasErrors,
  aliasesOf,
  conditionContent,
  conditionKind,
  conditionsOf,
  draftIsValid,
  draftsAreValid,
  draftsOf,
  orderInfo,
  templatesOf,
  updatedPolicy,
  withDrafts,
  withoutState,
  type Action,
  type Drafts,
  type ErrorNotification,
  type IsmTemplate,
  type Order,
  type Policy,
  type PolicyDocument,
  type State,
  type Transition,
} from './policy_model';
import { CRUMBS, ROUTES } from './routes';
import { AceJsonEditor, CustomLabel, DocsLink, FormButtons, Radio, Rule, Spacer, TitledPanel } from './job_parts';
import { TIME_ZONES } from './time_zones';

const DOCS = 'https://opensearch.org/docs/im-plugin/ism/index/';
const POLICY_DOCS = 'https://opensearch.org/docs/im-plugin/ism/policies/';
const ACTIONS_DOCS = `${POLICY_DOCS}#actions`;
const TRANSITION_DOCS = `${POLICY_DOCS}#transitions`;

let counter = 0;
const newId = () => `ism-${(counter += 1)}`;

// --- States, as the details of a policy show them and as its editor changes them --------------------------

/** A word and its number in a small round badge, as a state's summary shows its actions and transitions */
function Count({ text, number }: { text: string; number: number }) {
  return (
    <p className="ismCount">
      {text} <span className="ismCount__badge">{number}</span>
    </p>
  );
}

function StateRow({
  state,
  initial,
  readOnly,
  onEdit,
  onDelete,
}: {
  state: State;
  initial: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);
  const actions = state.actions ?? [];
  const transitions = state.transitions ?? [];
  return (
    <div className={cx('ismState', open && 'ismState--open')}>
      <div className="ismState__trigger">
        <button type="button" className="ismState__button" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="ismState__arrow">
            <Icon name="chevronRight" />
          </span>
          <span className="ismState__title">
            <strong className="ismState__name">{state.name}</strong>
            {initial && <span className="ismState__initial">Initial state</span>}
            {actions.length > 0 && <Count text="Actions" number={actions.length} />}
            {transitions.length > 0 && <Count text="Transitions" number={transitions.length} />}
          </span>
        </button>
        {!readOnly && (
          <div className="ismState__extra">
            <IconButton
              icon="trash"
              label="Delete"
              title="Delete state"
              variant="dangerEmpty"
              className="ismRoundButton"
              onClick={() => setConfirming(true)}
              testId="state-delete-button"
            />
            <IconButton
              icon="pencil"
              label="Edit"
              title="Edit state"
              variant="empty"
              className="ismRoundButton"
              onClick={onEdit}
            />
          </div>
        )}
      </div>
      {open && (
        <div className="ismState__body">
          <h5>Actions</h5>
          {actions.length === 0 ? (
            <p className="ismState__none">No actions. Edit state to add actions.</p>
          ) : (
            <div className="ismChips">
              {actions.map((action, index) => (
                <div key={index} className="ismChip">
                  {actionContent(action)}
                </div>
              ))}
            </div>
          )}
          <h5>Transitions</h5>
          {transitions.length === 0 ? (
            <p className="ismState__none">No transitions. Edit state to add transitions.</p>
          ) : (
            <div className="ismChips">
              {transitions.map((transition, index) => (
                <dl key={index} className="ismChip">
                  <dt>Destination state</dt>
                  <dd>{transition.state_name}</dd>
                  <dt>Transition trigger logic</dt>
                  <dd>{conditionContent(transition)}</dd>
                </dl>
              ))}
            </div>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmationModal
          title="Delete state"
          bodyMessage={
            <>
              Delete "<strong>{state.name}</strong>" permanently? Deleting the state will result in deleting all
              transitions.
            </>
          }
          actionMessage="Delete state"
          danger
          onClose={() => setConfirming(false)}
          onAction={onDelete}
        />
      )}
    </div>
  );
}

export function StatesPanel({
  policy,
  readOnly = false,
  onAdd,
  onEdit,
  onDelete,
  onDefault,
}: {
  policy: Policy;
  readOnly?: boolean;
  onAdd?: () => void;
  onEdit?: (state: State) => void;
  onDelete?: (index: number) => void;
  onDefault?: (name: string) => void;
}) {
  const states = policy.states ?? [];
  const add = (
    <Button onClick={onAdd} testId="states-add-state-button">
      Add state
    </Button>
  );
  return (
    <section className="atlPanel ismStates">
      <h2 className="atlTitleS">{`States (${states.length})`}</h2>
      <p className="ismStates__description">
        You can think of policies as state machines. "Actions" are the operations ISM performs when an index is in a
        certain state.
        <br />
        "Transitions" define when to move from one state to another. <DocsLink href={`${POLICY_DOCS}#states`} />
      </p>
      <Rule />
      <div>
        {!readOnly && (
          <>
            <div className="ismInitial">
              <label className="ismInitial__label" htmlFor="ismInitialState">
                Initial state
              </label>
              <Select
                id="ismInitialState"
                compact
                className="ismInitial__select"
                value={policy.default_state}
                onChange={(name) => onDefault?.(name)}
                options={states.map((state) => ({ value: state.name, label: state.name }))}
              />
            </div>
            <Rule />
          </>
        )}
        <div className="ismStates__list">
          {states.map((state, index) => (
            <StateRow
              key={state.name}
              state={state}
              initial={state.name === policy.default_state}
              readOnly={readOnly}
              onEdit={() => onEdit?.(state)}
              onDelete={() => onDelete?.(index)}
            />
          ))}
        </div>
        {!readOnly &&
          (states.length > 0 ? (
            <>
              <Spacer />
              {add}
            </>
          ) : (
            <div className="ismStates__empty">
              <h3>No states</h3>
              <Spacer size="m" />
              <p>Your policy currently has no states defined. Add states to manage your index lifecycle.</p>
              <Spacer />
              {add}
            </div>
          ))}
      </div>
    </section>
  );
}

// --- Who is told ------------------------------------------------------------------------------------------

interface Channel {
  config_id: string;
  name: string;
}

function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const answer = await ism.get<{ channel_list?: Channel[] }>('_notifications/channels');
    if (answer.ok) setChannels(answer.response?.channel_list ?? []);
    else toasts.danger(`Could not load notification channels: ${answer.error}`);
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { channels, loading, load };
}

function ChannelNotification({
  channelId,
  message,
  onChannel,
  onMessage,
  inAction,
}: {
  channelId: string;
  message: string;
  onChannel: (id: string) => void;
  onMessage: (text: string) => void;
  /** In the form of an action, and not the notification of the policy itself */
  inAction?: boolean;
}) {
  const { channels, loading, load } = useChannels();
  return (
    <>
      <CustomLabel title="Channel ID" />
      <div className="ismChannel">
        <div className="ismChannel__select">
          <Select
            id={inAction ? 'action-channel-id' : 'channel-id'}
            compact
            placeholder=""
            value={channelId}
            onChange={onChannel}
            options={channels.map((channel) => ({ value: channel.config_id, label: channel.name }))}
            testId={inAction ? 'create-policy-notification-action-channel-id' : 'create-policy-notification-channel-id'}
          />
        </div>
        <Button
          icon="refresh"
          className="ismRefreshButton"
          aria-label="Refresh"
          onClick={load}
          disabled={loading}
          testId="channel-notification-refresh"
        />
        <Button icon="external" iconSide="right" disabled title="Notifications are not part of this product">
          Manage channels
        </Button>
      </div>
      {channelId && (
        <>
          <Spacer size="m" />
          <CustomLabel title="Notification message" help="Embed variables in your message using Mustache template." />
          <div className="ismField400">
            <TextArea
              className="ismTextArea"
              value={message}
              onChange={onMessage}
              placeholder="The index {{ctx.index}} failed during policy execution."
              testId={inAction ? 'create-policy-notification-action-message' : 'create-policy-notification-message'}
            />
          </div>
        </>
      )}
    </>
  );
}

function LegacyNotification({
  json,
  onChange,
  onSwitch,
  inAction,
}: {
  json: string;
  onChange: (json: string) => void;
  onSwitch: () => void;
  inAction?: boolean;
}) {
  return (
    <>
      <CallOut tone="accent" size="s" icon="info" title="Update your notifications to use Channel ID">
        <p className="ismCallOutText">
          Using Channel ID will give you more control to manage notifications across OpenSearch dashboards. If you do
          decide to switch, you will lose your current error notification settings.
        </p>
        <Button onClick={onSwitch}>Switch to using Channel ID</Button>
      </CallOut>
      <Spacer size="m" />
      <AceJsonEditor
        value={json}
        onChange={onChange}
        height={300}
        cursorAtEnd
        testId={inAction ? 'create-policy-action-legacy-notification' : 'create-policy-legacy-notification'}
      />
    </>
  );
}

// --- The form of an action ----------------------------------------------------------------------------------

interface UiAction {
  id: string;
  action: Action;
  drafts: Drafts;
}

const uiAction = (action: Action, id = newId()): UiAction => ({ id, action, drafts: draftsOf(action) });
const uiIsValid = (ui: UiAction) => actionIsValid(ui.action) && draftsAreValid(ui.action, ui.drafts);

const settingsOf = (action: Action, type: string) => (action[type] ?? {}) as Record<string, unknown>;
const text = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

/**
 * One setting in the flyout, as the plugin lays its own out: its name at 17 px, red while what is
 * set cannot be saved, what it is for, and the field as wide as the flyout with what is wrong
 * under it.
 */
function Setting({
  title,
  help,
  optional,
  invalid,
  error,
  children,
}: {
  title: string;
  help?: ReactNode;
  optional?: boolean;
  invalid?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <>
      <CustomLabel title={title} help={help} optional={optional} invalid={invalid} />
      <div className="ismSfRow">
        {children}
        {invalid && error && <div className="ismSfRow__error">{error}</div>}
      </div>
    </>
  );
}

/** A switch on a line of its own, as a form row of the plugin holds one */
function SwitchLine({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}) {
  return (
    <div className="ismSfSwitch">
      <Switch compressed label={label} checked={checked} onChange={onChange} testId={testId} />
    </div>
  );
}

/** What the plugin says in an orange box over the settings it is about */
function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="ismSfWarning">
      <p>{children}</p>
    </div>
  );
}

function ActionFields({ ui, onChange }: { ui: UiAction; onChange: (ui: UiAction) => void }) {
  const type = actionType(ui.action) ?? '';
  const settings = settingsOf(ui.action, type);
  const set = (changes: Record<string, unknown>) => {
    const next = { ...settings, ...changes };
    for (const [key, value] of Object.entries(changes)) if (value === undefined) delete next[key];
    onChange({ ...ui, action: { ...ui.action, [type]: next } });
  };
  const draft = (name: string, value: string) => onChange({ ...ui, drafts: { ...ui.drafts, [name]: value } });
  // As the plugin's: the names of an action's settings turn red together while it cannot be saved
  const invalid = !actionIsValid(ui.action);

  switch (type) {
    case 'alias': {
      const { add, remove } = aliasesOf(ui.action);
      const write = (added: string[], removed: string[]) =>
        set({
          actions: [
            ...added.map((alias) => ({ add: { alias } })),
            ...removed.map((alias) => ({ remove: { alias } })),
          ],
        });
      return <AliasFields add={add} remove={remove} errors={aliasErrors(ui.action)} onChange={write} />;
    }
    case 'allocation':
    case 'rollup':
      return (
        <AceJsonEditor
          key={type}
          value={ui.drafts.json ?? ''}
          onChange={(json) => draft('json', json)}
          height={500}
          cursorAtEnd
        />
      );
    case 'convert_index_to_remote': {
      const pattern = typeof settings.rename_pattern === 'string' ? settings.rename_pattern : '$1_remote';
      const patternValid = pattern.trim().length > 0 && pattern.includes('$1');
      const replicas = settings.number_of_replicas as number | undefined;
      return (
        <>
          <Setting
            title="Repository"
            help="The repository name registered through the native snapshot API operations. Must be a remote repository type (e.g., S3, Azure, or GCS)."
            invalid={!settings.repository}
          >
            <TextField
              compact
              value={text(settings.repository)}
              onChange={(repository) => set({ repository })}
              testId="action-render-convert-index-to-remote-repository"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Snapshot"
            help="The snapshot name created through the snapshot action. You can use variables like {{ctx.index}} for dynamic naming."
            invalid={!settings.snapshot}
          >
            <TextField
              compact
              value={text(settings.snapshot)}
              onChange={(snapshot) => set({ snapshot })}
              testId="action-render-convert-index-to-remote-snapshot"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Rename pattern"
            help="The pattern used to name the restored remote index. Must include $1 to reference the source index name."
            invalid={!patternValid}
            error="Rename pattern must be non-empty and contain $1."
          >
            <TextField
              compact
              value={pattern}
              onChange={(rename_pattern) => set({ rename_pattern })}
              testId="action-render-convert-index-to-remote-rename-pattern"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Include aliases"
            help="Whether to include index aliases during the restore operation. Set to true if your application references the index through aliases."
          >
            <SwitchLine
              label="Include aliases"
              checked={Boolean(settings.include_aliases)}
              onChange={(include_aliases) => set({ include_aliases })}
              testId="action-render-convert-index-to-remote-include-aliases"
            />
          </Setting>
          <Spacer size="s" />
          <Setting title="Delete original index" help="Delete the local source index after the restored remote index is confirmed.">
            <SwitchLine
              label="Delete original index"
              checked={Boolean(settings.delete_original_index)}
              onChange={(delete_original_index) => set({ delete_original_index })}
              testId="action-render-convert-index-to-remote-delete-original-index"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Ignore index settings"
            help="A comma-separated list of index settings to ignore during the restore operation (e.g., 'index.refresh_interval,index.number_of_replicas')."
          >
            <TextField
              compact
              value={text(settings.ignore_index_settings)}
              onChange={(ignore_index_settings) => set({ ignore_index_settings })}
              testId="action-render-convert-index-to-remote-ignore-index-settings"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Number of replicas"
            optional
            help="The number of replicas to configure for the restored remote index. Leave empty to inherit the value from the snapshot."
            invalid={!(replicas === undefined || replicas >= 0)}
            error="Number of replicas must be non-negative."
          >
            <NumberField
              compact
              min={0}
              value={replicas}
              onChange={(number_of_replicas) => set({ number_of_replicas })}
              testId="action-render-convert-index-to-remote-number-of-replicas"
            />
          </Setting>
        </>
      );
    }
    case 'force_merge':
      return (
        <Setting title="Max num segments" help="The number of segments to merge to." invalid={invalid}>
          <NumberField
            compact
            value={settings.max_num_segments as number | undefined}
            onChange={(max_num_segments) => set({ max_num_segments })}
            testId="action-render-force-merge"
          />
        </Setting>
      );
    case 'index_priority':
      return (
        <Setting title="Priority" help="Higher priority indices are recovered first when possible." invalid={invalid}>
          <NumberField
            compact
            value={settings.priority as number | undefined}
            onChange={(priority) => set({ priority })}
            testId="action-render-index-priority"
          />
        </Setting>
      );
    case 'notification': {
      if (ui.drafts.json) {
        return (
          <LegacyNotification
            inAction
            json={ui.drafts.json}
            onChange={(json) => draft('json', json)}
            onSwitch={() => onChange(uiAction(ACTION_DEFAULTS.notification, ui.id))}
          />
        );
      }
      const channel = (settings.channel ?? {}) as { id?: string };
      const template = (settings.message_template ?? {}) as { source?: string };
      return (
        <ChannelNotification
          inAction
          channelId={channel.id ?? ''}
          message={template.source ?? ''}
          onChannel={(id) => set({ channel: { id } })}
          onMessage={(source) => set({ message_template: { source } })}
        />
      );
    }
    case 'replica_count':
      return (
        <Setting title="Number of replicas" help="The number of replicas to set for the index." invalid={invalid}>
          <NumberField
            compact
            value={settings.number_of_replicas as number | undefined}
            onChange={(number_of_replicas) => set({ number_of_replicas })}
            testId="action-render-replica-count"
          />
        </Setting>
      );
    case 'rollover':
      return (
        <>
          <Setting
            title="Minimum index age"
            help={'The minimum age required to roll over the index. Accepts time units, e.g. "5h" or "1d".'}
            invalid={invalid}
          >
            <TextField
              compact
              value={text(settings.min_index_age)}
              onChange={(value) => set({ min_index_age: value || undefined })}
              testId="action-render-rollover-min-index-age"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Minimum doc count"
            help="The minimum number of documents required to roll over the index."
            invalid={invalid}
          >
            <NumberField
              compact
              value={settings.min_doc_count as number | undefined}
              onChange={(min_doc_count) => set({ min_doc_count })}
              testId="action-render-rollover-min-doc-count"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Minimum index size"
            help={'The minimum size of the total primary shard storage required to roll over the index. Accepts byte units, e.g. "500mb" or "50gb".'}
            invalid={invalid}
          >
            <TextField
              compact
              value={text(settings.min_size)}
              onChange={(value) => set({ min_size: value || undefined })}
              testId="action-render-rollover-min-size"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Minimum primary shard size"
            help={'The minimum size of a single primary shard required to roll over the index. Accepts byte units, e.g. "500mb" or "50gb".'}
            invalid={invalid}
          >
            <TextField
              compact
              value={text(settings.min_primary_shard_size)}
              onChange={(value) => set({ min_primary_shard_size: value || undefined })}
              testId="action-render-rollover-min-primary-shard-size"
            />
          </Setting>
        </>
      );
    case 'shrink':
      // As the plugin's, what is typed is kept as it is typed: a number of shards is sent as text
      return (
        <>
          {invalid && <Warning>Exactly one setting specifying the number of primary shards to shrink to must be used.</Warning>}
          <Setting
            title="Number of new shards"
            help="The number of primary shards to attempt to shrink the index down to. This must be a factor of the number of source index primary shards or else the greatest factor lower than your requested number of targeted primary shards will be used."
            invalid={invalid}
          >
            <TextField
              compact
              value={text(settings.num_new_shards)}
              onChange={(value) => set({ num_new_shards: value || undefined })}
              testId="action-render-shrink-num-new-shards"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Maximum shard size"
            help={'The maximum size of each primary shard following the shrink. This will be used to calculate the lowest factor of the number of source index primary shards to shrink to which satisfies the maximum shard size requirement. Accepts byte units, e.g. "500mb" or "50gb".'}
            invalid={invalid}
          >
            <TextField
              compact
              value={text(settings.max_shard_size)}
              onChange={(value) => set({ max_shard_size: value || undefined })}
              testId="action-render-shrink-max-shard-size"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Percentage of source shards"
            help="The percentage of source shards to shrink to. This will be used to calculate the greatest factor of the number of source index primary shards to shrink to which is less than the number of source shards times the percentage to shrink to. Accepts a percentage as a decimal, e.g. 0.5"
            invalid={invalid}
          >
            <TextField
              compact
              value={text(settings.percentage_of_source_shards)}
              onChange={(value) => set({ percentage_of_source_shards: value || undefined })}
              testId="action-render-shrink-percentage-of-source-shards"
            />
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Target Index Name Template"
            optional
            help={'The mustache template to use to form the name of the output shrunken index. If not provided, a default suffix of "_shrunken" will be appended.'}
            invalid={!draftIsValid(ui.drafts.template)}
          >
            <AceJsonEditor
              value={ui.drafts.template ?? ''}
              onChange={(json) => draft('template', json)}
              height={100}
              cursorAtEnd
            />
          </Setting>
          <Spacer size="s" />
          {Boolean(settings.force_unsafe) && (
            <Warning>
              Warning: shrinking without replicas will allocate all primaries to one node, which could result in a complete
              loss of the index in the case of a node crashing.
            </Warning>
          )}
          <Setting
            title="Force unsafe"
            help="If this is set to 'No' then the shrink action will fail for indices which do not have replica shards."
          >
            <div>
              <Radio
                id="no"
                name="forceUnsafe"
                label="No"
                checked={!settings.force_unsafe}
                onChange={() => set({ force_unsafe: false })}
              />
              <Radio
                id="yes"
                name="forceUnsafe"
                label="Yes"
                checked={Boolean(settings.force_unsafe)}
                onChange={() => set({ force_unsafe: true })}
              />
            </div>
          </Setting>
          <Spacer size="s" />
          <Setting
            title="Aliases"
            optional
            help="The aliases to be applied to the output shrunken index."
            invalid={!draftIsValid(ui.drafts.aliases)}
          >
            <AceJsonEditor
              value={ui.drafts.aliases ?? ''}
              onChange={(json) => draft('aliases', json)}
              height={100}
              cursorAtEnd
            />
          </Setting>
        </>
      );
    case 'snapshot':
      return (
        <>
          <Setting
            title="Repository"
            help="The repository name that you register through the native snapshot API operations."
            invalid={invalid}
          >
            <TextField
              compact
              value={text(settings.repository)}
              onChange={(repository) => set({ repository })}
              testId="action-render-snapshot-repository"
            />
          </Setting>
          <Spacer size="s" />
          <Setting title="Snapshot" help="The name of the snapshot." invalid={invalid}>
            <TextField
              compact
              value={text(settings.snapshot)}
              onChange={(snapshot) => set({ snapshot })}
              testId="action-render-snapshot-snapshot"
            />
          </Setting>
        </>
      );
    default:
      // The actions that have nothing to set
      return <div />;
  }
}

const MAX_ALIASES = 10;

function AliasFields({
  add,
  remove,
  errors,
  onChange,
}: {
  add: string[];
  remove: string[];
  errors: { add?: string; remove?: string };
  onChange: (add: string[], remove: string[]) => void;
}) {
  const [adding, setAdding] = useState(add.length > 0);
  const [removing, setRemoving] = useState(remove.length > 0);
  const limit = (count: number) => {
    const left = MAX_ALIASES - count;
    return (
      <span className="ismSfLimit">
        {left > 0
          ? `You can add up to ${left} more ${left === 1 ? 'alias' : 'aliases'}.`
          : `You have reached the limit of ${MAX_ALIASES} aliases.`}
      </span>
    );
  };
  // As the plugin's: no list to choose from, and nothing more is taken once ten are entered
  const aliases = (
    kind: 'add' | 'remove',
    names: string[],
    error: string | undefined,
    write: (names: string[]) => void
  ) => (
    <>
      <Spacer size="m" />
      <FormRow full label={`Select aliases to ${kind === 'add' ? 'add to' : 'remove from'} indexes`} error={error}>
        <span>
          <span className="ismSfCombo">
            <ComboBox
              compact
              allowCustom
              placeholder={`Enter aliases to ${kind}`}
              options={[]}
              selected={names}
              onChange={(next) => write(next.slice(0, MAX_ALIASES))}
              invalid={error !== undefined}
              testId={`${kind}-alias-combo-box`}
            />
          </span>
          {limit(names.length)}
        </span>
      </FormRow>
    </>
  );
  return (
    <>
      <SwitchLine
        label="Add aliases"
        checked={adding}
        onChange={(checked) => {
          if (!checked && add.length > 0) onChange([], remove);
          setAdding(checked);
        }}
        testId="add-alias-toggle"
      />
      {adding && aliases('add', add, errors.add, (names) => onChange(names, remove))}
      <Spacer />
      <SwitchLine
        label="Remove aliases"
        checked={removing}
        onChange={(checked) => {
          if (!checked && remove.length > 0) onChange(add, []);
          setRemoving(checked);
        }}
        testId="remove-alias-toggle"
      />
      {removing && aliases('remove', remove, errors.remove, (names) => onChange(add, names))}
    </>
  );
}

const BACKOFFS = [
  { value: 'exponential', label: 'Exponential' },
  { value: 'constant', label: 'Constant' },
  { value: 'linear', label: 'Linear' },
];

/** What an action does when it fails or takes too long, folded away under the action's settings */
function TimeoutRetry({ ui, onChange }: { ui: UiAction; onChange: (ui: UiAction) => void }) {
  const [open, setOpen] = useState(false);
  const retry = (ui.action.retry ?? {}) as { count?: number; backoff?: string; delay?: string };
  const set = (changes: Record<string, unknown>) => onChange({ ...ui, action: { ...ui.action, ...changes } });
  const setRetry = (changes: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...retry, ...changes };
    if (next.count === undefined) delete next.count;
    set({ retry: next });
  };
  return (
    <div className={cx('ismSfMore', open && 'ismSfMore--open')}>
      <button
        type="button"
        className="ismSfMore__button"
        aria-expanded={open}
        aria-controls="timeout-retry-settings"
        onClick={() => setOpen(!open)}
      >
        <span className="ismSfMore__arrow">
          <Icon name="chevronRight" />
        </span>
        <span>Timeout and retry settings</span>
      </button>
      <div className="ismSfMore__body" id="timeout-retry-settings" hidden={!open}>
        <p className="ismSfGrey">
          Timeout and retry settings are supported to handle an action failure. You can specify parameters based on your
          need.
        </p>
        <div>
          <Setting title="Timeout" help={'The timeout period for the action. Accepts time units, e.g. "5h" or "1d".'}>
            <TextField compact value={text(ui.action.timeout)} onChange={(timeout) => set({ timeout })} />
          </Setting>
        </div>
        <div>
          <Setting
            title="Retry count"
            help="The number of times the action should be retried if it fails. Must be greater than 0."
          >
            <NumberField compact min={0} value={retry.count} onChange={(count) => setRetry({ count })} />
          </Setting>
        </div>
        <div>
          <Setting title="Retry backoff" help="The backoff policy type to use when retrying.">
            {/* As the plugin's: nothing chosen shows the first of the three */}
            <Select
              compact
              id="retry-backoff-type"
              value={retry.backoff ?? ''}
              onChange={(backoff) => setRetry({ backoff })}
              options={BACKOFFS}
            />
          </Setting>
        </div>
        <div>
          <Setting title="Retry delay" help={'The time to wait between retries. Accepts time units, e.g. "2h" or "1d"'}>
            <TextField compact value={retry.delay ?? ''} onChange={(delay) => setRetry({ delay })} />
          </Setting>
        </div>
      </div>
    </div>
  );
}

/** The two buttons under the form of an action or a transition, at the right */
function FlyoutButtons({
  edit,
  what,
  disabled,
  onCancel,
  onSave,
}: {
  edit: boolean;
  what: string;
  disabled?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="ismSfFoot ismSfFoot--end">
      <Button variant="empty" className="ismSfFoot__cancel" onClick={onCancel} testId="flyout-footer-cancel-button">
        Cancel
      </Button>
      <Button variant="primary" disabled={disabled} onClick={onSave} testId="flyout-footer-action-button">
        {`${edit ? 'Edit' : 'Add'} ${what}`}
      </Button>
    </div>
  );
}

/** The heading of the form of an action or a transition, and what one is */
function FormIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 className="ismSfTitle">{title}</h3>
      <div className="ismSfIntro">{children}</div>
      <Spacer />
    </>
  );
}

// --- The form of a transition ---------------------------------------------------------------------------------

interface UiTransition {
  id: string;
  transition: Transition;
}

function TransitionFields({ ui, onChange }: { ui: UiTransition; onChange: (ui: UiTransition) => void }) {
  const kind = conditionKind(ui.transition);
  const conditions = ui.transition.conditions ?? {};
  const set = (next: Transition['conditions']) => {
    const transition: Transition = { ...ui.transition, conditions: next };
    if (next === undefined) delete transition.conditions;
    onChange({ ...ui, transition });
  };
  const cron = conditions.cron?.cron ?? { expression: '', timezone: '' };
  return (
    <>
      <Setting title="Condition" help="Specify the condition needed to be met to transition to the destination state.">
        <Select
          compact
          id="condition-type"
          className="ismSfCapital"
          value={kind}
          onChange={(chosen) => set(conditionsOf(chosen))}
          options={CONDITION_OPTIONS}
          testId="create-state-action-type"
        />
      </Setting>
      <Spacer />
      {kind === 'min_index_age' && (
        <Setting title="Minimum index age" help="The minimum age required to transition to the next state.">
          <TextField
            compact
            value={conditions.min_index_age ?? ''}
            onChange={(min_index_age) => set({ min_index_age })}
            testId="transition-render-conditions-min-index-age"
          />
        </Setting>
      )}
      {kind === 'min_doc_count' && (
        <Setting title="Minimum doc count" help="The minimum number of documents required to transition to the next state.">
          <NumberField
            compact
            value={conditions.min_doc_count}
            onChange={(min_doc_count) => set({ min_doc_count })}
            testId="transition-render-conditions-min-doc-count"
          />
        </Setting>
      )}
      {kind === 'min_size' && (
        <Setting
          title="Minimum index size"
          help="The minimum size of the total primary shard storage required to transition to the next state."
        >
          <TextField
            compact
            value={conditions.min_size ?? ''}
            onChange={(min_size) => set({ min_size })}
            testId="transition-render-conditions-min-size"
          />
        </Setting>
      )}
      {kind === 'min_rollover_age' && (
        <Setting
          title="Minimum rollover age"
          help="The minimum age after a rollover has occurred that is required to transition to the next state."
        >
          <TextField
            compact
            value={conditions.min_rollover_age ?? ''}
            onChange={(min_rollover_age) => set({ min_rollover_age })}
            testId="transition-render-conditions-min-rollover-age"
          />
        </Setting>
      )}
      {kind === 'cron' && (
        <>
          <Setting
            title="Cron expression"
            help={
              <>
                The matching cron expression required to transition to the next state. <DocsLink href={TRANSITION_DOCS} />
              </>
            }
          >
            {/* The test id is the plugin's own, which names another condition */}
            <TextField
              compact
              value={cron.expression}
              onChange={(expression) => set({ cron: { cron: { ...cron, expression } } })}
              testId="transition-render-conditions-min-size"
            />
          </Setting>
          <Spacer />
          <Setting title="Timezone" help="A day starts from 00:00:00 in the specified timezone.">
            <Select
              compact
              id="timezone"
              value={cron.timezone}
              onChange={(timezone) => set({ cron: { cron: { ...cron, timezone } } })}
              options={TIME_ZONES}
            />
          </Setting>
        </>
      )}
    </>
  );
}

// --- The flyout that creates or edits a state ----------------------------------------------------------------

/** The actions or the transitions of a state, each in a panel that can be dragged to another place */
function Draggable<Item extends { id: string }>({
  items,
  what,
  content,
  onOrder,
  onEdit,
  onDelete,
}: {
  items: Item[];
  what: string;
  content: (item: Item) => ReactNode;
  onOrder: (items: Item[]) => void;
  onEdit: (item: Item) => void;
  onDelete: (index: number) => void;
}) {
  const [dragged, setDragged] = useState<number>();
  const drop = (target: number) => {
    if (dragged === undefined || dragged === target) return;
    const next = [...items];
    const [moved] = next.splice(dragged, 1);
    next.splice(target, 0, moved);
    onOrder(next);
    setDragged(undefined);
  };
  return (
    <div className="ismSfItems">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="ismSfItem"
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => drop(index)}
        >
          <div
            className="ismSfItem__handle"
            aria-label="Drag Handle"
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(event) => {
              // The whole panel goes with the pointer, as the plugin's does
              const panel = event.currentTarget.parentElement;
              if (panel) event.dataTransfer.setDragImage(panel, 25, 33);
              setDragged(index);
            }}
            onDragEnd={() => setDragged(undefined)}
          >
            <Icon name="grab" />
          </div>
          <div className="ismSfItem__text">{content(item)}</div>
          <Tooltip content={`Delete ${what}`} position="top" delay="regular">
            <IconButton
              icon="trash"
              label="Delete"
              title=""
              variant="dangerEmpty"
              className="ismRoundButton"
              onClick={() => onDelete(index)}
              testId={`draggable-item-delete-button-${item.id}`}
            />
          </Tooltip>
          <Tooltip content={`Edit ${what}`} position="top" delay="regular">
            <IconButton
              icon="pencil"
              label="Edit"
              title=""
              variant="empty"
              className="ismRoundButton"
              onClick={() => onEdit(item)}
              testId={`draggable-item-edit-button-${item.id}`}
            />
          </Tooltip>
        </div>
      ))}
    </div>
  );
}

/** What the flyout says where a state has no actions, or no transitions, yet */
function NoneAdded({ what }: { what: string }) {
  return (
    <p className="ismSfNone">
      <span className="ismSfGrey">{`No ${what} have been added.`}</span>
    </p>
  );
}

function StateFlyout({
  state,
  policy,
  onSave,
  onClose,
}: {
  state?: State;
  policy: Policy;
  onSave: (state: State, order: Order, afterBeforeState: string) => void;
  onClose: () => void;
}) {
  const proposed = useMemo(() => orderInfo(state, policy.states), [state, policy.states]);
  const [name, setName] = useState(state?.name ?? '');
  const [nameError, setNameError] = useState('');
  const [order, setOrder] = useState<Order>(proposed.order);
  const [afterBeforeState, setAfterBeforeState] = useState(proposed.afterBeforeState);
  const [actions, setActions] = useState<UiAction[]>(() => (state?.actions ?? []).map((action) => uiAction(action)));
  const [transitions, setTransitions] = useState<UiTransition[]>(() =>
    (state?.transitions ?? []).map((transition) => ({ id: newId(), transition }))
  );
  // The action or transition worked on; an action has no form until its kind is chosen
  const [action, setAction] = useState<{ ui?: UiAction; edit: boolean }>();
  const [transition, setTransition] = useState<{ ui: UiTransition; edit: boolean }>();

  const changeName = (next: string) => {
    const taken = next !== state?.name && policy.states.some((other) => other.name === next);
    setName(next);
    setNameError(taken ? 'A state with this name already exists.' : '');
  };

  // As the plugin's: the flyout is named after what it does only while the state itself is shown
  let title = action || transition ? 'State' : `${state ? 'Edit' : 'Create'} state`;
  if (name) title += `: ${name}`;

  if (action) {
    const ui = action.ui;
    const save = () => {
      if (!ui) return;
      setActions((before) =>
        action.edit ? before.map((other) => (other.id === ui.id ? ui : other)) : [...before, ui]
      );
      setAction(undefined);
    };
    const change = (next: UiAction) => setAction({ edit: action.edit, ui: next });
    return (
      <Flyout
        title={title}
        onClose={onClose}
        hideClose
        className="ismSf"
        footer={
          <FlyoutButtons
            edit={action.edit}
            what="action"
            disabled={!ui || !uiIsValid(ui)}
            onCancel={() => setAction(undefined)}
            onSave={save}
          />
        }
      >
        <FormIntro title={action.edit ? 'Edit action' : 'Add action'}>
          Actions are the operations ISM performs when an index is in a certain state. <DocsLink href={ACTIONS_DOCS} />
        </FormIntro>
        <Setting title="Action type" help="Select the action you want to add to this state.">
          {/* As the plugin's: nothing is chosen at first, and the list has no line that says so */}
          <Select
            compact
            id="action-type"
            className="ismSfCapital ismSfNoBlank"
            placeholder=""
            value={ui ? (actionType(ui.action) ?? '') : ''}
            onChange={(type) => change(uiAction(ACTION_DEFAULTS[type], ui?.id))}
            options={ACTION_OPTIONS}
            testId="create-state-action-type"
          />
        </Setting>
        <Spacer />
        {ui && <ActionFields ui={ui} onChange={change} />}
        <Spacer />
        {ui && <TimeoutRetry ui={ui} onChange={change} />}
      </Flyout>
    );
  }

  if (transition) {
    const ui = transition.ui;
    const options = policy.states.map((other) => other.name);
    const save = () => {
      setTransitions((before) =>
        transition.edit ? before.map((other) => (other.id === ui.id ? ui : other)) : [...before, ui]
      );
      setTransition(undefined);
    };
    const change = (next: UiTransition) => setTransition({ edit: transition.edit, ui: next });
    const destination = (stateName: string) => change({ ...ui, transition: { ...ui.transition, state_name: stateName } });
    return (
      <Flyout
        title={title}
        onClose={onClose}
        hideClose
        className="ismSf"
        footer={
          <FlyoutButtons edit={transition.edit} what="transition" onCancel={() => setTransition(undefined)} onSave={save} />
        }
      >
        <FormIntro title={transition.edit ? 'Edit transition' : 'Add transition'}>
          Transitions define the conditions that need to be met for a state to change. After all actions in the current
          state are completed, the policy starts checking the conditions for transitions.{' '}
          <DocsLink href={TRANSITION_DOCS} />
        </FormIntro>
        <Setting
          title="Destination state"
          help="If entering a state that does not exist yet then you must create it before creating the policy."
        >
          {/* As the plugin's: the field says nothing while it is empty, and a name typed in is kept in small letters */}
          <ComboBox
            single
            compact
            clearable={false}
            options={options.map((value) => ({ value, label: value }))}
            selected={ui.transition.state_name ? [ui.transition.state_name] : []}
            onChange={([chosen]) => destination(chosen ?? '')}
            onCreateOption={(typed) => {
              const normalized = typed.trim().toLowerCase();
              if (normalized) destination(normalized);
            }}
          />
        </Setting>
        <Spacer />
        <TransitionFields ui={ui} onChange={change} />
      </Flyout>
    );
  }

  const others = policy.states.filter((other) => other.name !== state?.name);
  const save = () =>
    onSave(
      {
        name,
        actions: actions.map((item) => withDrafts(item.action, item.drafts)),
        transitions: transitions.map((item) => item.transition),
      },
      order,
      afterBeforeState
    );
  return (
    <Flyout
      title={title}
      onClose={onClose}
      hideClose
      className="ismSf"
      footer={
        <div className="ismSfFoot">
          <Button variant="empty" icon="cross" className="ismSfFoot__cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={name.trim().length === 0 || Boolean(nameError)} onClick={save}>
            {state ? 'Update state' : 'Save state'}
          </Button>
        </div>
      }
    >
      <h3 className="ismSfTitle ismSfTitle--field">State name</h3>
      <div className="ismSfRow">
        <TextField
          compact
          value={name}
          onChange={changeName}
          invalid={Boolean(nameError)}
          placeholder="sample_hot_state"
          testId="create-state-state-name"
        />
        {nameError && <div className="ismSfRow__error">{nameError}</div>}
      </div>
      <Spacer />
      <h3 className="ismSfTitle ismSfTitle--field">Order</h3>
      <div className="ismSfOrder">
        <Select
          compact
          disabled={proposed.disableOrderSelections}
          value={order}
          onChange={(next) => setOrder(next as Order)}
          options={[
            { value: 'after', label: 'Add after' },
            { value: 'before', label: 'Add before' },
          ]}
          aria-label="Retry failed policy from"
        />
        <Select
          compact
          disabled={proposed.disableOrderSelections}
          value={afterBeforeState}
          onChange={setAfterBeforeState}
          options={others.map((other) => ({ value: other.name, label: other.name }))}
          aria-label="Retry failed policy from"
        />
      </div>
      <hr className="ismSfRule" />
      <CustomLabel title="Actions" help="Actions are the operations ISM performs when an index is in a certain state." />
      {actions.length > 0 && (
        <Draggable
          items={actions}
          what="action"
          content={(item) => actionContent(item.action)}
          onOrder={setActions}
          onEdit={(item) => setAction({ ui: item, edit: true })}
          onDelete={(index) => setActions((before) => before.filter((_, position) => position !== index))}
        />
      )}
      <Spacer size="s" />
      {actions.length === 0 && <NoneAdded what="actions" />}
      <Spacer />
      <Button onClick={() => setAction({ edit: false })}>+ Add action</Button>
      <hr className="ismSfRule" />
      <CustomLabel
        title="Transitions"
        help="Transitions define the conditions that need to be met for a state to change. After all actions in the current state are completed, the policy starts checking the conditions for transitions."
      />
      {transitions.length > 0 && (
        <Draggable
          items={transitions}
          what="transition"
          content={(item) => conditionContent(item.transition)}
          onOrder={setTransitions}
          onEdit={(item) => setTransition({ ui: item, edit: true })}
          onDelete={(index) => setTransitions((before) => before.filter((_, position) => position !== index))}
        />
      )}
      <Spacer size="s" />
      {transitions.length === 0 && <NoneAdded what="transitions" />}
      <Spacer />
      <Button onClick={() => setTransition({ edit: false, ui: { id: newId(), transition: { state_name: '' } } })}>
        + Add Transition
      </Button>
    </Flyout>
  );
}

// --- The indexes a policy applies itself to -------------------------------------------------------------------

function IsmTemplates({ policy, onChange }: { policy: Policy; onChange: (policy: Policy) => void }) {
  const templates = templatesOf(policy.ism_template);
  const write = (next: IsmTemplate[]) => onChange({ ...policy, ism_template: next });
  const add = (
    <Button onClick={() => write([...templates, { index_patterns: [], priority: 1 }])} testId="ism-templates-add-template-button">
      Add template
    </Button>
  );
  return (
    <TitledPanel
      title="ISM templates"
      optional
      description={
        <>
          Specify ISM template patterns that match the index to apply the policy. <DocsLink href={DOCS} />
        </>
      }
    >
      <div className="ismTemplates">
        {templates.length > 0 && (
          <div className="ismTemplates__row">
            <h5 className="ismTemplates__patterns">Index patterns</h5>
            <h5>Priority</h5>
          </div>
        )}
        {templates.map((template, index) => {
          const change = (changes: Partial<IsmTemplate>) =>
            write(templates.map((other, position) => (position === index ? { ...other, ...changes } : other)));
          return (
            <IsmTemplateRow
              key={index}
              template={template}
              onChange={change}
              onRemove={() => write(templates.filter((_, position) => position !== index))}
            />
          );
        })}
        {templates.length === 0 ? (
          <div className="ismStates__empty ismTemplates__empty">
            <h3>No ISM templates</h3>
            <Spacer size="m" />
            <p>
              Your policy currently has no ISM templates defined. Add ISM templates to automatically apply the policy to
              indices created in the future.
            </p>
            <Spacer />
            {add}
          </div>
        ) : (
          <>
            <Spacer />
            {add}
          </>
        )}
      </div>
    </TitledPanel>
  );
}

function IsmTemplateRow({
  template,
  onChange,
  onRemove,
}: {
  template: IsmTemplate;
  onChange: (changes: Partial<IsmTemplate>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="ismTemplates__row">
      <div className="ismTemplates__patterns">
        <ComboBox
          fullWidth
          allowCustom
          clearable={false}
          placeholder="Add index patterns"
          options={[]}
          selected={template.index_patterns}
          onChange={(patterns) => onChange({ index_patterns: patterns.filter((pattern) => pattern.trim() && !pattern.includes(' ')) })}
          testId="ism-template-index-pattern-input"
        />
      </div>
      <div className="ismTemplates__priority">
        <NumberField
          compact
          value={template.priority}
          onChange={(priority) => onChange({ priority })}
          testId="ism-template-priority-input"
        />
      </div>
      <Button variant="danger" onClick={onRemove} testId="ism-template-remove-button">
        Remove
      </Button>
    </div>
  );
}

// --- The page ---------------------------------------------------------------------------------------------------

export function VisualCreatePolicy({ isEdit }: { isEdit: boolean }) {
  const { hashParams } = useLocation();
  const id = hashParams.id ?? '';
  useBreadcrumbs(
    isEdit
      ? [CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDEX_POLICIES, CRUMBS.EDIT_POLICY, { text: id }]
      : [CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDEX_POLICIES, CRUMBS.CREATE_POLICY]
  );
  const [policyId, setPolicyId] = useState('');
  const [policyIdError, setPolicyIdError] = useState('');
  const [policy, setPolicy] = useState<Policy>(EMPTY_POLICY);
  const [version, setVersion] = useState<{ seqNo: number; primaryTerm: number }>();
  const [legacyNotification, setLegacyNotification] = useState('');
  const [flyout, setFlyout] = useState<{ state?: State }>();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    if (!id) {
      toasts.danger(`Invalid policy id: ${id}`);
      go(ROUTES.INDEX_POLICIES);
      return;
    }
    void ism.get<PolicyDocument>(`policies/${encodeURIComponent(id)}`).then((answer) => {
      if (!answer.ok || !answer.response) {
        toasts.danger(`Could not load the policy: ${answer.error}`);
        go(ROUTES.INDEX_POLICIES);
        return;
      }
      const loaded = answer.response;
      setVersion({ seqNo: loaded.seqNo, primaryTerm: loaded.primaryTerm });
      setPolicyId(loaded.id);
      setPolicy(loaded.policy);
      if (loaded.policy.error_notification?.destination) {
        setLegacyNotification(JSON.stringify(loaded.policy.error_notification, null, 4));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  const notification: ErrorNotification = policy.error_notification ?? {};
  const setNotification = (next: ErrorNotification) => setPolicy((before) => ({ ...before, error_notification: next }));

  const submit = async () => {
    setSubmitted(true);
    if (!policyId.trim()) {
      setPolicyIdError('Required');
      return;
    }
    let merged: Policy;
    try {
      merged = { ...policy };
      if (legacyNotification) merged.error_notification = JSON.parse(legacyNotification);
    } catch {
      toasts.danger('Invalid Policy');
      return;
    }
    if (isEdit && !version) {
      toasts.danger('Could not update policy without seqNo and primaryTerm');
      return;
    }
    setSubmitting(true);
    const answer = await ism.put<{ _id: string }>(
      `policies/${encodeURIComponent(policyId)}`,
      { policy: merged },
      isEdit ? { seqNo: version?.seqNo, primaryTerm: version?.primaryTerm } : undefined
    );
    setSubmitting(false);
    if (answer.ok && answer.response) {
      toasts.success(`${isEdit ? 'Updated' : 'Created'} policy: ${answer.response._id}`);
      go(ROUTES.INDEX_POLICIES);
    } else {
      toasts.danger(`Failed to ${isEdit ? 'update' : 'create'} policy: ${answer.error}`);
    }
  };

  return (
    <div className="ismPolicyEditor">
      <h1 className="atlTitleL">{`${isEdit ? 'Edit' : 'Create'} policy`}</h1>
      <Spacer size="s" />
      <p className="ismPolicyEditor__intro">
        Policies let you automatically perform administrative operations on indices. <DocsLink href={POLICY_DOCS} />
      </p>
      <Spacer size="m" />
      <TitledPanel title="Policy info">
        <CustomLabel title="Policy ID" help="Specify a unique and descriptive ID that is easy to recognize and remember." />
        <FormRow error={policyIdError || undefined}>
          <TextField
            compact
            disabled={isEdit}
            invalid={Boolean(policyIdError)}
            placeholder="hot_cold_workflow"
            value={policyId}
            onChange={(next) => {
              setPolicyId(next);
              if (submitted) setPolicyIdError(next ? '' : 'Required');
            }}
            testId="create-policy-policy-id"
          />
        </FormRow>
        <Spacer size="m" />
        <CustomLabel title="Description" help="Describe the policy." />
        <div className="ismField400">
          <TextArea
            className="ismTextArea"
            value={policy.description ?? ''}
            onChange={(description) => setPolicy((before) => ({ ...before, description }))}
            testId="create-policy-description"
          />
        </div>
      </TitledPanel>
      <Spacer size="m" />
      <TitledPanel
        title="Error notification"
        optional="title"
        description={
          <>
            You can set up an error notification for when a policy execution fails.{' '}
            <DocsLink href={`${POLICY_DOCS}#error-notifications`} />
          </>
        }
      >
        <div>
          {legacyNotification ? (
            <LegacyNotification
              json={legacyNotification}
              onChange={setLegacyNotification}
              onSwitch={() => {
                setLegacyNotification('');
                setPolicy((before) => ({ ...before, error_notification: null }));
              }}
            />
          ) : (
            <ChannelNotification
              channelId={notification.channel?.id ?? ''}
              message={notification.message_template?.source ?? ''}
              onChannel={(channel) =>
                setNotification({ message_template: { source: '', lang: 'mustache' }, ...notification, channel: { id: channel } })
              }
              onMessage={(source) =>
                setNotification({ ...notification, message_template: { ...notification.message_template, source } })
              }
            />
          )}
        </div>
      </TitledPanel>
      <Spacer size="m" />
      <IsmTemplates policy={policy} onChange={setPolicy} />
      <Spacer size="m" />
      <StatesPanel
        policy={policy}
        onAdd={() => setFlyout({})}
        onEdit={(state) => setFlyout({ state })}
        onDelete={(index) => setPolicy((before) => withoutState(before, index))}
        onDefault={(name) => setPolicy((before) => ({ ...before, default_state: name }))}
      />
      <Spacer size="m" />
      {flyout && (
        <StateFlyout
          state={flyout.state}
          policy={policy}
          onClose={() => setFlyout(undefined)}
          onSave={(state, order, afterBeforeState) => {
            setPolicy((before) => updatedPolicy(before, state, flyout.state, order, afterBeforeState));
            setFlyout(undefined);
          }}
        />
      )}
      <FormButtons>
        <Button variant="empty" onClick={() => (isEdit ? window.history.back() : go(ROUTES.INDEX_POLICIES))}>
          Cancel
        </Button>
        <Button variant="primary" loading={submitting} onClick={submit}>
          {isEdit ? 'Update' : 'Create'}
        </Button>
      </FormButtons>
    </div>
  );
}
