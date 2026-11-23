/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The page of one index template and the page of one component template: each creates one when
 * the address names none, and shows and changes the one it names.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef, type ReactNode } from 'react';
import { Badge, Button, CallOut, IconButton, Panel, cx } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Checkbox, NumberField, SearchField, Switch, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Modal } from '../../components/overlay';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { ExternalLink, FilterButton, JSONModal, Labeled, UnsavedBar, go, ism, to, toasts } from './common';
import { AliasSelect, MappingEditor, SettingsFields, aliasesError } from './index_form';
import {
  PARTS,
  comparableComponent,
  comparableTemplate,
  countChanges,
  fieldsHaveErrors,
  localComponent,
  localTemplate,
  presetTemplate,
  priorityError,
  remoteComponent,
  remoteTemplate,
  simulatedTemplateBody,
  templateSettingsErrors,
  type ComponentItem,
  type Part,
  type TemplateBody,
  type TemplateItem,
} from './index_model';
import { TEMPLATE_NAMING_MESSAGE, TEMPLATE_NAMING_PATTERN, matchesAny } from './model';
import { CRUMBS, INDEX_MANAGEMENT_PATH, ROUTES } from './routes';
import { DeleteComponentModal, DeleteTemplateModal, loadIndexTemplates, type IndexTemplate } from './templates';

const DOCS = 'https://opensearch.org/docs/latest';
const TEMPLATE_DOCS = `${DOCS}/opensearch/index-templates/`;
const COMPONENT_DOCS = `${DOCS}/im-plugin/index-templates/#composable-index-templates`;
const MAPPINGS_DOCS = `${DOCS}/opensearch/mappings/`;
const COMPONENT_TEXT =
  'Component templates are reusable building blocks for composing index or data stream templates. You can define component templates with common index configurations and associate them to an index template.';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A list of names and what they stand for, side by side */
export function Facts({ items, columns = 4 }: { items: Array<[string, ReactNode]>; columns?: number }) {
  return (
    <div className="ismFacts" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map(([title, value]) => (
        <div key={title}>
          <h4>{title}</h4>
          <div>{value === undefined || value === null || value === '' ? '-' : value}</div>
        </div>
      ))}
    </div>
  );
}

function PartBadges({ template }: { template: Record<string, unknown> | undefined }) {
  return (
    <span className="atlRow" style={{ gap: 'var(--space-1)' }}>
      {PARTS.filter((part) => template?.[part]).map((part) => (
        <Badge key={part}>
          <span className="ismCapital">{part}</span>
        </Badge>
      ))}
    </span>
  );
}

// --- What a template gives an index, as a form and as a summary -----------------------------------------

interface BodyErrors {
  aliases?: string;
  settings: Record<string, string>;
}

function bodyErrors(body: TemplateBody | undefined): BodyErrors {
  return { aliases: aliasesError(body?.aliases), settings: templateSettingsErrors(body?.settings) };
}

const hasErrors = (errors: BodyErrors, body: TemplateBody | undefined) =>
  Boolean(errors.aliases) ||
  Object.keys(errors.settings).length > 0 ||
  fieldsHaveErrors(body?.mappings?.properties ?? [], undefined, false);

function AliasPart({
  body,
  onChange,
  readOnly,
  across,
  error,
}: {
  body: TemplateBody;
  onChange: (body: TemplateBody) => void;
  readOnly?: boolean;
  across?: boolean;
  error?: string;
}) {
  if (readOnly) return <Facts items={[['Alias names', Object.keys(body.aliases ?? {}).join(',')]]} />;
  return (
    <Labeled
      title="Index alias"
      across={across}
      testId="form-row-template.aliases"
      help="Select existing aliases or specify a new alias."
      error={error}
    >
      <AliasSelect value={body.aliases} onChange={(aliases) => onChange({ ...body, aliases })} invalid={Boolean(error)} />
    </Labeled>
  );
}

function SettingsPart({
  body,
  onChange,
  readOnly,
  across,
  errors,
  columns,
}: {
  body: TemplateBody;
  onChange: (body: TemplateBody) => void;
  readOnly?: boolean;
  across?: boolean;
  errors: Record<string, string>;
  columns?: number;
}) {
  if (readOnly) {
    return (
      <Facts
        columns={columns}
        items={[
          ['Number of primary shards', body.settings?.['index.number_of_shards'] as ReactNode],
          ['Number of replicas', body.settings?.['index.number_of_replicas'] as ReactNode],
          ['Refresh interval', body.settings?.['index.refresh_interval'] as ReactNode],
        ]}
      />
    );
  }
  return (
    <SettingsFields
      value={body.settings}
      onChange={(settings) => onChange({ ...body, settings })}
      errors={errors}
      forTemplate
      across={across}
    />
  );
}

export function MappingsHelp() {
  return (
    <div className="ismLabeled__help">
      Define how documents and their fields are stored and indexed. <ExternalLink href={MAPPINGS_DOCS} />
    </div>
  );
}

/** The three things a template gives, one under the other */
function Definition({
  body,
  onChange,
  readOnly,
  across,
  showErrors,
  columns,
}: {
  body: TemplateBody;
  onChange: (body: TemplateBody) => void;
  readOnly?: boolean;
  across?: boolean;
  showErrors: boolean;
  columns?: number;
}) {
  const errors = bodyErrors(body);
  return (
    <div className="ismDefinition">
      <div>
        <h3 className="ismDefinition__title">Index alias</h3>
        <div className="ismLabeled__help">
          Allow the new indexes to be referenced by existing aliases or specify a new alias.
        </div>
      </div>
      <AliasPart body={body} onChange={onChange} readOnly={readOnly} across={across} error={showErrors ? errors.aliases : undefined} />
      <h3 className="ismDefinition__title">Index settings</h3>
      <SettingsPart
        body={body}
        onChange={onChange}
        readOnly={readOnly}
        across={across}
        errors={showErrors ? errors.settings : {}}
        columns={columns}
      />
      <div>
        <h3 className="ismDefinition__title">Index mapping</h3>
        <MappingsHelp />
      </div>
      <MappingEditor
        value={body.mappings}
        onChange={(mappings) => onChange({ ...body, mappings })}
        readOnly={readOnly}
        showErrors={showErrors}
      />
    </div>
  );
}

// --- An index template ----------------------------------------------------------------------------------

interface RemoteComponent {
  name: string;
  component_template: { template?: Record<string, unknown> };
}

async function loadComponents(): Promise<RemoteComponent[]> {
  const answer = await ism.request<{ component_templates?: RemoteComponent[] }>('GET', '/_component_template/*', undefined, true);
  return answer.ok ? (answer.response?.component_templates ?? []) : [];
}

const typeName = (item: TemplateItem) => (item.data_stream === undefined ? 'Indexes' : 'Data streams');

function Overview({ item, columns }: { item: TemplateItem; columns?: number }) {
  const composed = item.composed_of ?? [];
  return (
    <Facts
      columns={columns}
      items={[
        ['Template type', typeName(item)],
        ['Index patterns', item.index_patterns?.join(', ')],
        ['Priority', item.priority as ReactNode],
        [
          'Associated component templates',
          composed.length === 0
            ? '-'
            : composed.map((name) => (
                <div key={name}>
                  <a href={to(`${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${name}`)} target="_blank" rel="noreferrer">
                    {name}
                  </a>
                </div>
              )),
        ],
      ]}
    />
  );
}

/** The component templates an index template is composed of, in the order that decides which of them wins */
function Components({ item, onChange }: { item: TemplateItem; onChange: (composed: string[]) => void }) {
  const [all, setAll] = useState<RemoteComponent[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [dragged, setDragged] = useState<number>();
  const created = useRef<{ submit: () => void }>(null);
  const reload = useCallback(async () => setAll(await loadComponents()), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const composed = item.composed_of ?? [];
  const options = all.filter(
    (component) =>
      types.every((type) => component.component_template.template?.[type]) &&
      component.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const drop = (target: number) => {
    if (dragged === undefined || dragged === target) return;
    const next = [...composed];
    const [moved] = next.splice(dragged, 1);
    next.splice(target, 0, moved);
    onChange(next);
    setDragged(undefined);
  };

  return (
    <Panel>
      <h2 className="ismPanel__heading">Component template</h2>
      <div className="ismLabeled__help">
        Define an index template by combining component templates containing index configurations. Associate existing
        component templates or create one. You can arrange the priority of the component templates by dragging them.
        The component template placed on bottom has the highest priority. <ExternalLink href={COMPONENT_DOCS} />
      </div>
      <hr className="ismRule" />
      {composed.length > 0 && all.length > 0 ? (
        <div className="ismDraggables" data-test-subj="composableTemplatesDropArea">
          {composed.map((name, index) => {
            const found = all.find((component) => component.name === name);
            if (!found) return <div key={name} />;
            return (
              <div
                key={name}
                className={cx('ismComponent', dragged === index && 'ismComponent--dragged')}
                draggable
                onDragStart={() => setDragged(index)}
                onDragEnd={() => setDragged(undefined)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => drop(index)}
              >
                <span className="ismComponent__grab" aria-label="Drag Handle">
                  <Icon name="grab" />
                </span>
                <span>{name}</span>
                <PartBadges template={found.component_template.template} />
                <span className="atlGrow" />
                <span className="ismField__delete">
                  <IconButton icon="trash" label="delete" onClick={() => onChange(composed.filter((_, at) => at !== index))} />
                </span>
                <IconButton
                  icon="inspect"
                  label="see detail"
                  onClick={() => window.open(to(`${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${name}`))}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ismMappings__none">No component templates associated</p>
      )}
      <div className="atlRow" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
        <Button size="s" onClick={() => setChoosing(true)}>
          Associate component templates
        </Button>
        <Button size="s" onClick={() => setCreating(true)}>
          Create component template
        </Button>
      </div>
      {choosing && (
        <Modal
          title="Associate component templates"
          wide
          onClose={() => setChoosing(false)}
          footer={
            <>
              <Button variant="empty" size="s" onClick={() => setChoosing(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="s"
                onClick={() => {
                  onChange([...composed, ...chosen]);
                  setChosen([]);
                  setChoosing(false);
                }}
              >
                {`Associate (${chosen.length})`}
              </Button>
            </>
          }
        >
          <div className="atlRow" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <div className="atlGrow">
              <SearchField compact value={search} onChange={setSearch} placeholder="Search" />
            </div>
            <FilterButton name="Types" options={PARTS.map((value) => ({ value }))} selected={types} onChange={setTypes} />
          </div>
          <ul className="ismSelectable">
            {options.map((component) => {
              const used = composed.includes(component.name);
              return (
                <li key={component.name}>
                  <Checkbox
                    checked={used || chosen.includes(component.name)}
                    disabled={used}
                    onChange={(checked) =>
                      setChosen(checked ? [...chosen, component.name] : chosen.filter((name) => name !== component.name))
                    }
                    label={component.name}
                  />
                  <span className="atlGrow" />
                  <PartBadges template={component.component_template.template} />
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
      {creating && (
        <Modal
          title="Create component template"
          wide
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="empty" size="s" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="s" onClick={() => created.current?.submit()}>
                Create
              </Button>
            </>
          }
        >
          <ComponentForm
            ref={created}
            embedded
            onCreated={(name) => {
              void reload();
              onChange([...composed, name]);
              setCreating(false);
            }}
          />
        </Modal>
      )}
    </Panel>
  );
}

function TemplateSettings({
  item,
  onChange,
  isEdit,
  showErrors,
}: {
  item: TemplateItem;
  onChange: (changes: Partial<TemplateItem>) => void;
  isEdit: boolean;
  showErrors: boolean;
}) {
  const flow = item._meta?.flow ?? 'simple';
  const patterns = item.index_patterns ?? [];
  const nameError = TEMPLATE_NAMING_PATTERN.test(item.name ?? '') ? undefined : 'Invalid template name.';
  const patternsError = patterns.length === 0 ? 'Index patterns must be defined' : undefined;
  const card = (id: string, value: 'simple' | 'components', title: string, text: string) => (
    <label className={cx('ismCard', flow === value && 'ismCard--selected')}>
      <span className="ismCard__side">
        <span className="atlRadio">
          <input
            type="radio"
            id={id}
            name="template-flow"
            checked={flow === value}
            onChange={() => onChange({ _meta: { ...item._meta, flow: value } })}
          />
        </span>
      </span>
      <span className="ismCard__body">
        <span className="ismCard__title">{title}</span>
        <span className="ismCard__text">{text}</span>
      </span>
    </label>
  );
  return (
    <Panel>
      <h2 className="ismPanel__heading">Template settings</h2>
      <hr className="ismRule" />
      <div className="ismForm">
        {!isEdit && (
          <Labeled
            title="Template name"
            testId="form-row-name"
            help="Template name cannot be changed after the template is created."
            error={showErrors ? nameError : undefined}
          >
            <TextField compact value={item.name ?? ''} onChange={(name) => onChange({ name })} invalid={showErrors && Boolean(nameError)} />
            <div className="ismLabeled__help">{TEMPLATE_NAMING_MESSAGE}</div>
          </Labeled>
        )}
        <Labeled title="Template type" across={isEdit} testId="form-row-data_stream">
          <div className="atlStack" style={{ gap: 'var(--space-2)' }}>
            <label className="atlRadio">
              <input type="radio" id="Indexes" checked={item.data_stream === undefined} onChange={() => onChange({ data_stream: undefined })} />
              <span>Indexes</span>
            </label>
            <label className="atlRadio">
              <input
                type="radio"
                id="Data streams"
                checked={item.data_stream !== undefined}
                onChange={() => onChange({ data_stream: { timestamp_field: { name: '@timestamp' } } })}
              />
              <span>Data streams</span>
            </label>
          </div>
          {item.data_stream !== undefined && (
            <div className="ismSub">
              <div className="ismField__label">Time field</div>
              <TextField
                compact
                value={item.data_stream.timestamp_field?.name ?? ''}
                onChange={(name) => onChange({ data_stream: name ? { timestamp_field: { name } } : {} })}
              />
            </div>
          )}
        </Labeled>
        <Labeled
          title="Index patterns"
          across={isEdit}
          testId="form-row-index_patterns"
          help="Specify the index patterns or wildcards. Add a comma to separate each value. Settings in this template will be applied to indexes with names matching index patterns or wildcards."
          error={showErrors ? patternsError : undefined}
        >
          <ComboBox
            compact
            options={patterns.map((pattern) => ({ value: pattern, label: pattern }))}
            selected={patterns}
            onChange={(next) =>
              onChange({ index_patterns: [...new Set(next.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))] })
            }
            allowCustom
            placeholder="Select index patterns or input wildcards"
            invalid={showErrors && Boolean(patternsError)}
          />
        </Labeled>
        {patterns.some((pattern) => matchesAny('.kibana', [pattern])) && (
          <CallOut tone="warning" title="Index patterns may contain system indexes">
            This template may apply to new system indexes and may affect your ability to access OpenSearch. We recommend
            narrowing your index patterns.
          </CallOut>
        )}
        <Labeled
          title="Priority"
          across={isEdit}
          testId="form-row-priority"
          help="Specify the priority of this template. If the index name matches more than one template, the template with the highest priority will be applied to the index."
          error={showErrors ? priorityError(item.priority) : undefined}
        >
          <NumberField
            compact
            value={item.priority === undefined || item.priority === '' ? undefined : Number(item.priority)}
            onChange={(priority) => onChange({ priority })}
          />
        </Labeled>
        <div className="ismLabeled" data-test-subj="form-row-_meta.flow">
          <div className="ismLabeled__title">Choose a method to define your templates</div>
          <div className="ismCards">
            {card(
              'checkboxForIndexTemplateFlowSimple',
              'simple',
              'Simple template',
              'Define an index template with index aliases, settings, and mappings.'
            )}
            {card(
              'checkboxForIndexTemplateFlowComponents',
              'components',
              'Component template',
              'Define an index template by associating component templates containing index configurations.'
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function templateIsValid(item: TemplateItem, isEdit: boolean): boolean {
  if (!isEdit && !TEMPLATE_NAMING_PATTERN.test(item.name ?? '')) return false;
  if ((item.index_patterns ?? []).length === 0 || priorityError(item.priority)) return false;
  return !hasErrors(bodyErrors(item.template), item.template);
}

async function simulate(item: TemplateItem): Promise<TemplateItem | undefined> {
  const { template: _template, ...others } = remoteTemplate(item);
  const answer = await ism.request<{ template?: unknown }>('POST', '/_index_template/_simulate', simulatedTemplateBody(item, Date.now()));
  if (!answer.ok) {
    toasts.danger(answer.error);
    return undefined;
  }
  return localTemplate(
    { ...others, index_patterns: item.index_patterns, priority: item.priority, template: answer.response?.template },
    item.name
  );
}

export function TemplateDetail({ name }: { name: string }) {
  const isEdit = name !== '';
  useBreadcrumbs([
    CRUMBS.INDEX_MANAGEMENT,
    CRUMBS.TEMPLATES,
    isEdit ? { text: name, to: `${INDEX_MANAGEMENT_PATH}#${ROUTES.CREATE_TEMPLATE}/${name}` } : CRUMBS.CREATE_TEMPLATE,
  ]);
  const { hashParams } = useLocation();
  const [item, setItem] = useState<TemplateItem>(() => presetTemplate(hashParams.values));
  const [old, setOld] = useState<TemplateItem>();
  const [simulated, setSimulated] = useState<TemplateItem>();
  const [tab, setTab] = useState<'summary' | 'CONFIG'>('summary');
  const [preview, setPreview] = useState(false);
  const [json, setJson] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const answer = await ism.request<{ index_templates?: Array<{ name: string; index_template: IndexTemplate }> }>(
      'GET',
      `/_index_template/${name}?flat_settings=true`
    );
    const found = answer.ok ? answer.response?.index_templates?.find((template) => template.name === name) : undefined;
    if (!found) {
      toasts.danger(answer.ok ? `The template [${name}] does not exist.` : answer.error || '');
      go(ROUTES.TEMPLATES);
      return;
    }
    const local = localTemplate(found.index_template, name);
    setOld(copy(local));
    setItem(local);
    setSubmitted(false);
    setSimulated(await simulate(local));
  }, [name]);
  useEffect(() => {
    if (isEdit) void refresh();
  }, [isEdit, refresh]);

  const change = (changes: Partial<TemplateItem>) =>
    setItem((before) => {
      const next = { ...before, ...changes };
      if ('data_stream' in changes && changes.data_stream === undefined) delete next.data_stream;
      return next;
    });
  const flow = item._meta?.flow ?? 'simple';
  const readOnly = isEdit && tab === 'summary';
  const count = isEdit && tab === 'CONFIG' ? countChanges(comparableTemplate(old), comparableTemplate(item)) : 0;

  const submit = async (): Promise<boolean> => {
    setSubmitted(true);
    if (!templateIsValid(item, isEdit)) return false;
    setBusy(true);
    const result = await ism.request(isEdit ? 'POST' : 'PUT', `/_index_template/${item.name}`, remoteTemplate(item));
    setBusy(false);
    if (!result.ok) toasts.danger(result.error);
    return result.ok;
  };
  const showPreview = async () => {
    const result = await simulate(item);
    if (result) {
      setSimulated(result);
      setPreview(true);
    }
  };
  const previewButton = (
    <Button variant="ghost" size="s" onClick={showPreview} testId="CreateIndexTemplatePreviewButton">
      Preview template
    </Button>
  );
  if (isEdit && !old) return null;

  const definition = (
    <Definition
      body={readOnly ? (simulated?.template ?? {}) : item.template}
      onChange={(template) => change({ template })}
      readOnly={readOnly}
      across={isEdit}
      showErrors={submitted}
    />
  );
  const overriding = !readOnly && flow === 'components';

  return (
    <div className="ismPage ismPage--form">
      <div className="ismPageHeader ismPageHeader--center">
        <div>
          <h1 className="ismPageTitle" title={isEdit ? name : undefined}>
            {isEdit ? name : 'Create template'}
          </h1>
          {!isEdit && (
            <div className="ismLabeled__help">
              Index templates let you initialize new indexes with predefined mappings and settings.{' '}
              <ExternalLink href={TEMPLATE_DOCS} />
            </div>
          )}
        </div>
        {isEdit && (
          <div className="atlRow" style={{ gap: 'var(--space-5)' }}>
            <Button size="s" onClick={() => setJson(true)}>
              View JSON
            </Button>
            <Button size="s" variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {isEdit && (
        <Panel>
          <h2 className="ismPanel__heading">Overview</h2>
          <hr className="ismRule" />
          <Overview item={item} />
        </Panel>
      )}
      {isEdit && (
        <div className="atlTabs" role="tablist">
          {(
            [
              ['summary', 'Summary'],
              ['CONFIG', 'Configuration'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="atlTab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              data-test-subj={`TemplateDetailTab-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!readOnly && <TemplateSettings item={item} onChange={change} isEdit={isEdit} showErrors={submitted} />}
      {overriding && <Components item={item} onChange={(composed_of) => change({ composed_of })} />}
      {overriding ? (
        <Panel>
          <button type="button" className="ismOverride" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} />
            <span>
              <span className="ismPanel__heading">Override template definition</span>
              <span className="ismLabeled__help">
                Provide additional configurations such as index aliases, settings, and mappings. Configurations defined
                in this section will take precedent if they overlap with the associated component templates.
              </span>
            </span>
          </button>
          {open && (
            <>
              <hr className="ismRule" />
              {definition}
            </>
          )}
        </Panel>
      ) : (
        <Panel>
          <h2 className="ismPanel__heading">{readOnly ? 'Preview template' : 'Template definition'}</h2>
          <hr className="ismRule" />
          {definition}
        </Panel>
      )}
      {!isEdit && (
        <div className="ismDarkBar">
          <Button variant="ghost" size="s" icon="cross" onClick={() => go(ROUTES.TEMPLATES)} testId="CreateIndexTemplateCancelButton">
            Cancel
          </Button>
          {previewButton}
          <Button
            variant="primary"
            size="s"
            loading={busy}
            testId="CreateIndexTemplateCreateButton"
            onClick={async () => {
              if (await submit()) {
                toasts.success(`${item.name} has been successfully created.`);
                go(ROUTES.TEMPLATES);
              }
            }}
          >
            Create template
          </Button>
        </div>
      )}
      {count > 0 && (
        <UnsavedBar
          count={count}
          busy={busy}
          testId="updateTemplateButton"
          cancelTestId="CancelUpdateTemplateButton"
          extra={previewButton}
          onCancel={() => old && setItem(copy(old))}
          onSave={async () => {
            if (await submit()) {
              toasts.success(`${item.name} has been successfully updated.`);
              await refresh();
            }
          }}
        />
      )}
      {preview && simulated && (
        <Modal
          title="Preview template"
          wide
          onClose={() => setPreview(false)}
          footer={
            <Button variant="primary" size="s" onClick={() => setPreview(false)}>
              Close
            </Button>
          }
        >
          <div className="ismDefinition">
            <h3 className="ismDefinition__title">Template settings</h3>
            <Overview item={simulated} columns={3} />
            <Definition body={simulated.template} onChange={() => undefined} readOnly showErrors={false} columns={3} />
          </div>
        </Modal>
      )}
      {json && (
        <JSONModal
          title={item.name ?? ''}
          json={{ ...item, template: remoteTemplate(item).template }}
          indent={2}
          testId="templateJSONDetailModal"
          onClose={() => setJson(false)}
        />
      )}
      {deleting && <DeleteTemplateModal names={[name]} onClose={() => setDeleting(false)} onDelete={() => go(ROUTES.TEMPLATES)} />}
    </div>
  );
}

// --- A component template ---------------------------------------------------------------------------------

const newComponent = (): ComponentItem => ({ template: {} });

function PartPanel({
  title,
  help,
  on,
  onToggle,
  embedded,
  children,
}: {
  title: string;
  help?: ReactNode;
  on: boolean;
  onToggle: (on: boolean) => void;
  embedded?: boolean;
  children: ReactNode;
}) {
  const content = (
    <>
      <div className="ismPageHeader">
        <div>
          <h2 className="ismPanel__heading">{title}</h2>
          {help}
        </div>
        <Switch checked={on} onChange={onToggle} label="Use configuration" />
      </div>
      {on && (
        <>
          <hr className="ismRule" />
          {children}
        </>
      )}
    </>
  );
  return embedded ? <div className="ismPart">{content}</div> : <Panel>{content}</Panel>;
}

interface ComponentFormProps {
  name?: string;
  /** Inside a dialog: no title, no panels and no buttons of its own */
  embedded?: boolean;
  onCreated?: (name: string) => void;
}

const ComponentForm = forwardRef<{ submit: () => void }, ComponentFormProps>(function ComponentForm(
  { name = '', embedded, onCreated },
  ref
) {
  const isEdit = name !== '';
  const [item, setItem] = useState<ComponentItem>(newComponent);
  const [old, setOld] = useState<ComponentItem>();
  const [taken, setTaken] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [users, setUsers] = useState<Array<IndexTemplate & { name: string }>>([]);
  const turn = useRef(0);

  const refresh = useCallback(async () => {
    const answer = await ism.request<{ component_templates?: Array<{ name: string; component_template: unknown }> }>(
      'GET',
      `/_component_template/${name}?flat_settings=true`
    );
    const found = answer.ok ? answer.response?.component_templates?.find((component) => component.name === name) : undefined;
    if (!found) {
      toasts.danger(answer.ok ? `The template [${name}] does not exist.` : answer.error || '');
      go(ROUTES.COMPOSABLE_TEMPLATES);
      return;
    }
    const local = localComponent(found.component_template, name);
    setOld(copy(local));
    setItem(local);
    setSubmitted(false);
  }, [name]);
  useEffect(() => {
    if (isEdit) void refresh();
  }, [isEdit, refresh]);

  // A name that a component template already has cannot be given to a new one
  useEffect(() => {
    if (isEdit || !item.name) {
      setTaken(undefined);
      return undefined;
    }
    const mine = (turn.current += 1);
    const asked = item.name;
    const timer = window.setTimeout(async () => {
      const answer = await ism.request<{ component_templates?: Array<{ name: string }> }>(
        'GET',
        `/_component_template/${asked}?flat_settings=true`,
        undefined,
        true
      );
      if (mine !== turn.current) return;
      const exists = answer.ok && Boolean(answer.response?.component_templates?.some((component) => component.name === asked));
      setTaken(exists ? asked : undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [isEdit, item.name]);

  const change = (changes: Partial<ComponentItem>) => setItem((before) => ({ ...before, ...changes }));
  const include = (part: Part, on: boolean) => change({ includes: { ...item.includes, [part]: on } });
  const errors = bodyErrors(item.template);
  const nameError = !TEMPLATE_NAMING_PATTERN.test(item.name ?? '')
    ? 'Invalid template name.'
    : taken === item.name
      ? `The component template ${item.name} already exists, please change the name.`
      : undefined;
  const count = isEdit ? countChanges(comparableComponent({ name: item.name, template: {}, ...old }), comparableComponent(item)) : 0;

  const submit = async (): Promise<boolean> => {
    setSubmitted(true);
    if (!isEdit && nameError) return false;
    if (item.includes?.aliases && errors.aliases) return false;
    if (item.includes?.settings && Object.keys(errors.settings).length > 0) return false;
    if (item.includes?.mappings && fieldsHaveErrors(item.template.mappings?.properties ?? [], undefined, false)) return false;
    setBusy(true);
    const result = await ism.request(isEdit ? 'POST' : 'PUT', `/_component_template/${item.name}`, remoteComponent(item));
    setBusy(false);
    if (!result.ok) toasts.danger(result.error);
    return result.ok;
  };
  const create = async () => {
    if (await submit()) {
      toasts.success(`${item.name} has been successfully created.`);
      if (onCreated) onCreated(item.name ?? '');
      else go(ROUTES.COMPOSABLE_TEMPLATES);
    }
  };
  useImperativeHandle(ref, () => ({ submit: () => void create() }));
  if (isEdit && !old) return null;

  const define = (
    <div className="ismForm">
      {!isEdit && (
        <Labeled
          title="Name"
          testId="form-row-name"
          help="Name cannot be changed after the component template is created."
          error={submitted || taken ? nameError : undefined}
        >
          <TextField compact value={item.name ?? ''} onChange={(next) => change({ name: next })} invalid={(submitted || Boolean(taken)) && Boolean(nameError)} />
          <div className="ismLabeled__help">{TEMPLATE_NAMING_MESSAGE}</div>
        </Labeled>
      )}
      <Labeled
        title={
          <>
            Description - <i>optional</i>
          </>
        }
        across={isEdit}
        testId="form-row-_meta.description"
        help="Describe the purpose or contents to help you identify this component."
      >
        <TextField
          compact
          value={item._meta?.description ?? ''}
          onChange={(description) => change({ _meta: { ...item._meta, description } })}
        />
      </Labeled>
    </div>
  );

  return (
    <div className={embedded ? 'ismEmbedded' : 'ismPage ismPage--form'}>
      {!embedded && (
        <div className="ismPageHeader ismPageHeader--center">
          <div>
            <h1 className="ismPageTitle" title={isEdit ? name : undefined}>
              {isEdit ? name : 'Create component template'}
            </h1>
            {!isEdit && (
              <div className="ismLabeled__help">
                {COMPONENT_TEXT} <ExternalLink href={COMPONENT_DOCS} />
              </div>
            )}
          </div>
          {isEdit && (
            <div className="atlRow" style={{ gap: 'var(--space-5)' }}>
              <Button size="s" onClick={() => setJson(true)} testId="viewJSONButton">
                View JSON
              </Button>
              <Button
                size="s"
                variant="danger"
                testId="deleteAction"
                onClick={async () => {
                  setUsers((await loadIndexTemplates()).filter((template) => template.composed_of?.includes(name)));
                  setDeleting(true);
                }}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
      {embedded ? (
        define
      ) : (
        <Panel>
          <h2 className="ismPanel__heading">Define component template</h2>
          <hr className="ismRule" />
          {define}
        </Panel>
      )}
      <PartPanel
        title="Index alias"
        embedded={embedded}
        on={Boolean(item.includes?.aliases)}
        onToggle={(on) => include('aliases', on)}
        help={
          <div className="ismLabeled__help">
            Allow the new indexes to be referenced by existing aliases or specify a new alias.
          </div>
        }
      >
        <AliasPart
          body={item.template}
          onChange={(template) => change({ template })}
          across={isEdit}
          error={submitted ? errors.aliases : undefined}
        />
      </PartPanel>
      <PartPanel
        title="Index settings"
        embedded={embedded}
        on={Boolean(item.includes?.settings)}
        onToggle={(on) => include('settings', on)}
      >
        <SettingsPart
          body={item.template}
          onChange={(template) => change({ template })}
          across={isEdit}
          errors={submitted ? errors.settings : {}}
        />
      </PartPanel>
      <PartPanel
        title="Index mapping"
        embedded={embedded}
        on={Boolean(item.includes?.mappings)}
        onToggle={(on) => include('mappings', on)}
        help={<MappingsHelp />}
      >
        <MappingEditor
          value={item.template.mappings}
          onChange={(mappings) => change({ template: { ...item.template, mappings } })}
          showErrors={submitted}
        />
      </PartPanel>
      {!isEdit && !embedded && (
        <div className="ismButtons">
          <Button variant="empty" size="s" onClick={() => go(ROUTES.COMPOSABLE_TEMPLATES)} testId="CreateComposableTemplateCancelButton">
            Cancel
          </Button>
          <Button variant="primary" size="s" loading={busy} onClick={create} testId="CreateComposableTemplateCreateButton">
            Create component template
          </Button>
        </div>
      )}
      {count > 0 && (
        <UnsavedBar
          count={count}
          busy={busy}
          testId="updateTemplateButton"
          onCancel={() => old && setItem(copy(old))}
          onSave={async () => {
            if (await submit()) {
              toasts.success(`${item.name} has been successfully updated.`);
              await refresh();
            }
          }}
        />
      )}
      {json && (
        <JSONModal
          title={item.name ?? ''}
          json={(() => {
            const { includes: _includes, ...others } = item;
            return { ...others, template: remoteComponent({ ...item, includes: { aliases: true, settings: true, mappings: true } }).template };
          })()}
          indent={2}
          testId="templateJSONDetailModal"
          onClose={() => setJson(false)}
        />
      )}
      {deleting && (
        <DeleteComponentModal
          name={name}
          users={users.map((template) => template.name)}
          onClose={() => setDeleting(false)}
          onDelete={() => go(ROUTES.COMPOSABLE_TEMPLATES)}
        />
      )}
    </div>
  );
});

export function ComposableTemplateDetail({ name }: { name: string }) {
  useBreadcrumbs([
    CRUMBS.INDEX_MANAGEMENT,
    CRUMBS.COMPOSABLE_TEMPLATES,
    name ? { text: name, to: `${INDEX_MANAGEMENT_PATH}#${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${name}` } : CRUMBS.CREATE_COMPOSABLE_TEMPLATE,
  ]);
  return <ComponentForm name={name} />;
}
