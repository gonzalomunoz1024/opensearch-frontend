/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parts of a form that describes an index, a template or a component template: the aliases,
 * the settings with their advanced editor, and the mappings with their visual and JSON editors.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, CallOut, IconButton, cx } from '../../components/basic';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { NumberField, Select, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { MenuButton, Modal } from '../../components/overlay';
import { ExternalLink, JsonEditor, Labeled, ism } from './common';
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

/** An editor for JSON that keeps what is typed while it is not JSON yet */
function ObjectEditor({
  value,
  onChange,
  readOnly,
  height = 240,
  testId,
}: {
  value: Record<string, unknown>;
  onChange?: (value: Record<string, unknown>) => void;
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
  return (
    <div className={cx('ismObjectEditor', broken && 'ismObjectEditor--broken')}>
      <JsonEditor
        value={text}
        readOnly={readOnly}
        height={height}
        testId={testId}
        onChange={(next) => {
          setText(next);
          try {
            const parsed: unknown = JSON.parse(next);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
            shown.current = pretty(parsed);
            setBroken(false);
            onChange?.(parsed as Record<string, unknown>);
          } catch {
            setBroken(true);
          }
        }}
      />
      {broken && <div className="ismLabeled__error">Your input does not match the validation of json format, please fix the error line with error aside.</div>}
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
  return (
    <div className="ismAdvanced">
      <button type="button" className="atlAccordion__button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} />
        <span className="atlGrow">{title}</span>
      </button>
      {open && (
        <div className="ismAdvanced__body">
          <Labeled
            title={label}
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
              // What the index has is at the left; what it is to have is at the right
              <div className="ismDiff">
                <ObjectEditor value={ordered(old ?? {})} readOnly />
                <ObjectEditor value={value} onChange={(next) => onChange(flatten(next))} testId="advancedSettingsEditor" />
              </div>
            ) : (
              <ObjectEditor
                value={value}
                readOnly={readOnly}
                onChange={(next) => onChange(nested ? next : flatten(next))}
                testId="advancedSettingsEditor"
              />
            )}
          </Labeled>
        </div>
      )}
    </div>
  );
}

/** A setting written out, for where it cannot be changed */
function Plain({ value }: { value: unknown }) {
  return <span className="ismPlain">{value ? String(value) : '-'}</span>;
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
  return (
    <div className="ismForm">
      {withShards && (
        <Labeled
          title="Number of primary shards"
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
        </Labeled>
      )}
      <Labeled
        title="Number of replicas"
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
      </Labeled>
      <Labeled
        title="Refresh interval"
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
      </Labeled>
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
  const [touched, setTouched] = useState(false);
  const shown = showErrors || touched ? errors : {};
  const types = TYPE_OPTIONS.includes(field.type) ? TYPE_OPTIONS : [...TYPE_OPTIONS, field.type];
  const label = (text: string) => (showLabels ? <span className="ismField__label">{text}</span> : null);
  return (
    <div className="ismField">
      <div className="ismField__cell ismField__cell--name">
        {label('Field name')}
        <TextField
          compact
          value={field.fieldName}
          onChange={(fieldName) => onChange({ ...field, fieldName })}
          onBlur={() => setTouched(true)}
          invalid={Boolean(shown.fieldName)}
          testId={`${id}-field-name`}
        />
        {shown.fieldName && <span className="ismLabeled__error">{shown.fieldName}</span>}
      </div>
      <div className="ismField__cell ismField__cell--type">
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
        <div key={option.name} className="ismField__cell ismField__cell--type">
          <span className="ismField__label">{option.label}</span>
          <TextField
            compact
            value={String(field[option.name] ?? '')}
            onChange={(next) => onChange({ ...field, [option.name]: next })}
            invalid={Boolean(shown[option.name])}
          />
          {shown[option.name] && <span className="ismLabeled__error">{shown[option.name]}</span>}
        </div>
      ))}
      <div className="ismField__cell">
        {label('Actions')}
        <div className="ismField__actions">
          {mappingType(field.type)?.hasChildren && (
            <MenuButton
              items={[
                { id: 'field', label: 'Add nested field', onClick: onAddField },
                { id: 'object', label: 'Add nested object', onClick: onAddObject },
              ]}
              button={(toggle) => (
                <IconButton icon="plusInCircleFilled" label="Add nested field" variant="empty" onClick={toggle} testId={`${id}-add-sub-field`} />
              )}
            />
          )}
          <span className="ismField__delete">
            <IconButton icon="trash" label="Delete current field" onClick={onDelete} testId={`${id}-delete-field`} />
          </span>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyField({ field, id }: { field: MappingField; id: string }) {
  return (
    <div className="ismField ismField--readonly">
      <span className="ismField__dot" />
      <span data-test-subj={`${id}-field-name`} title={field.fieldName}>
        {field.fieldName}
      </span>
      <Badge title={field.type}>
        <span data-test-subj={`${id}-field-type`}>{field.type}</span>
      </Badge>
      {(mappingType(field.type)?.fields ?? []).map((option) => (
        <Badge key={option.name} title={String(field[option.name] ?? '')}>
          {option.label}: {String(field[option.name] ?? '')}
        </Badge>
      ))}
    </div>
  );
}

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
    <ul className="ismTree">
      {fields.map((field, index) => {
        const here = [...path, index];
        const id = `mapping-visual-editor-${here.join('.properties.')}`;
        const fixed = readOnly || (isEdit && Boolean(old?.[index]));
        const showLabels = !fixed && !labelled.done;
        if (showLabels) labelled.done = true;
        const isClosed = closed[index] ?? Boolean(readOnly);
        const add = (type: string) =>
          change(here, (inner) => [...inner, { fieldName: '', type }]);
        return (
          <li key={index} className="ismTree__item">
            <div className="ismTree__row">
              <button
                type="button"
                className="ismTree__toggle"
                style={{ visibility: field.properties ? 'visible' : 'hidden' }}
                aria-label={isClosed ? 'Expand' : 'Collapse'}
                onClick={() => setClosed({ ...closed, [index]: !isClosed })}
              >
                <Icon name={isClosed ? 'chevronRight' : 'chevronDown'} />
              </button>
              {fixed ? (
                <ReadOnlyField field={field} id={id} />
              ) : (
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
              )}
            </div>
            {field.properties && !isClosed && (
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

  return (
    <div className="ismMappings">
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
      {mode === 'VISUAL' ? (
        <>
          {!fieldsArePlain(added) && (
            <CallOut tone="warning" size="s" title="You have advanced configurations not supported by the visual editor">
              To view or modify all of your configurations, switch to the JSON editor.
            </CallOut>
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
            <p className="ismMappings__none">You have no field mappings.</p>
          )}
          {!readOnly && (
            <div className="atlRow" style={{ gap: 'var(--space-2)' }}>
              <Button size="s" onClick={() => setFields([...fields, { fieldName: '', type: 'text' }])} testId="createIndexAddFieldButton">
                Add new field
              </Button>
              <Button size="s" onClick={() => setFields([...fields, { fieldName: '', type: 'object' }])} testId="createIndexAddObjectFieldButton">
                Add new object
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          {isEdit && !readOnly && Object.keys(old ?? {}).length > 0 && (
            <div>
              <Button size="s" onClick={() => setPrevious(true)} testId="previousMappingsJsonButton">
                See previous mappings
              </Button>
            </div>
          )}
          {readOnly ? (
            <ObjectEditor value={whole} readOnly height={300} />
          ) : (
            <Labeled
              title="Specify index mapping"
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
                height={300}
                testId="mappingsJsonEditor"
                onChange={(next) =>
                  onChange({ ...next, properties: [...(isEdit ? oldFields : []), ...fieldsOf(next.properties)] })
                }
              />
            </Labeled>
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
            <Button variant="primary" size="s" onClick={() => setPrevious(false)}>
              OK
            </Button>
          }
        >
          <JsonEditor value={pretty({ ...old, properties: propertiesOf(oldFields) })} readOnly height={400} />
        </Modal>
      )}
    </div>
  );
}

/** The field a path leads to, for what needs to look one up */
export { fieldAt };
