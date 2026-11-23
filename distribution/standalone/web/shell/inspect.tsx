/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Inspect: the original's inspector (src/plugins/inspector) in its flyout under the header. Its
 * views are the data behind what is on screen as a table, with its CSV, and the requests that
 * fetched it, each with its statistics, what was asked and what came back; a Vega visualization
 * adds its debug view.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Button, EmptyPrompt, IconButton, Spinner, Tabs, cx } from '../components/basic';
import { Icon } from '../components/icon';
import { tabbablesIn, wrapTab } from '../components/layers';
import { Popover, Portal, Tooltip, downloadFile, useLayer } from '../components/overlay';
import { DataTable } from '../components/table';
import type { AggContext, Table, TableRow } from '../lib/aggs';
import type { Filter } from '../lib/types';
import { services } from '../services';
import { stringifyJson } from '../services/http';
import type { RequestRecord } from '../services/search';
import { cellFilters } from '../vis/table_data';
import { VegaDebugView, type VegaDebugValues } from '../vis/vega/debug_view';
import {
  csvFileName,
  filterRowIndex,
  filterableColumn,
  inspectorCsv,
  inspectorTitle,
  inspectorViews,
  jsonRuns,
  requestDetails,
  requestStatistics,
  requestStatus,
  requestsMadeText,
  sortValueOf,
  type InspectorView,
  type RequestDetail,
} from './inspect_model';
import { copySelection } from './share_menu';

export interface InspectorProps {
  /**
   * What is inspected: the flyout's title and the name of its CSV. "Inspector" when it is not
   * given, as the original's; an empty one stays empty, and its CSV is "unsaved.csv".
   */
  title?: string;
  requests: RequestRecord[];
  /** The table a visualization is drawn from */
  table?: Table;
  /** The view and spec of a Vega visualization */
  vega?: VegaDebugValues;
  /**
   * Adds the filters of a cell's "Filter for value" and "Filter out value", as the original's add
   * them to the page's; given it and `context`, the cells of the buckets have these buttons
   */
  onFilter?: (filters: Filter[]) => void;
  /** What the table's buckets are made filters with: the index pattern and the settings of its search */
  context?: AggContext;
  onClose: () => void;
}

/** A table as a CSV file, with values as shown or as stored, as the original's "Download CSV" */
export function tableToCsv(table: Table, formatted: boolean): string {
  return inspectorCsv(
    table,
    formatted,
    services.uiSettings.get('csv:separator', ','),
    services.uiSettings.get('csv:quoteValues', true)
  );
}

// --- A menu whose items tell more beside them --------------------------------------------------

interface TipMenuItem {
  label: ReactNode;
  /** What shows at the left of the item while the pointer or the focus is on it */
  tip?: ReactNode;
  /** A check before the chosen one, and room for it before the others */
  checked?: boolean;
  onClick: () => void;
  testId?: string;
}

/**
 * The original's small context menu of items with a tooltip each (EuiContextMenuPanel size "s"
 * with `toolTipContent` at the left): rows of 37 px, the up and down keys go round them
 */
function TipMenu({ items, checks, testId }: { items: TipMenuItem[]; checks?: boolean; testId?: string }) {
  const menu = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !menu.current) return;
    const rows = [...menu.current.querySelectorAll<HTMLElement>('.atlContextMenu__item')];
    if (rows.length === 0) return;
    event.preventDefault();
    const index = rows.findIndex((row) => row === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    rows[index < 0 ? (step > 0 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length]?.focus();
  };
  return (
    <div ref={menu} className="atlContextMenu atlContextMenu--small shlInspector__menu" role="menu" data-test-subj={testId} onKeyDown={onKeyDown}>
      {items.map((item, index) => (
        <Tooltip key={index} content={item.tip} position="left" delay="regular" block>
          <button type="button" role="menuitem" className="atlContextMenu__item" onClick={item.onClick} data-test-subj={item.testId}>
            {checks && <Icon name={item.checked ? 'check' : 'empty'} />}
            <span className="atlContextMenu__text">{item.label}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

// --- The flyout ---------------------------------------------------------------------------------

/**
 * The original's medium flyout under the header, as the inspector opens it: its close button
 * ("Close Inspector") in the corner, first to take the focus, then the title and the view chooser,
 * then the view. The page behind is dimmed and blurred; a click on it or Escape closes it, Tab goes
 * round what it holds, and the focus goes back to what opened it.
 */
function InspectorFlyout({ title, chooser, children, onClose }: { title: string; chooser: ReactNode; children: ReactNode; onClose: () => void }) {
  useLayer(true, onClose);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => {
    const element = panel.current;
    if (!element) return undefined;
    if (!element.contains(document.activeElement)) (tabbablesIn(element)[0] ?? element).focus({ preventScroll: true });
    const from = opener.current;
    return () => {
      if (!(from instanceof HTMLElement) || !from.isConnected || element.contains(from)) return;
      const now = document.activeElement;
      if (!now || now === document.body || element.contains(now)) from.focus({ preventScroll: true });
    };
  }, []);
  const holdTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    const element = panel.current;
    if (event.key !== 'Tab' || event.defaultPrevented || !element) return;
    // A popover opened from the flyout is drawn outside it and holds the focus itself
    if (!element.contains(document.activeElement)) return;
    const target = wrapTab(tabbablesIn(element), document.activeElement as HTMLElement | null, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
  return (
    <Portal>
      <div className="atlFlyoutMask shlInspector__mask" onMouseDown={onClose} />
      <aside ref={panel} className="atlFlyout shlInspector" role="dialog" tabIndex={-1} onKeyDown={holdTab} data-test-subj="inspectorPanel">
        <IconButton icon="cross" label="Close Inspector" title="" size="xs" className="shlInspector__close" onClick={onClose} testId="euiFlyoutCloseButton" />
        <div className="shlInspector__header">
          <h2 className="atlTitleM shlInspector__title">{title}</h2>
          <div className="shlInspector__chooser">{chooser}</div>
        </div>
        {/* As the original's, the body takes the focus, for the keys to scroll it */}
        <div className="shlInspector__body" tabIndex={0}>
          {children}
        </div>
      </aside>
    </Portal>
  );
}

/**
 * The view shown: its name with what it shows in a tooltip under it when it is the only one, else
 * a button that opens the menu of the views, each with its own tooltip at its left
 */
function ViewChooser({ views, selected, onSelect }: { views: InspectorView[]; selected: InspectorView; onSelect: (view: InspectorView) => void }) {
  const [open, setOpen] = useState(false);
  if (views.length < 2) {
    return (
      <Tooltip content={selected.help} position="bottom" delay="regular">
        <div className="shlInspector__viewName">View: {selected.title}</div>
      </Tooltip>
    );
  }
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      position="downRight"
      button={
        <Button variant="empty" icon="chevronDown" iconSide="right" onClick={() => setOpen(!open)} testId="inspectorViewChooser">
          View: {selected.title}
        </Button>
      }
    >
      <TipMenu
        items={views.map((view) => ({
          label: view.title,
          tip: view.help,
          onClick: () => {
            onSelect(view);
            setOpen(false);
          },
          testId: `inspectorViewChooser${view.title}`,
        }))}
      />
    </Popover>
  );
}

// --- Data ---------------------------------------------------------------------------------------

interface DataItem {
  row: TableRow;
  index: number;
}

function DataCell({ text, onFilter }: { text: string; onFilter?: (negate: boolean) => void }) {
  return (
    <div className="shlInspector__cell">
      <span className="shlInspector__value">{text}</span>
      {onFilter && (
        <span className="shlInspector__filters">
          <Tooltip content="Filter for value" position="bottom" delay="regular">
            <IconButton
              icon="plusInCircle"
              label="Filter for value"
              title=""
              className="shlInspector__filter"
              onClick={() => onFilter(false)}
              testId="filterForInspectorCellValue"
            />
          </Tooltip>
          <Tooltip content="Filter out value" position="bottom" delay="regular">
            <IconButton
              icon="minusInCircle"
              label="Filter out value"
              title=""
              className="shlInspector__filter"
              onClick={() => onFilter(true)}
              testId="filterOutInspectorCellValue"
            />
          </Tooltip>
        </span>
      )}
    </div>
  );
}

/** "Download CSV" and its menu: the values as the table shows them, or as they came */
function DownloadOptions({ table, title }: { table: Table; title: string }) {
  const [open, setOpen] = useState(false);
  const save = (formatted: boolean) =>
    // As the original's file: UTF-8 with its byte order mark, which spreadsheets read it by
    downloadFile(csvFileName(title), new Blob(['\uFEFF', tableToCsv(table, formatted)], { type: 'text/csv;charset=utf-8' }));
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      position="downCenter"
      button={
        <Button icon="chevronDown" iconSide="right" onClick={() => setOpen(!open)}>
          Download CSV
        </Button>
      }
    >
      <TipMenu
        items={[
          { label: 'Formatted CSV', tip: 'Download the data in table format', onClick: () => save(true) },
          { label: 'Raw CSV', tip: 'Download the data as provided, for example, dates as timestamps', onClick: () => save(false) },
        ]}
      />
    </Popover>
  );
}

function DataView({ table, title, onFilter, context }: { table: Table; title: string; onFilter?: (filters: Filter[]) => void; context?: AggContext }) {
  const items = useMemo(() => table.rows.map((row, index): DataItem => ({ row, index })), [table]);
  const columns = table.columns.map((column, columnIndex) => {
    const filterable = Boolean(onFilter && context && filterableColumn(column, context));
    return {
      id: column.id,
      name: column.name,
      plainOrder: true,
      sortValue: (item: DataItem) => sortValueOf(column, item.row),
      render: (item: DataItem) => {
        const value = item.row[column.id];
        const filter = (negate: boolean) => {
          if (!onFilter || !context) return;
          const filters = cellFilters(table.columns, table.rows, columnIndex, filterRowIndex(table, column, value, item.index), negate, context);
          if (filters.length) onFilter(filters);
        };
        return <DataCell text={column.format(value)} onFilter={filterable ? filter : undefined} />;
      },
    };
  });
  return (
    <div className="shlInspector__data">
      <div className="shlInspector__download">
        <DownloadOptions table={table} title={title} />
      </div>
      <DataTable rows={items} rowId={(item) => String(item.index)} columns={columns} layout="fixed" pageSize={20} pageSizes={[10, 20, 50]} testId="inspectorTable" />
    </div>
  );
}

// --- Requests -----------------------------------------------------------------------------------

/** What the original's code blocks hold beyond this is shown without its colours, to stay quick */
const COLOURED_LIMIT = 200000;

/** JSON in the original's small code block: coloured, its lines wrapped, a button in the corner copies it */
function CodeView({ text, testId }: { text: string; testId: string }) {
  const lines = useMemo(() => (text.length > COLOURED_LIMIT ? undefined : jsonRuns(text)), [text]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="shlInspector__code">
      <pre className="shlInspector__pre">
        <code className="shlInspector__json" data-test-subj={testId}>
          {lines
            ? lines.map((runs, line) => (
                <Fragment key={line}>
                  {runs.map((run, index) =>
                    run.kind ? (
                      <span key={index} className={`shlInspector__token shlInspector__token--${run.kind}`}>
                        {run.text}
                      </span>
                    ) : (
                      run.text
                    )
                  )}
                  {line < lines.length - 1 && '\n'}
                </Fragment>
              ))
            : text}
        </code>
      </pre>
      <div className="shlInspector__codeControls">
        {/* As the original's, it says that it copied over the button, until the pointer leaves */}
        <Tooltip content={copied ? 'Copied' : ''} delay="regular">
          <IconButton
            icon="copy"
            label="Copy"
            title=""
            size="xs"
            onClick={() => setCopied(copySelection(text))}
            onMouseLeave={() => setCopied(false)}
          />
        </Tooltip>
      </div>
    </div>
  );
}

/** The statistics of a request, each with a question mark that tells what it is */
function StatsTable({ request }: { request: RequestRecord }) {
  return (
    <table className="atlTable atlTable--fixed shlInspector__stats">
      <tbody>
        {requestStatistics(request).map((stat) => (
          <tr key={stat.id}>
            <td>
              <span className="shlInspector__statIcon">
                <Tooltip content={stat.description} delay="regular">
                  <span className="shlInspector__statTip" tabIndex={0} aria-label="Description" role="img">
                    <Icon name="questionInCircle" />
                  </span>
                </Tooltip>
              </span>
              {stat.label}
            </td>
            <td>{stat.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The tabs of a request: the one chosen stays while the request has it, else the first */
function RequestDetails({ request }: { request: RequestRecord }) {
  const available = requestDetails(request);
  const [chosen, setChosen] = useState<RequestDetail | undefined>(available[0]);
  const shown = chosen && available.includes(chosen) ? chosen : available[0];
  if (shown !== chosen) setChosen(shown);
  if (!shown) return null;
  return (
    <div className="shlInspector__details">
      <Tabs
        size="s"
        selected={shown}
        onSelect={(id) => setChosen(id as RequestDetail)}
        tabs={available.map((name) => ({ id: name, label: name, testId: `inspectorRequestDetail${name}` }))}
      />
      {shown === 'Statistics' && <StatsTable request={request} />}
      {shown === 'Request' && <CodeView text={stringifyJson(request.body, 2)} testId="inspectorRequestBody" />}
      {shown === 'Response' && <CodeView text={stringifyJson(request.response, 2)} testId="inspectorResponseBody" />}
    </div>
  );
}

/** "Request:", the request shown or the menu of them, and how long it took or that it is under way */
function RequestSelector({ requests, selected, onSelect }: { requests: RequestRecord[]; selected: RequestRecord; onSelect: (request: RequestRecord) => void }) {
  const [open, setOpen] = useState(false);
  const status = requestStatus(selected);
  return (
    <div className="shlInspector__selector">
      <strong className="shlInspector__requestLabel">Request:</strong>
      <div className="shlInspector__requestName">
        {requests.length <= 1 ? (
          <div className="shlInspector__singleRequest" data-test-subj="inspectorRequestName">
            {selected.name}
          </div>
        ) : (
          <Popover
            open={open}
            onClose={() => setOpen(false)}
            position="downLeft"
            button={
              <Button variant="empty" icon="chevronDown" iconSide="right" onClick={() => setOpen(!open)} testId="inspectorRequestChooser">
                {selected.name}
              </Button>
            }
          >
            <TipMenu
              checks
              testId="inspectorRequestChooserMenuPanel"
              items={requests.map((request) => {
                const state = requestStatus(request);
                return {
                  label: (
                    <span className={cx(state === 'error' && 'shlInspector__failedText')}>
                      {request.name}
                      {state === 'error' && ' (failed)'}
                      {state === 'pending' && (
                        <span className="shlInspector__menuSpinner" aria-label="Request in progress">
                          <Spinner />
                        </span>
                      )}
                    </span>
                  ),
                  tip: request.description,
                  checked: request === selected,
                  onClick: () => {
                    onSelect(request);
                    setOpen(false);
                  },
                  testId: `inspectorRequestChooser${request.name}`,
                };
              })}
            />
          </Popover>
        )}
      </div>
      {status === 'pending' ? (
        <span aria-label="Request in progress">
          <Spinner />
        </span>
      ) : (
        <Tooltip
          position="left"
          delay="regular"
          content={
            <>
              <div className="shlInspector__tipTitle">{status === 'ok' ? 'Request succeeded' : 'Request failed'}</div>
              The total time the request took.
            </>
          }
        >
          <span className={cx('shlInspector__badge', status === 'error' && 'shlInspector__badge--failed')}>
            <Icon name={status === 'ok' ? 'check' : 'cross'} size="s" />
            {selected.tookMs ?? 0}ms
          </span>
        </Tooltip>
      )}
    </div>
  );
}

function RequestsView({ requests }: { requests: RequestRecord[] }) {
  const [selected, setSelected] = useState<RequestRecord>();
  // As the original's: the request chosen stays while it is among them, else the first is shown
  const request = selected && requests.includes(selected) ? selected : requests[0];
  if (!request) {
    return (
      <div data-test-subj="inspectorNoRequestsMessage">
        <EmptyPrompt title="No requests logged">
          <p>The element hasn&apos;t logged any requests (yet).</p>
          <p>This usually means that there was no need to fetch any data or that the element has not yet started fetching data.</p>
        </EmptyPrompt>
      </div>
    );
  }
  const failed = requests.filter((item) => requestStatus(item) === 'error').length;
  return (
    <div className="shlInspector__requests">
      <p className="shlInspector__status" role="status" aria-live="polite" aria-atomic="true">
        {requestsMadeText(requests.length)}
        {failed > 0 && <span className="shlInspector__failedText">, {failed} had a failure</span>}
      </p>
      <RequestSelector requests={requests} selected={request} onSelect={setSelected} />
      {request.description && <p className="shlInspector__description">{request.description}</p>}
      <RequestDetails request={request} />
    </div>
  );
}

export function Inspector({ title, requests, table, vega, onFilter, context, onClose }: InspectorProps) {
  const views = inspectorViews({ table: table !== undefined, vega: vega !== undefined });
  const [viewId, setViewId] = useState<InspectorView['id']>(views[0].id);
  // As the original's: the view chosen stays while it is offered, else the first is shown
  const view = views.find((item) => item.id === viewId) ?? views[0];
  const shownTitle = inspectorTitle(title);
  return (
    <InspectorFlyout title={shownTitle} chooser={<ViewChooser views={views} selected={view} onSelect={(next) => setViewId(next.id)} />} onClose={onClose}>
      {view.id === 'data' && table ? (
        <DataView table={table} title={shownTitle} onFilter={onFilter} context={context} />
      ) : view.id === 'vega' && vega ? (
        <VegaDebugView values={vega} />
      ) : (
        <RequestsView requests={requests} />
      )}
    </InspectorFlyout>
  );
}
