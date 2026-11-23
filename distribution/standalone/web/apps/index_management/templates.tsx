/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Templates and component templates: the two lists, what links an index template to the
 * components it is composed of, and the dialogs that unlink and delete them.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, IconButton } from '../../components/basic';
import { Checkbox } from '../../components/form';
import { Flyout, Modal, Tooltip, type MenuItem } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { FewNames } from './aliases';
import {
  ActionsMenu,
  ContentPanel as OldContentPanel,
  ExternalLink,
  FilterButton,
  LocalTable,
  Names,
  PanelButton,
  SearchRow,
  Table,
  go,
  ism,
  pageOf,
  to,
  toasts,
  useListQuery,
  type TableColumn,
} from './common';
import { ContentPanel, ContentPanelActions, ListEmpty, TitleHelp } from './content_panel';
import { pageChanges, pageQuery } from './model';
import { DeleteModal, SimpleModal } from './plugin_modal';
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

/** Takes a component out of an index template, as the template is now */
async function unlink(templateName: string, component: string): Promise<boolean> {
  const current = await ism.request<IndexTemplates>('GET', `/_index_template/${templateName}?flat_settings=true`);
  const found = current.response?.index_templates?.find((item) => item.name === templateName);
  if (!current.ok || !found) {
    toasts.danger(current.ok ? `The template [${templateName}] does not exist.` : current.error || '');
    return false;
  }
  const answer = await ism.request('POST', `/_index_template/${templateName}`, {
    ...found.index_template,
    composed_of: (found.index_template.composed_of ?? []).filter((item) => item !== component),
  });
  if (answer.ok) toasts.success(`${component} has been successfully unlinked from ${templateName}.`);
  else toasts.danger(answer.error);
  return answer.ok;
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
        The component {component} will be removed from the template {template}. {wording}
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
                <a href={to(`${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${row.name}`)} target="_blank" rel="noreferrer">
                  {row.name}
                </a>
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
      render: (row) => <a href={`#${ROUTES.CREATE_TEMPLATE}/${row.name}`}>{row.name}</a>,
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
            title={`Index patterns in in ${row.name} (${patterns.length})`}
            hint={`Index patterns in ${row.name} (${patterns.length})`}
            column="Index pattern"
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

interface ComponentRow {
  name: string;
  component_template: {
    template: Record<string, unknown>;
    _meta?: { description?: string };
  };
  /** The index templates composed of it */
  associated: string[];
  associatedCount: number;
}

const TYPES = ['aliases', 'settings', 'mappings'];

function AssociatedTemplatesModal({
  component,
  templates,
  onClose,
  onUnlink,
}: {
  component: string;
  templates: Array<IndexTemplate & { name: string }>;
  onClose: () => void;
  onUnlink: () => void;
}) {
  const [unlinking, setUnlinking] = useState<IndexTemplate & { name: string }>();
  return (
    <>
      <Modal title="Associated index templates" onClose={onClose}>
        <LocalTable
          columns={[
            {
              field: 'name',
              name: 'Templates',
              sortable: true,
              render: (row: IndexTemplate & { name: string }) => (
                <a href={to(`${ROUTES.CREATE_TEMPLATE}/${row.name}`)} target="_blank" rel="noreferrer">
                  {row.name}
                </a>
              ),
            },
            {
              field: 'actions',
              name: 'Actions',
              align: 'right',
              render: (row) => (
                <IconButton icon="unlink" label={`Unlink from ${row.name}?`} onClick={() => setUnlinking(row)} />
              ),
            },
          ]}
          rows={templates}
          rowId={(row) => row.name}
          sortField="name"
          empty={`No index templates associated to ${component}`}
        />
      </Modal>
      {unlinking && (
        <UnlinkConfirm
          template={unlinking}
          component={component}
          wording="This will affect any new indexes created with the template."
          onClose={() => setUnlinking(undefined)}
          onDone={() => {
            onUnlink();
            onClose();
          }}
        />
      )}
    </>
  );
}

export function DeleteComponentModal({
  row,
  templates,
  onClose,
  onDelete,
}: {
  row: Pick<ComponentRow, 'name' | 'associated'>;
  templates: Array<IndexTemplate & { name: string }>;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const linked = templates.filter((template) => row.associated.includes(template.name));
  const confirm = async () => {
    setBusy(true);
    // A component in use is taken out of its templates first
    for (const template of linked) {
      if (!(await unlink(template, row.name))) {
        setBusy(false);
        return;
      }
    }
    const result = await ism.request('DELETE', `/_component_template/${row.name}`);
    setBusy(false);
    if (result.ok) {
      toasts.success(`Delete [${row.name}] successfully`);
      onClose();
      onDelete();
    } else {
      toasts.danger(result.error || '');
    }
  };
  return (
    <Modal
      title={`Delete ${row.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="empty" size="s" disabled={busy} onClick={onClose} testId="deletaCancelButton">
            Cancel
          </Button>
          {linked.length === 0 ? (
            <Button variant="dangerFill" size="s" loading={busy} onClick={confirm} testId="deleteConfirmButton">
              Delete
            </Button>
          ) : (
            <Button
              variant="dangerFill"
              size="s"
              loading={busy}
              disabled={!checked}
              onClick={confirm}
              testId="deleteConfirmUnlinkButton"
            >
              Apply changes
            </Button>
          )}
        </>
      }
    >
      <div className="ismDialog">
        {linked.length === 0 ? (
          <>
            <p>The following component template will be permanently deleted. This action cannot be undone.</p>
            <Names names={[row.name]} />
          </>
        ) : (
          <>
            <p>
              {`The component template ${row.name} will be permanently deleted. The component template will be unlinked from ${linked.length} index templates:`}
            </p>
            <ul className="ismNames">
              {linked.map((template) => (
                <li key={template.name}>
                  <a href={to(`${ROUTES.CREATE_TEMPLATE}/${template.name}`)} target="_blank" rel="noreferrer">
                    {template.name}
                  </a>
                </li>
              ))}
            </ul>
            <Checkbox
              checked={checked}
              onChange={setChecked}
              label={`Unlink index templates and delete ${row.name}`}
              testId="UnlinkConfirmCheckBox"
            />
          </>
        )}
      </div>
    </Modal>
  );
}

export function ComposableTemplates() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.TEMPLATES]);
  const [query, setQuery] = useListQuery({ sortField: 'name' });
  const [all, setAll] = useState<ComponentRow[]>([]);
  const [templates, setTemplates] = useState<Array<IndexTemplate & { name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ComponentRow[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<ComponentRow>();
  const [associated, setAssociated] = useState<ComponentRow>();
  const turn = useRef(0);

  const load = async () => {
    const mine = (turn.current += 1);
    setLoading(true);
    const [answer, indexTemplates] = await Promise.all([
      ism.request<{ component_templates?: Array<Omit<ComponentRow, 'associated' | 'associatedCount'>> }>(
        'GET',
        `/_component_template/*${query.search}*`,
        undefined,
        true
      ),
      loadIndexTemplates(),
    ]);
    if (mine !== turn.current) return;
    let rows: ComponentRow[] = [];
    if (answer.ok) {
      rows = (answer.response?.component_templates ?? []).map((item) => {
        const users = indexTemplates
          .filter((template) => template.composed_of?.includes(item.name))
          .map((template) => template.name);
        return { ...item, associated: users, associatedCount: users.length };
      });
    } else if (answer.error !== 'Not Found') {
      toasts.danger(answer.error);
    }
    setTemplates(indexTemplates);
    setAll(rows);
    setSelected((before) => before.flatMap((item) => rows.filter((remote) => remote.name === item.name)));
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.search]);

  const columns: Array<TableColumn<ComponentRow>> = useMemo(
    () => [
      {
        field: 'name',
        name: 'Name',
        sortable: true,
        render: (row) => (
          <a href={`#${ROUTES.CREATE_COMPOSABLE_TEMPLATE}/${row.name}`} data-test-subj={`templateDetail-${row.name}`}>
            {row.name}
          </a>
        ),
      },
      {
        field: 'templateTypes',
        name: 'Type',
        render: (row) => (
          <span className="atlRow" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
            {TYPES.filter((type) => row.component_template.template?.[type]).map((type) => (
              <Badge key={type}>
                <span className="ismCapital">{type}</span>
              </Badge>
            ))}
          </span>
        ),
      },
      {
        field: 'component_template._meta.description',
        name: 'Description',
        sortable: true,
        value: (row) => row.component_template._meta?.description ?? '',
        render: (row) => row.component_template._meta?.description || '-',
      },
      { field: 'associatedCount', name: 'Associated index templates', sortable: true, align: 'right', render: (row) => row.associatedCount },
      {
        field: 'actions',
        name: 'Actions',
        align: 'right',
        render: (row) => (
          <>
            <IconButton
              icon="kqlSelector"
              label="View associated index templates"
              onClick={() => setAssociated(row)}
              testId={`ViewAssociatedIndexTemplates-${row.name}`}
            />
            <IconButton
              icon="trash"
              label="Delete component template"
              onClick={() => setDeleting(row)}
              testId={`DeleteComponentTemplate-${row.name}`}
            />
          </>
        ),
      },
    ],
    []
  );

  const shown = all.filter((row) => types.every((type) => row.component_template.template?.[type]));
  const rows = pageOf(shown, columns, pageQuery(query));
  const filtered = query.search !== '' || types.length > 0;

  return (
    <OldContentPanel
      title="Component templates"
      description={
        <>
          Component templates are reusable building blocks for composing index or data stream templates. You can
          define component templates with common index configurations and associate them to an index template.{' '}
          <ExternalLink href={COMPONENT_DOCS} />
        </>
      }
      actions={
        <>
          <Button
            size="s"
            variant="danger"
            disabled={selected.length !== 1}
            onClick={() => setDeleting(selected[0])}
            testId="deleteAction"
          >
            Delete
          </Button>
          <PanelButton text="Create component template" variant="primary" to={to(ROUTES.CREATE_COMPOSABLE_TEMPLATE)} />
        </>
      }
    >
      <SearchRow search={query.search} onSearch={(search) => setQuery({ search, from: 0 })} placeholder="Search...">
        <FilterButton name="Types" options={TYPES.map((value) => ({ value }))} selected={types} onChange={setTypes} />
      </SearchRow>
      <Table
        columns={columns}
        rows={rows}
        total={shown.length}
        query={pageQuery(query)}
        onQuery={(changes) => setQuery(pageChanges(changes, query.size))}
        rowId={(row) => row.name}
        selected={selected}
        onSelect={setSelected}
        loading={loading}
        empty={
          <div className="ismEmpty">
            <p>
              {filtered
                ? 'There are no templates matching your applied filters. Reset your filters to view your templates.'
                : 'You have no templates.'}
            </p>
            {filtered ? (
              <Button
                variant="primary"
                size="s"
                onClick={() => {
                  setTypes([]);
                  setQuery({ search: '' });
                }}
              >
                Reset filters
              </Button>
            ) : (
              <Button
                variant="primary"
                size="s"
                icon="plus"
                to={to(ROUTES.CREATE_COMPOSABLE_TEMPLATE)}
                testId="CreateComponentTemplateWhenNoTemplateFound"
              >
                Create component template
              </Button>
            )}
          </div>
        }
      />
      {deleting && (
        <DeleteComponentModal row={deleting} templates={templates} onClose={() => setDeleting(undefined)} onDelete={load} />
      )}
      {associated && (
        <AssociatedTemplatesModal
          component={associated.name}
          templates={templates.filter((template) => associated.associated.includes(template.name))}
          onClose={() => setAssociated(undefined)}
          onUnlink={load}
        />
      )}
    </OldContentPanel>
  );
}
