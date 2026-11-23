/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Saved objects, as OpenSearch Dashboards 3.9.0's page: the objects a page at a time, found as its
 * search bar asks, deleted and exported; what an object is tied to; the import of a file, and the
 * page that shows one object as it is stored.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Link, Spinner } from '../../components/basic';
import { Flyout, Modal, Popover, Portal, downloadFile } from '../../components/overlay';
import { formatDate } from '../../lib/dates';
import { navigate } from '../../router';
import { services } from '../../services';
import { useBreadcrumbs } from '../../shell/state';
import { ImportFlyout } from './saved_objects_import';
import { InspectPage } from './saved_objects_inspect';
import { getDefaultTitle, titleOf, type ManagedObject } from './saved_objects_lib';
import {
  BasicTable,
  Callout,
  MANAGEMENT_CRUMB,
  OBJECTS_CRUMB,
  errorText,
  Check,
  IMPORT_ICON,
  InMemoryTable,
  RowAction,
  SearchBar,
  SmallSwitch,
  TypeIcon,
  type Column,
  type FieldFilter,
  type SearchChange,
  allowedObjectTypes,
} from './saved_objects_parts';
import { filterQuery, readSearchQuery, type Clause } from './saved_objects_query';
import '../../styles/saved_objects.css';

const API = '/api/opensearch-dashboards/management/saved_objects';

/*
 * What the original lets a person open, as its capabilities say without the security plugin: an
 * object whose app is not one of these (correlations, whose plugin does not ship) has no link.
 */
const GRANTED = new Set([
  'advancedSettings.show',
  'dashboard.show',
  'discover.show',
  'visualize.show',
  'visualization-visbuilder.show',
  'management.opensearchDashboards.indexPatterns',
  'home.show',
  'indexPatterns.save',
]);

export const canGoInApp = (object: ManagedObject) =>
  Boolean(object.meta.inAppUrl && object.meta.inAppUrl.uiCapabilitiesPath && GRANTED.has(object.meta.inAppUrl.uiCapabilitiesPath));

/** Where the title of an object leads: the path of its app, read as the original reads it */
export function inAppPath(object: ManagedObject): string {
  const path = object.meta.inAppUrl?.path ?? '';
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function goInspectObject(object: ManagedObject) {
  if (object.meta.editUrl) navigate(`/app${object.meta.editUrl}`);
}

export function SavedObjectsSection({ rest }: { rest: string[] }) {
  if (rest.length >= 2) return <InspectPage key={rest.join('/')} serviceName={rest[0]} id={rest.slice(1).join('/')} />;
  return <ObjectsTablePage />;
}

function ObjectsTablePage() {
  useBreadcrumbs([MANAGEMENT_CRUMB, OBJECTS_CRUMB]);
  const [allowedTypes, setAllowedTypes] = useState<string[]>();
  useEffect(() => {
    let live = true;
    allowedObjectTypes().then(
      (types) => live && setAllowedTypes(types),
      (error) => live && services.toasts.danger('Unable find saved objects', errorText(error))
    );
    return () => {
      live = false;
    };
  }, []);
  return allowedTypes ? <ObjectsTable allowedTypes={allowedTypes} /> : null;
}

// --- Export ---------------------------------------------------------------------------------------

interface ExportDetails {
  exportedCount: number;
  missingRefCount: number;
  missingReferences: Array<{ id: string; type: string }>;
}

/** The file is saved, and the last line read: it lists the objects the export could not find */
async function exportObjects(body: Record<string, unknown>) {
  let file: string;
  try {
    file = await services.http.post<string>('/api/saved_objects/_export', { body, asText: true });
  } catch (error) {
    services.toasts.danger('Unable to generate export');
    throw error;
  }
  downloadFile('export.ndjson', file, 'application/ndjson');
  const lines = file.split('\n').filter((line) => line.length > 0);
  const details = JSON.parse(lines[lines.length - 1]) as Partial<ExportDetails>;
  const isDetails = 'exportedCount' in details && 'missingRefCount' in details && 'missingReferences' in details;
  if (isDetails && (details.missingReferences ?? []).length > 0) {
    services.toasts.warning(
      'Your file is downloading in the background. Some related objects could not be found. Please see the last line in the exported file for a list of missing objects.'
    );
  } else {
    services.toasts.success('Your file is downloading in the background');
  }
}

// --- The table ------------------------------------------------------------------------------------

interface ActiveQuery {
  clauses: Clause[];
  /** What the search bar showed: answers to a query that is not the one shown any more are left */
  text: string;
}

interface Counts {
  type?: Record<string, number>;
}

function findOptions(allowedTypes: string[], clauses: Clause[], page: { index: number; size: number }) {
  const { queryText, visibleTypes } = readSearchQuery(clauses);
  const type = filterQuery(allowedTypes, visibleTypes);
  return {
    search: queryText ? `${queryText}*` : undefined,
    perPage: page.size,
    page: page.index + 1,
    fields: ['id'],
    type,
    sortField: type.length > 1 ? 'type' : undefined,
  };
}

function ObjectsTable({ allowedTypes }: { allowedTypes: string[] }) {
  // As the original reads the setting: its own 50 in place of the setting's default, until someone sets it
  const perPage = (!services.uiSettings.isDefault('savedObjects:perPage') && services.uiSettings.get<number>('savedObjects:perPage')) || 50;
  const [query, setQuery] = useState<ActiveQuery>({ clauses: [], text: '' });
  const [page, setPage] = useState({ index: 0, size: perPage });
  const [objects, setObjects] = useState<ManagedObject[]>([]);
  const [total, setTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [exportAllOptions, setExportAllOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [exportAllSelected, setExportAllSelected] = useState<Record<string, boolean>>({});
  const [includeReferencesDeep, setIncludeReferencesDeep] = useState(true);
  const [selected, setSelected] = useState<ManagedObject[]>([]);
  const [parseError, setParseError] = useState<string>();
  const [showImport, setShowImport] = useState(false);
  const [showExportAll, setShowExportAll] = useState(false);
  const [deleteState, setDeleteState] = useState<'confirm' | 'deleting'>();
  const [relationshipObject, setRelationshipObject] = useState<ManagedObject>();

  // The find waits 300 ms for more changes, then reads the query and page of that moment
  const latest = useRef({ query, page });
  latest.current = { query, page };
  const timer = useRef<number>();
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    },
    []
  );

  const fetchObjects = useCallback(() => {
    setIsSearching(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const asked = latest.current;
      try {
        const answer = await services.http.get<{ saved_objects: ManagedObject[]; total: number }>(`${API}/_find`, {
          query: findOptions(allowedTypes, asked.query.clauses, asked.page),
        });
        if (!mounted.current || latest.current.query.text !== asked.query.text) return;
        setObjects(answer.saved_objects);
        setTotal(answer.total);
        setIsSearching(false);
        // The table keeps the rows chosen that are still in it
        setSelected((chosen) => chosen.filter((object) => answer.saved_objects.some((item) => item.id === object.id)));
      } catch (error) {
        if (mounted.current) setIsSearching(false);
        services.toasts.danger('Unable find saved objects', errorText(error));
      }
    }, 300);
  }, [allowedTypes]);

  const fetchCounts = useCallback(
    async (clauses: Clause[]) => {
      try {
        const { queryText, visibleTypes } = readSearchQuery(clauses);
        const filteredTypes = filterQuery(allowedTypes, visibleTypes);
        // The objects the table can show, for what an export of them all offers
        const filtered = await services.http.post<Counts>(`${API}/scroll/counts`, {
          body: { typesToInclude: filteredTypes, searchString: queryText },
        });
        const filteredCounts = filtered.type ?? {};
        // All the objects, for the counts of the type filter
        const all = await services.http.post<Counts>(`${API}/scroll/counts`, {
          body: { typesToInclude: allowedTypes, searchString: queryText },
        });
        if (!mounted.current) return;
        setCounts(all.type ?? {});
        setExportAllOptions(Object.keys(filteredCounts).map((id) => ({ id, label: `${id} (${filteredCounts[id] || 0})` })));
        setExportAllSelected(Object.fromEntries(Object.keys(filteredCounts).map((id) => [id, true])));
      } catch {
        // As the original's: the counts stay as they were
      }
    },
    [allowedTypes]
  );

  useEffect(() => {
    fetchObjects();
    void fetchCounts([]);
  }, [fetchObjects, fetchCounts]);

  const onSearch = (change: SearchChange) => {
    if (change.error !== undefined) {
      setParseError(change.error);
      return;
    }
    setParseError(undefined);
    const next = { clauses: change.clauses, text: change.text };
    setQuery(next);
    latest.current = { query: next, page: { ...latest.current.page, index: 0 } };
    setPage(latest.current.page);
    setSelected([]);
    fetchObjects();
    void fetchCounts(change.clauses);
  };

  const onTableChange = useCallback(
    (next: { index: number; size: number }) => {
      setPage(next);
      latest.current = { ...latest.current, page: next };
      setSelected([]);
      fetchObjects();
    },
    [fetchObjects]
  );

  const refresh = () => {
    fetchObjects();
    void fetchCounts(latest.current.query.clauses);
  };

  const remove = async () => {
    if (deleteState === 'deleting') return;
    setDeleteState('deleting');
    try {
      if (selected.some((object) => object.type === 'index-pattern')) services.indexPatterns.clear();
      const found = await services.http.post<{ saved_objects: Array<{ id: string; type: string }> }>('/api/saved_objects/_bulk_get', {
        body: selected.map(({ id, type }) => ({ id, type })),
      });
      await Promise.all(
        found.saved_objects.map((object) =>
          services.http.delete(`/api/saved_objects/${encodeURIComponent(object.type)}/${encodeURIComponent(object.id)}`, { query: { force: true } })
        )
      );
      setSelected([]);
      fetchObjects();
      await fetchCounts(latest.current.query.clauses);
      setDeleteState(undefined);
    } catch (error) {
      services.toasts.danger('Unable to delete saved objects', errorText(error));
      setDeleteState('confirm');
    }
  };

  const exportAll = async () => {
    const { queryText } = readSearchQuery(latest.current.query.clauses);
    await exportObjects({
      type: Object.entries(exportAllSelected)
        .filter(([, chosen]) => chosen)
        .map(([id]) => id),
      search: queryText ? `${queryText}*` : undefined,
      includeReferencesDeep,
    });
    setShowExportAll(false);
  };

  const dateFormat = services.formatSettings().dateFormat;
  const columns: Array<Column<ManagedObject>> = [
    {
      key: 'type',
      name: 'Type',
      description: 'Type of the saved object',
      width: 50,
      align: 'center',
      testId: 'savedObjectsTableRowType',
      render: (object) => <TypeIcon type={object.type} icon={object.meta.icon} />,
    },
    {
      key: 'title',
      name: 'Title',
      description: 'Title of the saved object',
      testId: 'savedObjectsTableRowTitle',
      render: (object) =>
        canGoInApp(object) ? (
          <Link to={inAppPath(object)}>{object.meta.title || getDefaultTitle(object)}</Link>
        ) : (
          <span className="sobText">{object.meta.title || getDefaultTitle(object)}</span>
        ),
    },
    {
      key: 'updated_at',
      name: 'Last updated',
      description: 'Last update of the saved object',
      testId: 'updated-at',
      render: (object) => (object.updated_at ? formatDate(new Date(object.updated_at), dateFormat, services.timeZone()) : ''),
    },
    {
      key: 'actions',
      name: 'Actions',
      width: 80,
      actions: true,
      render: (object) => (
        <>
          {object.meta.editUrl && (
            <RowAction
              label="Inspect"
              description="Inspect this saved object"
              icon="inspect"
              onClick={() => goInspectObject(object)}
              testId="savedObjectsTableAction-inspect"
            />
          )}
          <RowAction
            label="Relationships"
            description="View the relationships this saved object has to other saved objects"
            icon="kqlSelector"
            onClick={() => setRelationshipObject(object)}
            testId="savedObjectsTableAction-relationships"
          />
        </>
      ),
    },
  ];

  const filters: FieldFilter[] = [
    {
      field: 'type',
      name: 'Type',
      options: allowedTypes.map((type) => ({ value: type, name: type, view: `${type} (${counts[type] || 0})` })),
      searchThreshold: 1,
    },
  ];

  return (
    <div className="mgtPage sobPage">
      <div className="atlPanel sobPanel">
        {showImport && (
          <ImportFlyout
            onClose={() => setShowImport(false)}
            onDone={() => {
              setShowImport(false);
              refresh();
            }}
          />
        )}
        {relationshipObject && (
          <Relationships object={relationshipObject} allowedTypes={allowedTypes} onClose={() => setRelationshipObject(undefined)} />
        )}
        {deleteState === 'deleting' && (
          <Portal>
            <div className="atlScrim sobBusy">
              <Spinner size="xl" />
            </div>
          </Portal>
        )}
        {deleteState === 'confirm' && <DeleteModal objects={selected} onCancel={() => setDeleteState(undefined)} onConfirm={() => void remove()} />}
        {showExportAll && (
          <Modal
            title={`Export ${total} ${total === 1 ? 'object' : 'objects'}`}
            onClose={() => setShowExportAll(false)}
            className="sobModal sobExportModal"
            footer={
              <>
                <Button variant="empty" onClick={() => setShowExportAll(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void exportAll().catch(() => undefined)}>
                  Export all
                </Button>
              </>
            }
          >
            <fieldset className="sobFieldset">
              <legend className="sobLegend">Select which types to export</legend>
              {exportAllOptions.map((option) => (
                <label key={option.id} className="sobCheckRow">
                  <Check
                    checked={Boolean(exportAllSelected[option.id])}
                    onChange={() => setExportAllSelected({ ...exportAllSelected, [option.id]: !exportAllSelected[option.id] })}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            <div className="sobSpacer--m" />
            <SmallSwitch
              name="includeReferencesDeep"
              label="Include related objects"
              checked={includeReferencesDeep}
              onChange={() => setIncludeReferencesDeep(!includeReferencesDeep)}
            />
          </Modal>
        )}

        <div className="sobHeader">
          <h1 className="atlTitleL sobHeader__title">Saved Objects</h1>
          <div className="sobHeader__actions">
            <Button variant="empty" icon="upload" onClick={() => setShowExportAll(true)} testId="exportAllObjects">
              Export all objects
            </Button>
            <Button variant="empty" icon={IMPORT_ICON} onClick={() => setShowImport(true)} testId="importObjects">
              Import
            </Button>
            <Button variant="empty" icon="refresh" onClick={refresh}>
              Refresh
            </Button>
          </div>
        </div>
        <p className="sobDescription">
          Manage and share your saved objects. To edit the underlying data of an object, go to its associated application.
        </p>

        <SearchBar
          filters={filters}
          onChange={onSearch}
          testId="savedObjectSearchBar"
          toolsRight={
            <>
              <Button
                variant="dangerOutline"
                icon="trash"
                className="sobDeleteButton"
                disabled={selected.length === 0}
                onClick={() => setDeleteState('confirm')}
                testId="savedObjectsManagementDelete"
              >
                Delete
              </Button>
              <ExportPopover disabled={selected.length === 0} onExport={(deep) => exportObjects({ objects: selected.map(({ id, type }) => ({ id, type })), includeReferencesDeep: deep })} />
            </>
          }
        />
        {parseError !== undefined && <div className="sobSearchError">{`Unable to parse query. ${parseError}`}</div>}
        <div className="sobTableSpacer" />
        <BasicTable
          testId="savedObjectsTable"
          items={objects}
          columns={columns}
          itemId={(object) => object.id}
          loading={isSearching}
          selection={{ selected, onChange: setSelected }}
          pagination={{ pageIndex: page.index, pageSize: page.size, totalItemCount: total, pageSizeOptions: [5, 10, 20, 50] }}
          onChange={onTableChange}
          rowTestId={(object) => `savedObjectsTableRow row-${object.id}`}
        />
      </div>
    </div>
  );
}

function ExportPopover({ disabled, onExport }: { disabled: boolean; onExport: (includeReferencesDeep: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [deep, setDeep] = useState(true);
  // As the original's popover, the kit's holds the focus: its switch has it when it opens, Tab goes
  // round its controls, and the focus goes back to the button when it closes from inside
  const close = () => setOpen(false);
  return (
    <Popover
      open={open}
      onClose={close}
      align="center"
      offset={8}
      buffer={16}
      className="sobExportPopover"
      button={
        <Button
          icon="chevronDown"
          iconSide="right"
          disabled={disabled}
          onClick={() => setOpen(!open)}
          className="sobExportButton"
        >
          Export
        </Button>
      }
    >
      <div>
        <div className="sobFormRow">
          <span className="sobLabel">Options</span>
          <SmallSwitch name="includeReferencesDeep" label="Include related objects" checked={deep} onChange={() => setDeep(!deep)} />
        </div>
        <div className="sobFormRow">
          <Button
            variant="primary"
            icon="upload"
            className="sobExportPopover__button"
            onClick={() => {
              void onExport(deep).catch(() => undefined);
              close();
            }}
          >
            Export
          </Button>
        </div>
      </div>
    </Popover>
  );
}

function DeleteModal({ objects, onCancel, onConfirm }: { objects: ManagedObject[]; onCancel: () => void; onConfirm: () => void }) {
  const columns: Array<Column<ManagedObject>> = [
    { key: 'type', name: 'Type', width: 50, render: (object) => <TypeIcon type={object.type} icon={object.meta.icon} /> },
    { key: 'title', name: 'Title', render: (object) => object.meta.title },
    { key: 'id', name: 'ID', render: (object) => object.id },
  ];
  return (
    <Modal
      title="Delete assets"
      onClose={onCancel}
      className="sobModal sobDeleteModal"
      footer={
        <>
          <Button variant="empty" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="dangerFill" type="submit" onClick={onConfirm} testId="confirmModalConfirmButton">
            Delete
          </Button>
        </>
      }
    >
      <p className="sobText">This action will delete the following assets:</p>
      <InMemoryTable items={objects} columns={columns} itemId={(object) => `${object.type}:${object.id}`} />
    </Modal>
  );
}

// --- What an object is tied to --------------------------------------------------------------------

function Relationships({ object, allowedTypes, onClose }: { object: ManagedObject; allowedTypes: string[]; onClose: () => void }) {
  const [state, setState] = useState<{ relationships?: ManagedObject[]; error?: string }>({});
  useEffect(() => {
    let live = true;
    setState({});
    services.http
      .get<ManagedObject[]>(`${API}/relationships/${encodeURIComponent(object.type)}/${encodeURIComponent(object.id)}`, {
        query: { savedObjectTypes: allowedTypes },
      })
      .then(
        (relationships) => live && setState({ relationships }),
        (error) => live && setState({ error: errorText(error) })
      );
    return () => {
      live = false;
    };
  }, [object.type, object.id, allowedTypes]);

  const columns: Array<Column<ManagedObject>> = [
    {
      key: 'type',
      name: 'Type',
      description: 'Type of the saved object',
      width: 50,
      align: 'center',
      render: (item) => <TypeIcon type={item.type} icon={item.meta.icon} testId="relationshipsObjectType" />,
    },
    {
      key: 'relationship',
      name: 'Direct relationship',
      width: 125,
      testId: 'directRelationship',
      render: (item) => (item.relationship === 'parent' ? 'Parent' : item.relationship === 'child' ? 'Child' : null),
    },
    {
      key: 'title',
      name: 'Title',
      description: 'Title of the saved object',
      render: (item) =>
        canGoInApp(item) ? (
          <Link to={item.meta.inAppUrl?.path ?? ''} testId="relationshipsTitle">
            {item.meta.title || getDefaultTitle(item)}
          </Link>
        ) : (
          <span className="sobText" data-test-subj="relationshipsTitle">
            {item.meta.title || getDefaultTitle(item)}
          </span>
        ),
    },
    {
      key: 'actions',
      name: 'Actions',
      actions: true,
      render: (item) =>
        item.meta.editUrl ? (
          <RowAction
            label="Inspect"
            description="Inspect this saved object"
            icon="inspect"
            onClick={() => goInspectObject(item)}
            testId="relationshipsTableAction-inspect"
          />
        ) : null,
    },
  ];

  const filters = useMemo<FieldFilter[]>(
    () => [
      {
        field: 'relationship',
        name: 'Direct relationship',
        options: [
          { value: 'parent', name: 'parent', view: 'Parent' },
          { value: 'child', name: 'child', view: 'Child' },
        ],
      },
      {
        field: 'type',
        name: 'Type',
        options: [...new Set((state.relationships ?? []).map((item) => item.type))].map((type) => ({ value: type, name: type, view: type })),
      },
    ],
    [state.relationships]
  );

  return (
    <Flyout title={titleOf(object)} onClose={onClose} mask className="sobFlyout sobFlyout--m sobRelationshipsFlyout">
      {state.error !== undefined ? (
        <Callout tone="danger" title="Error">
          <p>{state.error}</p>
        </Callout>
      ) : !state.relationships ? (
        <Spinner size="xl" />
      ) : (
        <div>
          <Callout tone="primary">
            <p>
              Here are the saved objects related to {titleOf(object)}. Deleting this {object.type} affects its parent objects, but not its
              children.
            </p>
          </Callout>
          <div className="sobSpacer--l" />
          <InMemoryTable
            items={state.relationships}
            columns={columns}
            itemId={(item) => `${item.relationship}:${item.type}:${item.id}`}
            filters={filters}
            rowTestId={() => 'relationshipsTableRow'}
          />
        </div>
      )}
    </Flyout>
  );
}
