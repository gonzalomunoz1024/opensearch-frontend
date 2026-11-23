/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Templates and component templates: the two lists, what links an index template to the
 * components it is composed of, and the dialogs that unlink and delete them.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, Spinner } from '../../components/basic';
import { Checkbox } from '../../components/form';
import { Flyout, Tooltip, type MenuItem } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { FewNames } from './aliases';
import {
  ActionsMenu,
  ExternalLink,
  LocalTable,
  SearchRow,
  Table,
  go,
  ism,
  to,
  toasts,
  useListQuery,
  type Answer,
  type TableColumn,
} from './common';
import { ContentPanel, ContentPanelActions, ListEmpty, TitleHelp } from './content_panel';
import { FilterBox } from './filter_box';
import { componentUsers, pluginOrder } from './index_model';
import { pageChanges, pageQuery } from './model';
import { DeleteModal, ModalButtons, ModalNames, PluginModal, SimpleModal } from './plugin_modal';
import { CRUMBS, ROUTES } from './routes';

const TEMPLATE_DOCS = 'https://opensearch.org/docs/latest/opensearch/index-templates/';
const COMPONENT_DOCS = 'https://opensearch.org/docs/latest/im-plugin/index-templates/#composable-index-templates';

export interface IndexTemplate {
  index_patterns?: string[];
  composed_of?: string[];
  priority?: number;
  data_stream?: Record<string, unknown>;
  template?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  [more: string]: unknown;
}

interface TemplateRow {
  name: string;
  index_patterns: string;
  order: string;
  version: string | null;
  composed_of: string;
  templateDetail?: IndexTemplate & { name: string };
}

interface IndexTemplates {
  index_templates?: Array<{ name: string; index_template: IndexTemplate }>;
}

/** Every index template with what it is made of */
export async function loadIndexTemplates(): Promise<Array<IndexTemplate & { name: string }>> {
  const answer = await ism.request<IndexTemplates>('GET', '/_index_template/*');
  if (!answer.ok) return [];
  return (answer.response?.index_templates ?? []).map((item) => ({ ...item.index_template, name: item.name }));
}

/**
 * Writes an index template again without one of its components, as the template is now. Nothing
 * comes back when the template could not be read, which a toast says as the plugin's does.
 */
async function withoutComponent(templateName: string, component: string): Promise<Answer | undefined> {
  const current = await ism.request<IndexTemplates>('GET', `/_index_template/${templateName}?flat_settings=true`);
  const found = current.response?.index_templates?.find((item) => item.name === templateName);
  if (!current.ok || !found) {
    toasts.danger(current.ok ? `The template [${templateName}] does not exist.` : current.error || '');
    return undefined;
  }
  return ism.request('POST', `/_index_template/${templateName}`, {
    ...found.index_template,
    composed_of: (found.index_template.composed_of ?? []).filter((item) => item !== component),
  });
}

/** Takes a component out of an index template, and says how that went */
async function unlink(templateName: string, component: string): Promise<boolean> {
  const answer = await withoutComponent(templateName, component);
  if (!answer) return false;
  if (answer.ok) toasts.success(`${component} has been successfully unlinked from ${templateName}.`);
  else toasts.danger(answer.error);
  return answer.ok;
}

/** A page of the plugin in a new tab, as the theme's link says it to a screen reader */
function NewTabLink({ path, children }: { path: string; children: ReactNode }) {
  return (
    <a href={to(path)} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
    </a>
  );
}

/** The plugin's question before a component leaves a template; `wording` is its last sentence */
function UnlinkConfirm({
  template,
  component,
  wording,
  onClose,
  onDone,
}: {
  template: string;
  component: string;
  wording: string;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <SimpleModal
      title={`Unlink from ${template}?`}
      confirmLabel="Unlink"
      danger
      onClose={onClose}
      onConfirm={async () => {
        const done = await unlink(template, component);
        if (done) onDone();
        return done;
      }}
    >
      <p>
        The component {component} will be removed from the template {template}
        {`. ${wording}`}
      </p>
    </SimpleModal>
  );
}

// --- Index templates ----------------------------------------------------------------------------------------

/** The plugin's flyout of the components a template is composed of, each with a way to unlink it */
function AssociatedComponents({
  template,
  onClose,
  onUnlink,
}: {
  template: IndexTemplate & { name: string };
  onClose: () => void;
  onUnlink: () => void;
}) {
  const [unlinking, setUnlinking] = useState<string>();
  const components = useMemo(() => (template.composed_of ?? []).map((name) => ({ name })), [template.composed_of]);
  return (
    <>
      <Flyout title="Associated component templates" onClose={onClose}>
        <LocalTable
          fixed
          columns={[
            {
              field: 'name',
              name: 'Component template',
              render: (row: { name: string }) => (
                <NewTabLink path={`${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${row.name}`}>{row.name}</NewTabLink>
              ),
            },
            {
              field: 'actions',
              name: 'Actions',
              align: 'right',
              render: (row) => (
                <Tooltip content="Unlink">
                  <IconButton
                    icon="unlink"
                    label={`Unlink ${row.name}?`}
                    title=""
                    onClick={() => setUnlinking(row.name)}
                  />
                </Tooltip>
              ),
            },
          ]}
          rows={components}
          rowId={(row) => row.name}
          pageSizes={[10, 25, 50]}
          empty="No items found"
        />
      </Flyout>
      {unlinking && (
        <UnlinkConfirm
          template={template.name}
          component={unlinking}
          wording="This will affect any new indexes created with this template."
          onClose={() => setUnlinking(undefined)}
          onDone={onUnlink}
        />
      )}
    </>
  );
}

export function DeleteTemplateModal({
  names,
  onClose,
  onDelete,
}: {
  names: string[];
  onClose: () => void;
  onDelete: () => void;
}) {
  const remove = async () => {
    const result = await ism.request('DELETE', `/_index_template/${names.join(',')}`);
    if (result.ok) {
      toasts.success(`Delete [${names.join(',')}] successfully`);
      onClose();
      onDelete();
    } else {
      toasts.danger(result.error || '');
    }
  };
  return (
    <DeleteModal
      title="Delete Templates"
      tips="The following template will be permanently deleted. This action cannot be undone."
      names={names}
      onClose={onClose}
      onConfirm={() => void remove()}
    />
  );
}

export function Templates() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.TEMPLATES]);
  const [query, setQuery] = useListQuery({ sortField: 'name' });
  const [all, setAll] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TemplateRow[]>([]);
  const [deleting, setDeleting] = useState<string[]>();
  // By its name: the flyout shows the template as the list has it now
  const [associated, setAssociated] = useState<string>();
  const turn = useRef(0);

  const load = async () => {
    const mine = (turn.current += 1);
    setLoading(true);
    const details = await loadIndexTemplates();
    const answer = await ism.call<TemplateRow[]>('cat.templates', {
      format: 'json',
      name: `*${query.search}*`,
      s: `${query.sortField}:${query.sortDirection}`,
    });
    if (mine !== turn.current) return;
    if (answer.ok && answer.response) {
      // The templates of the older kind are composed of nothing and are not listed
      const rows = answer.response
        .filter((item) => item.composed_of)
        .map((item) => ({ ...item, templateDetail: details.find((detail) => detail.name === item.name) }));
      setAll(rows);
      setSelected((before) => before.flatMap((item) => rows.filter((remote) => remote.name === item.name)));
    } else {
      toasts.danger(answer.error);
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.search, query.sortField, query.sortDirection]);

  const rows = all.slice(query.from * query.size, (query.from + 1) * query.size);
  const columns: Array<TableColumn<TemplateRow>> = [
    {
      field: 'name',
      name: 'Template name',
      sortable: true,
      render: (row) => (
        <a className="ismCellLink" href={`#${ROUTES.CREATE_TEMPLATE}/${row.name}`}>
          {row.name}
        </a>
      ),
    },
    {
      field: 'templateType',
      name: 'Template type',
      render: (row) => (row.templateDetail?.data_stream === undefined ? 'Indexes' : 'Data streams'),
    },
    {
      field: 'index_patterns',
      name: 'Index patterns',
      sortable: true,
      render: (row) => {
        const patterns = row.templateDetail?.index_patterns ?? [];
        return (
          <FewNames
            names={patterns}
            // "in in" is the plugin's
            title={
              <>
                Index patterns in in {row.name} ({patterns.length})
              </>
            }
            hint={`Index patterns in ${row.name} (${patterns.length})`}
            column="Index pattern"
            field="pattern"
            testId="indexPatternsTable"
          />
        );
      },
    },
    { field: 'order', name: 'Priority', sortable: true, align: 'right', render: (row) => row.order },
    {
      field: 'composed_of',
      name: 'Associated component templates',
      align: 'right',
      render: (row) => row.templateDetail?.composed_of?.length || 0,
    },
    {
      field: 'actions',
      name: 'Actions',
      align: 'right',
      render: (row) => (
        <span className="ismRowActions">
          {/* the plugin's words for the components of a template */}
          <Tooltip content="View associated index templates">
            <IconButton
              icon="kqlSelector"
              label="View associated index templates"
              title=""
              className="ismRowActions__info"
              onClick={() => setAssociated(row.name)}
            />
          </Tooltip>
          <Tooltip content="Delete template">
            <IconButton
              icon="trash"
              variant="dangerEmpty"
              label="Delete template"
              title=""
              className="ismRowActions__danger"
              onClick={() => setDeleting([row.name])}
            />
          </Tooltip>
        </span>
      ),
    },
  ];

  const items: MenuItem[] = [
    {
      id: 'edit',
      label: 'Edit',
      disabled: selected.length !== 1,
      testId: 'editAction',
      onClick: () => go(`${ROUTES.CREATE_TEMPLATE}/${selected[0].name}`),
    },
    {
      id: 'delete',
      label: 'Delete',
      disabled: selected.length !== 1,
      testId: 'deleteAction',
      onClick: () => setDeleting(selected.map((item) => item.name)),
    },
  ];
  const filtered = query.search !== '';
  const shown = associated ? all.find((row) => row.name === associated)?.templateDetail : undefined;

  return (
    <ContentPanel
      bodyStyles={{ padding: 'initial' }}
      title={
        <>
          <span className="ismContentPanel__title ismContentPanel__title--m">Templates</span>
          <TitleHelp>
            Index templates let you initialize new indexes or data streams with predefined mappings and settings.{' '}
            <ExternalLink href={TEMPLATE_DOCS} />
          </TitleHelp>
        </>
      }
      actions={
        <ContentPanelActions
          actions={[
            { text: '', children: <ActionsMenu items={items} size="m" /> },
            {
              text: 'Create template',
              buttonProps: { variant: 'primary', icon: 'plus', onClick: () => go(ROUTES.CREATE_TEMPLATE) },
            },
          ]}
        />
      }
    >
      <SearchRow
        className="ismIndexControls"
        clearable
        search={query.search}
        onSearch={(search) => setQuery({ search, from: 0 })}
        placeholder="Search..."
      />
      <hr className="ismContentPanel__rule" />
      <div className="ismTemplatesTable" data-test-subj="templatesTable">
        <Table
          fixed
          columns={columns}
          rows={rows}
          total={all.length}
          query={pageQuery(query)}
          onQuery={(changes) => setQuery(pageChanges(changes, query.size))}
          rowId={(row) => row.name}
          selected={selected}
          onSelect={setSelected}
          loading={loading}
          empty={
            <ListEmpty
              text={
                filtered
                  ? 'There are no templates matching your applied filters. Reset your filters to view your templates.'
                  : 'You have no templates.'
              }
            >
              {filtered ? (
                <Button variant="primary" onClick={() => setQuery({ search: '' })}>
                  Reset filters
                </Button>
              ) : (
                <Button variant="primary" icon="plus" onClick={() => go(ROUTES.CREATE_TEMPLATE)}>
                  Create template
                </Button>
              )}
            </ListEmpty>
          }
        />
      </div>
      {deleting && <DeleteTemplateModal names={deleting} onClose={() => setDeleting(undefined)} onDelete={load} />}
      {shown && (
        <AssociatedComponents template={shown} onClose={() => setAssociated(undefined)} onUnlink={() => void load()} />
      )}
    </ContentPanel>
  );
}

// --- Component templates --------------------------------------------------------------------------------------

interface ComponentTemplate {
  name: string;
  component_template: {
    template?: Record<string, unknown>;
    _meta?: { description?: string };
  };
}

interface ComponentRow extends ComponentTemplate {
  /** How many index templates are composed of it */
  associatedCount: number;
}

/** What a component template may hold, in the order of its badges */
const TYPES = ['aliases', 'settings', 'mappings'];
/** The same, in the order the filter offers them */
const TYPE_FILTERS = ['aliases', 'mappings', 'settings'];

/** The plugin's hollow badges of what a component template holds */
function TypeBadges({ template }: { template?: Record<string, unknown> }) {
  return (
    <div className="ismTypeBadges">
      {TYPES.filter((type) => template?.[type]).map((type) => (
        <span key={type} className="ismHollowBadge">
          {type}
        </span>
      ))}
    </div>
  );
}

/** The plugin's flyout of the index templates composed of a component, each with a way to unlink it */
function AssociatedTemplates({
  component,
  templates,
  onClose,
  onUnlink,
}: {
  component: string;
  /** The names of the index templates composed of it */
  templates: string[];
  onClose: () => void;
  onUnlink: () => void;
}) {
  const [unlinking, setUnlinking] = useState<string>();
  const rows = useMemo(() => templates.map((name) => ({ name })), [templates]);
  return (
    <>
      <Flyout title="Associated index templates" onClose={onClose}>
        <LocalTable
          fixed
          columns={[
            {
              field: 'name',
              name: 'Templates',
              render: (row: { name: string }) => (
                <NewTabLink path={`${ROUTES.CREATE_TEMPLATE}/${row.name}`}>{row.name}</NewTabLink>
              ),
            },
            {
              field: 'actions',
              name: 'Actions',
              align: 'right',
              render: (row) => (
                <Tooltip content="Unlink">
                  <IconButton
                    icon="unlink"
                    label={`Unlink from ${row.name}?`}
                    title=""
                    onClick={() => setUnlinking(row.name)}
                  />
                </Tooltip>
              ),
            },
          ]}
          rows={rows}
          rowId={(row) => row.name}
          pageSizes={[10, 25, 50]}
          empty="No items found"
        />
      </Flyout>
      {unlinking && (
        <UnlinkConfirm
          template={unlinking}
          component={component}
          wording="This will affect any new indexes created with the template."
          onClose={() => setUnlinking(undefined)}
          onDone={onUnlink}
        />
      )}
    </>
  );
}

/**
 * The plugin's question before a component template goes. The index templates composed of it lose
 * it first, all at once, once that is ticked.
 */
export function DeleteComponentModal({
  name,
  users,
  loading,
  onClose,
  onDelete,
}: {
  name: string;
  /** The index templates composed of it */
  users: string[];
  /** While it is not known yet which templates are composed of it */
  loading?: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const linked = users.length > 0;
  const confirm = async () => {
    if (linked) {
      const results = await Promise.all(users.map((template) => withoutComponent(template, name)));
      // A template that could not be read said so, and the plugin goes no further
      if (results.some((result) => result === undefined)) return;
      const failed = results.filter((result) => !result?.ok);
      if (failed.length > 0) {
        toasts.danger(failed.map((result) => result?.error ?? '').join(', '));
        return;
      }
    }
    const result = await ism.request('DELETE', `/_component_template/${name}`);
    if (result.ok) {
      toasts.success(`Delete [${name}] successfully`);
      onDelete();
    } else {
      toasts.danger(result.error || '');
    }
  };
  let body;
  if (loading) {
    body = <Spinner size="l" />;
  } else if (linked) {
    body = (
      <>
        <p>
          {`The component template ${name} will be permanently deleted. The component template will be unlinked from ${users.length} index templates:`}
        </p>
        {users.map((template, index) => (
          <span key={template}>
            {index > 0 && ', '}
            <a href={to(`${ROUTES.CREATE_TEMPLATE}/${template}`)} target="_blank" rel="noreferrer">
              {template}
            </a>
          </span>
        ))}
        <div className="ismSpacer ismSpacer--l" />
        <Checkbox
          checked={checked}
          onChange={setChecked}
          label={`Unlink index templates and delete ${name}`}
          testId="UnlinkConfirmCheckBox"
        />
      </>
    );
  } else {
    body = (
      <>
        <p>The following component template will be permanently deleted. This action cannot be undone.</p>
        <ModalNames names={[name]} within="plain" />
      </>
    );
  }
  return (
    <PluginModal
      title={<>Delete {name}</>}
      onClose={onClose}
      footer={
        <ModalButtons
          label={linked ? 'Apply changes' : 'Delete'}
          danger
          disabled={loading || (linked && !checked)}
          onCancel={onClose}
          onConfirm={() => void confirm()}
          cancelTestId="deletaCancelButton"
          confirmTestId={linked ? 'deleteConfirmUnlinkButton' : 'deleteConfirmButton'}
        />
      }
    >
      {body}
    </PluginModal>
  );
}

export function ComposableTemplates() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.TEMPLATES]);
  const [query, setQuery] = useListQuery({ sortField: 'name' });
  const [all, setAll] = useState<ComponentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ComponentRow[]>([]);
  // Not kept in the address, as the plugin keeps it
  const [types, setTypes] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string>();
  const [associated, setAssociated] = useState<string>();
  // Which index templates are composed of which component: read once, and again after an unlink
  const [users, setUsers] = useState<Map<string, string[]>>(new Map());
  const [usersLoading, setUsersLoading] = useState(true);
  const turn = useRef(0);

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsers(componentUsers(await loadIndexTemplates()));
    setUsersLoading(false);
  };
  useEffect(() => {
    void loadUsers();
  }, []);

  // As the plugin's, the list is read again whenever what it shows changes
  const load = async () => {
    const mine = (turn.current += 1);
    setLoading(true);
    const answer = await ism.request<{ component_templates?: ComponentTemplate[] }>(
      'GET',
      `/_component_template/*${query.search}*`,
      undefined,
      true
    );
    if (mine !== turn.current) return;
    let rows: ComponentTemplate[] = [];
    if (answer.ok) rows = answer.response?.component_templates ?? [];
    else if (answer.error !== 'Not Found') toasts.danger(answer.error);
    setAll(rows);
    setSelected((before) => before.filter((item) => rows.some((remote) => remote.name === item.name)));
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.search, query.sortField, query.sortDirection, query.from, query.size, types]);

  const columns: Array<TableColumn<ComponentRow>> = [
    {
      field: 'name',
      name: 'Name',
      sortable: true,
      render: (row) => (
        <a
          className="ismCellLink"
          href={`#${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${row.name}`}
          data-test-subj={`templateDetail-${row.name}`}
        >
          {row.name}
        </a>
      ),
    },
    {
      field: 'templateTypes',
      name: 'Type',
      render: (row) => <TypeBadges template={row.component_template.template} />,
    },
    {
      field: 'component_template._meta.description',
      name: 'Description',
      sortable: true,
      render: (row) => row.component_template._meta?.description || '-',
    },
    {
      field: 'associatedCount',
      name: 'Associated index templates',
      sortable: true,
      align: 'right',
      render: (row) => row.associatedCount,
    },
    {
      field: 'actions',
      name: 'Actions',
      align: 'right',
      render: (row) => (
        <span className="ismRowActions">
          <Tooltip content="View associated index templates">
            <IconButton
              icon="kqlSelector"
              label="View associated index templates"
              title=""
              className="ismRowActions__info"
              onClick={() => setAssociated(row.name)}
              testId={`ViewAssociatedIndexTemplates-${row.name}`}
            />
          </Tooltip>
          <Tooltip content="Delete component template">
            <IconButton
              icon="trash"
              variant="dangerEmpty"
              label="Delete component template"
              title=""
              className="ismRowActions__danger"
              onClick={() => setDeleting(row.name)}
              testId={`DeleteComponentTemplate-${row.name}`}
            />
          </Tooltip>
        </span>
      ),
    },
  ];

  // Ordered, then filtered, then paged, as the plugin does; its count is of all of them
  const counted = all.map((row) => ({ ...row, associatedCount: (users.get(row.name) ?? []).length }));
  const shown = pluginOrder(counted, query.sortField, query.sortDirection).filter((row) =>
    types.every((type) => row.component_template.template?.[type])
  );
  const rows = shown.slice(query.from * query.size, (query.from + 1) * query.size);
  // Only a search counts as a filter: types that leave nothing say there are no templates
  const filtered = query.search !== '';

  return (
    <ContentPanel
      bodyStyles={{ padding: 'initial' }}
      title={
        <>
          <span className="ismContentPanel__title ismContentPanel__title--m">Component templates</span>
          <TitleHelp>
            Component templates are reusable building blocks for composing index or data stream templates. You can
            define component templates with common index configurations and associate them to an index template.{' '}
            <ExternalLink href={COMPONENT_DOCS} />
          </TitleHelp>
        </>
      }
      actions={
        <ContentPanelActions
          actions={[
            {
              text: '',
              children: (
                <Button
                  variant="danger"
                  disabled={selected.length !== 1}
                  onClick={() => setDeleting(selected[0]?.name)}
                  testId="deleteAction"
                >
                  Delete
                </Button>
              ),
            },
            {
              text: 'Create component template',
              buttonProps: { variant: 'primary', onClick: () => go(ROUTES.CREATE_COMPOSABLE_TEMPLATE) },
            },
          ]}
        />
      }
    >
      <SearchRow
        className="ismIndexControls ismIndexControls--s"
        autoFocus
        clearable
        search={query.search}
        onSearch={(search) => setQuery({ search, from: 0 })}
        placeholder="Search..."
      >
        <FilterBox
          name="Types"
          own
          options={TYPE_FILTERS}
          selected={types}
          onChange={(next) => {
            setTypes(next);
            setQuery({ from: 0 });
          }}
        />
      </SearchRow>
      <hr className="ismContentPanel__rule" />
      <div className="ismSpacer ismSpacer--s" />
      <div className="ismComponentTemplatesTable" data-test-subj="templatesTable">
        <Table
          fixed
          columns={columns}
          rows={rows}
          total={all.length}
          query={pageQuery(query)}
          onQuery={(changes) => setQuery(pageChanges(changes, query.size))}
          rowId={(row) => row.name}
          selected={selected}
          onSelect={setSelected}
          loading={loading || usersLoading}
          empty={
            <ListEmpty
              text={
                filtered
                  ? 'There are no templates matching your applied filters. Reset your filters to view your templates.'
                  : 'You have no templates.'
              }
            >
              {filtered ? (
                <Button variant="primary" onClick={() => setQuery({ search: '' })}>
                  Reset filters
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => go(ROUTES.CREATE_COMPOSABLE_TEMPLATE)}
                  testId="CreateComponentTemplateWhenNoTemplateFound"
                >
                  Create component template
                </Button>
              )}
            </ListEmpty>
          }
        />
      </div>
      {deleting !== undefined && (
        <DeleteComponentModal
          name={deleting}
          users={users.get(deleting) ?? []}
          loading={usersLoading}
          onClose={() => setDeleting(undefined)}
          onDelete={() => {
            setDeleting(undefined);
            void load();
          }}
        />
      )}
      {associated !== undefined && (
        <AssociatedTemplates
          component={associated}
          templates={users.get(associated) ?? []}
          onClose={() => setAssociated(undefined)}
          onUnlink={() => {
            void load();
            void loadUsers();
          }}
        />
      )}
    </ContentPanel>
  );
}
