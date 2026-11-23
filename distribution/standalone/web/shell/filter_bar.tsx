/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The filters under the query, as the filter bar of OpenSearch Dashboards (its data plugin's
 * filter_bar): a menu that changes all of them, a pill for each, with a menu that pins, edits,
 * inverts, switches off or deletes it, and "Add filter". A pill says what its filter asks, written
 * with the field's format, or why it cannot: a field the index pattern lacks, a pattern that is
 * gone. A filter that cannot be read is switched off, as the original switches it off.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cx } from '../components/basic';
import { Icon, type IconName } from '../components/icon';
import { Popover, Tooltip } from '../components/overlay';
import { fieldFormatter } from '../lib/field_formats';
import { filterMatchesIndex, mapFilter, uniqueFilters, withMappedMeta, type ValueText } from '../lib/query';
import type { Filter, IndexPattern } from '../lib/types';
import { services } from '../services';
import { FilterEditor } from './filter_editor';

export const isPinned = (filter: Filter) => filter.$state?.store === 'globalState';

/** Filters by where they are kept: with the page, or pinned across pages */
export function splitFilters(filters: Filter[]) {
  return {
    pinned: filters.filter(isPinned),
    app: filters.filter((filter) => !isPinned(filter)),
  };
}

// --- What the original's helpers change of a filter ------------------------------------------------

export const togglePinned = (filter: Filter): Filter => ({
  ...filter,
  $state: { ...filter.$state, store: isPinned(filter) ? 'appState' : 'globalState' },
});
export const toggleNegated = (filter: Filter): Filter => ({ ...filter, meta: { ...filter.meta, negate: !filter.meta.negate } });
export const toggleDisabled = (filter: Filter): Filter => ({
  ...filter,
  meta: { ...filter.meta, disabled: !filter.meta.disabled },
});
const enableFilter = (filter: Filter) => (filter.meta.disabled ? toggleDisabled(filter) : filter);
const disableFilter = (filter: Filter) => (filter.meta.disabled ? filter : toggleDisabled(filter));
const pinFilter = (filter: Filter) => (isPinned(filter) ? filter : togglePinned(filter));
const unpinFilter = (filter: Filter) => (isPinned(filter) ? togglePinned(filter) : filter);

/** A filter with nothing in it yet, on an index pattern: what "Add filter" edits (buildEmptyFilter) */
export function emptyFilter(pinned: boolean, index?: string): Filter {
  return {
    meta: { disabled: false, negate: false, alias: null, index },
    $state: { store: pinned ? 'globalState' : 'appState' },
  };
}

// --- What a pill says ------------------------------------------------------------------------------

export type FilterLabelStatus = '' | 'warn' | 'error';

export interface FilterLabelConfig {
  title: string;
  status: FilterLabelStatus;
  message?: string;
}

/**
 * The value a pill shows (getDisplayValueFromFilter): written with the format of the field on the
 * filter's index pattern. A field the pattern lacks cannot be written, and says so.
 */
export function displayValueOf(filter: Filter, indexPatterns: IndexPattern[]): string {
  const mapped = mapFilter(filter);
  if (typeof mapped.value !== 'function') return mapped.value ?? '';
  const pattern = indexPatterns.find((candidate) => candidate.id === filter.meta.index);
  let format: ValueText | undefined;
  if (pattern && mapped.key) {
    const field = pattern.fields.find((candidate) => candidate.name === mapped.key);
    if (!field) throw new Error(`Field ${mapped.key} not found in index pattern ${pattern.title}`);
    const formatter = fieldFormatter(pattern, field.name, services.formatSettings());
    format = (value) => formatter(value).text;
  }
  return mapped.value(format);
}

/**
 * Whether a filter is about the index patterns of the page: one of them is its own, or has its
 * field. Without patterns, every filter is.
 */
function isFilterApplicable(filter: Filter, indexPatterns: IndexPattern[]): boolean {
  if (indexPatterns.length === 0) return true;
  if (indexPatterns.some((pattern) => pattern.id === filter.meta.index)) return true;
  return indexPatterns.some((pattern) => filterMatchesIndex(filter, pattern));
}

/** What a pill says of its value, and whether something is wrong with it (getValueLabel) */
export function filterLabelConfig(
  filter: Filter,
  indexPatterns: IndexPattern[],
  indexPatternExists: boolean
): FilterLabelConfig {
  if (!indexPatternExists) {
    return { status: 'error', title: 'Error', message: `Index pattern ${filter.meta.index} not found` };
  }
  if (isFilterApplicable(filter, indexPatterns)) {
    try {
      return { status: '', title: displayValueOf(filter, indexPatterns) };
    } catch (error) {
      return { status: 'error', title: 'Error', message: (error as Error).message };
    }
  }
  return { status: 'warn', title: 'Warning', message: `Field ${filter.meta.key} does not exist in current view` };
}

/** The parts of a pill's text: what comes before its value, and the value (FilterLabel) */
export function filterLabelParts(filter: Filter, valueLabel: string, status: FilterLabelStatus): { prefix: string; value?: string } {
  const { meta } = filter;
  if (meta.alias !== null && meta.alias !== undefined) {
    return status ? { prefix: `${meta.alias}: `, value: valueLabel } : { prefix: meta.alias };
  }
  switch (meta.type) {
    case 'exists':
      return { prefix: `${meta.key}: `, value: 'exists' };
    case 'phrases':
      return { prefix: `${meta.key}: `, value: `is one of ${valueLabel}` };
    case 'query_string':
      return { prefix: '', value: valueLabel };
    case 'geo_bounding_box':
    case 'geo_polygon':
    case 'phrase':
    case 'range':
      return { prefix: `${meta.key}: `, value: valueLabel };
    default: {
      const query = filter.query === undefined ? undefined : JSON.stringify(filter.query);
      return { prefix: '', value: `${query || meta.value}` };
    }
  }
}

function FilterLabel({ filter, valueLabel, status }: { filter: Filter; valueLabel: string; status: FilterLabelStatus }) {
  const { prefix, value } = filterLabelParts(filter, valueLabel, status);
  const negate = filter.meta.negate ? ' NOT ' : '';
  return (
    <>
      {negate && !filter.meta.disabled ? <span className="shlFilter__not">{negate}</span> : negate}
      {prefix}
      {value !== undefined && (
        <span className="shlFilter__value" data-test-subj="globalFilterLabelValue">
          {value}
        </span>
      )}
    </>
  );
}

/** A pill's text as it reads: its spaces run together, as the text of the page reads */
export function filterLabelText(filter: Filter, valueLabel: string, status: FilterLabelStatus): string {
  const { prefix, value } = filterLabelParts(filter, valueLabel, status);
  return `${filter.meta.negate ? ' NOT ' : ''}${prefix}${value ?? ''}`.replace(/\s+/g, ' ').trim();
}

// --- A menu as the original's context menu -----------------------------------------------------------

interface FilterMenuItem {
  name: string;
  icon: IconName;
  onClick: () => void;
  testId: string;
  /** It opens a panel of its own: an arrow says so */
  panel?: boolean;
  disabled?: boolean;
}

function FilterMenu({ title, items, testId }: { title?: string; items: FilterMenuItem[]; testId?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const focused = useRef<number | undefined>(undefined);
  const buttons = () => [...(panel.current?.querySelectorAll<HTMLButtonElement>('.shlFilterMenu__item') ?? [])];

  // The first item has the focus once the menu is open, as the original's
  useEffect(() => {
    const frame = requestAnimationFrame(() => buttons()[0]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = buttons();
    if (all.length === 0) return;
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = focused.current === undefined ? 0 : (focused.current + 1) % all.length;
    else if (event.key === 'ArrowUp') {
      next = focused.current === undefined ? all.length - 1 : (focused.current - 1 + all.length) % all.length;
    } else if (event.key === 'ArrowRight' && focused.current !== undefined && items[focused.current]?.panel) {
      event.preventDefault();
      items[focused.current].onClick();
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    focused.current = next;
    all[next].focus();
  };

  return (
    <div ref={panel} className="shlFilterMenu" data-test-subj={testId} onKeyDown={onKeyDown}>
      {title && <div className="shlFilterMenu__title">{title}</div>}
      {items.map((item, index) => (
        <button
          key={item.testId}
          type="button"
          className="shlFilterMenu__item"
          disabled={item.disabled}
          data-test-subj={item.testId}
          onFocus={() => {
            focused.current = focused.current === undefined && index === 0 ? undefined : index;
          }}
          onClick={item.onClick}
        >
          <Icon name={item.icon} />
          <span className="shlFilterMenu__text">{item.name}</span>
          {item.panel && <Icon name="chevronRight" />}
        </button>
      ))}
    </div>
  );
}

// --- A pill --------------------------------------------------------------------------------------------

function FilterItem({
  filter,
  indexPatterns,
  onUpdate,
  onRemove,
}: {
  filter: Filter;
  indexPatterns: IndexPattern[];
  onUpdate: (filter: Filter) => void;
  onRemove: () => void;
}) {
  const [panel, setPanel] = useState<'menu' | 'edit' | undefined>();
  const [indexPatternExists, setIndexPatternExists] = useState<boolean | undefined>(undefined);
  const close = useCallback(() => setPanel(undefined), []);
  const index = filter.meta.index;

  useEffect(() => {
    let live = true;
    // A filter without an index pattern is not checked
    if (!index) setIndexPatternExists(true);
    else {
      services.indexPatterns.get(index).then(
        (pattern) => live && setIndexPatternExists(Boolean(pattern)),
        () => live && setIndexPatternExists(false)
      );
    }
    return () => {
      live = false;
    };
  }, [index]);

  const mapped = useMemo(() => withMappedMeta(filter), [filter]);
  const label = useMemo(
    () => (indexPatternExists === undefined ? undefined : filterLabelConfig(filter, indexPatterns, indexPatternExists)),
    [filter, indexPatterns, indexPatternExists]
  );

  // A filter that cannot be read is switched off, and drawn once it is
  const errored = label?.status === 'error' && !filter.meta.disabled;
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;
  useEffect(() => {
    if (errored) updateRef.current({ ...filter, meta: { ...filter.meta, disabled: true } });
  }, [errored, filter]);

  // Nothing is drawn until it is known whether the index pattern is there
  if (!label || errored) return null;

  const { meta } = mapped;
  const pinned = isPinned(filter);
  const disabled = Boolean(meta.disabled) || label.status === 'error';
  const hasValue = Boolean(mapFilter(filter).value);
  const testId = [
    'filter',
    `filter-${disabled ? 'disabled' : 'enabled'}`,
    meta.key ? `filter-key-${meta.key}` : '',
    hasValue ? `filter-value-${label.status === '' ? label.title : label.status}` : '',
    `filter-${pinned ? 'pinned' : 'unpinned'}`,
    meta.negate ? 'filter-negated' : '',
  ].join(' ');
  let title = label.message || `Filter: ${filterLabelText(mapped, label.title, label.status)}. Select for more filter actions.`;
  if (pinned) title = `Pinned ${title}`;
  if (meta.disabled) title = `Disabled ${title}`;

  const act = (change: () => void) => () => {
    close();
    change();
  };
  const items: FilterMenuItem[] = [
    {
      name: pinned ? 'Unpin' : 'Pin across all apps',
      icon: 'pin',
      onClick: act(() => onUpdate(togglePinned(filter))),
      testId: 'pinFilter',
    },
    { name: 'Edit filter', icon: 'pencil', panel: true, onClick: () => setPanel('edit'), testId: 'editFilter' },
    {
      name: meta.negate ? 'Include results' : 'Exclude results',
      icon: meta.negate ? 'plusCircle' : 'minusCircle',
      onClick: act(() => onUpdate(toggleNegated(filter))),
      testId: 'negateFilter',
    },
    {
      name: meta.disabled ? 'Re-enable' : 'Temporarily disable',
      icon: meta.disabled ? 'eye' : 'eyeClosed',
      onClick: act(() => onUpdate(toggleDisabled(filter))),
      testId: 'disableFilter',
    },
    { name: 'Delete', icon: 'trash', onClick: act(onRemove), testId: 'deleteFilter' },
  ];

  const badge = (
    <span
      className={cx(
        'shlFilter',
        disabled && 'shlFilter--disabled',
        label.status === 'error' && 'shlFilter--error',
        label.status === 'warn' && 'shlFilter--warning',
        pinned && 'shlFilter--pinned',
        meta.negate && 'shlFilter--excluded'
      )}
    >
      <span className="shlFilter__content">
        <button
          type="button"
          className="shlFilter__button"
          title={title}
          aria-label="Filter actions"
          data-test-subj={testId}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            // Shift and a click switches it off or on, as the original's
            if (event.shiftKey) onUpdate(toggleDisabled(filter));
            else setPanel(panel ? undefined : 'menu');
          }}
        >
          <span>
            <FilterLabel filter={mapped} valueLabel={label.title} status={label.status} />
          </span>
        </button>
        <button
          type="button"
          className="shlFilter__remove"
          aria-label="Delete"
          title="Delete"
          tabIndex={-1}
          onClick={onRemove}
        >
          <Icon name="cross" />
        </button>
      </span>
    </span>
  );

  return (
    <Popover
      open={panel !== undefined}
      onClose={close}
      offset={8}
      buffer={16}
      className="shlFilterPopover"
      anchorClassName="shlFilters__pillAnchor"
      button={badge}
    >
      {panel === 'edit' ? (
        <div className="shlFilterPopover__editor">
          <FilterEditor
            filter={filter}
            indexPatterns={indexPatterns}
            onSubmit={(next) => {
              close();
              onUpdate(next);
            }}
            onCancel={close}
          />
        </div>
      ) : (
        <FilterMenu items={items} />
      )}
    </Popover>
  );
}

// --- The menu of all the filters ----------------------------------------------------------------------

function FilterOptions({ filters, onChange }: { filters: Filter[]; onChange: (filters: Filter[]) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const all = (change: (filter: Filter) => Filter) => () => {
    close();
    onChange(filters.map(change));
  };
  const items: FilterMenuItem[] = [
    { name: 'Enable all', icon: 'eye', onClick: all(enableFilter), testId: 'enableAllFilters' },
    { name: 'Disable all', icon: 'eyeClosed', onClick: all(disableFilter), testId: 'disableAllFilters' },
    { name: 'Pin all', icon: 'pin', onClick: all(pinFilter), testId: 'pinAllFilters' },
    { name: 'Unpin all', icon: 'pin', onClick: all(unpinFilter), testId: 'unpinAllFilters' },
    { name: 'Invert inclusion', icon: 'invert', onClick: all(toggleNegated), testId: 'invertInclusionAllFilters' },
    { name: 'Invert enabled/disabled', icon: 'eye', onClick: all(toggleDisabled), testId: 'invertEnableDisableAllFilters' },
    {
      name: 'Remove all',
      icon: 'trash',
      onClick: () => {
        close();
        onChange([]);
      },
      testId: 'removeAllFilters',
    },
  ];
  return (
    <Popover
      open={open}
      onClose={close}
      offset={8}
      buffer={16}
      className="shlFilterPopover"
      anchorClassName="shlFilters__branchAnchor"
      button={
        <Tooltip content="Change all filters" position="bottom" delay="long">
          <button
            type="button"
            className="shlFilters__actions"
            aria-label="Change all filters"
            data-test-subj="showFilterActions"
            onClick={() => setOpen(!open)}
          >
            <Icon name="filter" />
          </button>
        </Tooltip>
      }
    >
      <FilterMenu title="Filters" items={items} testId="filter-options-menu-panel" />
    </Popover>
  );
}

// --- The bar --------------------------------------------------------------------------------------------

export interface FilterBarProps {
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  indexPatterns: IndexPattern[];
}

export function FilterBar({ filters, onChange, indexPatterns }: FilterBarProps) {
  const [adding, setAdding] = useState(false);
  const closeAdding = useCallback(() => setAdding(false), []);

  // What changes is kept as the original's filter manager keeps it: read, and each filter once.
  // Changes made at once, as pills that cannot be read switching off, each build on the last.
  const latest = useRef(filters);
  latest.current = filters;
  const update = useCallback(
    (next: Filter[]) => {
      const settled = uniqueFilters(next.map(withMappedMeta));
      latest.current = settled;
      onChange(settled);
    },
    [onChange]
  );
  const updateAt = (at: number) => (filter: Filter) =>
    update(latest.current.map((other, index) => (index === at ? filter : other)));

  const pinnedByDefault = Boolean(services.uiSettings.get('filters:pinnedByDefault', false));
  const newFilter = emptyFilter(pinnedByDefault, indexPatterns[0]?.id);

  let addButton: ReactNode = (
    <button
      type="button"
      className="shlFilters__add"
      aria-label="Add filter"
      data-test-subj="addFilter"
      onClick={() => setAdding(true)}
    >
      <Icon name="plusCircle" />
      Add filter
    </button>
  );
  addButton = (
    <Popover
      open={adding}
      onClose={closeAdding}
      offset={8}
      buffer={16}
      className="shlFilterPopover"
      button={addButton}
    >
      <div className="shlFilterPopover__editor">
        <FilterEditor
          key={JSON.stringify(newFilter)}
          filter={newFilter}
          indexPatterns={indexPatterns}
          onSubmit={(filter) => {
            setAdding(false);
            update([...filters, filter]);
          }}
          onCancel={closeAdding}
        />
      </div>
    </Popover>
  );

  return (
    <div className="shlFilters" data-test-subj="globalFilterGroup">
      <div className="shlFilters__branch">
        <FilterOptions filters={filters} onChange={update} />
      </div>
      <div className="shlFilters__list" data-test-subj="globalFilterGroupFilterFlexItem">
        <div className="shlFilters__items">
          {filters.map((filter, index) => (
            <div
              // The pills are known by their place, as the original's
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className="shlFilters__item"
              data-test-subj="globalFilterBar"
            >
              <FilterItem
                filter={filter}
                indexPatterns={indexPatterns}
                onUpdate={updateAt(index)}
                onRemove={() => update(filters.filter((_other, at) => at !== index))}
              />
            </div>
          ))}
          <div className="shlFilters__item shlFilters__item--add">{addButton}</div>
        </div>
      </div>
    </div>
  );
}
