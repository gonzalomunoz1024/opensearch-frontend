/* SPDX-License-Identifier: Apache-2.0 */

/* Inspect: the data behind what is on screen as a table, and the requests that fetched it. */

import { useMemo, useState } from 'react';
import { Button, CodeBlock, EmptyPrompt, Tabs } from '../components/basic';
import { Select } from '../components/form';
import { Flyout, copyText, downloadFile } from '../components/overlay';
import { DataTable } from '../components/table';
import type { Table } from '../lib/aggs';
import { toCsv } from '../lib/docs';
import { services } from '../services';
import { totalOf, type RequestRecord, type SearchResponse } from '../services/search';
import { VegaDebugView, type VegaDebugValues } from '../vis/vega/debug_view';

export interface InspectorProps {
  title: string;
  requests: RequestRecord[];
  /** The table a visualization is drawn from */
  table?: Table;
  /** The view and spec of a Vega visualization */
  vega?: VegaDebugValues;
  onClose: () => void;
}

/** A table as a CSV file, with values as shown or as stored */
export function tableToCsv(table: Table, formatted: boolean): string {
  return toCsv(
    table.columns.map((column) => column.name),
    table.rows.map((row) =>
      table.columns.map((column) => {
        const value = row[column.id];
        if (formatted) return column.format(value);
        return value !== null && typeof value === 'object' ? column.format(value) : value;
      })
    ),
    services.uiSettings.get('csv:separator', ','),
    services.uiSettings.get('csv:quoteValues', true)
  );
}

function DataView({ table, title }: { table: Table; title: string }) {
  return (
    <div className="atlStack">
      <div className="atlRow" style={{ justifyContent: 'flex-end' }}>
        <Button
          size="s"
          icon="download"
          onClick={() => downloadFile(`${title || 'unsaved'}.csv`, tableToCsv(table, true), 'text/csv')}
          testId="inspectorDownloadFormattedCsv"
        >
          Formatted CSV
        </Button>
        <Button
          size="s"
          icon="download"
          onClick={() => downloadFile(`${title || 'unsaved'}.csv`, tableToCsv(table, false), 'text/csv')}
        >
          Raw CSV
        </Button>
      </div>
      <DataTable
        compact
        rows={table.rows.map((row, index) => ({ row, index }))}
        rowId={(item) => String(item.index)}
        columns={table.columns.map((column) => ({
          id: column.id,
          name: column.name,
          render: (item: { row: Record<string, unknown> }) => column.format(item.row[column.id]),
          sortValue: (item: { row: Record<string, unknown> }) => {
            const value = item.row[column.id];
            return typeof value === 'number' || typeof value === 'string' ? value : column.format(value);
          },
        }))}
      />
    </div>
  );
}

function RequestsView({ requests }: { requests: RequestRecord[] }) {
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState('statistics');
  const request = requests[Math.min(selected, requests.length - 1)];
  const response = request?.response as SearchResponse | undefined;
  const body = useMemo(() => JSON.stringify(request?.body ?? {}, null, 2), [request]);
  const answer = useMemo(() => JSON.stringify(request?.response ?? {}, null, 2), [request]);
  if (!request) return <EmptyPrompt title="No requests logged">The element has not logged any requests yet.</EmptyPrompt>;
  const text = tab === 'request' ? body : answer;
  return (
    <div className="atlStack">
      {requests.length > 1 && (
        <Select
          value={String(selected)}
          onChange={(value) => setSelected(Number(value))}
          options={requests.map((item, index) => ({ value: String(index), label: item.name }))}
          aria-label="Request"
        />
      )}
      <Tabs
        selected={tab}
        onSelect={setTab}
        tabs={[
          { id: 'statistics', label: 'Statistics' },
          { id: 'request', label: 'Request' },
          { id: 'response', label: 'Response' },
        ]}
      />
      {tab === 'statistics' ? (
        <dl className="atlDescriptionList" data-test-subj="inspectorRequestDetailStatistics">
          <dt>Index</dt>
          <dd>{request.index}</dd>
          {request.error && (
            <>
              <dt>Error</dt>
              <dd>{request.error}</dd>
            </>
          )}
          {response?.hits && (
            <>
              <dt>Hits (total)</dt>
              <dd>{totalOf(response).toLocaleString()}</dd>
              <dt>Hits</dt>
              <dd>{response.hits.hits.length.toLocaleString()}</dd>
            </>
          )}
          {response?.took !== undefined && (
            <>
              <dt>Query time</dt>
              <dd>{response.took}ms</dd>
            </>
          )}
          {request.tookMs !== undefined && (
            <>
              <dt>Request duration</dt>
              <dd>{request.tookMs}ms</dd>
            </>
          )}
          <dt>Request timestamp</dt>
          <dd>{new Date(request.startedAt).toISOString()}</dd>
        </dl>
      ) : (
        <>
          <div className="atlRow" style={{ justifyContent: 'flex-end' }}>
            <Button size="s" icon="copy" onClick={() => copyText(text)}>
              Copy to clipboard
            </Button>
          </div>
          <CodeBlock>{text.length > 400000 ? `${text.slice(0, 400000)}\n… cut short` : text}</CodeBlock>
        </>
      )}
    </div>
  );
}

export function Inspector({ title, requests, table, vega, onClose }: InspectorProps) {
  const [view, setView] = useState(table ? 'data' : 'requests');
  // the views in the original's order: what the element has to show decides which there are
  const views = [
    ...(table ? [{ value: 'data', label: 'View: Data' }] : []),
    { value: 'requests', label: 'View: Requests' },
    ...(vega ? [{ value: 'vega', label: 'View: Vega debug' }] : []),
  ];
  return (
    <Flyout title={title || 'Inspector'} onClose={onClose} wide testId="inspectorPanel">
      <div className="atlStack">
        {views.length > 1 && (
          <Select
            value={view}
            onChange={setView}
            options={views}
            style={{ width: 200 }}
            aria-label="View"
            testId="inspectorViewChooser"
          />
        )}
        {view === 'data' && table ? (
          <DataView table={table} title={title} />
        ) : view === 'vega' && vega ? (
          <VegaDebugView values={vega} />
        ) : (
          <RequestsView requests={requests} />
        )}
      </div>
    </Flyout>
  );
}
