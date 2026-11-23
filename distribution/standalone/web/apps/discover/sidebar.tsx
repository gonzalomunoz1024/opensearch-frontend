/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The fields of the index pattern beside the documents, as the original's sidebar: which are
 * shown as columns, which are popular, and what each holds in the documents on screen.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button, FieldToken, IconButton, Segments, cx } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { SearchField, Select, Switch } from '../../components/form';
import { Icon } from '../../components/icon';
import { Popover, Tooltip } from '../../components/overlay';
import { flattenHit, type RawHit } from '../../lib/docs';
import { fieldFormatter } from '../../lib/field_formats';
import type { Field, IndexPattern } from '../../lib/types';
import { services } from '../../services';
import type { IndexPatternSummary } from '../../services/index_patterns';
import { isFilterable, shortDots } from './doc_table';

type Choice = 'any' | 'true' | 'false';

export interface FieldFilter {
  name: string;
  type: string;
  aggregatable: Choice;
  searchable: Choice;
  /** Leave out the fields no document on screen has */
  missing: boolean;
}

export const NO_FILTER: FieldFilter = { name: '', type: 'any', aggregatable: 'any', searchable: 'any', missing: true };

const META_FIELDS = ['_source', '_id', '_type', '_index', '_score'];

const matches = (wanted: Choice, actual: boolean) => wanted === 'any' || (wanted === 'true') === actual;

/** Whether a field is listed under a filter, as the original decides it */
export function passesFilter(field: Field, filter: FieldFilter, present: ReadonlySet<string>): boolean {
  return (
    (filter.type === 'any' || field.type === filter.type) &&
    matches(filter.aggregatable, field.aggregatable) &&
    matches(filter.searchable, field.searchable) &&
    (!filter.missing || field.type === '_source' || Boolean(field.scripted) || present.has(field.name)) &&
    (filter.name === '' || field.name.toLowerCase().includes(filter.name.toLowerCase()))
  );
}

/** The names the documents on screen hold: their fields, and the meta fields every hit has */
export function presentNames(rows: RawHit[], indexPattern: IndexPattern, metaFields: string[]): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    for (const name of Object.keys(flattenHit(row, indexPattern))) names.add(name);
    for (const name of metaFields) if (name !== '_source') names.add(name);
  }
  return names;
}

export interface FieldGroups {
  selected: Field[];
  popular: Field[];
  unpopular: Field[];
}

/**
 * The fields under their three headings, as the original sorts them: by name, the selected ones
 * in the order of the columns, and the most picked of the others as popular. Columns that are no
 * list (none: the state's are not) put no field under any heading, as the original's.
 */
export function groupFields(
  fields: Field[],
  columns: readonly string[] | undefined,
  popularLimit: number,
  filter: FieldFilter,
  present: ReadonlySet<string>
): FieldGroups {
  if (!columns) return { selected: [], popular: [], unpopular: [] };
  const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name));
  const popular = new Set(
    sorted
      .filter((field) => !columns.includes(field.name) && (field.count ?? 0) > 0)
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, popularLimit)
      .map((field) => field.name)
  );
  const groups: FieldGroups = { selected: [], popular: [], unpopular: [] };
  for (const field of sorted) {
    if (!passesFilter(field, filter, present)) continue;
    if (columns.includes(field.name)) groups.selected.push(field);
    else if (field.type === '_source') continue;
    else if (popular.has(field.name)) groups.popular.push(field);
    else groups.unpopular.push(field);
  }
  groups.selected.sort((a, b) => columns.indexOf(a.name) - columns.indexOf(b.name));
  return groups;
}

/** The fields of the pattern, and those the documents hold that the pattern does not know */
export function sidebarFields(indexPattern: IndexPattern, present: ReadonlySet<string>): Field[] {
  const known = new Set(indexPattern.fields.map((field) => field.name));
  const unknown = [...present]
    .filter((name) => !known.has(name))
    .map((name): Field => ({ name, type: 'unknown', searchable: false, aggregatable: false }));
  return [...indexPattern.fields, ...unknown];
}

export interface FieldBucket {
  value: unknown;
  count: number;
  percent: number;
}

export type FieldSummary = { error: string } | { total: number; exists: number; buckets: FieldBucket[] };

const NO_ANALYSIS_TYPES = ['geo_point', 'geo_shape', 'attachment'];

/** The values a field takes most often in the documents on screen, counted as the original counts them */
export function fieldSummary(rows: RawHit[], indexPattern: IndexPattern, field: Pick<Field, 'name' | 'type'>, limit = 5): FieldSummary {
  if (NO_ANALYSIS_TYPES.includes(field.type)) return { error: `Analysis is not available for ${field.type} fields.` };
  const values = rows.map((row) => flattenHit(row, indexPattern)[field.name]);
  const missing = values.filter((value) => value === undefined || value === null).length;
  // Keyed as an object's properties are, so that whole numbers come first among equal counts
  const groups: Record<string, { value: unknown; count: number }> = Object.create(null);
  for (const value of values.flat()) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) return { error: 'Analysis is not available for object fields.' };
    const key = String(value);
    if (groups[key]) groups[key].count += 1;
    else groups[key] = { value, count: 1 };
  }
  if (rows.length === missing) {
    return {
      error: `This field is present in your OpenSearch mapping but not in the ${rows.length} documents shown in the doc table. You may still be able to visualize or search on it.`,
    };
  }
  const exists = rows.length - missing;
  const buckets = Object.keys(groups)
    .sort((a, b) => groups[b].count - groups[a].count)
    .slice(0, limit)
    .map((key) => ({ value: groups[key].value, count: groups[key].count, percent: (groups[key].count / exists) * 100 }));
  return { total: rows.length, exists, buckets };
}

/**
 * The text of one of a field's top values: the value as the field's format writes it, an empty
 * string too, as the original's field calculator does; its details say "Empty string" only when
 * that text is empty
 */
export const bucketText = (value: unknown, format: (value: unknown) => { text: string }) => format(value).text;

/** Whether the original offers to visualize a field from its summary */
export function isVisualizable(field: Field): boolean {
  return field.aggregatable && field.name !== '_id' && !['geo_point', 'geo_shape', 'unknown', 'conflict'].includes(field.type);
}

/** A field's name broken after its dots, so that a long name wraps there */
const wrapOnDot = (name: string) => name.replace(/\./g, '.​');

function FieldDetails({
  field,
  indexPattern,
  rows,
  metaFields,
  onFilter,
  onFilterExists,
  onVisualize,
}: {
  field: Field;
  indexPattern: IndexPattern;
  rows: RawHit[];
  metaFields: string[];
  onFilter: (fieldName: string, value: unknown, negate: boolean) => void;
  onFilterExists: (fieldName: string) => void;
  onVisualize?: () => void;
}) {
  const summary = useMemo(() => fieldSummary(rows, indexPattern, field), [rows, indexPattern, field]);
  const format = fieldFormatter(indexPattern, field.name, services.formatSettings());
  const filterable = isFilterable(field, field.name);
  return (
    <>
      <div className="dscFieldPopover__title" tabIndex={0}>
        Top 5 values
      </div>
      <div className="dscFieldDetails" data-test-subj="fieldVisualizeContainer">
        {'error' in summary ? (
          <div className="dscFieldDetails__error" data-test-subj="fieldVisualizeError">
            {summary.error}
          </div>
        ) : (
          summary.buckets.length > 0 && (
            <div className="dscFieldDetails__buckets" data-test-subj="fieldVisualizeBucketContainer">
              {summary.buckets.map((bucket, index) => {
                const display = bucketText(bucket.value, format);
                const value = String(bucket.value);
                return (
                  <div key={index} className="dscFieldBucket">
                    <div className="dscFieldBucket__bar" data-test-subj="dscFieldDetailsBarContainer">
                      <div className="dscFieldBucket__text">
                        <span
                          className="dscFieldBucket__value"
                          title={display === '' ? 'Empty string' : `${display}: ${bucket.count} (${bucket.percent.toFixed(1)}%)`}
                          data-test-subj="dscFieldDetailsText"
                        >
                          {display === '' ? 'Empty string' : display}
                        </span>
                        <span className="dscFieldBucket__percent">{bucket.percent.toFixed(1)}%</span>
                      </div>
                      <div
                        className="dscFieldBucket__progress"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={bucket.percent}
                        aria-label={`${value}: ${bucket.count} (${bucket.percent}%)`}
                      >
                        <span style={{ width: `${bucket.percent}%` }} />
                      </div>
                    </div>
                    {filterable && (
                      <div className="dscFieldBucket__actions">
                        <IconButton
                          icon="plusCircle"
                          className="dscFieldBucket__action"
                          label={`Filter for ${field.name}: "${value}"`}
                          title="Filter for value"
                          onClick={() => onFilter(field.name, bucket.value, false)}
                          testId={`plus-${field.name}-${value}`}
                        />
                        <IconButton
                          icon="minusCircle"
                          className="dscFieldBucket__action"
                          label={`Filter out ${field.name}: "${value}"`}
                          title="Filter out value"
                          onClick={() => onFilter(field.name, bucket.value, true)}
                          testId={`minus-${field.name}-${value}`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
        {onVisualize && (
          <div className="dscFieldDetails__visualize" data-test-subj="fieldVisualizeLink">
            <Button size="m" onClick={onVisualize} testId={`fieldVisualize-${field.name}`}>
              Visualize
            </Button>
            {field.scripted && (
              <Tooltip content="Scripted fields can take a long time to execute.">
                <Icon name="warning" className="dscFieldDetails__warning" />
              </Tooltip>
            )}
          </div>
        )}
      </div>
      {!('error' in summary) && (
        <div className="dscFieldPopover__footer">
          {!metaFields.includes(field.name) && !field.scripted ? (
            <button type="button" className="atlLinkButton" onClick={() => onFilterExists(field.name)}>
              Exists in {summary.exists}
            </button>
          ) : (
            <span>{summary.exists}</span>
          )}{' '}
          / {summary.total} records
        </div>
      )}
    </>
  );
}

function FieldRow({
  field,
  selected,
  indexPattern,
  rows,
  metaFields,
  shortenNames,
  onToggle,
  onFilter,
  onFilterExists,
  onVisualize,
}: {
  field: Field;
  selected: boolean;
  indexPattern: IndexPattern;
  rows: RawHit[];
  metaFields: string[];
  shortenNames: boolean;
  onToggle: (fieldName: string) => void;
  onFilter: (fieldName: string, value: unknown, negate: boolean) => void;
  onFilterExists: (fieldName: string) => void;
  onVisualize?: (field: Field) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const isSource = field.name === '_source';
  return (
    <div className="dscSidebar__item" data-attr-field={field.name} data-test-subj="fieldList-field">
      <div className="dscSidebarField" data-test-subj="dscSidebarField">
        <FieldToken type={field.type} scripted={field.scripted} />
        <div className="dscSidebarField__label">
          {/* Its whole name, in the original's tooltip, once the pointer stays on it */}
          <Tooltip content={field.name} delay="long">
            <span className="dscSidebarField__name" data-test-subj={`field-${field.name}`}>
              {wrapOnDot(shortenNames ? shortDots(field.name) : field.name)}
            </span>
          </Tooltip>
        </div>
        {/* The original's two small empty icon buttons in the primary colour, round */}
        {!isSource && (
          <Popover
            open={open}
            onClose={close}
            side="right"
            className="dscFieldPopover"
            button={
              <Button
                variant="empty"
                size="xs"
                icon="inspect"
                className="atlButton--round dscSidebarField__action"
                aria-label={`View ${field.name} summary`}
                onClick={() => setOpen(!open)}
                testId={`field-${field.name}-showDetails`}
              />
            }
          >
            <FieldDetails
              field={field}
              indexPattern={indexPattern}
              rows={rows}
              metaFields={metaFields}
              onFilter={onFilter}
              onFilterExists={onFilterExists}
              onVisualize={onVisualize && isVisualizable(field) ? () => onVisualize(field) : undefined}
            />
          </Popover>
        )}
        {!isSource && (
          <Tooltip content={selected ? 'Remove field from table' : 'Add field as column'} delay="long">
            <Button
              variant={selected ? 'dangerEmpty' : 'empty'}
              size="xs"
              icon={selected ? 'cross' : 'plusInCircleFilled'}
              className={cx('atlButton--round', 'dscSidebarField__action', selected && 'dscSidebarField__action--remove')}
              aria-label={selected ? `Remove ${field.name} from table` : `Add ${field.name} to table`}
              onClick={(event) => {
                event.currentTarget.focus();
                onToggle(field.name);
              }}
              testId={`fieldToggle-${field.name}`}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** A heading that folds its fields away, as the original's */
function FieldGroup({ title, category, children }: { title: string; category: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <>
      <button
        type="button"
        className="dscSidebar__group"
        aria-label={title}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        data-test-subj="dscSideBarFieldGroupButton"
      >
        <Icon name={expanded ? 'chevronDown' : 'chevronRight'} />
        <span>{title}</span>
      </button>
      {expanded && (
        <div className="dscSidebar__list" data-test-subj={`fieldList-${category}`}>
          {children}
        </div>
      )}
    </>
  );
}

const CHOICES: Array<{ id: Choice; label: string }> = [
  { id: 'any', label: 'any' },
  { id: 'true', label: 'yes' },
  { id: 'false', label: 'no' },
];

function ChoiceRow({ label, value, onChange, testId }: { label: string; value: Choice; onChange: (value: Choice) => void; testId: string }) {
  return (
    <div className="dscFieldFilter__row">
      <span className="dscFieldFilter__label">{label}</span>
      <fieldset className="dscFieldFilter__choices" data-test-subj={testId}>
        <legend className="atlScreenReaderOnly">{label}</legend>
        <Segments options={CHOICES} value={value} onChange={onChange} />
      </fieldset>
    </div>
  );
}

interface SidebarFieldsProps {
  indexPattern: IndexPattern;
  /** The columns the state names, as the original's sidebar is given them: none when they are no list */
  columns: string[] | undefined;
  rows: RawHit[];
  onToggleColumn: (fieldName: string) => void;
  onFilter: (fieldName: string, value: unknown, negate: boolean) => void;
  onFilterExists: (fieldName: string) => void;
  onVisualize?: (field: Field) => void;
}

/**
 * The index pattern's picker over its fields. With no pattern (the address names one that cannot
 * be read) the picker shows none chosen and no field is listed, as the original's.
 */
export function Sidebar({
  indexPattern,
  indexPatterns,
  onIndexPatternChange,
  onRefreshFields,
  ...fields
}: Omit<SidebarFieldsProps, 'indexPattern'> & {
  indexPattern: IndexPattern | undefined;
  indexPatterns: IndexPatternSummary[];
  onIndexPatternChange: (id: string) => void;
  onRefreshFields: () => void;
}) {
  // With no pattern there are no fields: the button reads the patterns again, as the original's
  const refreshLabel = indexPattern ? 'Refresh the field list' : 'Refresh data selector';
  return (
    <aside className="dscSidebar atlPanel atlPanel--flush" data-test-subj="sidebarPanel" aria-label="Index and fields">
      <div className="dscSidebar__source">
        <div className="dscSidebar__sourceGroup">
          <ComboBox
            single
            clearable={false}
            options={indexPatterns.map((pattern) => ({ value: pattern.id, label: pattern.displayName || pattern.title }))}
            selected={indexPattern ? [indexPattern.id] : []}
            placeholder="Select a data source"
            onChange={([id]) => id && onIndexPatternChange(id)}
            testId="indexPattern-switch-link"
          />
          <button type="button" className="dscSidebar__refresh" aria-label={refreshLabel} title={refreshLabel} onClick={onRefreshFields} data-test-subj="sourceRefreshButton">
            <Icon name="refresh" />
          </button>
        </div>
      </div>
      {indexPattern && <SidebarFields indexPattern={indexPattern} {...fields} />}
    </aside>
  );
}

/** The search of the field names, its filter by type, and the fields under their headings */
function SidebarFields({ indexPattern, columns, rows, onToggleColumn, onFilter, onFilterExists, onVisualize }: SidebarFieldsProps) {
  const [filter, setFilter] = useState<FieldFilter>(NO_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const patch = (changes: Partial<FieldFilter>) => setFilter((current) => ({ ...current, ...changes }));

  const metaSetting = services.uiSettings.get<string[]>('metaFields', META_FIELDS);
  const metaKey = metaSetting.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the setting is read anew on each draw
  const metaFields = useMemo(() => metaSetting, [metaKey]);
  const present = useMemo(() => presentNames(rows, indexPattern, metaFields), [rows, indexPattern, metaFields]);
  const fields = useMemo(() => sidebarFields(indexPattern, present), [indexPattern, present]);
  // The kinds in the order the sorted list first shows them, as the original offers them
  const types = useMemo(
    () => ['any', ...new Set([...fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) => field.type))],
    [fields]
  );
  const popularLimit = services.uiSettings.get<number>('fields:popularLimit', 10);
  const shortenNames = services.uiSettings.get<boolean>('shortDots:enable', false);
  const groups = groupFields(fields, columns, popularLimit, filter, present);
  const activeFilters = Number(filter.type !== 'any') + Number(filter.aggregatable !== 'any') + Number(filter.searchable !== 'any');

  const row = (field: Field, isSelected: boolean) => (
    <FieldRow
      key={field.name}
      field={field}
      selected={isSelected}
      indexPattern={indexPattern}
      rows={rows}
      metaFields={metaFields}
      shortenNames={shortenNames}
      onToggle={onToggleColumn}
      onFilter={onFilter}
      onFilterExists={onFilterExists}
      onVisualize={onVisualize}
    />
  );

  return (
    <>
      <div className="dscSidebar__search">
        <SearchField
          compact
          className="dscSidebar__searchInput"
          value={filter.name}
          onChange={(name) => patch({ name })}
          placeholder="Search field names"
          testId="fieldFilterSearchInput"
          aria-label="Search field names"
          append={
            filter.name ? (
              <button
                type="button"
                className="dscSidebar__searchClear"
                aria-label="Clear input"
                onClick={(event) => {
                  patch({ name: '' });
                  event.currentTarget.parentElement?.querySelector('input')?.focus();
                }}
              >
                <Icon name="cross" />
              </button>
            ) : undefined
          }
        />
        <div className="dscSidebar__filterGroup">
          <Popover
            open={filterOpen}
            onClose={closeFilter}
            width={300}
            className="dscFieldFilter"
            button={
              <button
                type="button"
                className="dscSidebar__filterButton"
                aria-label={filterOpen ? 'Hide field filter settings' : 'Show field filter settings'}
                aria-pressed={filterOpen}
                onClick={() => setFilterOpen(!filterOpen)}
                data-test-subj="toggleFieldFilterButton"
              >
                <Icon name="filter" />
                <span className="dscSidebar__filterText" data-text="Filter by type">Filter by type</span>
                <span className={cx('dscSidebar__filterCount', activeFilters > 0 && 'dscSidebar__filterCount--active')}>{activeFilters}</span>
              </button>
            }
          >
            <div className="dscFieldPopover__title">Filter by type</div>
            <div className="dscFieldFilter__form" data-test-subj="filterSelectionPanel">
              <ChoiceRow label="Aggregatable" value={filter.aggregatable} onChange={(aggregatable) => patch({ aggregatable })} testId="aggregatableButtonGroup" />
              <ChoiceRow label="Searchable" value={filter.searchable} onChange={(searchable) => patch({ searchable })} testId="searchableButtonGroup" />
              <div className="dscFieldFilter__row">
                <span className="dscFieldFilter__label">Type</span>
                <Select value={filter.type} onChange={(type) => patch({ type })} options={types} aria-label="Selection of type filter options" testId="typeSelect" />
              </div>
            </div>
            <div className="dscFieldFilter__footer">
              <Switch checked={filter.missing} onChange={(missing) => patch({ missing })} label="Hide missing fields" testId="missingSwitch" />
            </div>
          </Popover>
        </div>
      </div>
      {fields.length > 0 && (
        <div className="dscSidebar__lists">
          <FieldGroup title="Selected fields" category="selected">
            {groups.selected.map((field) => row(field, true))}
          </FieldGroup>
          {groups.popular.length > 0 && (
            <FieldGroup title="Popular fields" category="popular">
              {groups.popular.map((field) => row(field, false))}
            </FieldGroup>
          )}
          <FieldGroup title="Available fields" category="unpopular">
            {groups.unpopular.map((field) => row(field, false))}
          </FieldGroup>
        </div>
      )}
    </>
  );
}
