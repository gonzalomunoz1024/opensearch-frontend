/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The import of saved objects, as the original's flyout: a file and how its objects meet those
 * already here, the index patterns to put in place of missing ones, a question for each conflict
 * when asked for, and what the import did.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Link, Spinner, cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Flyout, Modal, Tooltip } from '../../components/overlay';
import { services } from '../../services';
import { HttpFetchError } from '../../services/http';
import {
  getDefaultTitle,
  importItems,
  processImportResponse,
  resolveImportErrors,
  type FailedConflict,
  type FailedImport,
  type ImportObject,
  type ImportResponse,
  type ImportSuccess,
  type RetryDecision,
  type RetryObject,
  type UnmatchedReference,
} from './saved_objects_lib';
import { Callout, IMPORT_ICON, InMemoryTable, TypeIcon, type Column } from './saved_objects_parts';

interface ImportMode {
  createNewCopies: boolean;
  overwrite: boolean;
}

interface IndexPatternChoice {
  id: string;
  title: string;
  displayTitle: string;
}

interface FlyoutState {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  file?: File;
  isLegacyFile: boolean;
  importMode: ImportMode;
  importCount: number;
  failedImports?: FailedImport[];
  successfulImports?: ImportSuccess[];
  unmatchedReferences?: UnmatchedReference[];
  /** What a legacy (JSON) file imported, said as the original's call-outs say it */
  legacy?: { importCount: number; failed: string[] };
}

/** The sentence of a failed import, as the original writes it */
function importError(error: unknown): string {
  const body = error instanceof HttpFetchError && error.body && typeof error.body === 'object' ? (error.body as { error?: unknown; message?: unknown }) : undefined;
  const text =
    body && body.error && body.message ? `${String(body.error)}: ${String(body.message)}` : error instanceof Error ? error.message : String(error);
  return `The file could not be processed due to error: "${text}"`;
}

function sendFile(path: string, file: File | undefined, query: Record<string, boolean>, retries?: RetryObject[]) {
  const form = new FormData();
  // A missing file goes as the word the original's form data makes of it
  form.append('file', file ?? 'undefined');
  if (retries) form.append('retries', JSON.stringify(retries));
  return services.http.post<ImportResponse>(path, { body: form, query });
}

/** A legacy export: a JSON array of `{_id, _type, _source}`, sent as objects whose migrations all run */
async function legacyObjects(file: File | undefined, allowedTypes: string[]): Promise<{ lines: string } | { error: string }> {
  let contents: unknown;
  try {
    contents = JSON.parse(file ? await file.text() : 'undefined');
  } catch {
    return { error: 'The file could not be processed.' };
  }
  if (!Array.isArray(contents)) return { error: 'Saved objects file format is invalid and cannot be imported.' };
  const lines = contents
    .filter((doc): doc is { _id: string; _type: string; _source: Record<string, unknown>; _migrationVersion?: Record<string, string> } =>
      Boolean(doc) && typeof doc === 'object' && allowedTypes.includes((doc as { _type?: string })._type ?? '')
    )
    .map((doc) => JSON.stringify({ id: doc._id, type: doc._type, attributes: doc._source, migrationVersion: doc._migrationVersion ?? {}, references: [] }))
    .join('\n');
  return { lines };
}

export function ImportFlyout({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [state, setStateValue] = useState<FlyoutState>({
    status: 'idle',
    isLegacyFile: false,
    importMode: { createNewCopies: true, overwrite: true },
    importCount: 0,
  });
  // The async steps read and write the state of their moment, as the original's class does
  const current = useRef(state);
  const setState = (patch: Partial<FlyoutState>) => {
    current.current = { ...current.current, ...patch };
    setStateValue(current.current);
  };
  const [indexPatterns, setIndexPatterns] = useState<IndexPatternChoice[]>([]);
  const [conflictingRecord, setConflictingRecord] = useState<{ conflict: FailedConflict; done: (result: [boolean, string | undefined]) => void }>();

  useEffect(() => {
    let live = true;
    services.http
      .get<{ saved_objects: Array<{ id: string; attributes: { title?: string; displayName?: string } }> }>('/api/saved_objects/_find', {
        query: { fields: ['title', 'displayName', 'type'], per_page: 10000, type: 'index-pattern' },
      })
      .then(
        (answer) =>
          live &&
          setIndexPatterns(
            answer.saved_objects.map((object) => ({
              id: object.id,
              title: object.attributes.title ?? '',
              displayTitle: object.attributes.displayName || object.attributes.title || '',
            }))
          ),
        () => undefined
      );
    return () => {
      live = false;
    };
  }, []);

  const getConflictResolutions = async (failures: FailedConflict[]) => {
    const resolutions: Record<string, RetryDecision> = {};
    for (const conflict of failures) {
      const [overwrite, destinationId] = await new Promise<[boolean, string | undefined]>((done) => setConflictingRecord({ conflict, done }));
      if (overwrite) {
        resolutions[`${conflict.obj.type}:${conflict.obj.id}`] = { retry: true, options: { overwrite: true, ...(destinationId ? { destinationId } : {}) } };
      }
      setConflictingRecord(undefined);
    }
    return resolutions;
  };

  const resolveErrors = async () => {
    setState({ error: undefined, status: 'loading' });
    const { file } = current.current;
    try {
      const resolved = await resolveImportErrors({
        state: current.current,
        getConflictResolutions,
        callResolveImportErrors: (retries, createNewCopies) =>
          sendFile('/api/saved_objects/_resolve_import_errors', file, createNewCopies ? { createNewCopies } : {}, retries),
      });
      setState(resolved);
    } catch (error) {
      setState({ status: 'error', error: importError(error) });
    }
  };

  const startImport = async () => {
    const { file, importMode } = current.current;
    setState({ status: 'loading', error: undefined });
    try {
      const response = await sendFile(
        '/api/saved_objects/_import',
        file,
        importMode.createNewCopies ? { createNewCopies: true } : { overwrite: importMode.overwrite }
      );
      setState(processImportResponse(response));
    } catch (error) {
      setState({ status: 'error', error: importError(error) });
      return;
    }
    // Without index patterns to choose, the errors are resolved at once: each conflict is asked about
    if (current.current.unmatchedReferences?.length === 0) await resolveErrors();
  };

  const legacyImport = async () => {
    const { file, importMode } = current.current;
    setState({ status: 'loading', error: undefined });
    void services.http.post('/api/saved_objects/_log_legacy_import').catch(() => undefined);
    const allowed = await services.http
      .get<{ types: string[] }>('/api/opensearch-dashboards/management/saved_objects/_allowed_types')
      .then((answer) => answer.types, () => []);
    const read = await legacyObjects(file, allowed);
    if ('error' in read) {
      setState({ status: 'error', error: read.error });
      return;
    }
    try {
      const response: ImportResponse = read.lines
        ? await sendFile('/api/saved_objects/_import', new File([read.lines], 'export.ndjson'), { overwrite: importMode.overwrite })
        : { success: true, successCount: 0 };
      const failed = (response.errors ?? []).map(({ error, id, type }) =>
        error.type === 'missing_references'
          ? error.references.map((reference) => `${type} [id=${id}] could not locate ${reference.type} [id=${reference.id}]`).join(' ')
          : error.type === 'unsupported_type'
            ? `${type} [id=${id}] unsupported type`
            : error.type === 'unknown'
              ? error.message
              : ''
      );
      setState({ status: 'success', legacy: { importCount: response.successCount, failed } });
    } catch (error) {
      setState({ status: 'error', error: importError(error) });
    }
  };

  const { status, error, file, isLegacyFile, importMode, unmatchedReferences, legacy } = state;
  const hasUnmatchedReferences = (unmatchedReferences?.length ?? 0) > 0;

  // As the original's flyout, which keeps the focus in it: when the button that had it is gone,
  // as the Import button once the import is done, the close button has it
  useEffect(() => {
    if (document.activeElement === document.body) {
      document.querySelector<HTMLElement>('.sobImportFlyout [data-test-subj=euiFlyoutCloseButton]')?.focus();
    }
  }, [status]);

  let confirmButton: ReactNode;
  if (status === 'success') {
    confirmButton = (
      <Button variant="primary" onClick={onDone} testId="importSavedObjectsDoneBtn">
        Done
      </Button>
    );
  } else if (hasUnmatchedReferences) {
    confirmButton = (
      <Button variant="primary" onClick={() => void resolveErrors()} loading={status === 'loading'} testId="importSavedObjectsConfirmBtn">
        Confirm all changes
      </Button>
    );
  } else {
    confirmButton = (
      <Button
        variant="primary"
        onClick={() => void (isLegacyFile ? legacyImport() : startImport())}
        loading={status === 'loading'}
        testId="importSavedObjectsImportBtn"
      >
        Import
      </Button>
    );
  }

  let body: ReactNode;
  if (status === 'loading') {
    body = (
      <div className="sobImportLoading">
        <Spinner size="xl" />
      </div>
    );
  } else if (!isLegacyFile && status === 'success') {
    body = <ImportSummary failedImports={state.failedImports ?? []} successfulImports={state.successfulImports ?? []} />;
  } else if (legacy && legacy.failed.length > 0) {
    body = (
      <Callout tone="warning" icon="help" title="Import failed" testId="importSavedObjectsFailedWarning">
        <p>
          Failed to import {legacy.failed.length} of {legacy.importCount + legacy.failed.length} objects. Import failed
        </p>
        <p>{legacy.failed.join(' ')}</p>
      </Callout>
    );
  } else if (legacy && status === 'success') {
    body =
      legacy.importCount === 0 ? (
        <Callout tone="primary" title="No objects imported" testId="importSavedObjectsSuccessNoneImported" />
      ) : (
        <Callout tone="success" icon="check" title="Import successful" testId="importSavedObjectsSuccess">
          <p>Successfully imported {legacy.importCount} objects.</p>
        </Callout>
      );
  } else if (hasUnmatchedReferences && unmatchedReferences) {
    body = (
      <UnmatchedReferences
        references={unmatchedReferences}
        indexPatterns={indexPatterns}
        onChange={(id, value) =>
          setState({
            unmatchedReferences: (current.current.unmatchedReferences ?? []).map((reference) =>
              reference.existingIndexPatternId === id ? { ...reference, newIndexPatternId: value } : reference
            ),
          })
        }
      />
    );
  } else {
    body = (
      <div className="sobForm">
        <div className="sobFormRow">
          <span className="sobLabel">Select file</span>
          <FilePicker
            file={file}
            onChange={(chosen) =>
              setState(
                chosen
                  ? { file: chosen, isLegacyFile: /\.json$/i.test(chosen.name) || chosen.type === 'application/json' }
                  : { file: undefined, isLegacyFile: false }
              )
            }
          />
        </div>
        <ImportModeControl isLegacyFile={isLegacyFile} importMode={importMode} onChange={(next) => setState({ importMode: next })} />
      </div>
    );
  }

  const subheader = status === 'loading' || status === 'success' ? null : (
    <>
      {isLegacyFile && (
        <>
          <div className="sobSpacer--s" />
          <Callout tone="warning" icon="help" title="Support for JSON files is going away" testId="importSavedObjectsLegacyWarning">
            <p>Use our updated export to generate NDJSON files, and you'll be all set.</p>
          </Callout>
          <div className="sobSpacer--m" />
        </>
      )}
      {hasUnmatchedReferences && (
        <>
          <div className="sobSpacer--s" />
          <Callout tone="warning" icon="help" title="Index Pattern Conflicts" testId="importSavedObjectsConflictsWarning">
            <p>
              The following saved objects use index patterns that do not exist. Please select the index patterns you'd like re-associated with
              them. You can <Link to="/app/management/opensearch-dashboards/indexPatterns">create a new index pattern</Link> if necessary.
            </p>
          </Callout>
        </>
      )}
    </>
  );

  return (
    <Flyout
      title="Import saved objects"
      // While a conflict is asked about, its dialog is on top: Escape answers it, and the flyout stays
      onClose={onClose}
      mask
      className="sobFlyout sobFlyout--s sobImportFlyout"
      footer={
        <>
          <Button
            variant="empty"
            onClick={onClose}
            disabled={status === 'loading' || (!isLegacyFile && status === 'success')}
            testId="importSavedObjectsCancelBtn"
          >
            Cancel
          </Button>
          {confirmButton}
        </>
      }
    >
      {subheader}
      {status === 'error' && (
        <>
          <Callout tone="danger" title="Sorry, there was an error">
            <p data-test-subj="importSavedObjectsErrorText">{error}</p>
          </Callout>
          <div className="sobSpacer--s" />
        </>
      )}
      {body}
      {conflictingRecord &&
        conflictQuestion(conflictingRecord.conflict, (overwrite, destinationId) => conflictingRecord.done([overwrite, destinationId]))}
    </Flyout>
  );
}

function FilePicker({ file, onChange }: { file?: File; onChange: (file?: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cx('sobFilePicker', file && 'sobFilePicker--selected')}>
      <input
        ref={input}
        type="file"
        accept=".ndjson, .json"
        className="sobFilePicker__input"
        aria-label="Select file"
        onChange={(event) => onChange(event.target.files?.[0])}
      />
      <div className="sobFilePicker__prompt">
        <Icon name={IMPORT_ICON} size="l" />
        <div className="sobFilePicker__text">{file ? <strong>{file.name}</strong> : 'Import'}</div>
        {file && (
          <button
            type="button"
            className="sobFilePicker__remove"
            onClick={() => {
              if (input.current) input.current.value = '';
              onChange(undefined);
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function ImportModeControl({
  isLegacyFile,
  importMode,
  onChange,
}: {
  isLegacyFile: boolean;
  importMode: ImportMode;
  onChange: (mode: ImportMode) => void;
}) {
  const overwriteRadio = (disabled: boolean) => (
    <div className="sobRadios" data-test-subj="savedObjectsManagement-importModeControl-overwriteRadioGroup">
      {[
        { id: 'overwriteEnabled', label: 'Automatically overwrite conflicts', overwrite: true },
        { id: 'overwriteDisabled', label: 'Request action on conflict', overwrite: false },
      ].map((option) => (
        <label key={option.id} htmlFor={option.id} className={cx('sobRadio', disabled && 'sobRadio--disabled')}>
          <input
            type="radio"
            id={option.id}
            className="sobRadio__input"
            checked={importMode.overwrite === option.overwrite}
            disabled={disabled}
            onChange={() => onChange({ ...importMode, overwrite: option.overwrite })}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );

  if (isLegacyFile) return overwriteRadio(false);

  const card = (
    id: string,
    text: string,
    tip: string,
    checked: boolean,
    createNewCopies: boolean,
    children?: ReactNode
  ) => (
    <div className={cx('sobCard', checked && 'sobCard--checked')} data-test-subj={`savedObjectsManagement-importModeControl-${id}`}>
      <div className="sobCard__row">
        <div className="sobCard__control">
          <input type="radio" id={id} className="sobRadio__input" checked={checked} onChange={() => onChange({ ...importMode, createNewCopies })} />
        </div>
        <label className="sobCard__label" htmlFor={id}>
          <span>{text}</span>
          <Tooltip content={tip}>
            <span className="sobCard__tip" aria-label={tip}>
              <Icon name="info" />
            </span>
          </Tooltip>
        </label>
      </div>
      {children && <div className="sobCard__children">{children}</div>}
    </div>
  );

  return (
    <fieldset className="sobFieldset sobImportMode">
      <legend className="sobImportMode__legend">Import options</legend>
      {card(
        'createNewCopiesEnabled',
        'Create new objects with unique IDs',
        'Use this option to create one or more copies of the object.',
        importMode.createNewCopies,
        true
      )}
      <div className="sobSpacer--s" />
      {card(
        'createNewCopiesDisabled',
        'Check for existing objects',
        'Check if objects were previously copied or imported.',
        !importMode.createNewCopies,
        false,
        overwriteRadio(importMode.createNewCopies)
      )}
    </fieldset>
  );
}

function UnmatchedReferences({
  references,
  indexPatterns,
  onChange,
}: {
  references: UnmatchedReference[];
  indexPatterns: IndexPatternChoice[];
  onChange: (id: string, value: string) => void;
}) {
  const columns: Array<Column<UnmatchedReference>> = [
    { key: 'id', name: 'ID', description: 'ID of the index pattern', render: (reference) => reference.existingIndexPatternId },
    { key: 'count', name: 'Count', description: 'How many affected objects', render: (reference) => reference.list.length },
    {
      key: 'sample',
      name: 'Sample of affected objects',
      description: 'Sample of affected objects',
      render: (reference) => (
        <ul className="sobPlainList">
          {reference.list.slice(0, 3).map((object: ImportObject, index) => (
            <li key={index}>{object.title}</li>
          ))}
        </ul>
      ),
    },
    {
      key: 'new',
      name: 'New index pattern',
      render: (reference) => (
        <select
          className="sobSelect"
          defaultValue=""
          onChange={(event) => onChange(reference.existingIndexPatternId, event.target.value)}
          data-test-subj={`managementChangeIndexSelection-${reference.existingIndexPatternId}`}
        >
          <option value="">-- Skip Import --</option>
          {indexPatterns.map((pattern) => (
            <option key={pattern.id} value={pattern.id} data-test-subj={`indexPatternOption-${pattern.title}`}>
              {pattern.displayTitle || pattern.title}
            </option>
          ))}
        </select>
      ),
    },
  ];
  return (
    <InMemoryTable items={references} columns={columns} itemId={(reference) => reference.existingIndexPatternId} pageSizeOptions={[5, 10, 25]} />
  );
}

/** How long ago, as moment's `fromNow` says it */
function fromNow(date: string): string {
  const seconds = (Date.now() - Date.parse(date)) / 1000;
  const past = seconds >= 0;
  const s = Math.abs(seconds);
  const round = Math.round;
  const text =
    s < 45
      ? 'a few seconds'
      : s < 90
        ? 'a minute'
        : s < 45 * 60
          ? `${round(s / 60)} minutes`
          : s < 90 * 60
            ? 'an hour'
            : s < 22 * 3600
              ? `${round(s / 3600)} hours`
              : s < 36 * 3600
                ? 'a day'
                : s < 26 * 86400
                  ? `${round(s / 86400)} days`
                  : s < 45 * 86400
                    ? 'a month'
                    : s < 320 * 86400
                      ? `${round(s / (30.4 * 86400))} months`
                      : s < 548 * 86400
                        ? 'a year'
                        : `${round(s / (365.25 * 86400))} years`;
  return past ? `${text} ago` : `in ${text}`;
}

/**
 * The question about one conflict, in a dialog of its own: the original's flyout mounts a new one
 * for each conflict, so the focus starts on Overwrite again and the choice is that conflict's.
 * Without the key, React keeps the dialog of the conflict before.
 */
export function conflictQuestion(conflict: FailedConflict, onFinish: (overwrite: boolean, destinationId?: string) => void) {
  return <OverwriteModal key={`${conflict.obj.type}:${conflict.obj.id}`} conflict={conflict} onFinish={onFinish} />;
}

function OverwriteModal({ conflict, onFinish }: { conflict: FailedConflict; onFinish: (overwrite: boolean, destinationId?: string) => void }) {
  const { obj, error } = conflict;
  const [destinationId, setDestinationId] = useState(error.type === 'conflict' ? error.destinationId : error.destinations[0]?.id);
  const title = obj.meta.title || getDefaultTitle(obj);
  const bodyText =
    error.type === 'conflict'
      ? `"${title}" conflicts with an existing object. Overwrite it?`
      : `"${title}" conflicts with multiple existing objects. Overwrite one?`;
  return (
    <Modal
      title={`Overwrite ${obj.type}?`}
      onClose={() => onFinish(false)}
      className="sobModal sobOverwriteModal"
      testId="confirmModal"
      footer={
        <>
          <Button variant="empty" onClick={() => onFinish(false)} testId="confirmModalCancelButton">
            Skip
          </Button>
          <Button variant="dangerFill" onClick={() => onFinish(true, destinationId)} data-autofocus testId="confirmModalConfirmButton">
            Overwrite
          </Button>
        </>
      }
    >
      <p className="sobText">{bodyText}</p>
      {error.type === 'ambiguous_conflict' && (
        <label className="sobPrepend">
          <span className="sobPrepend__label">Object ID</span>
          <select className="sobSelect sobPrepend__select" value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
            {error.destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {`${destination.title ?? `${obj.type} [id=${destination.id}]`} — ID: ${destination.id} — Last updated: ${
                  destination.updatedAt ? fromNow(destination.updatedAt) : 'never'
                }`}
              </option>
            ))}
          </select>
        </label>
      )}
    </Modal>
  );
}

function ImportSummary({ failedImports, successfulImports }: { failedImports: FailedImport[]; successfulImports: ImportSuccess[] }) {
  const items = importItems(failedImports, successfulImports);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.outcome, (counts.get(item.outcome) ?? 0) + 1);
  const created = counts.get('created');
  const overwritten = counts.get('overwritten');
  const errors = counts.get('error');
  return (
    <>
      <h3 className="sobSummary__title" data-test-subj={items.length ? 'importSavedObjectsSuccess' : 'importSavedObjectsSuccessNoneImported'}>
        {items.length === 1 ? '1 object imported' : `${items.length} objects imported`}
      </h3>
      <div className="sobSpacer--m" />
      {items.length > 0 && (
        <div className="sobSummary__counts">
          {created && <h4 className="sobSummary__count sobSummary__count--created">{created} new</h4>}
          {overwritten && <h4 className="sobSummary__count">{overwritten} overwritten</h4>}
          {errors && <h4 className="sobSummary__count sobSummary__count--error">{errors} error</h4>}
        </div>
      )}
      <hr className="sobRule" />
      {items.map((item, index) => (
        <div key={index} className="sobSummary__row">
          <TypeIcon type={item.type} icon={item.icon} />
          <p className="sobSummary__name" title={item.title}>
            {item.title}
          </p>
          <Tooltip content={item.outcome === 'created' ? 'Created' : item.outcome === 'overwritten' ? 'Overwritten' : (item.errorMessage ?? 'Error')}>
            <span
              className={`sobSummary__status sobSummary__status--${item.outcome}`}
              aria-label={item.outcome === 'created' ? 'Created' : item.outcome === 'overwritten' ? 'Overwritten' : (item.errorMessage ?? 'Error')}
            >
              <Icon name={item.outcome === 'created' ? 'checkCircle' : item.outcome === 'overwritten' ? 'check' : 'warning'} />
            </span>
          </Tooltip>
        </div>
      ))}
    </>
  );
}

