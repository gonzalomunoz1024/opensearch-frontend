/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The left of VisBuilder under its index pattern: the fields at the left, to drag onto the chart
 * or to click for the values they take most often, and at the right the parts of the chart
 * (Y-axis, X-axis, Split series…), each with the aggregations it holds. A click on an
 * aggregation, or on the button of "Click or drop to add", slides in the panel that edits it,
 * where a valid change is kept a moment after it is made, as in OpenSearch Dashboards.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { FieldToken, IconButton, cx } from '../../components/basic';
import { SearchField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Portal } from '../../components/overlay';
import { aggLabel, type AggConfig, type AggContext } from '../../lib/aggs';
import type { RawHit } from '../../lib/docs';
import { fieldFormatter } from '../../lib/field_formats';
import { existsFilter, phraseFilter } from '../../lib/query';
import type { Field, Filter, IndexPattern } from '../../lib/types';
import { services } from '../../services';
import { defaultQueryLanguage } from '../../shell/query_bar';
import { AggEditor } from '../visualize/agg_editor';
import { aggProblem } from '../visualize/defaults';
import {
  aggregationsProblem,
  availableFields,
  droppedAggs,
  fieldCategory,
  fieldDetails,
  newDraft,
  schemaAggTypes,
  withAggs,
  withDraft,
  withEditorError,
  withSavedDraft,
  type AppState,
  type DragItem,
  type DropPlace,
  type FieldCategory,
} from './editor_state';
import { visBuilderType, type VisBuilderSchema } from './model';

const META_FIELDS = ['_source', '_id', '_type', '_index', '_score'];

/** The key the panel that edits an aggregation keeps its validity under, as there */
const PANEL_KEY = 'SECONDARY_PANEL';

const GROUPS: Array<{ id: FieldCategory; title: string; testId: string }> = [
  { id: 'categorical', title: 'Categorical Fields', testId: 'categoricalFields' },
  { id: 'numerical', title: 'Numerical Fields', testId: 'numericalFields' },
  { id: 'meta', title: 'Meta Fields', testId: 'metaFields' },
];

// The kinds of field a filter can be made on
const FILTERABLE_TYPES = ['string', 'number', 'date', 'ip', 'boolean', 'histogram'];
const filterable = (field: Field) =>
  field.name === '_id' || Boolean(field.scripted) || (field.searchable && FILTERABLE_TYPES.includes(field.type));

/** A name that may break after each dot: a long field name wraps where it reads well */
const wrapOnDot = (name: string) => name.replace(/\./g, '.​');

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export interface DataTabProps {
  state: AppState;
  update: (change: (state: AppState) => AppState) => void;
  indexPattern?: IndexPattern;
  context: AggContext;
  /** The documents the values of a field are counted in */
  hits: RawHit[];
  onAddFilters: (filters: Filter[]) => void;
}

/** Where something can be dropped: on a part of the chart, its button to add, or one of its aggregations */
type DropKind = 'list' | 'add' | 'item';

interface DragAndDrop {
  dragging?: DragItem;
  over?: string;
  source: (item: DragItem, text: string) => {
    draggable: true;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  };
  target: (
    key: string,
    place: DropPlace,
    kind: DropKind
  ) => {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}

export function DataTab({ state, update, indexPattern, context, hits, onAddFilters }: DataTabProps) {
  const [dragging, setDragging] = useState<DragItem>();
  const [over, setOver] = useState<string>();
  const active = state.visualization.activeVisualization;
  const aggs = useMemo(() => active?.aggConfigParams ?? [], [active]);

  const endDrag = useCallback(() => {
    setDragging(undefined);
    setOver(undefined);
  }, []);

  const drop = (item: DragItem, place: DropPlace, kind: DropKind) => {
    // As there, nothing is dropped on the split of the chart while its aggregations are in error
    if (place.schema.name === 'split' && kind !== 'add') {
      const problem = aggregationsProblem(aggs);
      if (problem) {
        services.toasts.warning('vb_invalid_schema', problem);
        return;
      }
    }
    const language = defaultQueryLanguage();
    update((current) => {
      const next = droppedAggs(current.visualization.activeVisualization?.aggConfigParams ?? [], item, place, indexPattern, language);
      return next ? withAggs(current, next) : current;
    });
  };

  const dnd: DragAndDrop = {
    dragging,
    over,
    source: (item, text) => ({
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.setData('text/plain', text);
        event.dataTransfer.effectAllowed = 'copyMove';
        // The parts of the chart are tinted once the browser has taken its picture of what is dragged
        window.setTimeout(() => setDragging(item), 0);
      },
      onDragEnd: endDrag,
    }),
    target: (key, place, kind) => ({
      onDragOver: (event) => {
        if (!dragging) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setOver(key);
      },
      onDragLeave: (event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver((current) => (current === key ? undefined : current));
      },
      onDrop: (event) => {
        if (!dragging) return;
        event.preventDefault();
        event.stopPropagation();
        const item = dragging;
        endDrag();
        drop(item, place, kind);
      },
    }),
  };

  return (
    <div className="vbdData">
      <FieldSelector state={state} update={update} indexPattern={indexPattern} hits={hits} dnd={dnd} onAddFilters={onAddFilters} />
      <ConfigPanel state={state} update={update} indexPattern={indexPattern} context={context} aggs={aggs} dnd={dnd} />
    </div>
  );
}

// --- The fields ---------------------------------------------------------------------------------

function FieldSelector({
  state,
  update,
  indexPattern,
  hits,
  dnd,
  onAddFilters,
}: Pick<DataTabProps, 'state' | 'update' | 'indexPattern' | 'hits' | 'onAddFilters'> & { dnd: DragAndDrop }) {
  const search = state.visualization.searchField;
  const metaFields = services.uiSettings.get<string[]>('metaFields', META_FIELDS);
  const groups = useMemo(() => {
    const result: Record<FieldCategory, Field[]> = { categorical: [], numerical: [], meta: [] };
    const wanted = search.toLowerCase();
    for (const field of availableFields(indexPattern)) {
      if (field.name.toLowerCase().includes(wanted)) result[fieldCategory(field, metaFields)].push(field);
    }
    return result;
  }, [indexPattern, search, metaFields]);

  return (
    <div className="vbdFields">
      <form onSubmit={(event) => event.preventDefault()}>
        <SearchField
          value={search}
          placeholder="Search field names"
          aria-label="Search field names"
          onChange={(searchField) => update((current) => ({ ...current, visualization: { ...current.visualization, searchField } }))}
          testId="fieldFilterSearchInput"
        />
      </form>
      <div className="vbdFields__groups">
        <div className="vbdFields__group">
          <FieldButton
            name="count"
            label="Count"
            type="number"
            testId="field-undefined-showDetails"
            drag={dnd.source({ kind: 'field', source: { count: true } }, 'count')}
          />
        </div>
        {GROUPS.map((group) => (
          <FieldGroup key={group.id} title={group.title} count={groups[group.id].length} testId={group.testId}>
            {groups[group.id].map((field) => (
              <FieldWithDetails
                key={field.name}
                field={field}
                indexPattern={indexPattern}
                hits={hits}
                metaFields={metaFields}
                dnd={dnd}
                onAddFilters={onAddFilters}
              />
            ))}
          </FieldGroup>
        ))}
      </div>
    </div>
  );
}

function FieldGroup({ title, count, testId, children }: { title: string; count: number; testId: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="vbdFieldGroup" data-test-subj={testId}>
      <div className="vbdFieldGroup__head">
        <button type="button" className="vbdFieldGroup__toggle" aria-expanded={open} aria-label="Expand Elements" onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} />
          <span className="vbdFieldGroup__title">{title}</span>
        </button>
        <span className="vbdFieldGroup__badge">{count}</span>
      </div>
      {open && <div className="vbdFieldGroup__fields">{children}</div>}
    </div>
  );
}

function FieldButton({
  name,
  label,
  type,
  testId,
  active,
  onClick,
  drag,
}: {
  name: string;
  label: string;
  type: string;
  testId: string;
  active?: boolean;
  onClick?: () => void;
  drag: ReturnType<DragAndDrop['source']>;
}) {
  return (
    <button type="button" className={cx('vbdField', active && 'vbdField--active')} onClick={onClick} data-test-subj={testId} {...drag}>
      <span className="vbdField__token">
        <FieldToken type={type} />
      </span>
      <span className="vbdField__name" title={name} data-test-subj={`field-${name}`}>
        {wrapOnDot(label)}
      </span>
    </button>
  );
}

function FieldWithDetails({
  field,
  indexPattern,
  hits,
  metaFields,
  dnd,
  onAddFilters,
}: {
  field: Field;
  indexPattern?: IndexPattern;
  hits: RawHit[];
  metaFields: string[];
  dnd: DragAndDrop;
  onAddFilters: (filters: Filter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div ref={anchor} className="vbdFields__item">
      <FieldButton
        name={field.name}
        label={field.name}
        type={field.type}
        testId={`field-${field.name}-showDetails`}
        active={open}
        onClick={() => setOpen(!open)}
        drag={dnd.source({ kind: 'field', source: { count: false, field } }, field.name)}
      />
      {open && indexPattern && (
        <SidePopover anchor={anchor} onClose={close}>
          <FieldDetailsView field={field} indexPattern={indexPattern} hits={hits} metaFields={metaFields} onAddFilters={onAddFilters} />
        </SidePopover>
      )}
    </div>
  );
}

/** A popover at the right of a field, its top level with the field's, that stays on screen */
function SidePopover({ anchor, onClose, children }: { anchor: RefObject<HTMLElement>; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      const height = panel.current?.offsetHeight ?? 0;
      if (!box) return;
      const margin = 8;
      const top = Math.max(margin, Math.min(box.top - 6, window.innerHeight - height - margin));
      setStyle({ left: box.right + margin, top });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || panel.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  return (
    <Portal>
      <div ref={panel} className="atlPopover atlMaterial vbdFieldPopover" style={style} data-test-subj="field-popover">
        {children}
      </div>
    </Portal>
  );
}

function FieldDetailsView({
  field,
  indexPattern,
  hits,
  metaFields,
  onAddFilters,
}: {
  field: Field;
  indexPattern: IndexPattern;
  hits: RawHit[];
  metaFields: string[];
  onAddFilters: (filters: Filter[]) => void;
}) {
  const details = useMemo(() => fieldDetails(hits, field, indexPattern), [hits, field, indexPattern]);
  const format = fieldFormatter(indexPattern, field.name, services.formatSettings());
  const title = details.error ? 'No values found' : details.buckets.length > 1 ? `Top ${details.buckets.length} values` : 'Top value';
  const existsFilterAllowed = !metaFields.includes(field.name) && !field.scripted;

  // A filter for a value is pinned when the settings say new filters are
  const pinned = (filter: Filter): Filter =>
    services.uiSettings.get('filters:pinnedByDefault', false) ? { ...filter, $state: { store: 'globalState' } } : filter;
  const filterValue = (value: unknown, negate: boolean) => {
    const filter = phraseFilter(field, value, indexPattern.id);
    filter.meta.negate = negate;
    onAddFilters([pinned(filter)]);
  };

  return (
    <>
      <div className="vbdFieldPopover__title" tabIndex={0}>
        {title}
      </div>
      <div className="vbdFieldDetails" data-test-subj="fieldDetailsContainer">
        {details.error ? (
          <p className="atlSmall" data-test-subj="fieldDetailsError">
            {details.error}
          </p>
        ) : (
          <div data-test-subj="fieldDetailsBucketsContainer">
            {details.buckets.map((bucket, index) => {
              const text = format(bucket.value).text;
              const shown = text === '' ? 'Empty string' : text;
              const percent = bucket.percent.toFixed(1);
              return (
                <div className="vbdBucket" key={`bucket${index}`}>
                  <div className="vbdBucket__value">
                    <div className="vbdBucket__text">
                      <span className="atlTruncate" title={`${shown}: ${bucket.count} (${percent}%)`}>
                        {shown}
                      </span>
                      <span className="vbdBucket__percent">{percent}%</span>
                    </div>
                    <div className="vbdBucket__bar" role="progressbar" aria-valuenow={bucket.percent} aria-valuemin={0} aria-valuemax={100}>
                      <span style={{ width: `${bucket.percent}%` }} />
                    </div>
                  </div>
                  {filterable(field) && (
                    <div className="vbdBucket__actions">
                      <IconButton
                        icon="plusCircle"
                        size="s"
                        label={`Filter for ${field.name}: "${String(bucket.value)}"`}
                        title="Filter for value"
                        onClick={() => filterValue(bucket.value, false)}
                        testId={`plus-${field.name}-${String(bucket.value)}`}
                      />
                      <IconButton
                        icon="minusCircle"
                        size="s"
                        label={`Filter out ${field.name}: "${String(bucket.value)}"`}
                        title="Filter out value"
                        onClick={() => filterValue(bucket.value, true)}
                        testId={`minus-${field.name}-${String(bucket.value)}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!details.error && (
        <div className="vbdFieldPopover__footer">
          {existsFilterAllowed ? (
            <button
              type="button"
              className="atlLinkButton"
              onClick={() => onAddFilters([pinned(existsFilter(field, indexPattern.id))])}
              data-test-subj="fieldDetailsExistsLink"
            >
              Exists in {details.exists}
            </button>
          ) : (
            details.exists
          )}{' '}
          / {details.total} records
        </div>
      )}
    </>
  );
}

// --- The parts of the chart ---------------------------------------------------------------------

function ConfigPanel({
  state,
  update,
  indexPattern,
  context,
  aggs,
  dnd,
}: Pick<DataTabProps, 'state' | 'update' | 'indexPattern' | 'context'> & { aggs: AggConfig[]; dnd: DragAndDrop }) {
  const active = state.visualization.activeVisualization;
  const schemas = visBuilderType(active?.name ?? '')?.schemas ?? [];
  const editing = Boolean(active?.draftAgg);
  return (
    <div className={cx('vbdConfig', editing && 'vbdConfig--secondary')}>
      <div className="vbdConfig__section" aria-hidden={editing}>
        <div className="vbdConfig__title">
          <h2>Configuration</h2>
        </div>
        <div className="vbdConfig__content">
          {schemas.map((schema) => (
            <Dropbox
              key={schema.name}
              schema={schema}
              aggs={aggs}
              context={context}
              dnd={dnd}
              onAdd={() => update((current) => withDraft(current, newDraft(current.visualization.activeVisualization?.aggConfigParams ?? [], schema)))}
              onEdit={(agg) => update((current) => withDraft(current, agg))}
              onDelete={(id) =>
                update((current) =>
                  withAggs(
                    current,
                    (current.visualization.activeVisualization?.aggConfigParams ?? []).filter((agg) => agg.id !== id)
                  )
                )
              }
            />
          ))}
        </div>
      </div>
      <div className="vbdConfig__section vbdConfig__section--secondary" aria-hidden={!editing}>
        <SecondaryPanel state={state} update={update} indexPattern={indexPattern} context={context} aggs={aggs} />
      </div>
    </div>
  );
}

function Dropbox({
  schema,
  aggs,
  context,
  dnd,
  onAdd,
  onEdit,
  onDelete,
}: {
  schema: VisBuilderSchema;
  aggs: AggConfig[];
  context: AggContext;
  dnd: DragAndDrop;
  onAdd: () => void;
  onEdit: (agg: AggConfig) => void;
  onDelete: (id: string) => void;
}) {
  const [closing, setClosing] = useState<string>();
  const items = aggs.filter((agg) => agg.schema === schema.name);
  const room = items.length < (schema.max ?? Infinity);
  const remove = (id: string) => {
    setClosing(id);
    // The aggregation folds away first
    window.setTimeout(
      () => {
        onDelete(id);
        setClosing(undefined);
      },
      reducedMotion() ? 0 : 350
    );
  };
  const targetClass = (key: string) =>
    cx('vbdDropbox__field', 'vbdDropbox__target', dnd.dragging && 'vbdDropbox__target--valid', dnd.over === key && 'vbdDropbox__target--over');

  return (
    <div className="vbdDropbox">
      <div className="vbdDropbox__label">{schema.title}</div>
      <div className="vbdDropbox__container" {...dnd.target(`${schema.name}:list`, { schema }, 'list')}>
        {items.length > 0 && (
          <div className="vbdDropbox__items">
            {items.map((agg, index) => {
              const key = `${schema.name}:${agg.id}`;
              const label = aggLabel(agg, context);
              return (
                <div
                  key={agg.id}
                  className={cx('vbdDropbox__draggable', closing === agg.id && 'vbdDropbox__draggable--closing')}
                  {...dnd.source({ kind: 'agg', id: agg.id }, label)}
                >
                  <div
                    className={targetClass(key)}
                    data-test-subj={`dropBoxField-${schema.name}-${index}`}
                    {...dnd.target(key, { schema, aggId: agg.id }, 'item')}
                  >
                    <button type="button" className="atlLinkButton vbdDropbox__text" onClick={() => onEdit(agg)}>
                      {label}
                    </button>
                    <IconButton icon="cross" size="s" label={`Remove ${label}`} onClick={() => remove(agg.id)} testId="dropBoxRemoveBtn" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {room && (
          <div
            className={targetClass(`${schema.name}:add`)}
            data-test-subj={`dropBoxAddField-${schema.name}`}
            {...dnd.target(`${schema.name}:add`, { schema }, 'add')}
          >
            <span className="vbdDropbox__hint">Click or drop to add</span>
            <IconButton icon="plusCircle" size="s" label={`Add to ${schema.title}`} onClick={onAdd} testId="dropBoxAddBtn" />
          </div>
        )}
      </div>
    </div>
  );
}

/** The panel that edits one aggregation, over the parts of the chart */
function SecondaryPanel({
  state,
  update,
  indexPattern,
  context,
  aggs,
}: Pick<DataTabProps, 'state' | 'update' | 'indexPattern' | 'context'> & { aggs: AggConfig[] }) {
  const active = state.visualization.activeVisualization;
  const draft = active?.draftAgg;
  const schema = visBuilderType(active?.name ?? '')?.schemas.find((candidate) => candidate.name === draft?.schema);
  // Once a change could not be kept, what is wrong is shown
  const [touched, setTouched] = useState(false);
  const valid = draft ? !aggProblem(draft, indexPattern) : true;
  const draftKey = draft ? JSON.stringify(draft) : '';
  const editing = Boolean(draft);

  // Whether the aggregation being edited is valid is part of the page's state, as there
  useEffect(() => {
    if (!editing) return;
    update((current) =>
      current.metadata.editor.errors?.[PANEL_KEY] === !valid ? current : withEditorError(current, PANEL_KEY, !valid)
    );
  }, [editing, valid, update]);

  // A valid change is kept a moment after it is made
  useEffect(() => {
    if (!editing) return undefined;
    const timer = window.setTimeout(() => {
      if (valid) update(withSavedDraft);
      else setTouched(true);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [draftKey, editing, valid, update]);

  return (
    <>
      <div className="vbdConfig__title vbdConfig__title--secondary">
        <button type="button" className="vbdConfig__back" aria-label="Close" onClick={() => update((current) => withDraft(current, undefined))} data-test-subj="panelCloseBtn">
          <Icon name="chevronLeft" />
        </button>
        <h2>{schema?.title ?? 'Edit'}</h2>
      </div>
      {draft && indexPattern && (
        <div className="vbdConfig__editor">
          <AggEditor
            agg={draft}
            types={schema ? schemaAggTypes(schema) : []}
            indexPattern={indexPattern}
            aggs={aggs}
            context={context}
            onChange={(next) => update((current) => withDraft(current, next))}
            showProblems={touched}
          />
        </div>
      )}
    </>
  );
}
