/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The list a kind of saved object opens with, as the original's table list view draws it: a
 * heading and its create button, a search box, and a table that sorts, pages and selects what the
 * search found, with the selected ones deleted after a confirmation.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, CallOut, Link, cx } from '../components/basic';
import { Icon, type IconName } from '../components/icon';
import { ConfirmModal, ContextMenu, Popover } from '../components/overlay';
import { Pagination } from '../components/table';
import { formatDate } from '../lib/dates';
import { services } from '../services';
import { errorMessage } from '../services/http';
import type { SavedObject } from '../services/saved_objects';
import { compareAsOriginal, compareListed, pageSizeOptions } from './listing_model';
import '../styles/listing.css';

export interface ListedAttributes {
  title?: string;
  description?: string;
  [other: string]: unknown;
}

export type Listed = SavedObject<ListedAttributes>;

export interface ListingColumn {
  /** The field the original's column shows, which names it in its test ids */
  field: string;
  name: string;
  /** What the column shows and sorts by; nothing where the object has none, which sorts last */
  value: (object: Listed) => string | undefined;
  render?: (object: Listed) => ReactNode;
}

export interface ListingProps {
  title: string;
  /** The id of the heading the page is labelled by */
  headingId: string;
  /** What one is called and what several are called: "dashboard", "dashboards" */
  entity: string;
  entities: string;
  types: string[];
  fields?: string[];
  searchFields?: string[];
  /** The button at the top: the original's "Create {entity}" */
  createLabel: string;
  createTo?: string;
  onCreate?: () => void;
  linkTo: (object: Listed) => string;
  /** The test id of a title's link: `dashboardListingTitleLink-...` */
  titleTestId: (title: string) => string;
  editTo?: (object: Listed) => string;
  /** The column between the title and the description */
  typeColumn: ListingColumn;
  /** What the page shows when there is nothing at all to list */
  noItems: ReactNode;
  /** The space around the page: the original's 'm' (16px) or 'l' (24px) */
  padding?: 'm' | 'l';
  /** The search the page opens with */
  initialFilter?: string;
  /**
   * How a failed delete is told: 'first' as the original's dashboards do (one message, for the
   * first that failed), 'each' as its visualizations do (one for each)
   */
  deleteErrors: { title: string; per: 'first' | 'each' };
  /** Which of the objects found are listed: all of them unless it says otherwise */
  keep?: (object: Listed) => boolean;
  /**
   * Whose title the original draws as a button and not as a link: what another application opens.
   * It stays a link here, and stands as the original's where it takes two lines.
   */
  titleAsButton?: (object: Listed) => boolean;
}

interface Sort {
  field: string;
  direction: 'asc' | 'desc';
}

export function Listing({
  title,
  headingId,
  entity,
  entities,
  types,
  fields = ['title', 'description'],
  searchFields = ['title^3', 'description'],
  createLabel,
  createTo,
  onCreate,
  linkTo,
  titleTestId,
  editTo,
  typeColumn,
  noItems,
  padding = 'm',
  initialFilter = '',
  deleteErrors,
  keep,
  titleAsButton,
}: ListingProps) {
  const [filter, setFilter] = useState(initialFilter);
  const [found, setFound] = useState<{ objects: Listed[] }>();
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tick, setTick] = useState(0);
  const [sort, setSort] = useState<Sort>();
  const [page, setPage] = useState(0);
  const initialPageSize = services.uiSettings.get<number>('savedObjects:perPage', 20);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const limit = services.uiSettings.get<number>('savedObjects:listingLimit', 1000);
  const dateFormat = services.uiSettings.get<string>('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS');
  const typeKey = types.join(',');
  const fieldKey = fields.join(',');
  const searchFieldKey = searchFields.join(',');
  const started = useRef(false);
  const tableId = useId();

  // The original waits 300ms after the last key before it searches; the first list comes at once.
  // It finds at most `listingLimit` objects and, for both its dashboards and its visualizations,
  // counts those it found (`total: list.length`, `total: hits.length`): its "Listing limit
  // exceeded" call-out never shows there, so there is none here.
  useEffect(() => {
    let live = true;
    setFetching(true);
    const timer = window.setTimeout(
      () => {
        services.savedObjects
          .find<ListedAttributes>({
            type: typeKey.split(','),
            search: filter ? `${filter}*` : undefined,
            searchFields: searchFieldKey.split(','),
            fields: fieldKey.split(','),
            perPage: limit,
            page: 1,
            defaultSearchOperator: 'AND',
          })
          .then((answer) => {
            if (!live) return;
            const kept = keep ? answer.saved_objects.filter((object) => keep(object)) : answer.saved_objects;
            const objects = filter
              ? kept
              : [...kept].sort((a, b) =>
                  compareAsOriginal(a.attributes.title ?? '', b.attributes.title ?? '')
                );
            setFound({ objects });
            setFetchError(undefined);
            setFetching(false);
          })
          .catch((failure) => {
            if (!live) return;
            setFound({ objects: [] });
            setFetchError(errorMessage(failure));
            setFetching(false);
          });
      },
      started.current ? 300 : 0
    );
    started.current = true;
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [typeKey, fieldKey, searchFieldKey, filter, limit, tick, keep]);

  const columns: ListingColumn[] = useMemo(
    () => [
      {
        field: 'title',
        name: 'Title',
        value: (object) => object.attributes.title,
        render: (object) => (
          <Link
            to={linkTo(object)}
            testId={titleTestId(object.attributes.title ?? '')}
            className={titleAsButton?.(object) ? 'shlListing__buttonTitle' : undefined}
          >
            {object.attributes.title ?? ''}
          </Link>
        ),
      },
      typeColumn,
      { field: 'description', name: 'Description', value: (object) => object.attributes.description },
      {
        field: 'updated_at',
        name: 'Last updated',
        value: (object) => object.updated_at,
        render: (object) =>
          object.updated_at ? formatDate(new Date(object.updated_at), dateFormat, services.timeZone()) : '',
      },
    ],
    [linkTo, titleTestId, typeColumn, dateFormat, titleAsButton]
  );

  const objects = useMemo(() => found?.objects ?? [], [found]);
  const sorted = useMemo(() => {
    const column = sort && columns.find((candidate) => candidate.field === sort.field);
    if (!sort || !column) return objects;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...objects].sort((a, b) => compareListed(column.value(a), column.value(b)) * direction);
  }, [objects, columns, sort]);

  // New results start on the first page, as the original's do
  useEffect(() => setPage(0), [objects]);
  const pages = Math.ceil(sorted.length / pageSize);
  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const idOf = (object: Listed) => `${object.type}:${object.id}`;
  const visibleIds = visible.map(idOf);
  const visibleKey = visibleIds.join('\n');
  // What is selected is on the page shown; what left it is no longer selected
  useEffect(() => {
    const shown = visibleKey.split('\n');
    setSelected((was) => {
      const kept = was.filter((id) => shown.includes(id));
      return kept.length === was.length ? was : kept;
    });
  }, [visibleKey]);

  const chosen = objects.filter((object) => selected.includes(idOf(object)));
  const remove = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    const results = await Promise.allSettled(chosen.map((object) => services.savedObjects.delete(object.type, object.id)));
    const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason as unknown] : []));
    for (const failure of deleteErrors.per === 'first' ? failures.slice(0, 1) : failures) {
      const error = failure instanceof Error ? failure : new Error(errorMessage(failure));
      services.toasts.addError(error, { title: deleteErrors.title });
    }
    setTick((count) => count + 1);
    setDeleting(false);
    setSelected([]);
    setConfirming(false);
  }, [chosen, deleting, deleteErrors]);

  const changeSort = (field: string) => {
    setSort((was) => ({ field, direction: was?.field === field && was.direction === 'asc' ? 'desc' : 'asc' }));
    setPage(0);
    setSelected([]);
  };
  const changePage = (next: number) => {
    setPage(next);
    setSelected([]);
  };

  const nothingAtAll = found && !fetching && !fetchError && found.objects.length === 0 && !filter;
  const allTicked = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const someTicked = !allTicked && visibleIds.some((id) => selected.includes(id));
  const count = selected.length;
  const counted = `${count} ${count === 1 ? entity : entities}`;

  const table = (
    <div className={cx('shlListing__tableWrap', fetching && 'shlListing__tableWrap--loading')}>
      {/* On a narrow screen, as the original's: over the rows, which are cards, the box that ticks
          them all and the menu that sorts them; the table's header is not shown there */}
      <div className="shlListing__mobileHead">
        <label className="shlListing__selectAll">
          <Tick
            checked={allTicked}
            indeterminate={someTicked}
            disabled={visibleIds.length === 0}
            label="Select all rows"
            testId="checkboxSelectAll"
            onChange={(checked) => setSelected(checked ? visibleIds : [])}
          />
          <span>Select all rows</span>
        </label>
        <SortingMenu columns={columns} sort={sort} onSort={changeSort} />
      </div>
      {/* The pages under it name it as what they turn, and hand it the focus when they do */}
      <table id={tableId} tabIndex={-1} className="shlListing__table" data-test-subj="itemsInMemTable">
        <caption className="shlListing__caption">
          This table contains {visible.length} rows out of {sorted.length} rows; Page {page + 1} of {Math.max(1, pages)}.
        </caption>
        <thead>
          <tr>
            <th className="shlListing__checkCell" scope="col">
              <div className="shlListing__cell">
                <Tick
                  checked={allTicked}
                  indeterminate={someTicked}
                  disabled={visibleIds.length === 0}
                  label="Select all rows"
                  testId="checkboxSelectAll"
                  onChange={(checked) => setSelected(checked ? visibleIds : [])}
                />
              </div>
            </th>
            {columns.map((column, index) => {
              const direction = sort?.field === column.field ? sort.direction : undefined;
              const describe = column.field === 'updated_at' ? 'Last update of the saved object' : undefined;
              return (
                <th
                  key={column.field}
                  scope="col"
                  aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  data-test-subj={`tableHeaderCell_${column.field}_${index}`}
                >
                  <button
                    type="button"
                    className={cx('shlListing__sort', direction && 'shlListing__sort--sorted')}
                    data-test-subj="tableHeaderSortButton"
                    onClick={() => changeSort(column.field)}
                  >
                    <span className="shlListing__cell">
                      <span className="shlListing__text" title={describe ? `${column.name}; ${describe}` : column.name}>
                        {column.name}
                      </span>
                      {describe && <span className="atlScreenReaderOnly">{describe}</span>}
                      {direction && <Icon name={direction === 'asc' ? 'sortUp' : 'sortDown'} className="shlListing__sortIcon" />}
                    </span>
                  </button>
                </th>
              );
            })}
            {editTo && (
              <th scope="col" className="shlListing__actionsCell">
                <span className="shlListing__cell shlListing__cell--right">
                  <span className="shlListing__text" title="Actions">
                    Actions
                  </span>
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {visible.map((object) => {
            const id = idOf(object);
            const ticked = selected.includes(id);
            return (
              <tr
                key={id}
                className={cx('shlListing__row', ticked && 'shlListing__row--selected', editTo && 'shlListing__row--actions')}
              >
                <td className="shlListing__checkCell">
                  <div className="shlListing__cell">
                    <Tick
                      checked={ticked}
                      label="Select this row"
                      testId={`checkboxSelectRow-${object.id}`}
                      onChange={(checked) =>
                        setSelected((was) => (checked ? [...was, id] : was.filter((other) => other !== id)))
                      }
                    />
                  </div>
                </td>
                {columns.map((column) => (
                  <td key={column.field} data-test-subj={column.field === 'updated_at' ? 'updated-at' : undefined}>
                    <div className="shlListing__mobileHeader">{column.name}</div>
                    <div className="shlListing__cell">
                      {column.render ? column.render(object) : <span className="shlListing__text">{column.value(object)}</span>}
                    </div>
                  </td>
                ))}
                {editTo && (
                  <td className="shlListing__actionsCell">
                    <div className="shlListing__cell shlListing__cell--right">
                      <EditAction to={editTo(object)} />
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={columns.length + (editTo ? 2 : 1)}>
                <div className="shlListing__cell shlListing__cell--center">No {entities} matched your search.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > 0 && (
        <TablePagination
          page={page}
          pages={pages}
          pageSize={pageSize}
          sizes={pageSizeOptions(initialPageSize)}
          onPage={changePage}
          onPageSize={(size) => {
            setPageSize(size);
            changePage(0);
          }}
          controls={tableId}
          arrowNames="plain"
        />
      )}
    </div>
  );

  return (
    <div className={cx('shlListing', `shlListing--${padding}`)} data-test-subj={`${entity}LandingPage`}>
      <main className="shlListing__body" aria-labelledby={found ? headingId : undefined}>
        {found &&
          (nothingAtAll ? (
            <div className="shlListing__content shlListing__content--empty">{noItems}</div>
          ) : (
            <div className="shlListing__content">
              <div className="shlListing__top" data-test-subj="top-nav">
                <h1 id={headingId} className="shlListing__title">
                  {title}
                </h1>
                <Button variant="primary" icon="plus" to={createTo} onClick={onCreate} testId="newItemButton" className="shlListing__create">
                  {createLabel}
                </Button>
              </div>
              {fetchError && (
                <div className="shlListing__callout">
                  <CallOut tone="critical" icon="warning" title="Fetching listing failed">
                    <p>
                      The {entity} listing could not be fetched: {fetchError}.
                    </p>
                  </CallOut>
                </div>
              )}
              <div className="shlListing__tools">
                {count > 0 && (
                  <Button variant="dangerOutline" icon="trash" onClick={() => setConfirming(true)} testId="deleteSelectedItems" className="shlListing__delete">
                    Delete {counted}
                  </Button>
                )}
                <label className="shlListing__search">
                  <Icon name="search" />
                  <input
                    type="search"
                    placeholder="Search..."
                    aria-label="This is a search bar. As you type, the results lower in the page will automatically filter."
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    data-test-subj="tableListSearchBox"
                  />
                  {filter && (
                    <button
                      type="button"
                      className="shlListing__clear"
                      aria-label="Clear search input"
                      data-test-subj="clearSearchButton"
                      onClick={() => setFilter('')}
                    >
                      <Icon name="cross" />
                    </button>
                  )}
                </label>
              </div>
              {table}
            </div>
          ))}
      </main>
      {confirming && (
        <ConfirmModal
          title={`Delete ${counted}?`}
          confirmLabel={deleting ? 'Deleting' : 'Delete'}
          danger
          focusCancel
          narrow
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        >
          <p>You can't recover deleted {entities}.</p>
        </ConfirmModal>
      )}
    </div>
  );
}

/**
 * The original's table pagination, "Rows per page" with its sizes and up to five page buttons: the
 * kit's, under the name the pages that list saved objects know it by
 */
export function TablePagination({
  page,
  pages,
  pageSize,
  sizes,
  onPage,
  onPageSize,
  controls,
  arrowNames,
}: {
  page: number;
  pages: number;
  pageSize: number;
  sizes: number[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** The id of the table the pages turn, which takes the focus when they do */
  controls?: string;
  /** 'plain' where the original's own translations name the arrows: the lists of saved objects */
  arrowNames?: 'numbered' | 'plain';
}) {
  return (
    <Pagination
      className="shlListing__pagination"
      page={page}
      pages={pages}
      onPage={onPage}
      pageSize={pageSize}
      pageSizes={sizes}
      onPageSize={onPageSize}
      controls={controls}
      arrowNames={arrowNames}
    />
  );
}

/** What a list with nothing in it says instead, as the original's empty prompt lays it out */
export function ListingEmpty({
  icon,
  title,
  headingId,
  children,
  actions,
}: {
  icon: IconName;
  title: string;
  headingId: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="shlListing__empty">
      <Icon name={icon} size="xl" className="shlListing__emptyIcon" />
      <h1 id={headingId} className="shlListing__emptyTitle">
        {title}
      </h1>
      {children && <div className="shlListing__emptyBody">{children}</div>}
      {actions && <div className="shlListing__emptyActions">{actions}</div>}
    </div>
  );
}

/** The original's check box: a square of the theme with the native box over it, unseen */
function Tick({
  checked,
  indeterminate,
  disabled,
  label,
  testId,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  testId: string;
  onChange: (checked: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <span className={cx('shlListing__tick', checked && 'shlListing__tick--on', indeterminate && 'shlListing__tick--some')}>
      <input
        ref={input}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        title={label === 'Select this row' ? label : undefined}
        data-test-subj={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="shlListing__square">{checked && <Icon name="check" />}</span>
    </span>
  );
}

/**
 * How the rows are sorted on a narrow screen, as the original's: a menu of the columns, the one they
 * are sorted by marked with its arrow, which stays open as a choice is made
 */
function SortingMenu({
  columns,
  sort,
  onSort,
}: {
  columns: ListingColumn[];
  sort?: Sort;
  onSort: (field: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="shlListing__sorting">
      <Popover
        open={open}
        onClose={close}
        position="downRight"
        width={200}
        button={
          <Button variant="empty" size="xs" icon="chevronDown" iconSize="s" iconSide="right" onClick={() => setOpen(!open)}>
            Sorting
          </Button>
        }
      >
        <ContextMenu
          panels={[
            {
              id: 'sorting',
              items: columns.map((column) => {
                const sorted = sort?.field === column.field;
                const ascending = sorted && sort?.direction === 'asc';
                return {
                  id: column.field,
                  label: column.name,
                  icon: sorted ? (ascending ? 'sortUp' : 'sortDown') : 'empty',
                  ariaLabel: `Sort ${column.name} ${ascending ? 'descending' : 'ascending'}`,
                  onClick: () => onSort(column.field),
                };
              }),
            },
          ]}
        />
      </Popover>
    </div>
  );
}

/** The pencil of a row: a menu of one item, "Edit" */
function EditAction({ to }: { to: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <span className="shlListing__hoverItem">
      <Popover
        open={open}
        onClose={close}
        position="downLeft"
        anchorStyle={{ display: 'inline-block', verticalAlign: 'middle' }}
        button={
          <button type="button" className="shlListing__pencil" aria-label="Edit" data-test-subj="dashboardEditBtn" onClick={() => setOpen((was) => !was)}>
            <Icon name="pencil" />
          </button>
        }
      >
        <ContextMenu
          small
          onDone={close}
          panels={[{ id: 'edit', items: [{ label: 'Edit', icon: 'pencil', to, testId: 'dashboardEditDashboard' }] }]}
        />
      </Popover>
    </span>
  );
}
