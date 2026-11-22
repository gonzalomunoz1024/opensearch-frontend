/* SPDX-License-Identifier: Apache-2.0 */

/* The fields of the index pattern beside the documents: which are shown as columns, and what each holds. */

import { useCallback, useMemo, useState } from 'react';
import { Accordion, Badge, Button, FieldToken, IconButton, cx } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { FormRow, SearchField, Select, Switch } from '../../components/form';
import { Popover } from '../../components/overlay';
import { fieldFormatter } from '../../lib/field_formats';
import { flattenHit, shownFields, type RawHit } from '../../lib/docs';
import type { Field, IndexPattern } from '../../lib/types';
import { services } from '../../services';
import type { IndexPatternSummary } from '../../services/index_patterns';

interface FieldFilter {
  name: string;
  type: string;
  aggregatable: string;
  searchable: string;
  hideMissing: boolean;
}

// As in OpenSearch Dashboards, fields no document on screen has are left out until asked for
const NO_FILTER: FieldFilter = { name: '', type: 'any', aggregatable: 'any', searchable: 'any', hideMissing: true };

const matches = (wanted: string, actual: boolean) => wanted === 'any' || (wanted === 'true') === actual;

interface ValueCount {
  value: unknown;
  count: number;
}

/** The values a field takes most often in the documents on screen */
export function topValues(rows: RawHit[], indexPattern: IndexPattern, fieldName: string, limit = 5) {
  const counts = new Map<string, ValueCount>();
  let present = 0;
  for (const row of rows) {
    const value = flattenHit(row, indexPattern)[fieldName];
    if (value === undefined || value === null || value === '') continue;
    present += 1;
    for (const item of Array.isArray(value) ? new Set(value as unknown[]) : [value]) {
      const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { value: item, count: 1 });
    }
  }
  const buckets = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  return { present, total: rows.length, buckets };
}

function FieldDetails({
  field,
  indexPattern,
  rows,
  onFilter,
  onVisualize,
}: {
  field: Field;
  indexPattern: IndexPattern;
  rows: RawHit[];
  onFilter: (fieldName: string, value: unknown, negate: boolean) => void;
  onVisualize?: () => void;
}) {
  const details = useMemo(() => topValues(rows, indexPattern, field.name), [rows, indexPattern, field.name]);
  const format = fieldFormatter(indexPattern, field.name, services.formatSettings());
  const filterable = field.searchable && field.type !== '_source' && !field.scripted;
  return (
    <div className="dscFieldDetails" data-test-subj="fieldVisualizeContainer">
      <div className="atlTitleXxs">Top {details.buckets.length} values</div>
      {details.buckets.length === 0 ? (
        <span className="atlSubdued atlSmall">
          {field.type === '_source' || field.type === 'geo_point' || field.type === 'geo_shape'
            ? 'Analysis is not available for this kind of field.'
            : 'This field is present in your OpenSearch mapping but not in the documents shown.'}
        </span>
      ) : (
        details.buckets.map((bucket) => {
          const share = details.present === 0 ? 0 : bucket.count / details.present;
          const text = format(bucket.value).text;
          return (
            <div key={text} className="dscFieldDetails__row">
              <div className="atlRow atlRowBetween">
                <span className="atlTruncate atlSmall" title={text}>
                  {text === '' ? <em>Empty string</em> : text}
                </span>
                <span className="atlRow" style={{ gap: 0 }}>
                  <span className="atlSubdued atlSmall">{(share * 100).toFixed(1)}%</span>
                  {filterable && (
                    <>
                      <IconButton
                        icon="plusCircle"
                        size="s"
                        label={`Filter for ${field.name}: ${text}`}
                        onClick={() => onFilter(field.name, bucket.value, false)}
                        testId={`plus-${field.name}-${text}`}
                      />
                      <IconButton
                        icon="minusCircle"
                        size="s"
                        label={`Filter out ${field.name}: ${text}`}
                        onClick={() => onFilter(field.name, bucket.value, true)}
                        testId={`minus-${field.name}-${text}`}
                      />
                    </>
                  )}
                </span>
              </div>
              <div className="dscFieldDetails__bar">
                <span style={{ width: `${Math.max(2, share * 100)}%` }} />
              </div>
            </div>
          );
        })
      )}
      <span className="atlSubdued atlSmall">
        Exists in {details.present} / {details.total} records
      </span>
      {onVisualize && (
        <Button size="s" variant="tint" onClick={onVisualize} testId={`fieldVisualize-${field.name}`}>
          Visualize
        </Button>
      )}
    </div>
  );
}

function FieldRow({
  field,
  selected,
  indexPattern,
  rows,
  onToggle,
  onFilter,
  onVisualize,
}: {
  field: Field;
  selected: boolean;
  indexPattern: IndexPattern;
  rows: RawHit[];
  onToggle: (fieldName: string) => void;
  onFilter: (fieldName: string, value: unknown, negate: boolean) => void;
  onVisualize?: (field: Field) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Popover
      open={open}
      onClose={close}
      padded
      anchorStyle={{ display: 'flex' }}
      button={
        <div className={cx('dscField', open && 'dscField--open')} data-test-subj={`field-${field.name}-showDetails`}>
          <button type="button" className="dscField__name" onClick={() => setOpen(!open)} title={field.name}>
            <FieldToken type={field.type} />
            <span className="atlTruncate">{field.name}</span>
          </button>
          {field.name !== '_source' && (
            <IconButton
              icon={selected ? 'cross' : 'plus'}
              size="s"
              className="dscField__action"
              label={selected ? `Remove ${field.name} from table` : `Add ${field.name} to table`}
              onClick={() => onToggle(field.name)}
              testId={`fieldToggle-${field.name}`}
            />
          )}
        </div>
      }
    >
      <FieldDetails
        field={field}
        indexPattern={indexPattern}
        rows={rows}
        onFilter={onFilter}
        onVisualize={onVisualize && field.aggregatable ? () => onVisualize(field) : undefined}
      />
    </Popover>
  );
}

export function Sidebar({
  indexPattern,
  indexPatterns,
  onIndexPatternChange,
  onRefreshFields,
  columns,
  rows,
  onToggleColumn,
  onFilter,
  onVisualize,
}: {
  indexPattern: IndexPattern;
  indexPatterns: IndexPatternSummary[];
  onIndexPatternChange: (id: string) => void;
  onRefreshFields: () => void;
  columns: string[];
  rows: RawHit[];
  onToggleColumn: (fieldName: string) => void;
  onFilter: (fieldName: string, value: unknown, negate: boolean) => void;
  onVisualize?: (field: Field) => void;
}) {
  const [filter, setFilter] = useState<FieldFilter>(NO_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const patch = (changes: Partial<FieldFilter>) => setFilter((current) => ({ ...current, ...changes }));

  const fields = useMemo(() => shownFields(indexPattern), [indexPattern]);
  const present = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) for (const name of Object.keys(flattenHit(row, indexPattern))) names.add(name);
    return names;
  }, [rows, indexPattern]);
  const types = useMemo(() => ['any', ...new Set(fields.map((field) => field.type))].sort(), [fields]);

  const needle = filter.name.trim().toLowerCase();
  const filtered = fields.filter(
    (field) =>
      (needle === '' || field.name.toLowerCase().includes(needle)) &&
      (filter.type === 'any' || field.type === filter.type) &&
      matches(filter.aggregatable, field.aggregatable) &&
      matches(filter.searchable, field.searchable) &&
      (!filter.hideMissing || present.has(field.name) || field.name === '_source')
  );
  const selectedNames = columns;
  const selected = selectedNames
    .map((name) => fields.find((field) => field.name === name) ?? ({ name, type: 'unknown', searchable: false, aggregatable: false } as Field))
    .filter((field) => needle === '' || field.name.toLowerCase().includes(needle));
  const popularLimit = services.uiSettings.get<number>('fields:popularLimit', 10);
  const unselected = filtered
    .filter((field) => !selectedNames.includes(field.name) && field.name !== '_source')
    .sort((a, b) => a.name.localeCompare(b.name));
  const popular = unselected
    .filter((field) => (field.count ?? 0) > 0)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, popularLimit);
  const others = unselected.filter((field) => !popular.includes(field));
  const activeFilters =
    Number(filter.type !== 'any') +
    Number(filter.aggregatable !== 'any') +
    Number(filter.searchable !== 'any');
  const yesNo = [
    { value: 'any', label: 'any' },
    { value: 'true', label: 'yes' },
    { value: 'false', label: 'no' },
  ];

  const row = (field: Field, isSelected: boolean) => (
    <FieldRow
      key={field.name}
      field={field}
      selected={isSelected}
      indexPattern={indexPattern}
      rows={rows}
      onToggle={onToggleColumn}
      onFilter={onFilter}
      onVisualize={onVisualize}
    />
  );

  return (
    <aside className="dscSidebar atlPanel atlPanel--flush" data-test-subj="discover-sidebar">
      <div className="dscSidebar__top">
        <div className="atlRow" style={{ gap: 'var(--space-1)' }}>
          <ComboBox
            single
            clearable={false}
            options={indexPatterns.map((pattern) => ({ value: pattern.id, label: pattern.displayName || pattern.title }))}
            selected={[indexPattern.id]}
            onChange={([id]) => id && onIndexPatternChange(id)}
            testId="indexPattern-switch-link"
          />
          <IconButton icon="refresh" label="Refresh the field list" variant="tint" onClick={onRefreshFields} />
        </div>
        <div className="dscSidebar__search">
          <SearchField
            value={filter.name}
            onChange={(name) => patch({ name })}
            placeholder="Search field names"
            testId="fieldFilterSearchInput"
            aria-label="Search field names"
          />
          <Popover
            open={filterOpen}
            onClose={closeFilter}
            padded
            button={
              <Button icon="filter" onClick={() => setFilterOpen(!filterOpen)} testId="toggleFieldFilterButton">
                Filter by type <Badge tone={activeFilters ? 'accent' : undefined}>{activeFilters}</Badge>
              </Button>
            }
          >
            <div className="atlStack" style={{ width: 240 }}>
              <FormRow label="Aggregatable" full>
                <Select value={filter.aggregatable} onChange={(aggregatable) => patch({ aggregatable })} options={yesNo} testId="aggregatableSelect" />
              </FormRow>
              <FormRow label="Searchable" full>
                <Select value={filter.searchable} onChange={(searchable) => patch({ searchable })} options={yesNo} testId="searchableSelect" />
              </FormRow>
              <FormRow label="Type" full>
                <Select value={filter.type} onChange={(type) => patch({ type })} options={types} testId="typeSelect" />
              </FormRow>
              <Switch checked={filter.hideMissing} onChange={(hideMissing) => patch({ hideMissing })} label="Hide missing fields" testId="missingSwitch" />
            </div>
          </Popover>
        </div>
      </div>
      <div className="dscSidebar__lists">
        <Accordion title="Selected fields">
          <div data-test-subj="fieldList-selected">
            {selected.length === 0 ? <span className="dscSidebar__empty">None</span> : selected.map((field) => row(field, true))}
          </div>
        </Accordion>
        <Accordion title="Available fields">
          <div data-test-subj="fieldList-unpopular">
            {popular.length > 0 && <div className="dscSidebar__label">Popular</div>}
            {popular.map((field) => row(field, false))}
            {popular.length > 0 && others.length > 0 && <div className="dscSidebar__label">Others</div>}
            {others.map((field) => row(field, false))}
            {unselected.length === 0 && <span className="dscSidebar__empty">No fields match</span>}
          </div>
        </Accordion>
      </div>
    </aside>
  );
}
