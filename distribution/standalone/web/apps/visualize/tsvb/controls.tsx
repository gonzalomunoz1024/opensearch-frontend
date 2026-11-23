/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parts the TSVB editor is built of: rows of fields, yes-or-no radios, colour pickers that
 * can be cleared, colour rules, the add, clone and delete buttons of a row, the query bar of a
 * filter, the field lists and the options of an index pattern. Each changes the params as the
 * original's does, key by key, so that what is saved has the shape OpenSearch Dashboards saves.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { IconButton, cx } from '../../../components/basic';
import { ColorPicker } from '../../../components/color_picker';
import { ComboBox, type ComboOption } from '../../../components/combo_box';
import { Icon } from '../../../components/icon';
import type { IndexPattern, Query } from '../../../lib/types';
import { services } from '../../../services';
import { QueryBar, defaultQueryLanguage } from '../../../shell/query_bar';
import {
  AUTO_INTERVAL,
  collection,
  inputValue,
  list,
  str,
  uuid,
  validateInterval,
  type Doc,
  type Fields,
  type OnChange,
} from './model';

// --- Layout ---------------------------------------------------------------------------------------

export interface TabSpec {
  id: string;
  label: ReactNode;
  testId?: string;
}

/** Tabs as the editor's: a row of small pills */
export function TvbTabs({ tabs, selected, onSelect, className }: { tabs: TabSpec[]; selected: string; onSelect: (id: string) => void; className?: string }) {
  return (
    <div className={cx('tvbTabs', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="tvbTab"
          aria-selected={tab.id === selected}
          onClick={() => onSelect(tab.id)}
          data-test-subj={tab.testId}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** A panel of options under a title */
export function OptionsPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="tvbOptions">
      <h3 className="tvbOptions__title">{title}</h3>
      {children}
    </section>
  );
}

export function Rule({ size }: { size?: 's' }) {
  return <hr className={cx('tvbRule', size === 's' && 'tvbRule--s')} />;
}

export function Spacer({ size = 'l' }: { size?: 'xs' | 's' | 'm' | 'l' }) {
  return <div className={`tvbSpacer tvbSpacer--${size}`} />;
}

/**
 * Items side by side, as the original's flex group: onto more lines when they do not fit only if
 * it may `wrap`, and one under another on a narrow screen unless it is not `responsive`
 */
export function Row({
  children,
  gap = 'l',
  center,
  wrap,
  responsive = true,
  className,
  testId,
}: {
  children: ReactNode;
  gap?: 's' | 'm' | 'l';
  center?: boolean;
  wrap?: boolean;
  responsive?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cx('tvbRow', `tvbRow--${gap}`, center && 'tvbRow--center', wrap && 'tvbRow--wrap', responsive && 'tvbRow--responsive', className)}
      data-test-subj={testId}
    >
      {children}
    </div>
  );
}

/** One item of a row: it takes an equal share of the room, or only what it needs */
export function Item({ children, grow = true, className, testId }: { children?: ReactNode; grow?: boolean; className?: string; testId?: string }) {
  return (
    <div className={cx('tvbItem', !grow && 'tvbItem--fixed', className)} data-test-subj={testId}>
      {children}
    </div>
  );
}

/** A labelled field, with its help or what is wrong with it under it */
export function Field({
  label,
  help,
  error,
  full,
  children,
  className,
}: {
  label?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  full?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('tvbField', full && 'tvbField--full', className)}>
      {label !== undefined && <div className={cx('tvbLabel', Boolean(error) && 'tvbLabel--invalid')}>{label}</div>}
      {children}
      {error && <div className="tvbField__error">{error}</div>}
      {help && <div className="tvbField__help">{help}</div>}
    </div>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('tvbLabel', className)}>{children}</span>;
}

// --- Inputs ---------------------------------------------------------------------------------------

/** A text field that hands back exactly what was typed: TSVB keeps most of its numbers as text */
export function TextInput({
  value,
  onChange,
  type = 'text',
  step,
  placeholder,
  disabled,
  invalid,
  label,
  testId,
}: {
  value: unknown;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
  testId?: string;
}) {
  return (
    <input
      type={type}
      step={step}
      className={cx('atlField', 'tvbInput', invalid && 'atlField--invalid')}
      value={inputValue(value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      data-test-subj={testId}
    />
  );
}

export interface Choice {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
  /** Drawn before the label in the list, as an icon is */
  prepend?: ReactNode;
}

/** A list to pick one of: what it hands back is the value picked, or null when it was cleared */
export function Combo({
  options,
  value,
  onChange,
  placeholder,
  clearable = true,
  disabled,
  invalid,
  testId,
  fullWidth = true,
  narrow,
}: {
  options: Choice[];
  value: unknown;
  onChange: (value: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  testId?: string;
  /** False for a list in an item that takes only the room it needs */
  fullWidth?: boolean;
  /**
   * At most 400 px wide, as the component library's list that is not full width, where no field
   * row of that width holds it
   */
  narrow?: boolean;
}) {
  const selected = options.some((option) => option.value === value) ? [String(value)] : [];
  const combo = (
    <ComboBox
      options={options as ComboOption[]}
      selected={selected}
      onChange={(next) => onChange(next[0] ?? null)}
      single
      placeholder={placeholder}
      clearable={clearable}
      disabled={disabled}
      invalid={invalid}
      testId={testId}
    />
  );
  // A list that can be cleared keeps the room of its clear button while nothing is chosen too, as
  // the original's does
  const shown = clearable && !disabled ? <div className="tvbCombo--clearable">{combo}</div> : combo;
  // A list in an item that takes only the room it needs asks for no more than what it shows, and
  // fills its item when a label makes that wider, as the original's does
  if (!fullWidth) return <div className="tvbCombo--fit">{shown}</div>;
  return narrow ? <div className="tvbCombo--narrow">{shown}</div> : shown;
}

/** Yes and No as radios, saved as 1 and 0 */
export function YesNo({ name, value, onChange, disabled, testId }: { name: string; value: unknown; onChange: OnChange; disabled?: boolean; testId?: string }) {
  const group = useId();
  const yes = Boolean(value);
  return (
    <div className="tvbYesNo">
      <label className={cx('atlRadio', disabled && 'tvbYesNo--disabled')}>
        <input type="radio" name={group} value="yes" checked={yes} disabled={disabled} onChange={() => onChange({ [name]: 1 })} data-test-subj={testId && `${testId}-yes`} />
        <span>Yes</span>
      </label>
      <label className={cx('atlRadio', disabled && 'tvbYesNo--disabled')}>
        <input type="radio" name={group} value="no" checked={!yes} disabled={disabled} onChange={() => onChange({ [name]: 0 })} data-test-subj={testId && `${testId}-no`} />
        <span>No</span>
      </label>
    </div>
  );
}

// The picker shows a saved rgba() colour as its numbers: "rgba(84,179,153,1)" reads "84,179,153,1"
const shownColor = (value: unknown) => (typeof value === 'string' ? (value.includes('rgba') ? value.replace(/[^0-9,]/g, '') : value) : '');

/** A colour of the params: saved as rgba(), and cleared to null with the cross beside it */
export function TvbColorPicker({ name, value, onChange, disableTrash }: { name: string; value: unknown; onChange: OnChange; disableTrash?: boolean }) {
  const [color, setColor] = useState(() => shownColor(value));
  const saved = useRef(value);
  // A colour changed elsewhere, such as a new row taking the series' colour, shows here too
  useEffect(() => {
    if (value !== saved.current) {
      saved.current = value;
      setColor(shownColor(value));
    }
  }, [value]);
  const change = (next: unknown) => {
    saved.current = next;
    onChange({ [name]: next });
  };
  const label = value ? `Color picker (${String(value)}), not accessible` : 'Color picker, not accessible';
  return (
    <div className="tvbColorPicker" data-test-subj="tvbColorPicker">
      <ColorPicker
        color={color}
        showAlpha
        fromSwatch
        label={label}
        onChange={(text, output) => {
          setColor(text);
          change(output.hex ? `rgba(${output.rgba.join(',')})` : '');
        }}
      />
      {!disableTrash && (
        <button
          type="button"
          className="tvbColorPicker__clear"
          title="Clear"
          aria-label="Clear"
          onClick={() => {
            setColor('');
            change(null);
          }}
        >
          <Icon name="cross" />
        </button>
      )}
    </div>
  );
}

// --- Rows of a list ---------------------------------------------------------------------------------

export interface AddDeleteProps {
  testSubj?: string;
  addTooltip?: string;
  deleteTooltip?: string;
  cloneTooltip?: string;
  activatePanelTooltip?: string;
  deactivatePanelTooltip?: string;
  isPanelActive?: boolean;
  disableAdd?: boolean;
  disableDelete?: boolean;
  togglePanelActivation?: () => void;
  onClone?: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
}

/** The buttons at the end of a row: show or hide it, copy it, add one after it, delete it */
export function AddDeleteButtons({
  testSubj = 'Add',
  addTooltip = 'Add',
  deleteTooltip = 'Delete',
  cloneTooltip = 'Clone',
  activatePanelTooltip = 'Re-enable',
  deactivatePanelTooltip = 'Temporarily Disable',
  isPanelActive,
  disableAdd,
  disableDelete,
  togglePanelActivation,
  onClone,
  onAdd,
  onDelete,
}: AddDeleteProps) {
  const activeTip = isPanelActive ? deactivatePanelTooltip : activatePanelTooltip;
  return (
    <div className="tvbAddDelete">
      {isPanelActive !== undefined && (
        <IconButton
          size="s"
          className="tvbIconButton"
          icon={isPanelActive ? 'eye' : 'eyeClosed'}
          label={activeTip}
          onClick={togglePanelActivation}
          testId={`${testSubj}ActivatePanelBtn`}
        />
      )}
      {onClone && !disableAdd && <IconButton size="s" className="tvbIconButton" icon="copy" label={cloneTooltip} onClick={onClone} testId={`${testSubj}CloneBtn`} />}
      {!disableAdd && <IconButton size="s" className="tvbIconButton" icon="plusCircle" label={addTooltip} onClick={onAdd} testId={`${testSubj}AddBtn`} />}
      {!disableDelete && (
        <IconButton size="s" className="tvbIconButton tvbIconButton--danger" icon="trash" label={deleteTooltip} onClick={onDelete} testId={`${testSubj}DeleteBtn`} />
      )}
    </div>
  );
}

// --- Sorting by dragging ------------------------------------------------------------------------------

/** What the handle of a row that can be dragged takes */
export interface HandleProps {
  ref: (element: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  lifted: boolean;
}

export interface Sortable {
  /** The element of a row, measured when a drag starts */
  row: (id: string) => (element: HTMLElement | null) => void;
  /** How a row is moved while one is dragged over it */
  style: (id: string) => CSSProperties | undefined;
  dragging: (id: string) => boolean;
  handle: (id: string) => HandleProps;
}

interface DragState {
  id: string;
  from: number;
  /** Where the row would be dropped, or null while it is outside its list */
  target: number | null;
  startX: number;
  startY: number;
  startScroll: number;
  dx: number;
  dy: number;
  /** The middles of the rows when the drag started, the box of the dragged one and of the list */
  middles: number[];
  box: { top: number; left: number; width: number; height: number };
  list: { top: number; bottom: number; left: number; right: number };
  slot: number;
}

// The page scrolls by itself while a row is dragged near its top or bottom edge, as the product's
// drag and drop does: from a quarter of the window away, faster nearer the edge, at most 28 pixels
// a frame, and gently in the first second of a drag
const SCROLL_FROM = 0.25;
const SCROLL_MAX = 28;
const SCROLL_DAMPEN_MS = 1200;

function scrollStep(clientY: number, elapsed: number) {
  const height = window.innerHeight;
  const zone = height * SCROLL_FROM;
  const toBottom = height - clientY;
  const distance = Math.min(clientY, toBottom);
  if (distance >= zone) return 0;
  const strength = ((zone - Math.max(distance, 0)) / zone) ** 2;
  const dampen = Math.min(1, elapsed / SCROLL_DAMPEN_MS);
  const step = Math.max(1, Math.round(SCROLL_MAX * strength * dampen));
  return clientY < toBottom ? -step : step;
}

/** Where a row dragged by (dx, dy) would be dropped: null while its middle is outside its list */
function dropTarget(state: DragState, dx: number, dy: number): number | null {
  const { from, middles, box, list } = state;
  const centerX = box.left + box.width / 2 + dx;
  const centerY = box.top + box.height / 2 + dy;
  if (centerX < list.left || centerX > list.right || centerY < list.top || centerY > list.bottom) return null;
  const top = box.top + dy;
  const bottom = top + box.height;
  // A row below makes way once the dragged row's bottom edge passes its middle, a row above once
  // the dragged row's top edge does
  let target = from;
  middles.forEach((middle, index) => {
    if (index > from && bottom > middle) target = Math.max(target, index);
  });
  if (target === from) {
    middles.forEach((middle, index) => {
      if (index < from && top < middle) target = Math.min(target, index);
    });
  }
  return target;
}

/**
 * Rows sorted by dragging their handle, as the product's lists are: the dragged row follows the
 * pointer, the others make room for it, and it is dropped where it is let go. From the keyboard,
 * Space lifts the row of the focused handle, the arrows move it and Space or Escape drops it.
 */
export function useSortable(ids: string[], onMove: (from: number, to: number) => void): Sortable {
  const rows = useRef(new Map<string, HTMLElement>());
  const handles = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const latest = useRef({ ids, onMove, drag });
  latest.current = { ids, onMove, drag };
  const refocus = useRef<string | null>(null);

  // A row moved from the keyboard keeps the focus on its handle
  useLayoutEffect(() => {
    if (!refocus.current) return;
    handles.current.get(refocus.current)?.focus();
    refocus.current = null;
  });

  const dragId = drag?.id;
  useEffect(() => {
    if (!dragId) return undefined;
    const began = performance.now();
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    const update = () =>
      setDrag((current) => {
        if (!current || !pointer) return current;
        const dx = pointer.x - current.startX;
        const dy = pointer.y - current.startY + (window.scrollY - current.startScroll);
        return { ...current, dx, dy, target: dropTarget(current, dx, dy) };
      });
    const tick = () => {
      if (pointer) {
        const step = scrollStep(pointer.y, performance.now() - began);
        if (step) {
          const before = window.scrollY;
          window.scrollBy(0, step);
          if (window.scrollY !== before) update();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      update();
    };
    const up = () => {
      const current = latest.current.drag;
      setDrag(null);
      if (current && current.target !== null && current.target !== current.from) latest.current.onMove(current.from, current.target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragId]);

  const begin = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const order = latest.current.ids;
    const boxes = order.map((rowId) => rows.current.get(rowId)?.getBoundingClientRect());
    const from = order.indexOf(id);
    const box = boxes[from];
    const holder = rows.current.get(id)?.parentElement?.getBoundingClientRect();
    if (!box || !holder || boxes.some((item) => !item)) return;
    event.preventDefault();
    const measured = boxes as DOMRect[];
    const next = measured[from + 1];
    const previous = measured[from - 1];
    const gap = next ? next.top - box.bottom : previous ? box.top - previous.bottom : 0;
    setDrag({
      id,
      from,
      target: from,
      startX: event.clientX,
      startY: event.clientY,
      startScroll: window.scrollY,
      dx: 0,
      dy: 0,
      middles: measured.map((item) => item.top + item.height / 2),
      box: { top: box.top, left: box.left, width: box.width, height: box.height },
      list: { top: holder.top, bottom: holder.bottom, left: holder.left, right: holder.right },
      slot: box.height + gap,
    });
  };

  const key = (id: string, event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setLifted((current) => (current === id ? null : id));
      return;
    }
    if (event.key === 'Escape') {
      setLifted(null);
      return;
    }
    if (lifted !== id || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const order = latest.current.ids;
    const from = order.indexOf(id);
    const to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= order.length) return;
    refocus.current = id;
    latest.current.onMove(from, to);
  };

  return {
    row: (id) => (element) => {
      if (element) rows.current.set(id, element);
      else rows.current.delete(id);
    },
    style: (id) => {
      if (!drag) return undefined;
      const index = ids.indexOf(id);
      if (id === drag.id) return { transform: `translate(${drag.dx}px, ${drag.dy}px)`, position: 'relative', zIndex: 2 };
      const { from, target, slot } = drag;
      let shift = 0;
      if (target !== null && from < target && index > from && index <= target) shift = -slot;
      if (target !== null && target < from && index >= target && index < from) shift = slot;
      return { transform: shift ? `translateY(${shift}px)` : undefined, transition: 'transform 0.2s ease' };
    },
    dragging: (id) => drag?.id === id || lifted === id,
    handle: (id) => ({
      ref: (element) => {
        if (element) handles.current.set(id, element);
        else handles.current.delete(id);
      },
      onPointerDown: (event) => begin(id, event),
      onKeyDown: (event) => key(id, event),
      // Moving a row takes the focus away for a moment; only a move elsewhere drops it
      onBlur: (event) => {
        if (event.relatedTarget) setLifted((current) => (current === id ? null : current));
      },
      lifted: lifted === id,
    }),
  };
}

/** The grip a row is dragged by; the place stays, empty, while the row cannot be sorted */
export function DragHandle({ handle, hidden }: { handle?: HandleProps; hidden: boolean }) {
  if (hidden || !handle) return <div className="tvbDragHandle" />;
  const { lifted, ...props } = handle;
  return (
    <div className="tvbDragHandle">
      <div
        {...props}
        role="button"
        tabIndex={0}
        className={cx('tvbDragHandle__grip', lifted && 'tvbDragHandle__grip--lifted')}
        aria-label="Drag to sort"
        aria-pressed={lifted}
        title="Drag to sort"
      >
        <Icon name="grab" />
      </div>
    </div>
  );
}

// --- Colour rules -------------------------------------------------------------------------------------

const OPERATORS: Choice[] = [
  { label: '> greater than', value: 'gt' },
  { label: '>= greater than or equal', value: 'gte' },
  { label: '< less than', value: 'lt' },
  { label: '<= less than or equal', value: 'lte' },
];

/**
 * The rules that colour a panel by its value: "Set background to [colour] and text to [colour]
 * if metric is [operator] [value]". A rule's value is a number, 0 to start with.
 */
export function ColorRules({
  model,
  onChange,
  name = 'color_rules',
  primaryName = 'background',
  primaryVarName = 'background_color',
  secondaryName = 'text',
  secondaryVarName = 'color',
  hideSecondary,
}: {
  model: Doc;
  onChange: OnChange;
  name?: string;
  primaryName?: string;
  primaryVarName?: string;
  secondaryName?: string;
  secondaryVarName?: string;
  hideSecondary?: boolean;
}) {
  const rules = list<Doc & { id: string }>(model, name);
  if (!Array.isArray(model[name])) return <div />;
  const save = (next: Array<Doc & { id: string }>) => onChange({ ...model, [name]: next });
  return (
    <div>
      {rules.map((row) => {
        const rule: Doc & { id: string } = { value: 0, ...row };
        const change = (part: Doc) => save(collection.change(rules, { ...rule, ...part }));
        return (
          <Row key={rule.id} gap="s" center wrap responsive={false} className="tvbColorRules__rule">
            <Item grow={false}>
              <Label>Set {primaryName} to</Label>
            </Item>
            <Item grow={false}>
              <TvbColorPicker name={primaryVarName} value={rule[primaryVarName]} onChange={change} />
            </Item>
            {!hideSecondary && (
              <>
                <Item grow={false}>
                  <Label>and {secondaryName} to</Label>
                </Item>
                <Item grow={false}>
                  <TvbColorPicker name={secondaryVarName} value={rule[secondaryVarName]} onChange={change} />
                </Item>
              </>
            )}
            <Item grow={false}>
              <Label>if metric is</Label>
            </Item>
            <Item>
              <Combo options={OPERATORS} value={rule.operator} onChange={(operator) => change({ operator: operator ?? undefined })} testId="colorRuleOperator" />
            </Item>
            <Item>
              <TextInput
                type="number"
                label="Value"
                value={rule.value}
                onChange={(text) => {
                  const value = Number(text);
                  change({ value: Number.isNaN(value) ? undefined : value });
                }}
                testId="colorRuleValue"
              />
            </Item>
            <Item grow={false}>
              <AddDeleteButtons
                onAdd={() => save(collection.add(rules, { id: uuid() }))}
                onDelete={() => save(collection.remove(rules, rule))}
                disableDelete={rules.length < 2}
              />
            </Item>
          </Row>
        );
      })}
    </div>
  );
}

// --- Filters --------------------------------------------------------------------------------------------

/** The index patterns saved under the titles a panel names, for what the query bar suggests */
function usePatterns(titles: string[]): IndexPattern[] {
  const [patterns, setPatterns] = useState<IndexPattern[]>([]);
  const key = titles.join('\n');
  useEffect(() => {
    let live = true;
    const wanted = key.split('\n').filter(Boolean);
    services.indexPatterns
      .list()
      .then((all) => Promise.all(all.filter((pattern) => wanted.includes(pattern.title)).map((pattern) => services.indexPatterns.get(pattern.id))))
      .then((found) => live && setPatterns(found))
      .catch(() => live && setPatterns([]));
    return () => {
      live = false;
    };
  }, [key]);
  return patterns;
}

/** A query of the params, `{ query, language }`, changed as it is typed */
export function QueryBarWrapper({ query, onChange, indexPatterns }: { query: Query; onChange: (query: Query) => void; indexPatterns: string[] }) {
  const patterns = usePatterns(indexPatterns);
  const text = typeof query.query === 'string' ? query.query : '';
  return (
    <div className="tvbQueryBar">
      <QueryBar
        appName="VisEditor"
        value={text}
        language={query.language}
        onChange={(next) => onChange({ query: next, language: query.language })}
        onSubmit={(next) => onChange({ query: next, language: query.language })}
        // Another language starts the query over, as the product's query bar does
        onLanguageChange={(language) => onChange({ query: '', language })}
        indexPatterns={patterns}
        // The original's query field takes the focus when it appears (and the page scrolls to it),
        // as TSVB does not turn that off
        autoFocus
      />
    </div>
  );
}

/** A query saved in the params, read with the language the product starts with */
export function readQuery(value: unknown): Query {
  const query = value && typeof value === 'object' ? (value as Doc) : {};
  const language = typeof query.language === 'string' && query.language ? query.language : defaultQueryLanguage();
  return { language, query: typeof query.query === 'string' ? query.query : '' };
}

// --- Fields -----------------------------------------------------------------------------------------------

/**
 * The fields of an index pattern to pick one from, grouped by their kind. A field that is not
 * among them, such as one of another pattern, is taken out of the params, as the original does.
 */
export function FieldSelect({
  fields,
  indexPattern = '*',
  value,
  onChange,
  type,
  restrict = [],
  placeholder = 'Select field...',
  disabled,
  clearable = true,
  testId,
}: {
  fields: Fields;
  indexPattern?: string;
  value: unknown;
  onChange: (value: string | null) => void;
  type?: string;
  restrict?: string[];
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  testId?: string;
}) {
  const kinds = restrict.join(',');
  const options = useMemo(() => {
    const allowed = kinds ? kinds.split(',') : [];
    const groups = new Map<string, Choice[]>();
    for (const field of fields[indexPattern] ?? []) {
      if (allowed.length && !allowed.includes(field.type)) continue;
      const group = groups.get(field.type) ?? [];
      group.push({ value: field.name, label: field.name, group: field.type });
      groups.set(field.type, group);
    }
    return [...groups.values()].flat();
  }, [fields, indexPattern, kinds]);
  const missing = type !== 'count' && Boolean(value) && !options.some((option) => option.value === value);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (missing) latest.current(null);
  }, [missing]);
  if (type === 'count') return null;
  return (
    <Combo options={options} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} clearable={clearable} testId={testId} />
  );
}

// --- Index pattern ------------------------------------------------------------------------------------------

const TIME_RANGE_OPTIONS: Choice[] = [
  { label: 'Last value', value: 'last_value' },
  { label: 'Entire time range', value: 'entire_time_range' },
];

const DATE_FIELDS = ['date'];

/**
 * Where a panel's data comes from: the time range it matches, the index pattern, its time field,
 * the interval of its buckets and whether the last bucket is left out. A series that overrides
 * the panel's index pattern has the same options with the prefix `series_`.
 */
export function IndexPatternOptions({
  fields,
  prefix = '',
  onChange,
  disabled,
  model: given,
}: {
  fields: Fields;
  prefix?: string;
  onChange: OnChange;
  disabled?: boolean;
  model: Doc;
}) {
  const timeFieldName = `${prefix}time_field`;
  const indexPatternName = `${prefix}index_pattern`;
  const intervalName = `${prefix}interval`;
  const dropBucketName = `${prefix}drop_last_bucket`;
  const model: Doc = {
    default_index_pattern: '',
    [indexPatternName]: '*',
    [intervalName]: AUTO_INTERVAL,
    [dropBucketName]: 1,
    time_range_mode: 'last_value',
    ...given,
  };
  const isTimeSeries = model.type === 'timeseries';
  const entireTimeRange = !isTimeSeries && model.time_range_mode === 'entire_time_range';
  const defaultUsed = Boolean(model.default_index_pattern) && !model[indexPatternName];
  const validation = validateInterval(model[intervalName]);
  return (
    <div className="index-pattern">
      {!isTimeSeries && (
        <Row>
          <Item>
            <Field label="Data timerange mode">
              <Combo
                options={TIME_RANGE_OPTIONS}
                value={model.time_range_mode}
                onChange={(mode) => onChange({ time_range_mode: mode })}
                placeholder="Select"
                clearable={false}
                disabled={disabled}
              />
            </Field>
            <p className="tvbText tvbText--xs">
              This setting controls the timespan used for matching documents. &quot;Entire timerange&quot; will match all the documents
              selected in the timepicker. &quot;Last value&quot; will match only the documents for the specified interval from the end of
              the timerange.
            </p>
          </Item>
        </Row>
      )}
      <Row>
        <Item>
          <Field
            label="Index name"
            help={
              defaultUsed
                ? 'Default index pattern is used. To query all indexes use *'
                : 'Use an asterisk (*) to match multiple indices. Spaces and the characters , /, ?, ", <, >, | are not allowed.'
            }
          >
            <TextInput
              value={model[indexPatternName]}
              onChange={(text) => onChange({ [indexPatternName]: text })}
              placeholder={str(model, 'default_index_pattern')}
              disabled={disabled}
              label="Index name"
              testId="metricsIndexPatternInput"
            />
          </Field>
        </Item>
        <Item>
          <Field label="Time field">
            <FieldSelect
              fields={fields}
              restrict={DATE_FIELDS}
              value={model[timeFieldName]}
              disabled={disabled}
              onChange={(field) => onChange({ [timeFieldName]: field })}
              indexPattern={str(model, indexPatternName)}
              placeholder={defaultUsed ? str(model, 'default_timefield') : undefined}
              testId="metricsIndexPatternFieldsSelect"
            />
          </Field>
        </Item>
        <Item grow={false}>
          <Field label="Interval" help="Examples: auto, 1m, 1d, 7d, 1y, >=1m" error={validation.valid ? undefined : validation.message}>
            <TextInput
              value={model[intervalName]}
              onChange={(text) => onChange({ [intervalName]: text })}
              placeholder={AUTO_INTERVAL}
              disabled={disabled || entireTimeRange}
              invalid={!validation.valid}
              label="Interval"
              testId="metricsIndexPatternInterval"
            />
          </Field>
        </Item>
        <Item grow={false}>
          <Field label="Drop last bucket?">
            <YesNo name={dropBucketName} value={model[dropBucketName]} onChange={onChange} disabled={disabled || entireTimeRange} testId="metricsDropLastBucket" />
          </Field>
        </Item>
      </Row>
    </div>
  );
}

/** The panel filter and whether the page's filters are ignored: the last row of a panel's data options */
export function PanelFilter({ model, onChange }: { model: Doc; onChange: OnChange }) {
  return (
    <Row wrap responsive={false}>
      <Item>
        <Field label="Panel filter" full>
          <QueryBarWrapper
            query={readQuery(model.filter)}
            onChange={(filter) => onChange({ filter })}
            indexPatterns={[str(model, 'index_pattern') || str(model, 'default_index_pattern')]}
          />
        </Field>
      </Item>
      <Item grow={false}>
        <Label>Ignore global filter?</Label>
        <Spacer size="m" />
        <YesNo name="ignore_global_filter" value={model.ignore_global_filter} onChange={onChange} />
      </Item>
    </Row>
  );
}

/** "This supports mustache templating. {{key}} is set to the term." */
export const KEY_HELP = (
  <>
    This supports mustache templating.{' '}
    <span className="tvbCode">
      <code>{'{{key}}'}</code>
    </span>{' '}
    is set to the term.
  </>
);
