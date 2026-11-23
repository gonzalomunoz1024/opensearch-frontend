/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The results of Query Workbench, as the plugin's panel of them: a tab of messages ("Output"),
 * then a tab per query that worked, with its rows ten to a page. SQL's tables have their name,
 * a search box and the Download menu above them, in a panel of their own. A row that holds
 * objects opens under itself to list them by name, as the plugin's side navigation does, and
 * each one picked shows as a table of its own, whose rows open in turn.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Button, cx } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { SearchField } from '../../components/form';
import { Icon } from '../../components/icon';
import { ContextMenu, Modal, Popover } from '../../components/overlay';
import { Pagination } from '../../components/table';
import {
  DOWNLOADS,
  OUTPUT_TAB,
  PAGE_SIZES,
  cellText,
  messageText,
  nestedNames,
  nestedTable,
  searchRows,
  tabName,
  truncateName,
  type DownloadKind,
  type Language,
  type ResultTable,
  type TableResult,
} from './model';

export interface ResultTab {
  id: string;
  name: string;
}

export interface ResultsProps {
  language: Language;
  queries: string[];
  results: TableResult[];
  messages: string[];
  tab: ResultTab;
  onTab: (tab: ResultTab) => void;
  search: string;
  onSearch: (text: string) => void;
  fullScreen: boolean;
  onFullScreen: (on: boolean) => void;
  /** The formats the Download menu lists, in its order */
  downloads: DownloadKind[];
  onDownload: (kind: DownloadKind) => void;
  /** Counts the runs: a new one starts at the first page, with nothing open */
  runId: number;
}

// What is open is kept as paths: "3" is row 3 opened, "3/geo" its object "geo" picked, "3/geo/0"
// the first row of the table that object makes, opened, and so on down.
type Open = ReadonlySet<string>;

interface Opening {
  open: Open;
  toggle: (path: string) => void;
  /** Opens a row and picks one of its names, as a link in a cell does */
  show: (row: string, name: string) => void;
}

/** The cells of a row: plain values, and links to what a value holds */
function Cells({
  data,
  columns,
  path,
  opening,
}: {
  data: unknown;
  columns: string[];
  path: string;
  opening: Opening;
}) {
  if (columns.length === 0) {
    return (
      <td className="qwbTable__cell">
        <div className="qwbTable__content">{cellText(data, '').text}</div>
      </td>
    );
  }
  const record = (data ?? {}) as Record<string, unknown>;
  return (
    <>
      {columns.map((field) => {
        const cell = cellText(record[field], field);
        return (
          <td key={field} className="qwbTable__cell">
            <div className="qwbTable__content">
              {cell.link !== undefined ? (
                <span>
                  {' '}
                  <button
                    type="button"
                    className="qwbLink"
                    onClick={() => {
                      opening.show(path, field);
                      // The row's first cell comes to the top of the page, as the plugin scrolls
                      document.getElementById(`qwbRow-${path}`)?.scrollIntoView();
                    }}
                  >
                    {cell.link}
                  </button>
                </span>
              ) : (
                cell.text
              )}
            </div>
          </td>
        );
      })}
    </>
  );
}

/** The button that opens a row or picks a name: a plus in a circle, a minus once open */
function Expander({
  isOpen,
  onClick,
  className,
}: {
  isOpen: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cx('qwbExpander', className)}
      aria-label={isOpen ? 'Collapse' : 'Expand'}
      onClick={onClick}
    >
      <Icon name={isOpen ? 'minusInCircle' : 'plusInCircle'} />
    </button>
  );
}

/** A row, and under it, once open, the names of what it holds */
function Rows({
  data,
  columns,
  path,
  opening,
  span,
  expander,
  testId,
}: {
  data: unknown;
  columns: string[];
  path: string;
  opening: Opening;
  span: number;
  /** Whether the row begins with the cell that opens it */
  expander: boolean;
  testId?: string;
}) {
  const names = columns.length > 0 ? nestedNames(data) : [];
  const isOpen = opening.open.has(path) && names.length > 0;
  return (
    <>
      <tr className={cx('qwbTable__row', isOpen && 'qwbTable__row--open')} data-test-subj={isOpen ? undefined : testId}>
        {expander && (
          <td className="qwbTable__cell qwbTable__cell--expander" id={`qwbRow-${path}`}>
            <div className="qwbTable__content">
              {/* As EuiTableCellContent's text: as wide as the button, which it squashes in a
                  narrower column */}
              <span className="qwbTable__text">
                {names.length > 0 && <Expander isOpen={isOpen} onClick={() => opening.toggle(path)} />}
              </span>
            </div>
          </td>
        )}
        <Cells data={data} columns={columns} path={path} opening={opening} />
      </tr>
      {isOpen && (
        <tr className="qwbTable__row qwbTable__row--nav">
          <td colSpan={span} className="qwbTable__navCell">
            <div className="qwbNavWrap">
              <nav className="qwbNav">
                <div className="qwbNav__item qwbNav__item--root">
                  {/* The navigation's root, with no name: nothing to see, as the original's */}
                  <div className="qwbNav__button qwbNav__button--root" />
                  <div className="qwbNav__items">
                    {names.map((name) => {
                      const inner = `${path}/${name}`;
                      const shown = opening.open.has(inner);
                      return (
                        <div key={name} className="qwbNav__item qwbNav__item--trunk">
                          <div className={cx('qwbNav__button', shown && 'qwbNav__button--selected')}>
                            <span className="qwbNav__content">
                              <Expander
                                isOpen={shown}
                                onClick={() => opening.toggle(inner)}
                                className="qwbNav__icon"
                              />
                              <span className="qwbNav__label">{name}</span>
                            </span>
                          </div>
                          {shown && (
                            <div className="qwbNav__items">
                              {/* The table is the picked item's name, cut where the name is */}
                              <div className="qwbNav__item qwbNav__item--branch">
                                <div className="qwbNav__button qwbNav__button--selected">
                                  <span className="qwbNav__content">
                                    <span className="qwbNav__label">
                                      <Nested
                                        value={(data as Record<string, unknown>)[name]}
                                        path={inner}
                                        opening={opening}
                                      />
                                    </span>
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </nav>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** What a picked name holds: an object as a table of one row, a list as a table of its items */
function Nested({ value, path, opening }: { value: unknown; path: string; opening: Opening }) {
  const { columns, rows } = nestedTable(value);
  // An object's table begins with the column that opens it; a list's has none
  const expander = !Array.isArray(value);
  const span = columns.length + (expander ? 1 : 0);
  return (
    <div>
      <table className="qwbTable qwbTable--nested">
        <thead>
          <tr>
            {expander && <th className="qwbTable__head qwbTable__head--nestedExpander" />}
            {columns.map((column) => (
              <th key={column} className="qwbTable__head">
                <div className="qwbTable__content">
                  <span className="qwbTable__headText" title={column}>
                    {column}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Rows
              key={index}
              data={row}
              columns={columns}
              path={`${path}/${index}`}
              opening={opening}
              span={Math.max(1, span)}
              expander={expander}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Download button and its menu of formats */
function Downloads({
  kinds,
  onDownload,
}: {
  kinds: DownloadKind[];
  onDownload: (kind: DownloadKind) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      position="downLeft"
      className="qwbDownloadMenu"
      button={
        <Button className="qwbButton" icon="chevronDown" iconSide="right" onClick={() => setOpen(!open)}>
          Download
        </Button>
      }
    >
      {/* As the plugin's, the menu stays open once a format is picked */}
      <ContextMenu
        panels={[
          {
            id: 'downloads',
            items: kinds.map((kind) => ({
              id: kind,
              label: DOWNLOADS[kind].label,
              onClick: () => onDownload(kind),
            })),
          },
        ]}
      />
    </Popover>
  );
}

/** A table of a query, with its name, the search box and the Download menu for SQL */
function TableView({
  table,
  language,
  name,
  search,
  onSearch,
  downloads,
  onDownload,
  runId,
}: {
  table: ResultTable;
  language: Language;
  name: string;
  search: string;
  onSearch: (text: string) => void;
  downloads: DownloadKind[];
  onDownload: (kind: DownloadKind) => void;
  runId: number;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Open>(new Set());
  const items = useMemo(() => searchRows(table.records, search), [table, search]);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const shownPage = Math.min(page, pages - 1);

  // Another table or another run starts at the first page; a search closes what is open
  useEffect(() => setPage(0), [table, runId]);
  useEffect(() => setOpen(new Set()), [table, search, runId]);

  // The bar over the table is as wide as the table and scrolls with it
  const top = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const scrolled = body.current?.firstElementChild;
    if (scrolled && scrolled.scrollWidth !== width) setWidth(scrolled.scrollWidth);
  });
  const follow = (from: RefObject<HTMLDivElement | null>, to: RefObject<HTMLDivElement | null>) => {
    if (from.current && to.current && to.current.scrollLeft !== from.current.scrollLeft) {
      to.current.scrollLeft = from.current.scrollLeft;
    }
  };

  const opening: Opening = {
    open,
    toggle: (path) => {
      const next = new Set(open);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      setOpen(next);
    },
    show: (row, field) => setOpen(new Set([...open, row, `${row}/${field}`])),
  };

  return (
    <div className="qwbTableView">
      <div className="qwbTableTop">
        {language === 'SQL' && (
          <div className="qwbTableTop__item qwbTableTop__item--grow">
            <h4 className="qwbTableTop__name">
              {name}
              <span className="qwbTableTop__count">{` (${items.length})`}</span>
            </h4>
            <div className="qwbTableTop__search">
              <SearchField
                value={search}
                onChange={onSearch}
                placeholder="Search keyword"
                aria-label="Search keyword"
              />
            </div>
          </div>
        )}
        {language === 'SQL' && (
          <div className="qwbTableTop__item">
            <Downloads kinds={downloads} onDownload={onDownload} />
          </div>
        )}
      </div>
      <div className="qwbTableScroll">
        <div ref={top} className="qwbTableScroll__top" aria-hidden="true" onScroll={() => follow(top, body)}>
          <div style={{ width }}>{' '}</div>
        </div>
        <div ref={body} className="qwbTableScroll__body" onScroll={() => follow(body, top)}>
          <table className="qwbTable">
            <thead>
              <tr>
                <th className="qwbTable__head qwbTable__head--expander" />
                {table.fields.map((field, index) => (
                  <th key={`${field}/${index}`} className="qwbTable__head">
                    <div className="qwbTable__content">
                      <span className="qwbTable__headText" title={field}>
                        {field}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.slice(shownPage * pageSize, (shownPage + 1) * pageSize).map((row) => (
                <Rows
                  key={row.rowId}
                  data={row.data}
                  columns={table.fields}
                  path={String(row.rowId)}
                  opening={opening}
                  span={table.fields.length + 1}
                  expander
                  testId="tableRow"
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="qwbPager">
        <Pagination
          page={shownPage}
          pages={pages}
          onPage={setPage}
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          onPageSize={setPageSize}
        />
      </div>
    </div>
  );
}

/** The messages of the queries, in a read-only editor as the plugin's */
function Output({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const frame = () => box.current?.querySelector<HTMLElement>('.atlCodeEditor') ?? undefined;

  useLayoutEffect(() => {
    // As the original's editors: the text is reached through the hint, not with the Tab key
    const around = frame();
    if (around) around.tabIndex = -1;
  }, []);

  return (
    <div
      ref={box}
      className={cx('qwbCode qwbCode--sql qwbCode--output', editing && 'qwbCode--editing')}
      onFocus={(event) => {
        if (event.target === frame()) setEditing(true);
      }}
      onBlur={(event) => {
        if (event.target === frame()) setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.target !== frame()) return;
        // Out of the text, to the hint the Tab key stops on
        event.preventDefault();
        event.stopPropagation();
        flushSync(() => setEditing(false));
        hint.current?.focus();
      }}
    >
      <button
        ref={hint}
        type="button"
        className={cx('qwbCode__hint', editing && 'qwbCode__hint--inactive')}
        onClick={() => frame()?.focus()}
        data-test-subj="codeEditorHint"
      >
        <p>Press Enter to start editing.</p>
        <p>{"When you're done, press Escape to stop editing."}</p>
      </button>
      <CodeEditor
        className="qwbCode__editor"
        value={text}
        readOnly
        gutter
        fontSize={14}
        height={500}
        ariaLabel="Code Editor"
        testId="workbenchOutput"
      />
    </div>
  );
}

/** The tabs, with an arrow that lists them when they are wider than the panel */
function ResultTabs({
  tabs,
  selected,
  onTab,
}: {
  tabs: ResultTab[];
  selected: string;
  onTab: (tab: ResultTab) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [menu, setMenu] = useState(false);
  useLayoutEffect(() => {
    const element = container.current;
    if (element) setOverflows(element.scrollWidth > element.offsetWidth);
  });
  return (
    <div className="qwbTabsRow">
      <div ref={container} className="qwbTabsGroup" id="tabsContainer">
        <div className="qwbTabsGroup__item">
          <div className="qwbTabs" role="tablist" data-test-subj="result_tab">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className={cx('qwbTab', tab.id === selected && 'qwbTab--selected')}
                aria-selected={tab.id === selected}
                onClick={() => onTab(tab)}
              >
                <span className="qwbTab__content">{tab.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {overflows && (
        <div className="qwbTabsArrow">
          <Popover
            className="qwbTabsMenu"
            open={menu}
            onClose={() => setMenu(false)}
            position="downLeft"
            button={
              <button
                type="button"
                className="qwbTabsArrow__button"
                aria-label="Show all tabs"
                data-test-subj="slide-down"
                onClick={() => setMenu(!menu)}
              >
                <Icon name="chevronDown" />
              </button>
            }
          >
            <ContextMenu
              onDone={() => setMenu(false)}
              panels={[
                {
                  id: 'tabs',
                  items: tabs.map((tab) => ({
                    id: tab.id,
                    label: tab.name,
                    icon: 'empty',
                    onClick: () => onTab(tab),
                  })),
                },
              ]}
            />
          </Popover>
        </div>
      )}
    </div>
  );
}

export function Results(props: ResultsProps) {
  const { language, queries, results, messages, tab, onTab, fullScreen, onFullScreen } = props;
  // Each query's name: its index for SQL, "Events" for PPL; the Output tab writes them all
  const names = results.map((_, index) => tabName(language, queries[index] ?? ''));
  const tabs: ResultTab[] = [{ id: OUTPUT_TAB, name: truncateName(OUTPUT_TAB, 17) }];
  results.forEach((result, index) => {
    if (result.fulfilled) tabs.push({ id: String(index), name: names[index] });
  });
  const selected = results[Number(tab.id)];
  const table = selected?.fulfilled ? selected.table : undefined;

  const body = table ? (
    <TableView
      table={table}
      language={language}
      name={tab.name}
      search={props.search}
      onSearch={props.onSearch}
      downloads={props.downloads}
      onDownload={props.onDownload}
      runId={props.runId}
    />
  ) : (
    <Output text={messageText(messages, names)} />
  );

  return (
    <div className="qwbResults">
      <div className="qwbResults__head">
        <div className="qwbGroup">
          <div className="qwbGroup__item qwbGroup__item--grow">
            <h3 className="qwbResults__title">Results</h3>
          </div>
          <div className="qwbGroup__item">
            {results.length > 0 &&
              (fullScreen ? (
                <button
                  type="button"
                  id="exit-fullscreen-button"
                  className="qwbExit"
                  aria-label="Exit full screen"
                  onClick={() => onFullScreen(false)}
                >
                  <Icon name="cross" />
                </button>
              ) : (
                <Button
                  className="qwbButton"
                  icon="fullScreen"
                  onClick={() => onFullScreen(true)}
                  testId="fullScreenView"
                >
                  Full screen view
                </Button>
              ))}
          </div>
        </div>
      </div>
      {results.length === 0 ? (
        <>
          <div className="qwbSpacer qwbSpacer--xxl" />
          <div className="qwbSpacer qwbSpacer--xl" />
          <div className="qwbNoResult">
            <div>
              <h4>No result</h4>
            </div>
            <div>
              <p>Enter a query in the query editor above to see results.</p>
            </div>
          </div>
          <div className="qwbSpacer qwbSpacer--xxl" />
          <div className="qwbSpacer qwbSpacer--xl" />
        </>
      ) : (
        <>
          <ResultTabs tabs={tabs} selected={tab.id} onTab={onTab} />
          <hr className="qwbRule" />
          {language === 'SQL' && tab.name !== OUTPUT_TAB ? (
            <div className="qwbWrap">
              <div className="qwbWrap__panel">{body}</div>
            </div>
          ) : (
            body
          )}
        </>
      )}
    </div>
  );
}

/** What a download that cannot be made says */
export function DownloadError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Modal
      title="Error"
      onClose={onClose}
      className="qwbDownloadError"
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
