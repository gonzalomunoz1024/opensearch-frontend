/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the pages of Snapshot Management share: the names over their fields, the foot of their
 * flyouts, the flyout that registers a repository, the fields that say what a snapshot holds
 * and where it goes, and the three switches of a snapshot.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Accordion, Button, CallOut, cx } from '../../components/basic';
import { CodeEditor, type CodeEditorHandle } from '../../components/code_editor';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { Checkbox, FormRow, NumberField, Select, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Flyout, MenuButton, Modal, Popover, Portal, type MenuItem } from '../../components/overlay';
import { ExternalLink, ism, toasts } from './common';
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
  settingsTokens,
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

/** Facts of a policy or a snapshot, three in a row as the plugin's grid has them, or two, or one */
export function Facts({
  items,
  columns = 3,
}: {
  items: Array<[string, ReactNode]>;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cx(
        'ismPolicyFacts',
        columns === 2 && 'ismPolicyFacts--two',
        columns === 1 && 'ismPolicyFacts--one'
      )}
    >
      {items.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A panel of the page of a policy, as the plugin's: its title, and a rule over what it holds */
export function PolicyPanel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ismPolicyPanel">
      <div className={cx('ismPolicyPanel__header', action !== undefined && 'ismPolicyPanel__header--action')}>
        <h2 className="atlTitleS">{title}</h2>
        {action}
      </div>
      <hr className="ismPolicyPanel__rule" />
      {children}
    </section>
  );
}

/**
 * The panel around a list of Snapshot Management, drawn as the plugin's: the title and what it
 * says on the left, the buttons on the right, a rule under them and the list 16 px in.
 */
export function ListPanel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ismListPanel">
      <header className="ismListPanel__header">
        <div className="ismListPanel__heading">
          <h1 className="atlTitleL">{title}</h1>
          {description && <p className="ismListPanel__description">{description}</p>}
        </div>
        <div className="ismListPanel__actions">{actions}</div>
      </header>
      <hr className="ismListPanel__rule" />
      <div className="ismListPanel__body">{children}</div>
    </section>
  );
}

/** The filters beside the search box of a list, joined in one group as the plugin's */
export function FilterGroup({ children }: { children: ReactNode }) {
  return <div className="ismFilterGroup">{children}</div>;
}

/** One filter of a group: a list of values, any of which a row may have */
export function GroupFilter({
  name,
  options,
  selected,
  onChange,
}: {
  name: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const items: MenuItem[] =
    options.length > 0
      ? options.map((option) => ({
          id: option,
          label: option,
          selected: selected.includes(option),
          testId: `FilterGroupSelectItem-${option}`,
          onClick: () =>
            onChange(
              selected.includes(option)
                ? selected.filter((value) => value !== option)
                : [...selected, option]
            ),
        }))
      : [{ id: 'none', label: 'No options found', disabled: true }];
  return (
    <MenuButton
      align="right"
      items={items}
      button={(toggle, open) => (
        <button
          type="button"
          className={cx('ismFilterGroup__button', selected.length > 0 && 'ismFilterGroup__button--active')}
          aria-expanded={open}
          onClick={toggle}
        >
          {/* As the plugin's, wide enough for the name in bold, which it takes once a value is chosen */}
          <span className="ismFilterGroup__name" data-text={name}>
            {name}
          </span>
          {selected.length > 0 && <span className="ismFilterCount">{selected.length}</span>}
          <Icon name="chevronDown" />
        </button>
      )}
    />
  );
}

/** The plugin's spacer: an empty line of 4, 8, 16, 24 or 40 px between the parts of a form */
export function Spacer({ size = 'l' }: { size?: 'xs' | 's' | 'm' | 'l' | 'xxl' }) {
  return <div className={`ismSpacer ismSpacer--${size}`} />;
}

/**
 * Radios one under the other with no space between them, as the plugin's radio group draws
 * them (the kit's group puts 8 px between them)
 */
export function RadioStack<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <div className="ismRadioStack">
      {options.map((option) => (
        <label key={option.id} className="atlRadio">
          <input
            type="radio"
            name={name}
            checked={option.id === value}
            onChange={() => onChange(option.id)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * A field under its name, as the plugin's label draws it: the name as a heading with, when the
 * field may be left empty, "x – optional" beside it (the "x" is the plugin's), what it means in
 * small light letters, and 8 px under them the field with what is wrong with it.
 */
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
    <div className="ismSnapField">
      <div className="ismSnapField__label">
        <h3 className="atlTitleS">{title}</h3>
        {optional && (
          <span className="ismSnapField__optional">
            x<i> – optional</i>
          </span>
        )}
      </div>
      {/* As the plugin's label: words go into its small light span, anything else stands as it is */}
      {typeof help === 'string' && help ? <span className="ismSnapField__help">{help}</span> : help}
      <Spacer size="s" />
      <div className="ismSnapField__body">{children}</div>
      {error && <div className="ismSnapField__error">{error}</div>}
    </div>
  );
}

/**
 * What a part of a form is for, as the plugin writes it where it says more than a few words:
 * small grey text in light letters, 5 px above and below it
 */
export function HelpText({ children }: { children: ReactNode }) {
  return (
    <div className="ismSnapHelp">
      <p>{children}</p>
    </div>
  );
}

/**
 * JSON to change, as the plugin's code editor shows it: 250 px high, numbered in a white gutter,
 * the line of the cursor on a band (the last line until the cursor moves) and coloured by the
 * rules of the original editor's JSON mode. The Tab key stops on a hint over it: Enter, or a
 * click, goes into the text, and Escape comes back out of it without closing what it is in.
 */
export function SettingsEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLButtonElement>(null);
  const editor = useRef<CodeEditorHandle>(null);
  // In the text: the hint is out of the way until the text is left
  const [editing, setEditing] = useState(false);
  // The line of the cursor, or null while what is selected runs over several lines
  const [cursorLine, setCursorLine] = useState<number | null>();
  const lines = value.split('\n').length;
  const activeLine =
    cursorLine === undefined ? lines - 1 : cursorLine === null ? -1 : Math.min(cursorLine, lines - 1);

  useEffect(() => {
    // The text is reached through the hint, not with the Tab key, as the original's
    box.current?.querySelector('textarea')?.setAttribute('tabindex', '-1');
  }, []);

  const lineAt = (offset: number) => {
    const text = box.current?.querySelector('textarea')?.value ?? value;
    return text.slice(0, offset).split('\n').length - 1;
  };

  return (
    <div
      ref={box}
      className="ismSnapEditor"
      data-test-subj="codeEditorContainer"
      style={{ '--ism-ace-digits': String(lines).length } as CSSProperties}
      onFocus={(event) => {
        // A click goes straight into the text, as in the original, whose hint lies under it
        if (event.target.tagName === 'TEXTAREA') setEditing(true);
      }}
      onBlur={(event) => {
        if (event.target.tagName === 'TEXTAREA') setEditing(false);
      }}
    >
      <button
        ref={hint}
        type="button"
        className={cx('ismSnapEditor__hint', editing && 'ismSnapEditor__hint--inactive')}
        onClick={() => {
          setEditing(true);
          editor.current?.focus();
        }}
        data-test-subj="codeEditorHint"
      >
        <p>Press Enter to start editing.</p>
        <p>{"When you're done, press Escape to stop editing."}</p>
      </button>
      <CodeEditor
        handle={editor}
        value={value}
        onChange={onChange}
        height={250}
        fontSize={14}
        tokenize={settingsTokens}
        markedLines={activeLine >= 0 ? [activeLine, activeLine] : undefined}
        onCursor={(start, end) => {
          const first = lineAt(start);
          setCursorLine(first === lineAt(end) ? first : null);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          flushSync(() => setEditing(false));
          hint.current?.focus();
        }}
        ariaLabel={label}
      />
    </div>
  );
}

/** The label of a tick, as the plugin's: what it does, and under it in light letters what that means */
export function TickLabel({ title, help }: { title: string; help?: string }) {
  return (
    <span className="ismTickLabel">
      <span className="ismTickLabel__title">{title}</span>
      {help && <span className="ismTickLabel__help">{help}</span>}
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
      <Button
        variant="empty"
        className="ismFlyoutFooter__cancel"
        onClick={onCancel}
        testId="flyout-footer-cancel-button"
      >
        Cancel
      </Button>
      <Button
        variant="primary"
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

/**
 * The plugin's dialog that asks before something is deleted: OUI's confirmation modal inside a mask
 * the plugin adds around it, so the page behind is dimmed and blurred twice. It is as wide as its
 * words, from 400 up to 768 px, under a large title, with the theme's tall buttons. As OUI's, it
 * gives the confirm button the focus whenever it is drawn and the button can be pressed (so the
 * focus leaves the field the moment "delete" is complete); until then the dialog itself has it.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  disabled,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const opening = useRef(true);
  // After every drawing, once the dialog has put the focus where it puts it (its first field)
  useEffect(() => {
    const dialog = body.current?.closest<HTMLElement>('[role="dialog"]');
    const confirm = dialog?.querySelector<HTMLButtonElement>(
      '[data-test-subj="confirmModalConfirmButton"]'
    );
    if (confirm && !confirm.disabled) confirm.focus();
    else if (opening.current) dialog?.focus();
    opening.current = false;
  });
  return (
    <>
      {/* The plugin's own mask; the dialog brings the other */}
      <Portal>
        <div className="atlScrim" aria-hidden="true" />
      </Portal>
      <Modal
        title={<span data-test-subj="confirmModalTitleText">{title}</span>}
        onClose={onCancel}
        className="ismConfirm"
        footer={
          <>
            <Button variant="empty" onClick={onCancel} testId="confirmModalCancelButton">
              Cancel
            </Button>
            <Button
              variant="dangerFill"
              disabled={disabled}
              onClick={onConfirm}
              testId="confirmModalConfirmButton"
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div ref={body} className="ismConfirm__body" data-test-subj="confirmModalBodyText">
          {children}
        </div>
      </Modal>
    </>
  );
}

/** The field a deletion waits for, as the plugin's: "delete" typed in it */
function DeleteWord({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <FormRow help={'To confirm deletion, type "delete".'}>
      <TextField
        value={value}
        onChange={onChange}
        placeholder="delete"
        compact
        testId="deleteTextField"
        aria-label="delete"
      />
    </FormRow>
  );
}

/**
 * Deletes repositories or snapshots, as the plugin's dialog for them: what goes, and what goes with
 * it; with `confirm`, only once "delete" is typed. It closes as soon as it is confirmed, and the
 * deletions are told one by one in the corner.
 */
export function DeleteDialog({
  type,
  ids,
  warning,
  confirm,
  onCancel,
  onDelete,
}: {
  type: 'repository' | 'snapshot';
  ids: string;
  warning?: string;
  confirm?: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [word, setWord] = useState(confirm ? '' : 'delete');
  return (
    <ConfirmDialog
      title={`Delete ${type}`}
      confirmLabel={`Delete ${type}`}
      disabled={word !== 'delete'}
      onCancel={onCancel}
      onConfirm={() => {
        onDelete();
        onCancel();
      }}
    >
      <p>
        Delete "<strong>{ids}</strong>" permanently? {warning}
      </p>
      <Spacer size="s" />
      {confirm && <DeleteWord value={word} onChange={setWord} />}
    </ConfirmDialog>
  );
}

/**
 * Deletes snapshot policies, as the plugin's dialog for policies: once "delete" is typed; it stays
 * open until the page that opened it closes it
 */
export function DeletePolicyDialog({
  policyIds,
  onCancel,
  onDelete,
}: {
  policyIds: string;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [word, setWord] = useState('');
  return (
    <ConfirmDialog
      title="Delete policy"
      confirmLabel="Delete policy"
      disabled={word !== 'delete'}
      onCancel={onCancel}
      onConfirm={onDelete}
    >
      Delete "<strong>{policyIds}</strong>" permanently? Indices will no longer be managed using this
      policy.
      <Spacer size="s" />
      <DeleteWord value={word} onChange={setWord} />
    </ConfirmDialog>
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
        {/* As the plugin's, what is wrong stands under a field that keeps its own look */}
        <Field title="Repository name" error={nameError}>
          <TextField
            value={name}
            onChange={(value) => {
              setName(value);
              setNameError('');
            }}
            compact
            testId="repoNameInput"
          />
        </Field>
        <Spacer size="m" />
        <Field
          title="Repository type"
          help={
            <HelpText>
              Select a supported repository type. For additional types, install the latest
              repository plugins and choose Custom configuration.{' '}
              <ExternalLink href={REPOSITORY_DOCS} />
            </HelpText>
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
        <Spacer size="m" />
        {kind === 'fs' ? (
          <>
            <Field title="Location" error={locationError}>
              <TextField
                value={location}
                onChange={(value) => {
                  setLocation(value);
                  setLocationError('');
                }}
                placeholder="e.g., /mnt/snapshots"
                compact
              />
            </Field>
            <Spacer />
            <div className="ismSnapshotForm__accordion">
              <Accordion
                title={<h3 className="atlTitleS">Advanced settings</h3>}
                initiallyOpen={false}
              >
                <Spacer size="s" />
                <HelpText>
                  Define additional settings for this repository.{' '}
                  <ExternalLink href={FS_REPOSITORY_DOCS} />
                </HelpText>
                <SettingsEditor value={fsText} onChange={setFsText} label="Advanced settings" />
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
            <Spacer size="s" />
            <Field
              title="Custom configuration"
              help={
                <HelpText>
                  Define a repository by custom type and settings.{' '}
                  <ExternalLink href={S3_REPOSITORY_DOCS}>View sample configurations</ExternalLink>
                </HelpText>
              }
            >
              <SettingsEditor
                value={customText}
                onChange={setCustomText}
                label="Custom configuration"
              />
            </Field>
          </>
        )}
        <Spacer size="m" />
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
  /**
   * Called once a repository was registered from here, for the list to be read again. Without
   * it there is no "Create repository" button, as in the plugin's flyout that takes a snapshot.
   */
  onRepositoryCreated?: () => void | Promise<void>;
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
      <Spacer size="m" />
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
        {onRepositoryCreated && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            Create repository
          </Button>
        )}
      </div>
      {creating && onRepositoryCreated && (
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
      <Spacer size="m" />
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
      <Spacer size="m" />
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
    <>
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
      <Spacer size="m" />
      <div className="ismCron__row">
        <div className="ismCron__start">
          {frequencyType === 'custom' ? (
            <Field title="Cron expression">
              <TextField value={expression} onChange={onExpression} compact disabled={disabled} />
              <p className="ismCron__help">
                Use Cron expression to define complex schedule. <ExternalLink href={CRON_DOCS} />
              </p>
            </Field>
          ) : (
            <>
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
              </Field>
              <Spacer size="s" />
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
                <Field title="On the">
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
                </Field>
              )}
            </>
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
    </>
  );
}
