/* SPDX-License-Identifier: Apache-2.0 */

/*
 * One saved object as it is stored, as the original's page shows it: every attribute in a field of
 * its kind, the references, and the fields of its class it does not have; saved back as they are.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Button, cx } from '../../components/basic';
import { CodeEditor, type CodeEditorHandle } from '../../components/code_editor';
import { Modal } from '../../components/overlay';
import { navigate, useLocation } from '../../router';
import { services } from '../../services';
import type { SavedObject } from '../../services/saved_objects';
import { useBreadcrumbs } from '../../shell/state';
import {
  OBJECT_SERVICES,
  createFieldList,
  inspectDelete,
  inspectedObject,
  savedAttributes,
  tokenizeFieldJson,
  type ObjectField,
  type ObjectService,
} from './saved_objects_lib';
import { Callout, MANAGEMENT_CRUMB, OBJECTS_ROOT, SmallSwitch, allowedObjectTypes, errorText, useObjectsDocTitle } from './saved_objects_parts';

type StoredObject = SavedObject<Record<string, unknown>>;

/*
 * Where "View" leads: the object in its app. (The original's link is the loader's relative
 * `#/edit/<id>`, which stays on this page.) An augment-vis has no app to be viewed in.
 */
const VIEW_URLS: Record<string, (id: string) => string> = {
  dashboard: (id) => `/app/dashboards#/view/${encodeURIComponent(id)}`,
  visualization: (id) => `/app/visualize#/edit/${encodeURIComponent(id)}`,
  search: (id) => `/app/discover#/view/${encodeURIComponent(id)}`,
  'visualization-visbuilder': (id) => `/app/vis-builder/edit/${encodeURIComponent(id)}`,
  homepage: () => '/app/home',
};

const NOT_FOUND_MESSAGES: Record<string, string> = {
  search: 'The saved search associated with this object no longer exists.',
  'index-pattern': 'The index pattern associated with this object no longer exists.',
  'index-pattern-field': 'A field associated with this object no longer exists in the index pattern.',
};

// Where the page goes when it is done: the section's root as the original's history writes it
const LISTING = `${OBJECTS_ROOT}/`;

const deleteObject = (type: string, id: string) => {
  const request = inspectDelete(type, id);
  return services.http.delete(request.path, { query: request.query });
};

/** The augment-vis objects of a deleted visualization go with it, as the vis augmenter's action does */
async function deleteAugmentVis(id: string) {
  if (!services.uiSettings.get<boolean>('visualization:enablePluginAugmentation', true)) return;
  try {
    const found = await services.http.get<{ saved_objects: Array<{ id: string }> }>('/api/saved_objects/_find', {
      // In the order the original's client writes them into the address
      query: {
        default_search_operator: 'AND',
        has_reference: JSON.stringify({ type: 'visualization', id }),
        page: 1,
        per_page: 100,
        search_fields: ['title^3', 'description'],
        type: 'augment-vis',
      },
    });
    await Promise.all(found.saved_objects.map((object) => deleteObject('augment-vis', object.id)));
  } catch {
    // As the original's: a clean-up the person did not ask for fails silently
  }
}

export function InspectPage({ serviceName, id }: { serviceName: string; id: string }) {
  const service = OBJECT_SERVICES[serviceName] as ObjectService | undefined;
  const type = service?.type ?? 'object';
  const { search } = useLocation();
  const notFoundType = new URLSearchParams(search).get('notFound') ?? undefined;
  const [object, setObject] = useState<StoredObject>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useBreadcrumbs([MANAGEMENT_CRUMB, { text: 'Saved objects', to: OBJECTS_ROOT }, { text: `Edit ${type}` }]);
  useObjectsDocTitle();

  useEffect(() => {
    // As the original's section does when it is opened on an object: the types are asked for too
    void allowedObjectTypes().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!service) return undefined;
    let live = true;
    // As the original's client reads one object: a bulk get of it. One that is not there is
    // answered without attributes and shown empty, with nothing said; only a request that fails
    // is told (the original leaves the page as it is then)
    services.savedObjects.bulkGet<Record<string, unknown>>([{ id, type: service.type }]).then(
      ([found]) => live && setObject(inspectedObject(service.type, id, found)),
      (error) => live && services.toasts.danger('Unable to find saved object', errorText(error))
    );
    return () => {
      live = false;
    };
  }, [service, id]);

  const title = (object?.attributes.title as string | undefined) ?? '';
  const viewUrl = VIEW_URLS[type]?.(id);

  const remove = async () => {
    setConfirmDelete(false);
    // The object's delete is asked for first, the clean-up of what augments it after, as the original's
    const deleted = deleteObject(type, id);
    if (type === 'visualization') void deleteAugmentVis(id);
    try {
      await deleted;
    } catch (error) {
      services.toasts.danger('Unable to delete saved objects', errorText(error));
      return;
    }
    services.toasts.success(`Deleted ${title} ${type} object`);
    navigate(LISTING);
  };

  return (
    <div className="mgtPage sobPage" data-test-subj="savedObjectsEdit">
      <div className="atlPanel sobPanel">
        <div className="sobHeader sobHeader--inspect">
          <h1 className="atlTitleL sobHeader__title">Edit {type}</h1>
          <div className="sobHeader__buttons">
            {viewUrl && (
              <Button icon="eye" to={viewUrl} testId="savedObjectEditViewInApp">
                View {type}
              </Button>
            )}
            <Button variant="dangerOutline" icon="trash" onClick={() => setConfirmDelete(true)} testId="savedObjectEditDelete">
              Delete {type}
            </Button>
          </div>
        </div>
        {!service && (
          <>
            <div className="sobSpacer--s" />
            <Callout tone="danger" icon="warning" title="There is a problem with this saved object">
              <p>{`There is no page for the saved objects of "${serviceName}".`}</p>
            </Callout>
          </>
        )}
        {notFoundType && (
          <>
            <div className="sobSpacer--s" />
            <Callout tone="danger" icon="warning" title="There is a problem with this saved object">
              <p>{NOT_FOUND_MESSAGES[notFoundType]}</p>
              <p>If you know what this error means, go ahead and fix it — otherwise click the delete button above.</p>
            </Callout>
          </>
        )}
        <div className="sobSpacer--s" />
        <Callout tone="warning" icon="warning" title="Proceed with caution!">
          <p>
            Modifying objects is for advanced users only. Object properties are not validated and invalid objects could cause errors, data loss,
            or worse. Unless someone with intimate knowledge of the code told you to be in here, you probably shouldn’t be.
          </p>
        </Callout>
        {object && service && (
          <>
            <div className="sobSpacer--m" />
            <InspectForm
              object={object}
              service={service}
              onSave={async ({ attributes, references }) => {
                await services.savedObjects.update(object.type, object.id, attributes, {
                  references: references as StoredObject['references'],
                });
                services.toasts.success(`Updated ${title} ${type} object`);
                navigate(LISTING);
              }}
            />
          </>
        )}
      </div>
      {confirmDelete && (
        // The original's confirmation: as wide as its text, its larger buttons, and the focus on itself
        <Modal
          title={`Delete '${title || 'saved OpenSearch Dashboards object'}'?`}
          onClose={() => setConfirmDelete(false)}
          className="sobModal sobConfirmModal"
          testId="confirmModal"
          footer={
            <>
              <Button variant="empty" onClick={() => setConfirmDelete(false)} testId="confirmModalCancelButton">
                Cancel
              </Button>
              <Button variant="dangerFill" onClick={() => void remove()} testId="confirmModalConfirmButton">
                Delete
              </Button>
            </>
          }
        >
          <p className="sobText">This action permanently removes the object from OpenSearch Dashboards.</p>
        </Modal>
      )}
    </div>
  );
}

interface FieldState {
  value: unknown;
  invalid: boolean;
}

function InspectForm({
  object,
  service,
  onSave,
}: {
  object: StoredObject;
  service: ObjectService;
  onSave: (form: { attributes: Record<string, unknown>; references: unknown }) => Promise<void>;
}) {
  const fields = useMemo(() => createFieldList(object, service), [object, service]);
  const [states, setStates] = useState<Record<string, FieldState>>({});
  const [submitting, setSubmitting] = useState(false);
  const valid = !Object.values(states).some((state) => state.invalid);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const edited = Object.fromEntries(Object.entries(states).map(([name, state]) => [name, state.value]));
      await onSave(savedAttributes(object.attributes, fields, edited));
    } catch (error) {
      services.toasts.danger('The object could not be saved', errorText(error));
    }
    setSubmitting(false);
  };

  return (
    <div className="sobForm" role="form" data-test-subj="savedObjectEditForm">
      {fields.map((field) => (
        <InspectField
          key={`${field.type}-${field.name}`}
          field={field}
          state={states[field.name]}
          onChange={(state) => setStates((all) => ({ ...all, [field.name]: state }))}
        />
      ))}
      <div className="sobSpacer--l" />
      <div className="sobFormButtons">
        <Button variant="primary" aria-label={`Save ${service.type} object`} onClick={() => void submit()} disabled={!valid || submitting} testId="savedObjectEditSave">
          Save {service.type} object
        </Button>
        <Button variant="empty" aria-label="Cancel" onClick={() => window.history.back()} testId="savedObjectEditCancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function InspectField({ field, state, onChange }: { field: ObjectField; state?: FieldState; onChange: (state: FieldState) => void }) {
  const value = state?.value ?? field.value;
  const testId = `savedObjects-editField-${field.name}`;
  let control;
  switch (field.type) {
    case 'number':
      control = (
        <input
          type="number"
          className="sobInput"
          id={testId}
          name={field.name}
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(event) => onChange({ value: Number(event.target.value), invalid: false })}
          data-test-subj={testId}
        />
      );
      break;
    case 'boolean':
      control = (
        <SmallSwitch name={field.name} label={value ? 'On' : 'Off'} checked={Boolean(value)} onChange={(checked) => onChange({ value: checked, invalid: false })} testId={testId} />
      );
      break;
    case 'json':
    case 'array':
      control = (
        <JsonField
          name={field.name}
          testId={testId}
          value={typeof value === 'string' ? value : ''}
          onChange={(text) => {
            let invalid = false;
            try {
              JSON.parse(text);
            } catch {
              invalid = true;
            }
            onChange({ value: text, invalid });
          }}
        />
      );
      break;
    default:
      control = (
        <input
          type="text"
          className="sobInput"
          id={testId}
          name={field.name}
          value={typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange({ value: event.target.value, invalid: false })}
          data-test-subj={testId}
        />
      );
  }
  return (
    <div className="sobFormRow sobFormRow--field">
      <label className="sobLabel" htmlFor={field.type === 'json' || field.type === 'array' || field.type === 'boolean' ? undefined : testId}>
        {field.name}
      </label>
      {control}
    </div>
  );
}

const JSON_LINE_HEIGHT = 15;

/** The runs of a field's JSON, with the classes this page colours them with */
const tokenizeField = (text: string) =>
  tokenizeFieldJson(text).map((runs) => runs.map((run) => (run.kind ? { text: run.text, kind: `Sob${run.kind}` } : run)));

/**
 * A JSON field as the original's code editor shows it: between 6 and 30 lines of 15 pixels,
 * numbered in a gutter as wide as the numbers need, the line of the cursor on a band (the last
 * line until the cursor moves), and a hint over it that the Tab key stops on: Enter goes into the
 * text, and Escape comes back out of it.
 */
function JsonField({ name, testId, value, onChange }: { name: string; testId: string; value: string; onChange: (text: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLButtonElement>(null);
  const editor = useRef<CodeEditorHandle>(null);
  // Typing in the text after the hint was used: the hint is out of the way until the text is left
  const [editing, setEditing] = useState(false);
  // The line of the cursor, or null while the selection runs over several lines
  const [cursorLine, setCursorLine] = useState<number | null>();
  const lines = value.split('\n').length;
  const activeLine = cursorLine === undefined ? lines - 1 : cursorLine === null ? -1 : Math.min(cursorLine, lines - 1);

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
      data-test-subj={testId}
      className="sobCode"
      style={{ '--sob-code-digits': String(lines).length } as CSSProperties}
      onBlur={(event) => {
        if (event.target.tagName === 'TEXTAREA') setEditing(false);
      }}
    >
      <button
        ref={hint}
        type="button"
        className={cx('sobCode__hint', editing && 'sobCode__hint--inactive')}
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
        height={Math.max(6, Math.min(30, lines)) * JSON_LINE_HEIGHT}
        tokenize={tokenizeField}
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
        ariaLabel={name}
      />
    </div>
  );
}
