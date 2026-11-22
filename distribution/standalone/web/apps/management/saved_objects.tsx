/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Saved objects: the table of all of them, export and import as a file, what an object points
 * at and what points at it, and the page that shows one object as it is stored.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, CallOut, EmptyPrompt, IconButton, Link, Loading, PageHeader, Panel } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { Checkbox, FormRow, NumberField, RadioGroup, SearchField, Select, Switch, TextArea, TextField } from '../../components/form';
import { Icon, type IconName } from '../../components/icon';
import { ConfirmModal, Flyout, Modal, Popover, downloadFile } from '../../components/overlay';
import { DataTable, type Column } from '../../components/table';
import { formatDate } from '../../lib/dates';
import { navigate } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import type { IndexPatternSummary } from '../../services/index_patterns';
import type { SavedObject, SavedObjectReference } from '../../services/saved_objects';
import { useBreadcrumbs } from '../../shell/state';

const ROOT = '/app/management/opensearch-dashboards/objects';
const MANAGEMENT = { text: 'Dashboards Management', to: '/app/management' };

interface TypeInfo {
  icon: IconName;
  /** The name of the type in the address of its page here */
  service: string;
  inApp?: (id: string) => string;
  /** False for the types the original has no page to inspect: settings, saved queries, short URLs */
  inspect?: false;
}

const TYPES: Record<string, TypeInfo> = {
  config: { icon: 'gear', service: 'config', inApp: () => '/app/management/opensearch-dashboards/settings', inspect: false },
  dashboard: { icon: 'dashboard', service: 'savedDashboards', inApp: (id) => `/app/dashboards#/view/${encodeURIComponent(id)}` },
  'index-pattern': {
    icon: 'index',
    service: 'indexPatterns',
    inApp: (id) => `/app/management/opensearch-dashboards/indexPatterns/patterns/${encodeURIComponent(id)}`,
  },
  // A saved query opens in Discover, which loads it
  query: {
    icon: 'search',
    service: 'savedQueries',
    inApp: (id) => `/app/discover#/?_a=(savedQuery:'${encodeURIComponent(id)}')`,
    inspect: false,
  },
  search: { icon: 'discover', service: 'savedSearches', inApp: (id) => `/app/discover#/view/${encodeURIComponent(id)}` },
  url: { icon: 'link', service: 'url', inspect: false },
  visualization: { icon: 'visualize', service: 'savedVisualizations', inApp: (id) => `/app/visualize#/edit/${encodeURIComponent(id)}` },
  'visualization-visbuilder': { icon: 'visualize', service: 'savedVisBuilder', inApp: (id) => `/app/vis-builder/edit/${encodeURIComponent(id)}` },
};
const ALL_TYPES = Object.keys(TYPES);

type Row = SavedObject<Record<string, unknown>>;
const keyOf = (object: { type: string; id: string }) => `${object.type}:${object.id}`;

export function titleOf(object: { type: string; id: string; attributes?: Record<string, unknown> }): string {
  if (object.type === 'config') return `Advanced Settings [${object.id}]`;
  // A short URL is named by the address that opens it
  if (object.type === 'url') return `/goto/${encodeURIComponent(object.id)}`;
  const title = object.attributes?.title ?? object.attributes?.name;
  return typeof title === 'string' && title ? title : `${object.type} [id=${object.id}]`;
}

const inspectPath = (object: { type: string; id: string }) =>
  `${ROOT}/${TYPES[object.type]?.service ?? object.type}/${encodeURIComponent(object.id)}`;
const canInspect = (type: string) => TYPES[type]?.inspect !== false;
/** Where the title of an object leads: its page, or its inspection; nowhere for a short URL */
const inAppPath = (object: { type: string; id: string }) =>
  TYPES[object.type]?.inApp?.(object.id) ?? (canInspect(object.type) ? inspectPath(object) : undefined);
const typeOfService = (service: string) => ALL_TYPES.find((type) => TYPES[type].service === service) ?? service;

function ObjectTitle({ object, testId }: { object: { type: string; id: string; attributes?: Record<string, unknown> }; testId?: string }) {
  const to = inAppPath(object);
  if (to === undefined) return <span data-test-subj={testId}>{titleOf(object)}</span>;
  return (
    <Link to={to} testId={testId}>
      {titleOf(object)}
    </Link>
  );
}

function TypeIcon({ type }: { type: string }) {
  return (
    <span title={type} className="mgtTypeIcon">
      <Icon name={TYPES[type]?.icon ?? 'document'} />
    </span>
  );
}

export function SavedObjectsSection({ rest }: { rest: string[] }) {
  if (rest.length >= 2) return <InspectObject key={rest.join('/')} type={typeOfService(rest[0])} id={rest.slice(1).join('/')} />;
  return <SavedObjectsTable />;
}

async function exportObjects(body: Record<string, unknown>) {
  try {
    const file = await services.http.post<string>('/api/saved_objects/_export', { body, asText: true });
    downloadFile('export.ndjson', file, 'application/ndjson');
    services.toasts.success('Your file is downloading in the background');
  } catch (failure) {
    services.toasts.error(failure, 'The objects could not be exported');
  }
}

// --- The table ------------------------------------------------------------------------------------

function SavedObjectsTable() {
  useBreadcrumbs([MANAGEMENT, { text: 'Saved objects' }]);
  const [objects, setObjects] = useState<Row[]>();
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [typesOpen, setTypesOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [deep, setDeep] = useState(true);
  const [exportAll, setExportAll] = useState(false);
  const [exportAllTypes, setExportAllTypes] = useState<string[]>(ALL_TYPES);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [relationsOf, setRelationsOf] = useState<Row>();

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(
      () => {
        services.savedObjects
          .find<Record<string, unknown>>({
            type: ALL_TYPES,
            search: search.trim() || undefined,
            // A short URL has no title: it is found by its address, as in the original
            searchFields: ['title', 'name', 'url'],
            fields: ['title', 'name'],
            perPage: 10000,
            sortField: 'type',
          })
          .then((answer) => {
            if (!live) return;
            setObjects(answer.saved_objects);
            setTotal(answer.total);
          })
          .catch((failure) => {
            if (!live) return;
            setObjects([]);
            services.toasts.error(failure, 'The saved objects could not be listed');
          });
      },
      search ? 250 : 0
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [search, tick]);

  const counts = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const object of objects ?? []) byType[object.type] = (byType[object.type] ?? 0) + 1;
    return byType;
  }, [objects]);
  const shown = useMemo(() => (objects ?? []).filter((object) => types.length === 0 || types.includes(object.type)), [objects, types]);
  const chosen = useMemo(() => (objects ?? []).filter((object) => selected.includes(keyOf(object))), [objects, selected]);

  const remove = useCallback(async () => {
    setBusy(true);
    const results = await Promise.allSettled(chosen.map((object) => services.savedObjects.delete(object.type, object.id)));
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed) services.toasts.danger(`${failed} of ${chosen.length} objects could not be deleted`);
    else services.toasts.success(chosen.length === 1 ? 'The object was deleted' : `${chosen.length} objects were deleted`);
    if (chosen.some((object) => object.type === 'index-pattern')) services.indexPatterns.clear();
    setBusy(false);
    setDeleting(false);
    setSelected([]);
    setTick((count) => count + 1);
  }, [chosen]);

  const columns: Array<Column<Row>> = [
    { id: 'type', name: 'Type', width: 64, render: (object) => <TypeIcon type={object.type} />, sortValue: (object) => object.type },
    {
      id: 'title',
      name: 'Title',
      render: (object) => <ObjectTitle object={object} testId="savedObjectsTableRowTitle" />,
      sortValue: titleOf,
    },
    {
      id: 'updated',
      name: 'Last updated',
      width: 240,
      render: (object) => (object.updated_at ? formatDate(new Date(object.updated_at), services.formatSettings().dateFormat, services.timeZone()) : ''),
      sortValue: (object) => object.updated_at ?? '',
    },
    {
      id: 'actions',
      name: 'Actions',
      width: 96,
      align: 'right',
      render: (object) => (
        <span className="atlRow" style={{ justifyContent: 'flex-end' }}>
          {canInspect(object.type) && (
            <IconButton icon="inspect" label="Inspect" size="s" to={inspectPath(object)} testId="savedObjectsTableAction-inspect" />
          )}
          <IconButton icon="link" label="Relationships" size="s" onClick={() => setRelationsOf(object)} testId="savedObjectsTableAction-relationships" />
        </span>
      ),
    },
  ];

  const exportCount = shown.length;
  return (
    <div className="mgtPage" data-test-subj="savedObjectsTable">
      <Panel>
        <PageHeader
          title="Saved Objects"
          description="Manage and share your saved objects. To edit the underlying data of an object, go to its associated application."
          actions={
            <>
              <Button variant="empty" icon="upload" onClick={() => setExportAll(true)} disabled={!objects?.length} testId="exportAllObjects">
                {types.length || search.trim() ? `Export ${exportCount} ${exportCount === 1 ? 'object' : 'objects'}` : 'Export all objects'}
              </Button>
              <Button variant="empty" icon="download" onClick={() => setImporting(true)} testId="importObjects">
                Import
              </Button>
              <Button variant="empty" icon="refresh" onClick={() => setTick((count) => count + 1)} testId="refreshObjects">
                Refresh
              </Button>
            </>
          }
        />
        <div className="atlRow mgtTabTools">
          <div className="atlGrow">
            <SearchField value={search} onChange={setSearch} placeholder="Search..." aria-label="Search saved objects" testId="savedObjectSearchBar" />
          </div>
          <Popover
            open={typesOpen}
            onClose={() => setTypesOpen(false)}
            align="right"
            padded
            button={
              <Button icon="chevronDown" iconSide="right" onClick={() => setTypesOpen(!typesOpen)}>
                Type{types.length ? ` (${types.length})` : ''}
              </Button>
            }
          >
            <div className="atlStack mgtTypeFilter">
              {ALL_TYPES.map((type) => (
                <div key={type} className="atlRow">
                  <div className="atlGrow">
                    <Checkbox
                      checked={types.includes(type)}
                      onChange={(checked) => setTypes(checked ? [...types, type] : types.filter((other) => other !== type))}
                      label={type}
                    />
                  </div>
                  <Badge>{counts[type] ?? 0}</Badge>
                </div>
              ))}
            </div>
          </Popover>
          <Button variant="danger" icon="trash" disabled={chosen.length === 0} onClick={() => setDeleting(true)} testId="savedObjectsManagementDelete">
            Delete
          </Button>
          <Popover
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            align="right"
            padded
            button={
              <Button icon="chevronDown" iconSide="right" disabled={chosen.length === 0} onClick={() => setExportOpen(!exportOpen)} testId="savedObjectsManagementExport">
                Export
              </Button>
            }
          >
            <div className="atlStack" style={{ width: 240 }}>
              <strong>Options</strong>
              <Switch checked={deep} onChange={setDeep} label="Include related objects" />
              <Button
                variant="primary"
                icon="upload"
                onClick={() => {
                  setExportOpen(false);
                  void exportObjects({ objects: chosen.map(({ type, id }) => ({ type, id })), includeReferencesDeep: deep });
                }}
              >
                Export
              </Button>
            </div>
          </Popover>
        </div>
        {!objects ? (
          <Loading />
        ) : (
          <>
            {total > objects.length && (
              <p className="atlSubdued atlSmall" style={{ marginBottom: 'var(--space-2)' }}>
                Showing the first {objects.length} of {total} objects. Search to narrow the list.
              </p>
            )}
            <DataTable
              rows={shown}
              columns={columns}
              rowId={keyOf}
              pageSize={50}
              pageSizes={[5, 10, 20, 50]}
              selected={selected}
              onSelect={setSelected}
              empty={<EmptyPrompt title="No saved objects matched your search." />}
              testId="savedObjectsTable"
            />
          </>
        )}
      </Panel>

      {exportAll && (
        <Modal
          title={`Export ${exportCount} ${exportCount === 1 ? 'object' : 'objects'}`}
          onClose={() => setExportAll(false)}
          footer={
            <>
              <Button variant="empty" onClick={() => setExportAll(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={exportAllTypes.length === 0}
                onClick={() => {
                  setExportAll(false);
                  const wanted = (types.length ? types : ALL_TYPES).filter((type) => exportAllTypes.includes(type));
                  void exportObjects({ type: wanted, includeReferencesDeep: deep, ...(search.trim() ? { search: `${search.trim()}*` } : {}) });
                }}
                testId="exportAllObjectsConfirm"
              >
                Export all
              </Button>
            </>
          }
        >
          <div className="atlStack">
            <strong>Select which types to export</strong>
            {(types.length ? types : ALL_TYPES)
              .filter((type) => counts[type])
              .map((type) => (
                <Checkbox
                  key={type}
                  checked={exportAllTypes.includes(type)}
                  onChange={(checked) => setExportAllTypes(checked ? [...exportAllTypes, type] : exportAllTypes.filter((other) => other !== type))}
                  label={`${type} (${counts[type]})`}
                />
              ))}
            <Switch checked={deep} onChange={setDeep} label="Include related objects" />
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal title="Delete saved objects" confirmLabel="Delete" danger busy={busy} onConfirm={remove} onCancel={() => setDeleting(false)}>
          <p>This action will delete the following saved objects:</p>
          <table className="mgtSamples">
            <thead>
              <tr>
                <th>Type</th>
                <th>Id</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody>
              {chosen.slice(0, 50).map((object) => (
                <tr key={keyOf(object)}>
                  <td>
                    <TypeIcon type={object.type} />
                  </td>
                  <td className="atlMono">{object.id}</td>
                  <td>{titleOf(object)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {chosen.length > 50 && <p className="atlSubdued">and {chosen.length - 50} more.</p>}
        </ConfirmModal>
      )}

      {importing && (
        <ImportFlyout
          onClose={() => setImporting(false)}
          onDone={() => {
            services.indexPatterns.clear();
            setTick((count) => count + 1);
          }}
        />
      )}
      {relationsOf && <Relationships object={relationsOf} onClose={() => setRelationsOf(undefined)} />}
    </div>
  );
}

// --- What an object is tied to --------------------------------------------------------------------

function Relationships({ object, onClose }: { object: Row; onClose: () => void }) {
  const [rows, setRows] = useState<Array<Row & { relationship: 'Parent' | 'Child' }>>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    (async () => {
      const full = await services.savedObjects.get(object.type, object.id);
      const [children, parents] = await Promise.all([
        services.savedObjects.bulkGet<Record<string, unknown>>(full.references.map(({ type, id }) => ({ type, id }))),
        services.savedObjects.find<Record<string, unknown>>({
          type: ALL_TYPES,
          hasReference: { type: object.type, id: object.id },
          fields: ['title', 'name'],
          perPage: 1000,
        }),
      ]);
      const seen = new Set<string>();
      const unique = <T extends Row>(list: T[]) =>
        list.filter((item) => {
          if (seen.has(keyOf(item))) return false;
          seen.add(keyOf(item));
          return true;
        });
      return [
        ...unique(parents.saved_objects).map((item) => ({ ...item, relationship: 'Parent' as const })),
        ...unique(children.filter((item) => !item.error)).map((item) => ({ ...item, relationship: 'Child' as const })),
      ];
    })().then(
      (found) => live && setRows(found),
      (failure) => live && setError(errorMessage(failure))
    );
    return () => {
      live = false;
    };
  }, [object]);

  const columns: Array<Column<Row & { relationship: string }>> = [
    { id: 'type', name: 'Type', width: 64, render: (row) => <TypeIcon type={row.type} />, sortValue: (row) => row.type },
    { id: 'relationship', name: 'Direct relationship', width: 170, render: (row) => row.relationship, sortValue: (row) => row.relationship },
    { id: 'title', name: 'Title', render: (row) => <ObjectTitle object={row} />, sortValue: titleOf },
    {
      id: 'actions',
      name: 'Actions',
      width: 80,
      align: 'right',
      render: (row) => (canInspect(row.type) ? <IconButton icon="inspect" label="Inspect" size="s" to={inspectPath(row)} /> : null),
    },
  ];

  return (
    <Flyout
      wide
      onClose={onClose}
      title={
        <span className="atlRow">
          <TypeIcon type={object.type} /> {titleOf(object)}
        </span>
      }
      testId="savedObjectRelationships"
    >
      {error ? (
        <CallOut tone="critical" title="The relationships could not be read">
          {error}
        </CallOut>
      ) : !rows ? (
        <Loading />
      ) : (
        <div className="atlStack">
          <CallOut>
            Here are the saved objects related to {titleOf(object)}. Deleting this {object.type} affects its parent objects, but not its children.
          </CallOut>
          <DataTable rows={rows} columns={columns} rowId={(row) => `${row.relationship}:${keyOf(row)}`} pageSize={20} empty="This object is related to no other" />
        </div>
      )}
    </Flyout>
  );
}

// --- Import ---------------------------------------------------------------------------------------

interface ImportFailure {
  id: string;
  type: string;
  title?: string;
  error: { type: string; message?: string; references?: Array<{ type: string; id: string }> };
}

interface ImportAnswer {
  success: boolean;
  successCount: number;
  errors?: ImportFailure[];
}

type ImportMode = 'overwrite' | 'ask' | 'copies';

/** The lines of an export file, with the objects among them read */
function readLines(text: string): Array<{ line: string; object?: { type: string; id: string; references?: SavedObjectReference[] } }> {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as { type?: string; id?: string; references?: SavedObjectReference[] };
        return typeof parsed.type === 'string' && typeof parsed.id === 'string'
          ? { line, object: { type: parsed.type, id: parsed.id, references: parsed.references } }
          : { line };
      } catch {
        return { line };
      }
    });
}

async function sendImport(text: string, query: Record<string, string | undefined>): Promise<ImportAnswer> {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'application/ndjson' }), 'import.ndjson');
  return services.http.post<ImportAnswer>('/api/saved_objects/_import', { query, body: form });
}

function ImportFlyout({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File>();
  const [mode, setMode] = useState<ImportMode>('overwrite');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [imported, setImported] = useState(0);
  const [failures, setFailures] = useState<ImportFailure[]>();
  const [text, setText] = useState('');
  // What to do with each object that is already there, and which index pattern stands in for a missing one
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [patterns, setPatterns] = useState<IndexPatternSummary[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    services.indexPatterns.list().then(setPatterns, () => setPatterns([]));
  }, []);

  const start = async () => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const content = await file.text();
      setText(content);
      const answer = await sendImport(content, mode === 'copies' ? { createNewCopies: 'true' } : mode === 'overwrite' ? { overwrite: 'true' } : {});
      setImported(answer.successCount);
      setFailures(answer.errors ?? []);
      setOverwrite(Object.fromEntries((answer.errors ?? []).filter((failure) => failure.error.type === 'conflict').map((failure) => [keyOf(failure), true])));
      if (answer.successCount) onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setBusy(false);
  };

  const conflicts = (failures ?? []).filter((failure) => failure.error.type === 'conflict');
  const missing = (failures ?? []).filter((failure) => failure.error.type === 'missing_references');
  const others = (failures ?? []).filter((failure) => failure.error.type !== 'conflict' && failure.error.type !== 'missing_references');
  const missingPatterns = [...new Set(missing.flatMap((failure) => (failure.error.references ?? []).filter((reference) => reference.type === 'index-pattern').map((reference) => reference.id)))];
  const canRetry = conflicts.some((failure) => overwrite[keyOf(failure)]) || missingPatterns.some((id) => replacements[id]);

  // The objects still to be settled go in again: those to overwrite, and those whose missing
  // index pattern now has one to stand in for it
  const retry = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const wanted = new Set<string>();
      for (const failure of conflicts) if (overwrite[keyOf(failure)]) wanted.add(keyOf(failure));
      for (const failure of missing) {
        const references = failure.error.references ?? [];
        if (references.every((reference) => reference.type === 'index-pattern' && replacements[reference.id])) wanted.add(keyOf(failure));
      }
      const lines = readLines(text)
        .filter((entry) => entry.object && wanted.has(keyOf(entry.object)))
        .map((entry) => {
          const parsed = JSON.parse(entry.line) as { references?: SavedObjectReference[] };
          parsed.references = (parsed.references ?? []).map((reference) =>
            reference.type === 'index-pattern' && replacements[reference.id] ? { ...reference, id: replacements[reference.id] } : reference
          );
          return JSON.stringify(parsed);
        });
      const answer = await sendImport(lines.join('\n'), { overwrite: 'true' });
      setImported((count) => count + answer.successCount);
      const settled = new Set([...wanted].filter((key) => !(answer.errors ?? []).some((failure) => keyOf(failure) === key)));
      setFailures([...(failures ?? []).filter((failure) => !settled.has(keyOf(failure)) && !wanted.has(keyOf(failure))), ...(answer.errors ?? [])]);
      if (answer.successCount) onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setBusy(false);
  };

  const finished = failures !== undefined;
  return (
    <Flyout
      title="Import saved objects"
      onClose={onClose}
      testId="importSavedObjectsFlyout"
      footer={
        <>
          <Button variant="empty" onClick={onClose}>
            {finished ? 'Done' : 'Cancel'}
          </Button>
          <span className="atlGrow" />
          {!finished && (
            <Button variant="primary" disabled={!file} loading={busy} onClick={start} testId="importSavedObjectsImportBtn">
              Import
            </Button>
          )}
          {finished && (conflicts.length > 0 || missingPatterns.length > 0) && (
            <Button variant="primary" disabled={!canRetry} loading={busy} onClick={retry} testId="importSavedObjectsConfirmBtn">
              Confirm all changes
            </Button>
          )}
        </>
      }
    >
      <div className="atlStack">
        {error && (
          <CallOut tone="critical" title="Sorry, there was an error">
            {error}
          </CallOut>
        )}
        {!finished ? (
          <>
            <FormRow label="Select a file to import" full>
              <div className="mgtFilePicker">
                <input
                  ref={input}
                  type="file"
                  accept=".ndjson,.json,application/x-ndjson,application/json"
                  onChange={(event) => setFile(event.target.files?.[0])}
                  data-test-subj="savedObjectsImportFile"
                />
                {file ? <span className="atlSubdued atlSmall">{(file.size / 1024).toFixed(1)} kB</span> : <span className="atlSubdued atlSmall">An .ndjson file exported from here or from OpenSearch Dashboards</span>}
              </div>
            </FormRow>
            <div className="atlStack">
              <strong>Import options</strong>
              <RadioGroup<'check' | 'copies'>
                value={mode === 'copies' ? 'copies' : 'check'}
                onChange={(value) => setMode(value === 'copies' ? 'copies' : 'overwrite')}
                options={[
                  { id: 'check', label: 'Check for existing objects' },
                  { id: 'copies', label: 'Create new objects with random IDs' },
                ]}
              />
              {mode !== 'copies' && (
                <div className="mgtIndent">
                  <RadioGroup<ImportMode>
                    value={mode}
                    onChange={setMode}
                    options={[
                      { id: 'overwrite', label: 'Automatically overwrite conflicts' },
                      { id: 'ask', label: 'Request action on conflict' },
                    ]}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <CallOut tone={failures.length ? 'warning' : 'healthy'} title={failures.length ? 'Import finished with objects left over' : 'Import successful'}>
              {imported === 1 ? '1 object was imported.' : `${imported} objects were imported.`}
              {failures.length > 0 && ` ${failures.length} ${failures.length === 1 ? 'was' : 'were'} not.`}
            </CallOut>
            {conflicts.length > 0 && (
              <div className="atlStack">
                <strong>Already here</strong>
                <p className="atlSubdued">Choose which of these to overwrite with the object in the file.</p>
                {conflicts.map((failure) => (
                  <Checkbox
                    key={keyOf(failure)}
                    checked={overwrite[keyOf(failure)] === true}
                    onChange={(checked) => setOverwrite({ ...overwrite, [keyOf(failure)]: checked })}
                    label={`${failure.title ?? failure.id} (${failure.type})`}
                  />
                ))}
              </div>
            )}
            {missingPatterns.length > 0 && (
              <div className="atlStack">
                <strong>Index pattern conflicts</strong>
                <p className="atlSubdued">
                  The following saved objects use index patterns that do not exist. Please select the index patterns you'd like re-associated with
                  them.
                </p>
                {missingPatterns.map((id) => {
                  const affected = missing.filter((failure) => (failure.error.references ?? []).some((reference) => reference.id === id));
                  return (
                    <FormRow
                      key={id}
                      label={<span className="atlMono">{id}</span>}
                      help={`${affected.length} ${affected.length === 1 ? 'object' : 'objects'}: ${affected
                        .slice(0, 3)
                        .map((failure) => failure.title ?? failure.id)
                        .join(', ')}${affected.length > 3 ? '…' : ''}`}
                      full
                    >
                      <Select
                        value={replacements[id] ?? ''}
                        onChange={(value) => setReplacements({ ...replacements, [id]: value })}
                        placeholder="Select a new index pattern"
                        options={patterns.map((pattern) => ({ value: pattern.id, label: pattern.displayName || pattern.title }))}
                      />
                    </FormRow>
                  );
                })}
              </div>
            )}
            {(others.length > 0 || missing.some((failure) => (failure.error.references ?? []).some((reference) => reference.type !== 'index-pattern'))) && (
              <div className="atlStack">
                <strong>Could not be imported</strong>
                <ul className="mgtPlainList">
                  {[...others, ...missing.filter((failure) => (failure.error.references ?? []).some((reference) => reference.type !== 'index-pattern'))].map((failure) => (
                    <li key={keyOf(failure)}>
                      {failure.title ?? failure.id} ({failure.type}):{' '}
                      {failure.error.type === 'unsupported_type'
                        ? 'this kind of object is not one this product keeps'
                        : failure.error.type === 'missing_references'
                          ? `it needs ${(failure.error.references ?? []).map((reference) => `${reference.type} ${reference.id}`).join(', ')}, which is not here`
                          : (failure.error.message ?? failure.error.type)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Flyout>
  );
}

// --- One object as it is stored -------------------------------------------------------------------

type FieldKind = 'text' | 'number' | 'boolean' | 'json' | 'object';

interface EditedField {
  name: string;
  kind: FieldKind;
  text: string;
  flag: boolean;
}

function fieldOf(name: string, value: unknown): EditedField {
  if (typeof value === 'boolean') return { name, kind: 'boolean', text: '', flag: value };
  if (typeof value === 'number') return { name, kind: 'number', text: String(value), flag: false };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return { name, kind: 'json', text: JSON.stringify(JSON.parse(value), null, 2), flag: false };
      } catch {
        // not JSON after all: shown as the text it is
      }
    }
    return { name, kind: 'text', text: value, flag: false };
  }
  return { name, kind: 'object', text: JSON.stringify(value ?? null, null, 2), flag: false };
}

/** The fields of an object, with the nested ones named by their path: `kibanaSavedObjectMeta.searchSourceJSON` */
function fieldsOf(attributes: Record<string, unknown>, prefix = ''): EditedField[] {
  return Object.entries(attributes).flatMap(([name, value]) => {
    const path = `${prefix}${name}`;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
      return fieldsOf(value as Record<string, unknown>, `${path}.`);
    }
    return [fieldOf(path, value)];
  });
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let at = target;
  for (const part of parts.slice(0, -1)) {
    if (at[part] === null || typeof at[part] !== 'object') at[part] = {};
    at = at[part] as Record<string, unknown>;
  }
  at[parts[parts.length - 1]] = value;
}

function InspectObject({ type, id }: { type: string; id: string }) {
  const [object, setObject] = useState<Row>();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<EditedField[]>([]);
  const [references, setReferences] = useState('[]');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useBreadcrumbs([MANAGEMENT, { text: 'Saved objects', to: ROOT }, { text: object ? `Inspect ${titleOf(object)}` : 'Inspect' }]);

  useEffect(() => {
    let live = true;
    services.savedObjects
      .get<Record<string, unknown>>(type, id)
      .then((loaded) => {
        if (!live) return;
        setObject(loaded);
        setFields(fieldsOf(loaded.attributes));
        setReferences(JSON.stringify(loaded.references ?? [], null, 2));
      })
      .catch((failure) => live && setError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, [type, id]);

  const problems = useMemo(() => {
    const found: Record<string, string> = {};
    for (const field of fields) {
      if (field.kind === 'json' || field.kind === 'object') {
        try {
          JSON.parse(field.text);
        } catch (failure) {
          found[field.name] = (failure as Error).message;
        }
      } else if (field.kind === 'number' && (field.text.trim() === '' || Number.isNaN(Number(field.text)))) found[field.name] = 'A number is expected';
    }
    try {
      if (!Array.isArray(JSON.parse(references))) found.references = 'A list is expected';
    } catch (failure) {
      found.references = (failure as Error).message;
    }
    return found;
  }, [fields, references]);

  if (error) {
    return (
      <div className="mgtPage">
        <Panel>
          <EmptyPrompt icon="warning" title="This object could not be opened" actions={<Button to={ROOT}>Back to saved objects</Button>}>
            {error}
          </EmptyPrompt>
        </Panel>
      </div>
    );
  }
  if (!object) {
    return (
      <div className="mgtPage">
        <Loading />
      </div>
    );
  }

  const change = (name: string, patch: Partial<EditedField>) => setFields(fields.map((field) => (field.name === name ? { ...field, ...patch } : field)));

  const save = async () => {
    setSaving(true);
    try {
      const attributes: Record<string, unknown> = {};
      for (const field of fields) {
        const value =
          field.kind === 'boolean'
            ? field.flag
            : field.kind === 'number'
              ? Number(field.text)
              : field.kind === 'json'
                ? JSON.stringify(JSON.parse(field.text))
                : field.kind === 'object'
                  ? (JSON.parse(field.text) as unknown)
                  : field.text;
        setPath(attributes, field.name, value);
      }
      await services.savedObjects.update(object.type, object.id, attributes, { references: JSON.parse(references) as SavedObjectReference[] });
      if (object.type === 'index-pattern') services.indexPatterns.clear(object.id);
      services.toasts.success(`Updated '${titleOf({ ...object, attributes })}' ${object.type} object`);
      navigate(ROOT);
    } catch (failure) {
      services.toasts.error(failure, 'The object could not be saved');
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await services.savedObjects.delete(object.type, object.id);
      if (object.type === 'index-pattern') services.indexPatterns.clear();
      services.toasts.success(`Deleted '${titleOf(object)}' ${object.type} object`);
      navigate(ROOT);
    } catch (failure) {
      services.toasts.error(failure, 'The object could not be deleted');
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  const view = TYPES[object.type]?.inApp?.(object.id);
  return (
    <div className="mgtPage" data-test-subj="savedObjectsEdit">
      <Panel>
        <PageHeader
          title={`Inspect ${titleOf(object)}`}
          actions={
            <>
              {view && (
                <Button icon="external" to={view} testId="savedObjectEditViewInApp">
                  View {object.type}
                </Button>
              )}
              <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)} testId="savedObjectEditDelete">
                Delete
              </Button>
            </>
          }
        />
        <CallOut tone="warning" title="Proceed with caution!">
          Modifying objects is for advanced users only. Object properties are not validated and invalid objects could cause errors, data loss, or
          worse. Unless someone with intimate knowledge of the code told you to be in here, you probably shouldn't be.
        </CallOut>
        <div className="atlStack mgtForm mgtForm--wide">
          {fields.map((field) => (
            <FormRow key={field.name} label={field.name} error={problems[field.name]} full>
              {field.kind === 'boolean' ? (
                <Switch checked={field.flag} onChange={(flag) => change(field.name, { flag })} label={field.flag ? 'On' : 'Off'} />
              ) : field.kind === 'number' ? (
                <NumberField value={field.text === '' ? '' : Number(field.text)} onChange={(value) => change(field.name, { text: value === undefined ? '' : String(value) })} />
              ) : field.kind === 'json' || field.kind === 'object' ? (
                <CodeEditor value={field.text} onChange={(text) => change(field.name, { text })} minLines={3} maxLines={24} ariaLabel={field.name} testId={`savedObjects-editField-${field.name}`} />
              ) : field.text.includes('\n') || field.text.length > 120 ? (
                <TextArea value={field.text} onChange={(text) => change(field.name, { text })} rows={Math.min(12, field.text.split('\n').length + 1)} />
              ) : (
                <TextField value={field.text} onChange={(text) => change(field.name, { text })} testId={`savedObjects-editField-${field.name}`} />
              )}
            </FormRow>
          ))}
          <FormRow label="references" error={problems.references} full>
            <CodeEditor value={references} onChange={setReferences} minLines={3} maxLines={24} ariaLabel="references" testId="savedObjects-editField-references" />
          </FormRow>
          <div className="atlRow mgtFormFooter">
            <Button variant="primary" loading={saving} disabled={Object.keys(problems).length > 0} onClick={save} testId="savedObjectEditSave">
              Save {object.type} Object
            </Button>
            <Button variant="empty" to={ROOT}>
              Cancel
            </Button>
          </div>
        </div>
      </Panel>
      {confirmDelete && (
        <ConfirmModal title={`Delete '${titleOf(object)}'?`} confirmLabel="Delete" danger busy={saving} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
          You can't recover deleted saved objects.
        </ConfirmModal>
      )}
    </div>
  );
}
