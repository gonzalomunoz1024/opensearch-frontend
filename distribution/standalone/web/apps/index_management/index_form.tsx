/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parts of a form that describes an index, a template or a component template: the aliases,
 * the settings with their advanced editor, and the mappings with their visual and JSON editors.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, CallOut, IconButton, cx } from '../../components/basic';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { NumberField, Select, Switch, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Menu, Modal, Popover, Tooltip } from '../../components/overlay';
import { ExternalLink, JsonEditor, ism } from './common';
import { FormRow } from './form_row';
import {
  INDEX_DYNAMIC_SETTINGS,
  MAPPING_TYPES,
  fieldAt,
  fieldErrors,
  fieldsArePlain,
  fieldsOf,
  flatten,
  mappingType,
  ordered,
  parsedObject,
  propertiesOf,
  replicasError,
  shardsError,
  withFields,
  withType,
  type MappingField,
  type Mappings,
} from './index_model';
import { INDEX_NAMING_MESSAGE, INDEX_NAMING_PATTERN, SYSTEM_ALIAS, matchesAny } from './model';

const DOCS = 'https://opensearch.org/docs/latest';
const INDEX_SETTINGS_URL = `${DOCS}/install-and-configure/configuring-opensearch/index-settings/#index-level-index-settings`;
export const REPLICA_NUMBER_MESSAGE = 'Specify the number of replicas each primary shard should have. Default is 1.';

// --- Aliases -------------------------------------------------------------------------------------------

export type AliasMap = Record<string, Record<string, unknown>>;

/** What is wrong with the names of the chosen aliases */
export function aliasesError(aliases: AliasMap | undefined): string | undefined {
  const wrong = Object.keys(aliases ?? {}).filter((name) => !INDEX_NAMING_PATTERN.test(name));
  if (wrong.length === 0) return undefined;
  return `Invalid alias name for ${wrong.join(', ')}. Rule for alias name: ${INDEX_NAMING_MESSAGE}`;
}

/** The aliases of the cluster to choose from; a name that is none of them becomes a new alias */
export function AliasSelect({
  value,
  onChange,
  invalid,
  disabled,
  testId,
  fromStart,
}: {
  value: AliasMap | undefined;
  onChange: (value: AliasMap) => void;
  invalid?: boolean;
  disabled?: boolean;
  testId?: string;
  /** Looks for the aliases that begin with what is typed, not for those that hold it */
  fromStart?: boolean;
}) {
  const [options, setOptions] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const turn = useRef(0);
  const wanted = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const search = async (text: string) => {
    const mine = (turn.current += 1);
    setLoading(true);
    const answer = await ism.call<Array<{ alias: string }>>('cat.aliases', {
      format: 'json',
      name: fromStart ? `${text}*` : `*${text}*`,
      s: 'alias:desc',
    });
    if (mine !== turn.current) return;
    setLoading(false);
    if (!answer.ok || !answer.response) return;
    const names = [...new Set(answer.response.map((item) => item.alias))].filter(
      (name) => name && !matchesAny(name, SYSTEM_ALIAS)
    );
    setOptions(names.map((name) => ({ value: name, label: name })));
  };
  // The cluster is asked once the typing has stopped for half a second
  const later = (text: string) => {
    wanted.current = text;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(text), 500);
  };
  useEffect(() => {
    void search('');
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = Object.keys(value ?? {});
  return (
    <ComboBox
      options={[...options, ...chosen.filter((name) => !options.some((option) => option.value === name)).map((name) => ({ value: name, label: name }))]}
      selected={chosen}
      onChange={(names) => {
        onChange(Object.fromEntries(names.map((name) => [name, value?.[name] ?? {}])));
        // What was typed is gone with the choice, and the list is whole again
        if (wanted.current !== '') later('');
      }}
      onSearch={later}
      loading={loading}
      allowCustom
      placeholder="Select aliases or specify new aliases."
      invalid={invalid}
      disabled={disabled}
      compact
      testId={testId}
    />
  );
}

// --- Settings ------------------------------------------------------------------------------------------

type Settings = Record<string, unknown>;

/** What is wrong with the settings, by the name of the setting */
export function settingsErrors(settings: Settings | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  const shards = shardsError(settings?.['index.number_of_shards']);
  const replicas = replicasError(settings?.['index.number_of_replicas']);
  if (shards) errors['index.number_of_shards'] = shards;
  if (replicas) errors['index.number_of_replicas'] = replicas;
  return errors;
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export const JSON_FORMAT_ERROR =
  'Your input does not match the validation of json format, please fix the error line with error aside.';

/**
 * An editor for JSON, as the plugin's: what is typed is taken when the editor is left, if it is JSON
 * then; until it is, the editor has a red border and says so under it.
 */
function ObjectEditor({
  value,
  onChange,
  onChecked,
  readOnly,
  height = 500,
  testId,
}: {
  value: Record<string, unknown>;
  onChange?: (value: Record<string, unknown>) => void;
  /** Told, each time the editor is left, whether what it has is JSON */
  onChecked?: (ok: boolean) => void;
  readOnly?: boolean;
  height?: number;
  testId?: string;
}) {
  const [text, setText] = useState(() => pretty(value));
  const [broken, setBroken] = useState(false);
  const shown = useRef(pretty(value));
  // What comes from outside replaces the text only when it is not what the text already says
  useEffect(() => {
    const next = pretty(value);
    if (next !== shown.current) {
      shown.current = next;
      setText(next);
      setBroken(false);
    }
  }, [value]);
  const take = () => {
    if (readOnly) return;
    const parsed = parsedObject(text);
    setBroken(!parsed);
    onChecked?.(Boolean(parsed));
    if (!parsed) return;
    shown.current = pretty(parsed);
    onChange?.(parsed);
  };
  return (
    <div
      className={cx('ismObjectEditor', broken && 'ismObjectEditor--broken')}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) take();
      }}
    >
      <JsonEditor value={text} readOnly={readOnly} height={height} testId={testId} onChange={setText} />
      {broken && <div className="ismCustomRow__error">{JSON_FORMAT_ERROR}</div>}
    </div>
  );
}

/** What there was beside what there is to be: the plugin's comparison of two JSON values */
function DiffEditor({
  original,
  value,
  onChange,
  onChecked,
}: {
  original: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onChecked?: (ok: boolean) => void;
}) {
  return (
    <div className="ismDiff">
      <FormRow label="Original" help="The original value">
        {null}
      </FormRow>
      <FormRow label="Modified" help="The value you modified">
        {null}
      </FormRow>
      <ObjectEditor value={original} readOnly height={600} />
      <ObjectEditor value={value} onChange={onChange} onChecked={onChecked} height={600} testId="advancedSettingsEditor" />
    </div>
  );
}

export function AdvancedSettings({
  value,
  old,
  onChange,
  isEdit,
  readOnly,
  title = 'Advanced settings',
  label = 'Specify advanced index settings',
  forTemplate,
  nested,
  children,
}: {
  value: Settings;
  old?: Settings;
  onChange: (value: Settings) => void;
  isEdit?: boolean;
  readOnly?: boolean;
  forTemplate?: boolean;
  /** The value is more than settings: what is nested in it stays nested */
  nested?: boolean;
  title?: ReactNode;
  label?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  // The switch is not moved while the editor holds what is not JSON: the editor says so instead
  const json = useRef(true);
  const checked = (ok: boolean) => {
    json.current = ok;
  };
  const take = (next: Record<string, unknown>) => onChange(nested ? next : flatten(next));
  const editor = (
    <ObjectEditor
      value={value}
      readOnly={readOnly}
      onChange={take}
      onChecked={checked}
      testId="advancedSettingsEditor"
    />
  );
  return (
    <div className="ismAccordion">
      <button type="button" className="ismAccordion__button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevronRight" className="ismAccordion__icon" />
        <span>{typeof title === 'string' ? <h3>{title}</h3> : title}</span>
      </button>
      {open && (
        <div className="ismAccordion__body">
          <FormRow
            label={label}
            fullWidth
            testId="formNameAdvancedSettings"
            help={
              children ?? (
                <>
                  <p>
                    Specify a comma-delimited list of settings.{' '}
                    <ExternalLink href={INDEX_SETTINGS_URL}>{forTemplate ? 'View index settings' : 'View index settings.'}</ExternalLink>
                  </p>
                  <p>
                    All the settings will be handled in flat structure.{' '}
                    <ExternalLink href={`${DOCS}/api-reference/index-apis/get-index/#query-parameters`} />
                    {forTemplate ? '' : '.'}
                  </p>
                </>
              )
            }
          >
            {isEdit && !readOnly ? (
              // The settings as they are, or, switched on, what the index has beside them
              <>
                <div className="ismSpacer ismSpacer--l" />
                <Switch
                  checked={compare}
                  onChange={(next) => {
                    if (json.current) setCompare(next);
                  }}
                  label="Compare previously saved settings"
                />
                <div className="ismSpacer ismSpacer--l" />
                {compare ? (
                  <DiffEditor original={ordered(old ?? {})} value={value} onChange={take} onChecked={checked} />
                ) : (
                  editor
                )}
              </>
            ) : (
              editor
            )}
          </FormRow>
        </div>
      )}
    </div>
  );
}

/** A setting written out, for where it cannot be changed */
function Plain({ value }: { value: unknown }) {
  const text = value ? String(value) : '-';
  return (
    <div>
      <div className="ismReadonlyText" title={text}>
        {text}
      </div>
    </div>
  );
}

/** The settings every index has a field for, and the editor for all the rest */
export function SettingsFields({
  value,
  old,
  onChange,
  isEdit,
  readOnly,
  errors = {},
  withShards = true,
  forTemplate,
  forDataStream,
  across = isEdit,
}: {
  value: Settings | undefined;
  old?: Settings;
  onChange: (value: Settings) => void;
  isEdit?: boolean;
  readOnly?: boolean;
  errors?: Record<string, string>;
  withShards?: boolean;
  /** The settings a template gives: every one of them can be set, and none has to be */
  forTemplate?: boolean;
  /** The settings a data stream takes from its template, whose shards row is as wide as the page too */
  forDataStream?: boolean;
  across?: boolean;
}) {
  const settings = value ?? {};
  // A field that is emptied takes its setting away
  const set = (name: string, next: unknown) => {
    const rest = { ...settings };
    if (next === undefined || next === '') delete rest[name];
    // A number that was typed is kept as its text, as it is read back from the cluster
    else rest[name] = typeof next === 'number' ? String(next) : next;
    onChange(rest);
  };
  const fixed = (name: string) => readOnly || (!forTemplate && isEdit && !INDEX_DYNAMIC_SETTINGS.includes(name));
  const number = (name: string) => {
    const now = settings[name];
    return now === undefined || now === '' ? undefined : Number(now);
  };
  // A template's settings are named a size smaller, 24 px apart, as the plugin's
  return (
    <div className={cx('ismSettings', forTemplate && 'ismSettings--template')}>
      {withShards && (
        <FormRow
          title="Number of primary shards"
          small={forTemplate}
          fullWidth={forTemplate && forDataStream}
          across={across}
          testId={forTemplate ? 'form-row-template.settings.index.number_of_shards' : 'form-name-index.number_of_shards'}
          error={errors['index.number_of_shards']}
          help={
            forTemplate ? (
              'Specify the number of primary shards in the index. Default is 1.'
            ) : (
              <>
                <div>Specify the number of primary shards for the index. Default is 1. </div>
                <div>The number of primary shards cannot be changed after the index is created.</div>
              </>
            )
          }
        >
          {fixed('index.number_of_shards') ? (
            <Plain value={settings['index.number_of_shards']} />
          ) : (
            <NumberField
              compact
              value={number('index.number_of_shards')}
              onChange={(next) => set('index.number_of_shards', next)}
              placeholder={forTemplate ? undefined : 'Specify primary shard count.'}
              invalid={Boolean(errors['index.number_of_shards'])}
            />
          )}
        </FormRow>
      )}
      <FormRow
        title="Number of replicas"
        small={forTemplate}
        fullWidth={forTemplate}
        across={across}
        testId={forTemplate ? 'form-row-template.settings.index.number_of_replicas' : 'form-name-index.number_of_replicas'}
        error={errors['index.number_of_replicas']}
        help={REPLICA_NUMBER_MESSAGE}
      >
        {fixed('index.number_of_replicas') ? (
          <Plain value={settings['index.number_of_replicas']} />
        ) : (
          <NumberField
            compact
            value={number('index.number_of_replicas')}
            onChange={(next) => set('index.number_of_replicas', next)}
            placeholder={forTemplate ? undefined : 'Specify number of replicas.'}
            invalid={Boolean(errors['index.number_of_replicas'])}
          />
        )}
      </FormRow>
      <FormRow
        title="Refresh interval"
        small={forTemplate}
        across={across}
        testId={forTemplate ? 'form-row-template.settings.index.refresh_interval' : 'form-name-index.refresh_interval'}
        help={
          forTemplate
            ? 'Specify how often the index should refresh, which publishes its most recent changes and makes them available for search. Default is 1s.'
            : 'Specify how often the index should refresh, which publishes the most recent changes and make them available for search. Default is 1 second.'
        }
      >
        {readOnly ? (
          <Plain value={settings['index.refresh_interval']} />
        ) : (
          <TextField
            compact
            value={String(settings['index.refresh_interval'] ?? '')}
            onChange={(next) => set('index.refresh_interval', next)}
            placeholder={forTemplate ? undefined : 'Can be set to -1 to disable refreshing.'}
          />
        )}
      </FormRow>
      <div className={cx('ismSpacer', forTemplate ? 'ismSpacer--l' : 'ismSpacer--m')} />
      <AdvancedSettings
        value={settings}
        old={old}
        onChange={onChange}
        isEdit={isEdit && !forTemplate}
        readOnly={readOnly}
        forTemplate={forTemplate}
      />
    </div>
  );
}

// --- Mappings ------------------------------------------------------------------------------------------

type EditorMode = 'VISUAL' | 'JSON';

const TYPE_OPTIONS = MAPPING_TYPES.map((item) => item.label);

/**
 * A menu that opens while the pointer is over its button or over the menu, as the plugin's popover
 * that opens on hover; the button keeps its own click
 */
function HoverMenu({ button, items }: { button: ReactNode; items: Array<{ label: string; onClick: () => void }> }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    let last = 0;
    // As the plugin's: the pointer is looked at ten times a second at most
    const onMove = (event: MouseEvent) => {
      const now = Date.now();
      if (now - last < 100) return;
      last = now;
      const target = event.target as Node | null;
      if (!target || (!anchor.current?.contains(target) && !panel.current?.contains(target))) setOpen(false);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [open]);
  return (
    <Popover
      open={open}
      onClose={() => undefined}
      align="center"
      button={
        <span ref={anchor} className="ismHoverMenu__anchor" onMouseEnter={() => setOpen(true)}>
          {button}
        </span>
      }
    >
      <div ref={panel}>
        <Menu items={items.map((item) => ({ id: item.label, label: item.label, onClick: item.onClick }))} />
      </div>
    </Popover>
  );
}

/** A field that can be changed: its name, its type and what the type asks for, 24 px apart */
function FieldRow({
  field,
  id,
  errors,
  showErrors,
  showLabels,
  onChange,
  onDelete,
  onAddField,
  onAddObject,
}: {
  field: MappingField;
  id: string;
  errors: Record<string, string>;
  showErrors: boolean;
  showLabels: boolean;
  onChange: (field: MappingField) => void;
  onDelete: () => void;
  onAddField: () => void;
  onAddObject: () => void;
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const shown = (name: string) => (showErrors || touched[name] ? errors[name] : undefined);
  const types = TYPE_OPTIONS.includes(field.type) ? TYPE_OPTIONS : [...TYPE_OPTIONS, field.type];
  const label = (text: string) => (showLabels ? <div className="ismCustomRow__label">{text}</div> : null);
  return (
    // The row's clicks stay in it: the tree's node around it opens and closes on its own
    <div className="ismFieldRow" onClick={(event) => event.stopPropagation()}>
      <div className="ismFieldRow__item ismFieldRow__item--name">
        {label('Field name')}
        <TextField
          compact
          value={field.fieldName}
          onChange={(fieldName) => {
            setTouched({ ...touched, fieldName: true });
            onChange({ ...field, fieldName });
          }}
          invalid={Boolean(shown('fieldName'))}
          testId={`${id}-field-name`}
        />
        {shown('fieldName') && <div className="ismCustomRow__error">{shown('fieldName')}</div>}
      </div>
      <div className="ismFieldRow__item ismFieldRow__item--type">
        {label('Field type')}
        <Select
          compact
          value={field.type}
          options={types}
          onChange={(type) => onChange(withType(field, type))}
          testId={`${id}-field-type`}
        />
      </div>
      {(mappingType(field.type)?.fields ?? []).map((option) => (
        <div key={option.name} className="ismFieldRow__item ismFieldRow__item--type">
          <div className="ismCustomRow__label">{option.label}</div>
          <TextField
            compact
            value={String(field[option.name] ?? '')}
            onChange={(next) => {
              setTouched({ ...touched, [option.name]: true });
              onChange({ ...field, [option.name]: next });
            }}
            invalid={Boolean(shown(option.name))}
          />
          {shown(option.name) && <div className="ismCustomRow__error">{shown(option.name)}</div>}
        </div>
      ))}
      <div className="ismFieldRow__item">
        {label('Actions')}
        <div className="ismFieldRow__actions">
          {mappingType(field.type)?.hasChildren && (
            <HoverMenu
              button={
                <IconButton
                  icon="plusInCircleFilled"
                  label="Add nested field"
                  variant="empty"
                  onClick={onAddField}
                  testId={`${id}-add-sub-field`}
                />
              }
              items={[
                { label: 'Add nested field', onClick: onAddField },
                { label: 'Add nested object', onClick: onAddObject },
              ]}
            />
          )}
          <Tooltip content="Delete current field">
            <IconButton icon="trash" label="Delete current field" variant="dangerEmpty" onClick={onDelete} testId={`${id}-delete-field`} />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

/** A field there is already: a dot, its name, and its type and settings as hollow badges */
function ReadOnlyField({ field, id }: { field: MappingField; id: string }) {
  return (
    <div className="ismReadonlyText">
      <span className="ismFieldLine">
        <Icon name="dot" size="s" />
        <span data-test-subj={`${id}-field-name`} title={field.fieldName}>
          {field.fieldName}
        </span>
        <span className="ismHollowBadge" title={field.type} data-test-subj={`${id}-field-type`}>
          {field.type}
        </span>
        {(mappingType(field.type)?.fields ?? []).map((option) => (
          <span key={option.name} className="ismHollowBadge" title={String(field[option.name] ?? '')}>
            {option.label}: {String(field[option.name] ?? '')}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * The fields as the theme's tree: a node per field, its arrow when it has fields of its own, the
 * fields it has 24 px further in. The nodes of an index's fields are open unless they cannot change.
 */
function FieldTree({
  fields,
  old,
  path,
  isEdit,
  readOnly,
  showErrors,
  labelled,
  change,
}: {
  fields: MappingField[];
  old: MappingField[] | undefined;
  path: number[];
  isEdit?: boolean;
  readOnly?: boolean;
  showErrors: boolean;
  /** Whether the names of the columns were already shown above an earlier field */
  labelled: { done: boolean };
  change: (path: number[], update: (inner: MappingField[]) => MappingField[]) => void;
}) {
  const [closed, setClosed] = useState<Record<number, boolean>>({});
  return (
    <ul className={cx('ismTreeView', path.length > 0 && 'ismTreeView--nested')}>
      {fields.map((field, index) => {
        const here = [...path, index];
        const id = `mapping-visual-editor-${here.join('.properties.')}`;
        const fixed = readOnly || (isEdit && Boolean(old?.[index]));
        const showLabels = !fixed && !labelled.done;
        if (showLabels) labelled.done = true;
        const parent = Boolean(field.properties);
        const isOpen = parent && !(closed[index] ?? Boolean(readOnly));
        const toggle = () => {
          if (parent) setClosed({ ...closed, [index]: isOpen });
        };
        const add = (type: string) => change(here, (inner) => [...inner, { fieldName: '', type }]);
        const icon = (
          <span className="ismTreeView__icon" style={parent ? undefined : { visibility: 'hidden' }}>
            <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} />
          </span>
        );
        return (
          <li key={index} className="ismTreeView__node">
            {fixed ? (
              <button type="button" className="ismTreeView__inner" aria-expanded={parent ? isOpen : undefined} onClick={toggle}>
                {icon}
                <span className="ismTreeView__label">
                  <ReadOnlyField field={field} id={id} />
                </span>
              </button>
            ) : (
              <div className="ismTreeView__inner" onClick={toggle}>
                {icon}
                <span className="ismTreeView__label">
                  <FieldRow
                    field={field}
                    id={id}
                    errors={fieldErrors(field, fields.slice(0, index))}
                    showErrors={showErrors}
                    showLabels={showLabels}
                    onChange={(next) => change(path, (inner) => inner.map((item, at) => (at === index ? next : item)))}
                    onDelete={() => change(path, (inner) => inner.filter((_, at) => at !== index))}
                    onAddField={() => add('text')}
                    onAddObject={() => add('object')}
                  />
                </span>
              </div>
            )}
            {field.properties && isOpen && (
              <FieldTree
                fields={field.properties}
                old={isEdit ? old?.[index]?.properties : undefined}
                path={here}
                isEdit={isEdit}
                readOnly={readOnly}
                showErrors={showErrors}
                labelled={labelled}
                change={change}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The mappings: a tree of fields to fill in, or the JSON of them */
export function MappingEditor({
  value,
  old,
  onChange,
  isEdit,
  readOnly,
  showErrors = false,
  onEditorText,
}: {
  value: Mappings | undefined;
  old?: Mappings;
  onChange: (value: Mappings) => void;
  isEdit?: boolean;
  readOnly?: boolean;
  showErrors?: boolean;
  /** Told what the JSON editor says, for the messages that name a line of it */
  onEditorText?: (text: string) => void;
}) {
  const [mode, setMode] = useState<EditorMode>('VISUAL');
  const [previous, setPrevious] = useState(false);
  const fields = value?.properties ?? [];
  const oldFields = old?.properties ?? [];
  const added = useMemo(() => fields.filter((_, index) => index >= oldFields.length), [fields, oldFields.length]);
  const setFields = (properties: MappingField[]) => onChange({ ...value, properties });
  const change = (path: number[], update: (inner: MappingField[]) => MappingField[]) =>
    setFields(withFields(fields, path, update));
  const whole = { ...value, properties: propertiesOf(isEdit && !readOnly ? added : fields) };
  useEffect(() => {
    onEditorText?.(mode === 'JSON' ? pretty(whole) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, JSON.stringify(whole)]);

  // As the plugin's: the editor's type, 24 px, then the fields or their JSON
  return (
    <div className="ismMappingEditor">
      <div className="atlSegments" role="group" aria-label="Editor Type">
        <button
          type="button"
          className="atlSegment"
          aria-pressed={mode === 'VISUAL'}
          onClick={() => setMode('VISUAL')}
          data-test-subj="editorTypeVisualEditor"
        >
          {readOnly ? 'Tree view' : 'Visual Editor'}
        </button>
        <button
          type="button"
          className="atlSegment"
          aria-pressed={mode === 'JSON'}
          onClick={() => setMode('JSON')}
          data-test-subj="editorTypeJsonEditor"
        >
          {readOnly ? 'JSON' : 'JSON Editor'}
        </button>
      </div>
      <div className="ismSpacer ismSpacer--l" />
      {mode === 'VISUAL' ? (
        <>
          {!fieldsArePlain(added) && (
            <>
              <CallOut tone="warning" size="s" title="You have advanced configurations not supported by the visual editor">
                To view or modify all of your configurations, switch to the JSON editor.
              </CallOut>
              <div className="ismSpacer ismSpacer--l" />
            </>
          )}
          {fields.length > 0 ? (
            <FieldTree
              fields={fields}
              old={isEdit ? oldFields : undefined}
              path={[]}
              isEdit={isEdit}
              readOnly={readOnly}
              showErrors={showErrors}
              labelled={{ done: false }}
              change={change}
            />
          ) : (
            <p className="ismReadonlyText ismMappingEditor__none">You have no field mappings.</p>
          )}
          {!readOnly && (
            <>
              <div className="ismSpacer ismSpacer--l" />
              <div className="ismMappingEditor__buttons">
                <Button onClick={() => setFields([...fields, { fieldName: '', type: 'text' }])} testId="createIndexAddFieldButton">
                  Add new field
                </Button>
                <Button onClick={() => setFields([...fields, { fieldName: '', type: 'object' }])} testId="createIndexAddObjectFieldButton">
                  Add new object
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {isEdit && !readOnly && Object.keys(old ?? {}).length > 0 && (
            <>
              <Button onClick={() => setPrevious(true)} testId="previousMappingsJsonButton">
                See previous mappings
              </Button>
              <div className="ismSpacer ismSpacer--l" />
            </>
          )}
          {readOnly ? (
            <ObjectEditor value={whole} readOnly height={600} />
          ) : (
            <FormRow
              label="Specify index mapping"
              fullWidth
              testId="mappingsJsonEditorFormRow"
              help={
                <>
                  Specify mapping in JSON format.{' '}
                  <ExternalLink href={`${DOCS}/opensearch/mappings/#mapping-example-usage`}>View mapping example.</ExternalLink>
                </>
              }
            >
              <ObjectEditor
                value={whole}
                height={600}
                testId="mappingsJsonEditor"
                onChange={(next) =>
                  onChange({ ...next, properties: [...(isEdit ? oldFields : []), ...fieldsOf(next.properties)] })
                }
              />
            </FormRow>
          )}
        </>
      )}
      {previous && (
        <Modal
          title="Previous mappings"
          wide
          onClose={() => setPrevious(false)}
          testId="previousMappingsJsonModal"
          footer={
            <Button variant="primary" onClick={() => setPrevious(false)} testId="previousMappingsJsonModal-ok">
              OK
            </Button>
          }
        >
          <ObjectEditor value={{ ...old, properties: propertiesOf(oldFields) }} readOnly height={600} />
        </Modal>
      )}
    </div>
  );
}

/** The field a path leads to, for what needs to look one up */
export { fieldAt };
