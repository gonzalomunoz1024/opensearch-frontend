/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A grid of sample data: columns that can be shown and hidden, cells cut to their column, and
 * pages when it is asked to have them. The headings are whatever the page gives it.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../components/basic';
import { SearchField, Switch } from '../../components/form';
import { Icon } from '../../components/icon';
import { Popover } from '../../components/overlay';
import { Pagination } from '../../components/table';
import { PAGE_SIZES } from './common';

export interface GridColumn {
  id: string;
  header: ReactNode;
}

/** The button over a grid that says how many columns are hidden and opens the list of them all */
function ColumnSelector({
  ids,
  hidden,
  onHidden,
}: {
  ids: string[];
  hidden: Set<string>;
  onHidden: (hidden: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const count = ids.filter((id) => hidden.has(id)).length;
  const found = ids.filter((id) => id.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (!next.delete(id)) next.add(id);
    onHidden(next);
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      width={272}
      button={
        <button
          type="button"
          className="ismGrid__selector"
          onClick={() => setOpen(!open)}
          data-test-subj="dataGridColumnSelectorButton"
        >
          {/* The original's small empty button draws its icon small */}
          <Icon name="list" size="s" />
          {count > 0 ? `${count} columns hidden` : 'Columns'}
        </button>
      }
    >
      <div className="ismGridColumns" data-test-subj="dataGridColumnSelectorPopover">
        <div className="ismGridColumns__search">
          <SearchField compact value={search} onChange={setSearch} placeholder="Search" aria-label="Search columns" autoFocus />
        </div>
        <div className="ismGridColumns__list">
          {found.map((id) => (
            <Switch key={id} checked={!hidden.has(id)} onChange={() => toggle(id)} label={id} />
          ))}
        </div>
        <div className="ismGridColumns__footer">
          <button type="button" className="atlLinkButton" onClick={() => onHidden(new Set())}>
            Show all
          </button>
          <button type="button" className="atlLinkButton" onClick={() => onHidden(new Set(ids))}>
            Hide all
          </button>
        </div>
      </div>
    </Popover>
  );
}

export function SampleGrid({
  label,
  columns,
  initiallyShown,
  rowCount,
  cell,
  paged,
  highlight,
}: {
  label: string;
  columns: GridColumn[];
  /** How many columns are shown at first; all of them when it is not said, and again whenever they change */
  initiallyShown?: number;
  rowCount: number;
  cell: (row: number, columnId: string) => string;
  paged?: boolean;
  /** A row under the pointer stands out */
  highlight?: boolean;
}) {
  const ids = useMemo(() => columns.map((column) => column.id), [columns]);
  const key = ids.join('\n');
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(initiallyShown === undefined ? [] : ids.slice(initiallyShown))
  );
  // Columns that change: a grid that shows all shows all again; one that shows a few keeps the new ones hidden
  const known = useRef(ids);
  useEffect(() => {
    const before = known.current;
    known.current = ids;
    if (before.join('\n') === key) return;
    if (initiallyShown === undefined) setHidden(new Set());
    else if (before.length === 0) setHidden(new Set(ids.slice(initiallyShown)));
    else setHidden((was) => new Set([...was, ...ids.filter((id) => !before.includes(id))]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const pages = Math.max(1, Math.ceil(rowCount / size));
  const shownPage = Math.min(page, pages - 1);
  const first = paged ? shownPage * size : 0;
  const last = paged ? Math.min(rowCount, first + size) : rowCount;
  const rows = Array.from({ length: Math.max(0, last - first) }, (_unused, at) => first + at);
  const visible = columns.filter((column) => !hidden.has(column.id));

  return (
    <div className="ismGrid" data-test-subj="dataGridWrapper">
      <div className="ismGrid__toolbar">
        <ColumnSelector ids={ids} hidden={hidden} onHidden={setHidden} />
      </div>
      <div className="ismGrid__scroll">
        <table
          className={cx('ismGrid__table', highlight && 'ismGrid__table--highlight')}
          style={{ minWidth: visible.length * 100 }}
          aria-label={label}
        >
          <thead>
            <tr data-test-subj="dataGridHeader">
              {/* Two columns may have one name: the same option taken twice */}
              {visible.map((column, at) => (
                <th key={`${at}:${column.id}`} scope="col" data-test-subj={`dataGridHeaderCell-${column.id}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                {visible.map((column, at) => {
                  const text = cell(row, column.id);
                  return (
                    <td key={`${at}:${column.id}`} title={text} data-test-subj="dataGridRowCell">
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paged && (
        <Pagination
          page={shownPage}
          pages={pages}
          onPage={setPage}
          pageSize={size}
          pageSizes={PAGE_SIZES}
          onPageSize={(next) => {
            setSize(next);
            setPage(0);
          }}
        />
      )}
    </div>
  );
}

/** The name of a column in a heading, cut when it is long, with what can be done to it at its right */
export function GridHeading({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <div className="ismGrid__heading">
      <b className="atlTruncate" title={name}>
        {name}
      </b>
      {children}
    </div>
  );
}
