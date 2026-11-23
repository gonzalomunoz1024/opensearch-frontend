/* SPDX-License-Identifier: Apache-2.0 */

/* Data streams: every data stream with its template and backing indexes, and what can be done to the ticked ones. */

import { useEffect, useRef, useState } from 'react';
import { Button, Health, type Tone } from '../../components/basic';
import { Tooltip, type MenuItem } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import {
  ActionsMenu,
  ExternalLink,
  SearchRow,
  Table,
  go,
  ism,
  toasts,
  useListQuery,
  type TableColumn,
} from './common';
import { ContentPanel, ContentPanelActions, ListEmpty, TitleHelp } from './content_panel';
import { pageChanges, pageQuery } from './model';
import { ClearCacheModal, FlushModal, RefreshModal } from './operations';
import { DeleteModal } from './plugin_modal';
import { CRUMBS, ROUTES } from './routes';

export const DATA_STREAM_DOCS = 'https://opensearch.org/docs/latest/opensearch/data-streams/';

export const HEALTH_TIPS: Record<string, string> = {
  green: 'All shards are assigned.',
  yellow: 'All primary shards are assigned, but one or more replica shards are unassigned.',
  red: 'One or more primary shards are unassigned, so some data is unavailable.',
};

export const HEALTH_TONES: Record<string, Tone> = {
  green: 'healthy',
  yellow: 'warning',
  red: 'critical',
};

export interface DataStream {
  name: string;
  timestamp_field?: { name: string };
  indices: Array<{ index_name: string; index_uuid?: string }>;
  generation?: number;
  status: string;
  template: string;
}

interface DataStreamRow extends DataStream {
  data_stream?: string;
  backing_indices?: number;
  store_size?: string;
  store_size_bytes?: number;
}

type Dialog = 'clearCache' | 'flush' | 'refresh' | 'delete';

function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  return left < right ? -1 : 1;
}

/** What can be done to data streams, with the dialogs that do it */
export function DataStreamsActions({
  selected,
  onDelete,
}: {
  selected: DataStream[];
  /** Called once the data streams are gone */
  onDelete: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>();
  const names = selected.map((item) => item.name);
  const operands = selected.map((item) => ({
    name: item.name,
    indices: (item.indices ?? []).map((index) => index.index_name),
  }));
  const none = selected.length === 0;
  const close = () => setDialog(undefined);

  const items: MenuItem[] = [
    {
      id: 'forceMerge',
      label: 'Force merge',
      testId: 'ForceMergeAction',
      onClick: () => go(`${ROUTES.FORCE_MERGE}/${names.join(',')}`),
    },
    {
      id: 'rollover',
      label: 'Roll over',
      disabled: selected.length > 1,
      testId: 'rolloverAction',
      // as the plugin's: the address ends in a stroke when nothing is ticked
      onClick: () => go(`${ROUTES.ROLLOVER}/${names.join(',')}`),
    },
    {
      id: 'clearCache',
      label: 'Clear cache',
      disabled: none,
      testId: 'ClearCacheAction',
      separated: true,
      onClick: () => setDialog('clearCache'),
    },
    {
      id: 'flush',
      label: 'Flush',
      disabled: none,
      testId: 'Flush Action',
      onClick: () => setDialog('flush'),
    },
    {
      id: 'refresh',
      label: 'Refresh',
      disabled: none,
      testId: 'refreshAction',
      onClick: () => setDialog('refresh'),
    },
    {
      id: 'delete',
      label: 'Delete',
      disabled: none,
      testId: 'deleteAction',
      separated: true,
      onClick: () => setDialog('delete'),
    },
  ];

  const deleteDataStreams = async () => {
    const result = await ism.request('DELETE', `/_data_stream/${names.join(',')}`);
    if (result.ok) {
      toasts.success(`Delete [${names.join(',')}] successfully`);
      close();
      onDelete();
    } else {
      toasts.danger(result.error || '');
    }
  };

  return (
    <>
      <ActionsMenu items={items} size="m" />
      {dialog === 'delete' && (
        <DeleteModal
          title="Delete data streams"
          tips="The following data streams will be permanently deleted. The backing indexes belonging to the data streams will also be deleted."
          names={names}
          onClose={close}
          onConfirm={() => void deleteDataStreams()}
        />
      )}
      {dialog === 'clearCache' && (
        <ClearCacheModal items={operands} target="data streams" onClose={close} />
      )}
      {dialog === 'flush' && <FlushModal items={operands} target="data streams" onClose={close} />}
      {dialog === 'refresh' && (
        <RefreshModal items={operands} target="data streams" onClose={close} />
      )}
    </>
  );
}

export function DataStreams() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.DATA_STREAMS]);
  const [query, setQuery] = useListQuery({ sortField: 'name' });
  const [all, setAll] = useState<DataStreamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DataStreamRow[]>([]);
  const turn = useRef(0);

  const load = async () => {
    const mine = (turn.current += 1);
    setLoading(true);
    const [streams, stats] = await Promise.all([
      ism.request<{ data_streams?: DataStream[] }>('GET', `_data_stream/*${query.search}*`),
      ism.request<{ data_streams?: Array<Partial<DataStreamRow> & { data_stream: string }> }>(
        'GET',
        `_data_stream/*${query.search}*/_stats?human=true`
      ),
    ]);
    if (mine !== turn.current) return;
    if (streams.ok && stats.ok) {
      // A data stream is listed with its size, so one without statistics is left out
      const rows = (streams.response?.data_streams ?? []).flatMap((stream) => {
        const size = (stats.response?.data_streams ?? []).find(
          (item) => item.data_stream === stream.name
        );
        return size ? [{ ...stream, ...size } as DataStreamRow] : [];
      });
      setAll(rows);
      setSelected((before) =>
        before.flatMap((item) => rows.filter((remote) => remote.name === item.name))
      );
    } else {
      toasts.danger((streams.ok ? stats.error : streams.error) || '');
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.search]);

  const field = query.sortField as keyof DataStreamRow;
  const sorted = [...all].sort((left, right) => {
    const order = compare(left[field], right[field]);
    return query.sortDirection === 'asc' ? order : -order;
  });
  const rows = sorted.slice(query.from * query.size, (query.from + 1) * query.size);
  const columns: Array<TableColumn<DataStreamRow>> = [
    {
      field: 'name',
      name: 'Data stream name',
      sortable: true,
      render: (row) => (
        <a className="ismCellLink" href={`#${ROUTES.CREATE_DATA_STREAM}/${row.name}/readonly`}>
          {row.name}
        </a>
      ),
    },
    {
      field: 'status',
      name: 'Status',
      sortable: true,
      render: (row) => {
        // written as it comes, shown with a capital
        const health = (row.status || '').toLowerCase();
        return (
          <Tooltip content={HEALTH_TIPS[health] || ''}>
            <span className="ismCapitalize">
              <Health tone={HEALTH_TONES[health]}>{health}</Health>
            </span>
          </Tooltip>
        );
      },
    },
    {
      field: 'template',
      name: 'Template',
      sortable: true,
      render: (row) => (
        <a className="ismCellLink" href={`#${ROUTES.CREATE_TEMPLATE}/${row.template}`}>
          {row.template}
        </a>
      ),
    },
    {
      field: 'backing_indices',
      name: 'Backing indexes count',
      sortable: true,
      align: 'right',
      render: (row) => row.backing_indices,
    },
    {
      field: 'store_size_bytes',
      name: 'Total size',
      sortable: true,
      align: 'right',
      render: (row) => row.store_size || '',
    },
  ];

  const filtered = query.search !== '';
  return (
    <ContentPanel
      bodyStyles={{ padding: 'initial' }}
      title={
        <>
          <h1 className="ismContentPanel__title">
            <span>Data streams</span>
          </h1>
          <TitleHelp>
            Data streams simplify the management of time-series data. Data streams are composed of
            multiple backing indexes. Search requests are routed to all backing indexes, while
            indexing requests are routed to the latest write index.{' '}
            <ExternalLink href={DATA_STREAM_DOCS} />
          </TitleHelp>
        </>
      }
      actions={
        <ContentPanelActions
          actions={[
            { text: '', children: <DataStreamsActions selected={selected} onDelete={load} /> },
            {
              text: 'Create data stream',
              buttonProps: {
                variant: 'primary',
                icon: 'plus',
                onClick: () => go(ROUTES.CREATE_DATA_STREAM),
              },
            },
          ]}
        />
      }
    >
      <SearchRow
        className="ismListControls ismListControls--edge"
        clearable
        search={query.search}
        onSearch={(search) => setQuery({ search, from: 0 })}
        placeholder="Search..."
      />
      <hr className="ismContentPanel__rule" />
      <div data-test-subj="dataStreamsTable">
        <Table
          fixed
          columns={columns}
          rows={rows}
          total={all.length}
          query={pageQuery(query)}
          onQuery={(changes) => setQuery(pageChanges(changes, query.size))}
          rowId={(row) => row.name}
          selected={selected}
          onSelect={setSelected}
          loading={loading}
          empty={
            <ListEmpty
              text={
                filtered
                  ? 'There are no data streams matching your applied filters. Reset your filters to view your data streams.'
                  : 'You have no data streams.'
              }
            >
              {filtered ? (
                // the plus is the plugin's
                <Button variant="primary" icon="plus" onClick={() => setQuery({ search: '' })}>
                  Reset filters
                </Button>
              ) : (
                <Button variant="primary" icon="plus" onClick={() => go(ROUTES.CREATE_DATA_STREAM)}>
                  Create data stream
                </Button>
              )}
            </ListEmpty>
          }
        />
      </div>
    </ContentPanel>
  );
}
