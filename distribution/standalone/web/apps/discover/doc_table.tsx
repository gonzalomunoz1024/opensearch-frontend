/* SPDX-License-Identifier: Apache-2.0 */

/* The documents a search found, one per row: the time, then the chosen fields or the whole source. */

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../../components/basic';
import { FieldValue } from '../../components/formatted';
import { Icon } from '../../components/icon';
import { flattenHit, type RawHit } from '../../lib/docs';
import type { IndexPattern } from '../../lib/types';
import { services } from '../../services';

export type SortPair = [field: string, direction: 'asc' | 'desc'];

export interface DocTableProps {
  rows: RawHit[];
  indexPattern: IndexPattern;
  columns: string[];
  sort: SortPair[];
  onSort?: (sort: SortPair[]) => void;
  onRemoveColumn?: (fieldName: string) => void;
  onMoveColumn?: (fieldName: string, by: number) => void;
  onFilter?: (fieldName: string, value: unknown, negate: boolean) => void;
  /** What a row shows under it once it is opened */
  details?: (hit: RawHit) => ReactNode;
  /** How many rows are drawn at first; more follow as the end comes into view */
  pageSize?: number;
}

const SOURCE_LIMIT = 200;

const SourceCell = memo(function SourceCell({ hit, indexPattern }: { hit: RawHit; indexPattern: IndexPattern }) {
  const flat = flattenHit(hit, indexPattern);
  // What the search marked comes first, as it is why the document was found
  const highlighted = Object.keys(hit.highlight ?? {});
  const names = [
    ...highlighted.filter((name) => name in flat),
    ...Object.keys(flat)
      .filter((name) => !highlighted.includes(name) && !name.startsWith('_'))
      .sort((a, b) => a.localeCompare(b)),
  ].slice(0, SOURCE_LIMIT);
  return (
    <dl className="dscSource">
      {names.map((name) => (
        <span key={name} className="dscSource__pair">
          <dt>{name}:</dt>
          <dd>
            <FieldValue indexPattern={indexPattern} fieldName={name} value={flat[name]} hit={hit} />
          </dd>
        </span>
      ))}
    </dl>
  );
});

const Row = memo(function Row({
  hit,
  indexPattern,
  columns,
  showTime,
  onFilter,
  rowKey,
  open,
  onToggle,
  details,
}: {
  hit: RawHit;
  indexPattern: IndexPattern;
  columns: string[];
  showTime: boolean;
  onFilter?: DocTableProps['onFilter'];
  rowKey: string;
  open: boolean;
  onToggle: (key: string) => void;
  details?: DocTableProps['details'];
}) {
  const flat = flattenHit(hit, indexPattern);
  const cell = (name: string, className?: string) => {
    const field = indexPattern.fields.find((candidate) => candidate.name === name);
    const value = flat[name];
    const filterable = Boolean(onFilter && field?.searchable && !field.scripted && value !== undefined && value !== null);
    return (
      <td key={name} className={className} data-test-subj="docTableField">
        <span className="dscCell">
          <span className="dscCell__value">
            <FieldValue indexPattern={indexPattern} fieldName={name} value={value} hit={hit} />
          </span>
          {filterable && (
            <span className="dscCell__actions">
              <IconButton icon="plusCircle" size="s" label="Filter for value" onClick={() => onFilter?.(name, value, false)} testId="filterForValue" />
              <IconButton icon="minusCircle" size="s" label="Filter out value" onClick={() => onFilter?.(name, value, true)} testId="filterOutValue" />
            </span>
          )}
        </span>
      </td>
    );
  };
  const width = columns.length + 1 + Number(showTime);
  return (
    <>
      <tr data-test-subj="docTableRow" className={open ? 'dscTable__row--open' : undefined}>
        <td className="dscTable__toggle">
          {details && (
            <IconButton
              icon={open ? 'chevronDown' : 'chevronRight'}
              size="s"
              label="Toggle row details"
              aria-expanded={open}
              onClick={() => onToggle(rowKey)}
              testId="docTableExpandToggleColumn"
            />
          )}
        </td>
        {showTime && indexPattern.timeFieldName && cell(indexPattern.timeFieldName, 'dscTable__time')}
        {columns.map((name) =>
          name === '_source' ? (
            <td key="_source" data-test-subj="docTableField">
              <SourceCell hit={hit} indexPattern={indexPattern} />
            </td>
          ) : (
            cell(name)
          )
        )}
      </tr>
      {open && details && (
        <tr className="dscTable__details">
          <td colSpan={width}>{details(hit)}</td>
        </tr>
      )}
    </>
  );
});

export function DocTable({
  rows,
  indexPattern,
  columns,
  sort,
  onSort,
  onRemoveColumn,
  onMoveColumn,
  onFilter,
  details,
  pageSize = 50,
}: DocTableProps) {
  const [shown, setShown] = useState(pageSize);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const sentinel = useRef<HTMLDivElement>(null);
  const hideTime = services.uiSettings.get('doc_table:hideTimeColumn', false);
  const timeField = indexPattern.timeFieldName;
  const showTime = Boolean(timeField) && !hideTime && !columns.includes(timeField ?? '');

  useEffect(() => setShown(pageSize), [rows, pageSize]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || shown >= rows.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShown((count) => Math.min(rows.length, count + pageSize));
      },
      { rootMargin: '600px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown, rows.length, pageSize]);

  const header = (name: string, label: string, movable: boolean) => {
    const field = indexPattern.fields.find((candidate) => candidate.name === name);
    const sortable = Boolean(onSort && field?.aggregatable !== false && field && field.type !== '_source' && name !== '_source');
    const current = sort.find(([sorted]) => sorted === name)?.[1];
    const position = columns.indexOf(name);
    return (
      <th key={name} data-test-subj={`docTableHeader-${name}`}>
        <span className="dscHeader">
          <span>{label}</span>
          {sortable && (
            <button
              type="button"
              className="dscHeader__button"
              style={current ? { opacity: 1 } : undefined}
              aria-label={`Sort ${name} ${current === 'asc' ? 'descending' : 'ascending'}`}
              title={`Sort ${name} ${current === 'asc' ? 'descending' : 'ascending'}`}
              onClick={() => onSort?.([[name, current === 'asc' ? 'desc' : 'asc']])}
              data-test-subj={`docTableHeaderFieldSort_${name}`}
            >
              <Icon name={current === 'asc' ? 'sortUp' : current === 'desc' ? 'sortDown' : 'sortUp'} />
            </button>
          )}
          {movable && onRemoveColumn && (
            <button type="button" className="dscHeader__button" aria-label={`Remove ${name} column`} title="Remove column" onClick={() => onRemoveColumn(name)}>
              <Icon name="cross" />
            </button>
          )}
          {movable && onMoveColumn && position > 0 && (
            <button type="button" className="dscHeader__button" aria-label={`Move ${name} column to the left`} title="Move column to the left" onClick={() => onMoveColumn(name, -1)}>
              <Icon name="chevronLeft" />
            </button>
          )}
          {movable && onMoveColumn && position < columns.length - 1 && (
            <button type="button" className="dscHeader__button" aria-label={`Move ${name} column to the right`} title="Move column to the right" onClick={() => onMoveColumn(name, 1)}>
              <Icon name="chevronRight" />
            </button>
          )}
        </span>
      </th>
    );
  };

  return (
    <div className="dscTableWrap">
      <table className="dscTable" data-test-subj="docTable">
        <thead>
          <tr>
            <th className="dscTable__toggle" />
            {showTime && timeField && header(timeField, 'Time', false)}
            {columns.map((name) => header(name, name, name !== '_source'))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((hit) => {
            const key = `${hit._index}/${hit._id}`;
            return (
              <Row
                key={key}
                rowKey={key}
                hit={hit}
                indexPattern={indexPattern}
                columns={columns}
                showTime={showTime}
                onFilter={onFilter}
                open={opened.has(key)}
                onToggle={toggle}
                details={details}
              />
            );
          })}
        </tbody>
      </table>
      <div ref={sentinel} />
    </div>
  );
}
