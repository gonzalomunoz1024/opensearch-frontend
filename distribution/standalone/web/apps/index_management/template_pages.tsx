/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The page of one index template and the page of one component template: each creates one when
 * the address names none, and shows and changes the one it names.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef, type ReactNode } from 'react';
import { Button, CallOut, IconButton, Panel, Tabs, cx } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { NumberField, SearchField, Switch, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Modal } from '../../components/overlay';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { PageBottomBar, UnsavedChangesBar } from './bottom_bar';
import { ExternalLink, go, ism, to, toasts } from './common';
import { ContentPanel, FactGrid, TitledPanel } from './content_panel';
import { FilterBox } from './filter_box';
import { FormRow } from './form_row';
import { JsonShowModal } from './plugin_modal';
import { AdvancedSettings, AliasSelect, MappingEditor, SettingsFields, aliasesError } from './index_form';
import {
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
import {
  DeleteComponentModal,
  DeleteTemplateModal,
  TYPE_FILTERS,
  TypeBadges,
  loadIndexTemplates,
  type IndexTemplate,
} from './templates';

const DOCS = 'https://opensearch.org/docs/latest';
const TEMPLATE_DOCS = `${DOCS}/opensearch/index-templates/`;
const COMPONENT_DOCS = `${DOCS}/im-plugin/index-templates/#composable-index-templates`;
const MAPPINGS_DOCS = `${DOCS}/opensearch/mappings/`;
const COMPONENT_TEXT =
  'Component templates are reusable building blocks for composing index or data stream templates. You can define component templates with common index configurations and associate them to an index template.';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
const nothing = () => undefined;
/** A setting as the plugin's summary writes it: a dash for nothing */
const shownSetting = (value: unknown) => (value ? String(value) : '-');

/** What a template is, as the plugin's overview of it: a heading over each value, `columns` to a row */
function OverviewItems({ item, columns }: { item: TemplateItem; columns?: number }) {
  const composed = item.composed_of ?? [];
  return (
    <FactGrid
      headings
      columns={columns}
      items={[
        ['Template type', typeName(item)],
        ['Index patterns', item.index_patterns?.join(', ') ?? '-'],
        ['Priority', item.priority ?? '-'],
        [
          'Associated component templates',
          composed.length === 0
            ? '-'
            : composed.map((name) => (
                <div key={name}>
                  <a href={to(`${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${name}`)} target="_blank" rel="noreferrer">
                    {name}
                    <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
                  </a>
                </div>
              )),
        ],
      ]}
    />
  );
}

interface PartProps {
  body: TemplateBody;
  onChange: (body: TemplateBody) => void;
  readOnly?: boolean;
  /** Each field beside its title, as the plugin edits a template there is */
  across?: boolean;
}

/** The aliases of the new indexes: what they are for, then their names, or the field to choose them */
function TemplateAliases({ body, onChange, readOnly, across, error }: PartProps & { error?: string }) {
  return (
    <>
      <FormRow
        fullWidth
        title="Index alias"
        help="Allow the new indexes to be referenced by existing aliases or specify a new alias."
      />
      <div className="ismSpacer ismSpacer--s" />
      {readOnly ? (
        <FactGrid headings items={[['Alias names', Object.keys(body.aliases ?? {}).join(',') || '-']]} />
      ) : (
        <FormRow
          fullWidth
          narrow
          small
          across={across}
          title="Index alias"
          help="Select existing aliases or specify a new alias."
          testId="form-row-template.aliases"
          error={error}
        >
          <AliasSelect value={body.aliases} onChange={(aliases) => onChange({ ...body, aliases })} invalid={Boolean(error)} />
        </FormRow>
      )}
    </>
  );
}

/** The settings of the new indexes: three of them by name, or written out, and all of them as JSON */
function TemplateIndexSettings({
  body,
  onChange,
  readOnly,
  across,
  errors,
  columns,
}: PartProps & { errors: Record<string, string>; columns?: number }) {
  const settings = body.settings ?? {};
  return (
    <>
      <h3 className="ismCustomRow__title">Index settings</h3>
      <div className="ismSpacer ismSpacer--s" />
      {readOnly ? (
        <>
          <FactGrid
            headings
            columns={columns}
            items={[
              ['Number of primary shards', shownSetting(settings['index.number_of_shards'])],
              ['Number of replicas', shownSetting(settings['index.number_of_replicas'])],
              ['Refresh interval', shownSetting(settings['index.refresh_interval'])],
            ]}
          />
          <div className="ismSpacer ismSpacer--l" />
          <AdvancedSettings value={settings} onChange={nothing} readOnly forTemplate />
        </>
      ) : (
        <SettingsFields
          value={body.settings}
          onChange={(next) => onChange({ ...body, settings: next })}
          errors={errors}
          forTemplate
          across={across}
        />
      )}
    </>
  );
}

/** The mapping of the new indexes, with where to read about mappings under its title */
function TemplateMappings({ body, onChange, readOnly, showErrors }: PartProps & { showErrors: boolean }) {
  return (
    <>
      <h3 className="ismCustomRow__title">Index mapping</h3>
      <FormRow
        fullWidth
        helpAt="bottom"
        help={
          <div>
            Define how documents and their fields are stored and indexed. <ExternalLink href={MAPPINGS_DOCS} />
          </div>
        }
      />
      <div className="ismSpacer ismSpacer--s" />
      <MappingEditor
        value={body.mappings}
        onChange={(mappings) => onChange({ ...body, mappings })}
        readOnly={readOnly}
        showErrors={showErrors}
      />
    </>
  );
}

/** The three things a template gives the indexes, one under the other, 24 px apart */
function TemplateParts({
  body,
  onChange,
  readOnly,
  across,
  showErrors,
  columns,
}: PartProps & { showErrors: boolean; columns?: number }) {
  const errors = bodyErrors(body);
  return (
    <>
      <TemplateAliases
        body={body}
        onChange={onChange}
        readOnly={readOnly}
        across={across}
        error={showErrors ? errors.aliases : undefined}
      />
      <div className="ismSpacer ismSpacer--l" />
      <TemplateIndexSettings
        body={body}
        onChange={onChange}
        readOnly={readOnly}
        across={across}
        errors={showErrors ? errors.settings : {}}
        columns={columns}
      />
      <div className="ismSpacer ismSpacer--l" />
      <TemplateMappings body={body} onChange={onChange} readOnly={readOnly} showErrors={showErrors} />
    </>
  );
}

/** Indexes or data streams, as the theme's compressed radios, and a data stream's time field */
function TemplateType({
  value,
  onChange,
}: {
  value: TemplateItem['data_stream'];
  onChange: (value: TemplateItem['data_stream']) => void;
}) {
  return (
    <>
      <div className="ismRadios">
        <label className="atlRadio">
          <input type="radio" id="Indexes" checked={value === undefined} onChange={(event) => event.target.checked && onChange(undefined)} />
          <span>Indexes</span>
        </label>
        <label className="atlRadio">
          <input
            type="radio"
            id="Data streams"
            checked={value !== undefined}
            onChange={(event) => event.target.checked && onChange({ timestamp_field: { name: '@timestamp' } })}
          />
          <span>Data streams</span>
        </label>
      </div>
      {value !== undefined && (
        <>
          <div className="ismSpacer ismSpacer--l" />
          <FormRow title="Time field" small>
            <TextField
              compact
              value={value.timestamp_field?.name ?? ''}
              onChange={(name) => onChange(name ? { timestamp_field: { name } } : {})}
            />
          </FormRow>
        </>
      )}
    </>
  );
}

/** The template's name, type, patterns, priority and way of being defined, as the plugin's panel */
function DefineTemplate({
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
  // As the plugin's form, a field is checked as soon as it changes, and all of them when submitting
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const shown = (name: string) => showErrors || Boolean(touched[name]);
  const touch = (name: string, changes: Partial<TemplateItem>) => {
    setTouched((before) => ({ ...before, [name]: true }));
    onChange(changes);
  };
  const flow = item._meta?.flow ?? 'simple';
  const patterns = item.index_patterns ?? [];
  const nameError = TEMPLATE_NAMING_PATTERN.test(item.name ?? '') ? undefined : 'Invalid template name.';
  const patternsError = patterns.length === 0 ? 'Index patterns must be defined' : undefined;
  const priority = shown('priority') ? priorityError(item.priority) : undefined;
  const card = (id: string, value: 'simple' | 'components', title: string, text: string) => (
    <label className={cx('ismFlowCard', flow === value && 'ismFlowCard--checked')}>
      <span className="ismFlowCard__side">
        <input
          type="radio"
          id={id}
          checked={flow === value}
          onChange={() => onChange({ _meta: { ...item._meta, flow: value } })}
        />
      </span>
      <span className="ismFlowCard__body">
        <h4 className="ismFlowCard__title">{title}</h4>
        <span className="ismFlowCard__text">{text}</span>
      </span>
    </label>
  );
  return (
    <Panel>
      <h2 className="ismPanelTitle">Template settings</h2>
      <hr className="ismRule" />
      <div className="ismSpacer ismSpacer--s" />
      {!isEdit && (
        <>
          <FormRow
            title="Template name"
            testId="form-row-name"
            help={<div>Template name cannot be changed after the template is created.</div>}
            error={shown('name') ? nameError : undefined}
          >
            <TextField
              compact
              value={item.name ?? ''}
              onChange={(name) => touch('name', { name })}
              invalid={shown('name') && Boolean(nameError)}
            />
          </FormRow>
          <FormRow help={<div>{TEMPLATE_NAMING_MESSAGE}</div>} />
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      <FormRow title="Template type" across={isEdit} testId="form-row-data_stream">
        <TemplateType value={item.data_stream} onChange={(data_stream) => onChange({ data_stream })} />
      </FormRow>
      <div className="ismSpacer ismSpacer--l" />
      <FormRow
        title="Index patterns"
        across={isEdit}
        testId="form-row-index_patterns"
        help="Specify the index patterns or wildcards. Add a comma to separate each value. Settings in this template will be applied to indexes with names matching index patterns or wildcards."
        error={shown('index_patterns') ? patternsError : undefined}
      >
        <ComboBox
          compact
          options={patterns.map((pattern) => ({ value: pattern, label: pattern }))}
          selected={patterns}
          onChange={(next) =>
            touch('index_patterns', {
              index_patterns: [
                ...new Set(next.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)),
              ],
            })
          }
          allowCustom
          delimiter=","
          placeholder="Select index patterns or input wildcards"
          invalid={shown('index_patterns') && Boolean(patternsError)}
        />
      </FormRow>
      <div className="ismSpacer ismSpacer--l" />
      {patterns.some((pattern) => matchesAny('.kibana', [pattern])) && (
        <>
          <FormRow>
            <CallOut tone="warning" title="Index patterns may contain system indexes">
              This template may apply to new system indexes and may affect your ability to access OpenSearch. We
              recommend narrowing your index patterns.
            </CallOut>
          </FormRow>
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      <FormRow
        title="Priority"
        across={isEdit}
        testId="form-row-priority"
        help="Specify the priority of this template. If the index name matches more than one template, the template with the highest priority will be applied to the index."
        error={priority}
      >
        <NumberField
          compact
          value={item.priority === undefined || item.priority === '' ? undefined : Number(item.priority)}
          onChange={(next) => touch('priority', { priority: next })}
          invalid={Boolean(priority)}
        />
      </FormRow>
      <div className="ismSpacer ismSpacer--l" />
      <FormRow fullWidth title="Choose a method to define your templates" testId="form-row-_meta.flow">
        <div className="ismFlowCards">
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
      </FormRow>
    </Panel>
  );
}

/** The component templates an index template is composed of, in the order that decides which of them wins */
function ComposedOf({ item, onChange }: { item: TemplateItem; onChange: (composed: string[]) => void }) {
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
    <ContentPanel
      title={
        <FormRow
          fullWidth
          label={<div className="ismPanelTitle">Component template</div>}
          help={
            <>
              Define an index template by combining component templates containing index configurations. Associate
              existing component templates or create one. You can arrange the priority of the component templates by
              dragging them. The component template placed on bottom has the highest priority.{' '}
              <ExternalLink href={COMPONENT_DOCS} />
            </>
          }
        />
      }
    >
      {composed.length > 0 && all.length > 0 ? (
        <div data-test-subj="droppable">
          {composed.map((name, index) => {
            const found = all.find((component) => component.name === name);
            if (!found) return <div key={name} />;
            return (
              <div
                key={name}
                className={cx('ismComposed', dragged === index && 'ismComposed--dragged')}
                data-test-subj="draggable"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => drop(index)}
              >
                <div className="ismComposed__panel">
                  <div className="ismComposed__what">
                    <div
                      className="ismComposed__grab"
                      aria-label="Drag Handle"
                      draggable
                      onDragStart={() => setDragged(index)}
                      onDragEnd={() => setDragged(undefined)}
                    >
                      <Icon name="grab" />
                    </div>
                    <span className="ismComposed__name">{name}</span>
                    <div className="ismComposed__badges">
                      <TypeBadges template={found.component_template.template} />
                    </div>
                  </div>
                  <div className="ismComposed__buttons">
                    <IconButton
                      variant="dangerEmpty"
                      icon="trash"
                      label="delete"
                      onClick={() => onChange(composed.filter((_, at) => at !== index))}
                    />
                    <IconButton
                      variant="empty"
                      icon="inspect"
                      label="see detail"
                      onClick={() => window.open(to(`${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${name}`))}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ismTextM">No component templates associated</div>
      )}
      <div className="ismSpacer ismSpacer--l" />
      <div className="ismComposedButtons">
        <Button onClick={() => setChoosing(true)}>Associate component templates</Button>
        <Button onClick={() => setCreating(true)}>Create component template</Button>
      </div>
      {choosing && (
        <Modal
          title="Associate component templates"
          className="ismAssociateModal"
          onClose={() => setChoosing(false)}
          footer={
            <>
              <Button variant="empty" onClick={() => setChoosing(false)} testId="Associate component templates-cancel">
                Cancel
              </Button>
              <Button
                variant="primary"
                testId="Associate component templates-confirm"
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
          {/* The theme's selectable list: its search and the plugin's filter of types, then the
              list 480 px high, a tick before each name chosen and the names already used greyed */}
          <div className="ismPicker">
            <div className="ismPicker__top">
              <div className="atlGrow">
                <SearchField value={search} onChange={setSearch} placeholder="Search" className="ismPicker__search" />
              </div>
              <FilterBox own name="Types" options={TYPE_FILTERS} selected={types} onChange={setTypes} />
            </div>
            <ul className="ismPicker__list" aria-multiselectable="true" role="listbox">
              {options.map((component) => {
                const used = composed.includes(component.name);
                const on = used || chosen.includes(component.name);
                return (
                  <li
                    key={component.name}
                    role="option"
                    aria-selected={on}
                    aria-disabled={used}
                    tabIndex={used ? -1 : 0}
                    className={cx('ismPicker__item', used && 'ismPicker__item--disabled')}
                    onClick={() =>
                      !used &&
                      setChosen(on ? chosen.filter((name) => name !== component.name) : [...chosen, component.name])
                    }
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      event.currentTarget.click();
                    }}
                  >
                    <Icon name={on ? 'check' : 'empty'} className="ismPicker__check" />
                    <span className="ismPicker__text">
                      <span className="ismPicker__name">{component.name}</span>
                      <TypeBadges template={component.component_template.template} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Modal>
      )}
      {creating && (
        <Modal
          title="Create component template"
          wide
          className="ismCreateComponentModal"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="empty" onClick={() => setCreating(false)} testId="Create component template-cancel">
                Cancel
              </Button>
              <Button variant="primary" onClick={() => created.current?.submit()} testId="Create component template-confirm">
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
    </ContentPanel>
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

const TEMPLATE_TABS = [
  { id: 'summary', label: 'Summary', testId: 'TemplateDetailTab-summary' },
  { id: 'CONFIG', label: 'Configuration', testId: 'TemplateDetailTab-CONFIG' },
];

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
  const [tab, setTab] = useState<string>('summary');
  const [preview, setPreview] = useState(false);
  const [json, setJson] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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
  const readOnly = isEdit && tab === 'summary';
  const components = (item._meta?.flow ?? 'simple') === 'components';
  const accordion = !readOnly && components;
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
    <Button
      variant="ghost"
      className="ismChangesBar__outline"
      onClick={() => void showPreview()}
      testId="CreateIndexTemplatePreviewButton"
    >
      Preview template
    </Button>
  );
  if (isEdit && !old) return null;

  return (
    <div className="ismFormPage">
      {isEdit ? (
        <div className="ismPageTitleRow">
          <h1 className="ismTextTitle" title={item.name}>
            {name}
          </h1>
          <div className="ismPageTitleRow__buttons">
            <Button onClick={() => setJson(true)}>View JSON</Button>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <>
          <h1 className="ismTextTitle">Create template</h1>
          <FormRow
            fullWidth
            help={
              <div>
                Index templates let you initialize new indexes with predefined mappings and settings.{' '}
                <ExternalLink href={TEMPLATE_DOCS} />
              </div>
            }
          />
        </>
      )}
      <div className="ismSpacer ismSpacer--l" />
      {isEdit && (
        <>
          <TitledPanel title="Overview">
            <div className="ismSpacer ismSpacer--s" />
            <OverviewItems item={item} />
          </TitledPanel>
          <div className="ismSpacer ismSpacer--l" />
          <Tabs size="s" tabs={TEMPLATE_TABS} selected={tab} onSelect={setTab} />
          <div className="ismSpacer ismSpacer--m" />
        </>
      )}
      {!readOnly && (
        <>
          <DefineTemplate item={item} onChange={change} isEdit={isEdit} showErrors={submitted} />
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      {!readOnly && components && (
        <>
          <ComposedOf item={item} onChange={(composed_of) => change({ composed_of })} />
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      <ContentPanel
        noExtraPadding
        accordion={accordion}
        title={
          <h2 className="ismPanelTitle">
            {readOnly ? 'Preview template' : components ? 'Override template definition' : 'Template definition'}
          </h2>
        }
        subTitleText={
          accordion
            ? 'Provide additional configurations such as index aliases, settings, and mappings. Configurations defined in this section will take precedent if they overlap with the associated component templates.'
            : undefined
        }
      >
        <div className="ismSpacer ismSpacer--s" />
        <TemplateParts
          body={readOnly ? (simulated?.template ?? {}) : item.template}
          onChange={(template) => change({ template })}
          readOnly={readOnly}
          across={isEdit}
          showErrors={submitted}
        />
        <div className="ismSpacer ismSpacer--l" />
      </ContentPanel>
      {preview && simulated && (
        <Modal
          title="Preview template"
          wide
          onClose={() => setPreview(false)}
          footer={
            <Button variant="primary" onClick={() => setPreview(false)} testId="Preview template-ok">
              Close
            </Button>
          }
        >
          <h3 className="ismCustomRow__title">Template settings</h3>
          <div className="ismSpacer ismSpacer--l" />
          <div className="ismSpacer ismSpacer--s" />
          <OverviewItems item={simulated} columns={3} />
          <div className="ismSpacer ismSpacer--l" />
          <div className="ismSpacer ismSpacer--l" />
          <TemplateParts body={simulated.template} onChange={nothing} readOnly showErrors={false} columns={3} />
        </Modal>
      )}
      {!isEdit && (
        <PageBottomBar>
          <Button variant="ghost" icon="cross" onClick={() => go(ROUTES.TEMPLATES)} testId="CreateIndexTemplateCancelButton">
            Cancel
          </Button>
          {previewButton}
          <Button
            variant="primary"
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
        </PageBottomBar>
      )}
      {count > 0 && (
        <UnsavedChangesBar
          count={count}
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
      {json && (
        <JsonShowModal
          title={item.name ?? ''}
          large
          json={{ ...item, template: remoteTemplate(item).template }}
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

/**
 * One part a component template may give, as the plugin's panel of it: its title, what it is for,
 * the switch that puts it in the template, and, when on, its fields. In the dialog of an index
 * template's page the panel is the theme's ghost: no frame and no rule.
 */
function ComponentPart({
  title,
  on,
  onToggle,
  ghost,
  wrapSwitch = true,
  children,
}: {
  title: ReactNode;
  on: boolean;
  onToggle: (on: boolean) => void;
  ghost?: boolean;
  /** The plugin puts the switch of two of the parts in a block of its own */
  wrapSwitch?: boolean;
  children: ReactNode;
}) {
  const toggle = <Switch compressed checked={on} onChange={onToggle} label="Use configuration" />;
  return (
    <ContentPanel ghost={ghost} noExtraPadding title={title} actions={wrapSwitch ? <div>{toggle}</div> : toggle}>
      {on ? children : null}
    </ContentPanel>
  );
}

interface ComponentFormProps {
  name?: string;
  /** Inside the dialog of an index template's page: no title, no panels and no buttons of its own */
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
  const [nameTouched, setNameTouched] = useState(false);
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

  // As the plugin's form, a name is checked as soon as it is typed
  const nameShown = submitted || nameTouched || Boolean(taken);
  const define = (
    <>
      {!isEdit && (
        <>
          <FormRow
            title="Name"
            testId="form-row-name"
            help={<div>Name cannot be changed after the component template is created.</div>}
            error={nameShown ? nameError : undefined}
          >
            <TextField
              compact
              value={item.name ?? ''}
              onChange={(next) => {
                setNameTouched(true);
                change({ name: next });
              }}
              invalid={nameShown && Boolean(nameError)}
            />
          </FormRow>
          <FormRow help={<div>{TEMPLATE_NAMING_MESSAGE}</div>} />
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      <FormRow
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
      </FormRow>
    </>
  );

  const parts = (
    <>
      <ComponentPart
        ghost={embedded}
        on={Boolean(item.includes?.aliases)}
        onToggle={(on) => include('aliases', on)}
        title={
          <FormRow
            fullWidth
            label={<h2 className="ismPanelTitle">Index alias</h2>}
            help="Allow the new indexes to be referenced by existing aliases or specify a new alias."
          />
        }
      >
        <div className="ismSpacer ismSpacer--s" />
        <FormRow
          fullWidth
          narrow
          across={isEdit}
          title="Index alias"
          help={<div>Select existing aliases or specify a new alias.</div>}
          testId="form-row-template.aliases"
          error={submitted ? errors.aliases : undefined}
        >
          <AliasSelect
            value={item.template.aliases}
            onChange={(aliases) => change({ template: { ...item.template, aliases } })}
            invalid={submitted && Boolean(errors.aliases)}
          />
        </FormRow>
        <div className="ismSpacer ismSpacer--s" />
      </ComponentPart>
      <div className="ismSpacer ismSpacer--l" />
      <ComponentPart
        ghost={embedded}
        on={Boolean(item.includes?.settings)}
        onToggle={(on) => include('settings', on)}
        title={<h2 className="ismPanelTitle">Index settings</h2>}
      >
        <div className="ismSpacer ismSpacer--s" />
        <SettingsFields
          value={item.template.settings}
          onChange={(settings) => change({ template: { ...item.template, settings } })}
          errors={submitted ? errors.settings : {}}
          forTemplate
          forComponent
          across={isEdit}
        />
        <div className="ismSpacer ismSpacer--l" />
      </ComponentPart>
      <div className="ismSpacer ismSpacer--l" />
      <ComponentPart
        ghost={embedded}
        wrapSwitch={false}
        on={Boolean(item.includes?.mappings)}
        onToggle={(on) => include('mappings', on)}
        title={
          <>
            <h2 className="ismPanelTitle">Index mapping</h2>
            <FormRow
              fullWidth
              helpAt="bottom"
              help={
                <div>
                  Define how documents and their fields are stored and indexed. <ExternalLink href={MAPPINGS_DOCS} />
                </div>
              }
            />
          </>
        }
      >
        <div className="ismSpacer ismSpacer--l" />
        <FormRow fullWidth>
          <MappingEditor
            value={item.template.mappings}
            onChange={(mappings) => change({ template: { ...item.template, mappings } })}
            showErrors={submitted}
          />
        </FormRow>
        <div className="ismSpacer ismSpacer--l" />
      </ComponentPart>
    </>
  );

  if (embedded) {
    return (
      <div>
        {define}
        <div className="ismSpacer ismSpacer--l" />
        {parts}
      </div>
    );
  }

  return (
    <div className="ismFormPage">
      {isEdit ? (
        <div className="ismPageTitleRow">
          <h1 className="ismTextTitle" title={name}>
            {name}
          </h1>
          <div className="ismPageTitleRow__buttons">
            <Button onClick={() => setJson(true)}>View JSON</Button>
            <Button
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
        </div>
      ) : (
        <>
          <h1 className="ismTextTitle">Create component template</h1>
          <FormRow
            fullWidth
            help={
              <div>
                {COMPONENT_TEXT} <ExternalLink href={COMPONENT_DOCS} />
              </div>
            }
          />
        </>
      )}
      <div className="ismSpacer ismSpacer--l" />
      <TitledPanel title="Define component template" grouped>
        {define}
      </TitledPanel>
      <div className="ismSpacer ismSpacer--l" />
      {parts}
      {!isEdit && (
        <>
          <div className="ismSpacer ismSpacer--l" />
          <div className="ismEndButtons">
            <Button variant="empty" onClick={() => go(ROUTES.COMPOSABLE_TEMPLATES)} testId="CreateComposableTemplateCancelButton">
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={create} testId="CreateComposableTemplateCreateButton">
              Create component template
            </Button>
          </div>
        </>
      )}
      {count > 0 && (
        <UnsavedChangesBar
          count={count}
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
        <JsonShowModal
          title={item.name ?? ''}
          json={(() => {
            const { includes: _includes, ...others } = item;
            return { ...others, template: remoteComponent({ ...item, includes: { aliases: true, settings: true, mappings: true } }).template };
          })()}
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
