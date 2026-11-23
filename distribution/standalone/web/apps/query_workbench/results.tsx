/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The results of Query Workbench: a tab of messages, then a tab per query that worked, with
 * its rows a page at a time. A row that holds objects opens to show them, each under its name.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, IconButton, cx } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { SearchField } from '../../components/form';
import { Icon } from '../../components/icon';
import { MenuButton, Modal } from '../../components/overlay';
import { Pagination } from '../../components/table';
import {
  OUTPUT_TAB,
  PAGE_SIZES,
  cellText,
  messageText,
  nestedNames,
  nestedTable,
  searchRows,
  tabName,
  type Language,
  type ResultTable,
  type TableResult,
} from './model';

export interface ResultTab {
  id: string;
  name: string;
}

export type DownloadKind = 'jdbc' | 'csv' | 'text';

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
  onDownload: (kind: DownloadKind) => void;
}

// What is open is kept as paths: "3" is row 3, "3/geo" the object under its name "geo",
// "3/geo/0" the row that object makes, and so on down.
type Open = ReadonlySet<string>;

interface Opening {
  open: Open;
  toggle: (path: string) => void;
  /** Opens a row at one of its names and keeps both open */
  show: (row: string, name: string) => void;
}

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
    return <td className="qwbCell">{cellText(data, '').text}</td>;
  }
  const record = (data ?? {}) as Record<string, unknown>;
  return (
    <>
      {columns.map((field) => {
        const cell = cellText(record[field], field);
        return (
          <td key={field} className="qwbCell">
            {cell.link !== undefined ? (
              <button
                type="button"
                className="qwbLink"
                onClick={() => {
                  opening.show(path, field);
                  document.getElementById(`qwbRow-${path}`)?.scrollIntoView({ block: 'nearest' });
                }}
              >
                {cell.link}
              </button>
            ) : (
              cell.text
            )}
          </td>
        );
      })}
    </>
  );
}

/** A row, and under it what it holds when it is open */
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
  const isOpen = opening.open.has(path);
  return (
    <>
      <tr className={cx('qwbRow', isOpen && 'qwbRow--open')} data-test-subj={testId}>
        {expander && (
          <td className="qwbCell qwbCell--expand" id={`qwbRow-${path}`}>
            {names.length > 0 && (
              <button
                type="button"
                className="qwbExpand"
                aria-label={isOpen ? 'Collapse' : 'Expand'}
                onClick={() => opening.toggle(path)}
              >
                <Icon name={isOpen ? 'minusCircle' : 'plusCircle'} />
              </button>
            )}
          </td>
        )}
        <Cells data={data} columns={columns} path={path} opening={opening} />
      </tr>
      {isOpen && names.length > 0 && (
        <tr className="qwbRow qwbRow--detail">
          <td colSpan={span}>
            <ul className="qwbNames">
              {names.map((name) => {
                const inner = `${path}/${name}`;
                const shown = opening.open.has(inner);
                return (
                  <li key={name}>
                    <div className="qwbNames__name">
                      <button
                        type="button"
                        className="qwbExpand"
                        aria-label={shown ? 'Collapse' : 'Expand'}
                        onClick={() => opening.toggle(inner)}
                      >
                        <Icon name={shown ? 'minusCircle' : 'plusCircle'} />
                      </button>
                      <span className={cx(shown && 'qwbNames__name--open')}>{name}</span>
                    </div>
                    {shown && (
                      <Nested
                        value={(data as Record<string, unknown>)[name]}
                        path={inner}
                        opening={opening}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

/** An object as a table of one row, a list as a table of its items */
function Nested({ value, path, opening }: { value: unknown; path: string; opening: Opening }) {
  const { columns, rows } = nestedTable(value);
  // A list of plain values has no heading; a row of names may open in turn
  const expander = columns.length > 0;
  return (
    <div className="qwbNested">
      <table className="qwbTable qwbTable--nested">
        {columns.length > 0 && (
          <thead>
            <tr>
              {expander && <th className="qwbHead qwbHead--expand" />}
              {columns.map((column) => (
                <th key={column} className="qwbHead">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, index) => (
            <Rows
              key={index}
              data={row}
              columns={columns}
              path={`${path}/${index}`}
              opening={opening}
              span={columns.length + 1}
              expander={expander}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultTableView({
  table,
  language,
  name,
  search,
  onSearch,
  onDownload,
}: {
  table: ResultTable;
  language: Language;
  name: string;
  search: string;
  onSearch: (text: string) => void;
  onDownload: (kind: DownloadKind) => void;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Open>(new Set());
  const items = useMemo(() => searchRows(table.records, search), [table, search]);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const shownPage = Math.min(page, pages - 1);

  // Another table, another search, another page: nothing stays open
  useEffect(() => {
    setOpen(new Set());
    setPage(0);
  }, [table, search]);

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

  const body = (
    <>
      {language === 'SQL' && (
        <div className="qwbTableTop">
          <div className="atlGrow">
            <h4 className="atlTitleXs qwbTableTop__name">
              {name}
              <span className="qwbTableTop__count"> ({items.length})</span>
            </h4>
            <SearchField
              value={search}
              onChange={onSearch}
              placeholder="Search keyword"
              aria-label="Search keyword"
              data-test-subj="workbenchSearch"
            />
          </div>
          <MenuButton
            align="right"
            items={[
              {
                id: 'jdbc',
                label: 'Download JDBC',
                onClick: () => onDownload('jdbc'),
                testId: 'downloadJdbc',
              },
              {
                id: 'csv',
                label: 'Download CSV',
                onClick: () => onDownload('csv'),
                testId: 'downloadCsv',
              },
              {
                id: 'text',
                label: 'Download Text',
                onClick: () => onDownload('text'),
                testId: 'downloadText',
              },
            ]}
            button={(toggle) => (
              <Button
                size="s"
                icon="chevronDown"
                iconSide="right"
                onClick={toggle}
                testId="downloadButton"
              >
                Download
              </Button>
            )}
          />
        </div>
      )}
      <div className="qwbScroll">
        <table className="qwbTable">
          <thead>
            <tr>
              <th className="qwbHead qwbHead--expand" />
              {table.fields.map((field, index) => (
                <th key={`${field}/${index}`} className="qwbHead" title={field}>
                  {field}
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
      <Pagination
        page={shownPage}
        pages={pages}
        onPage={(next) => {
          setPage(next);
          setOpen(new Set());
        }}
        pageSize={pageSize}
        pageSizes={PAGE_SIZES}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(0);
          setOpen(new Set());
        }}
      />
    </>
  );
  return language === 'SQL' ? (
    <div className="qwbTableWrap">
      <div className="qwbTablePanel">{body}</div>
    </div>
  ) : (
    body
  );
}

export function Results(props: ResultsProps) {
  const { language, queries, results, messages, tab, onTab, fullScreen, onFullScreen } = props;
  const names = results.map((_, index) => tabName(language, queries[index] ?? ''));
  const tabs: ResultTab[] = [{ id: OUTPUT_TAB, name: OUTPUT_TAB }];
  results.forEach((result, index) => {
    if (result.fulfilled) tabs.push({ id: String(index), name: names[index] });
  });
  const selected = results[Number(tab.id)];
  const table = selected?.fulfilled ? selected.table : undefined;

  let content: ReactNode;
  if (results.length === 0) {
    content = (
      <div className="qwbNoResult">
        <h4 className="atlTitleXs">No result</h4>
        <p>Enter a query in the query editor above to see results.</p>
      </div>
    );
  } else {
    content = (
      <>
        <div className="atlTabs qwbTabs" role="tablist" data-test-subj="result_tab">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="atlTab"
              aria-selected={item.id === tab.id}
              onClick={() => onTab(item)}
            >
              {item.name}
            </button>
          ))}
        </div>
        {table ? (
          <ResultTableView
            table={table}
            language={language}
            name={tab.name}
            search={props.search}
            onSearch={props.onSearch}
            onDownload={props.onDownload}
          />
        ) : (
          <CodeEditor
            readOnly
            value={messageText(messages, names)}
            height={500}
            fontSize={14}
            ariaLabel="Code Editor"
            testId="workbenchOutput"
            className="qwbOutput"
          />
        )}
      </>
    );
  }

  return (
    <section className={cx('qwbResults', fullScreen && 'qwbResults--full')}>
      <div className="qwbResults__top">
        <h3 className="atlTitleS">Results</h3>
        {results.length > 0 &&
          (fullScreen ? (
            <IconButton
              icon="cross"
              label="Exit full screen"
              id="exit-fullscreen-button"
              onClick={() => onFullScreen(false)}
            />
          ) : (
            <Button
              size="s"
              icon="fullScreen"
              onClick={() => onFullScreen(true)}
              testId="fullScreenView"
            >
              Full screen view
            </Button>
          ))}
      </div>
      {content}
    </section>
  );
}

/** What a download that cannot be made says */
export function DownloadError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Modal
      title="Error"
      onClose={onClose}
      footer={
        <Button variant="primary" size="s" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
