/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Repositories: the places snapshots are kept in. The list of them, the flyout that registers
 * one and the dialog that removes some.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/basic';
import { SearchField } from '../../components/form';
import { searchItems } from '../../lib/search_syntax';
import { useBreadcrumbs } from '../../shell/state';
import { LocalTable, ism, toasts, type TableColumn } from './common';
import { CRUMBS } from './routes';
import {
  distinct,
  fieldValues,
  snapshotCountsWarning,
  truncate,
  withFieldValues,
  type Repository,
} from './snapshot_model';
import {
  CreateRepositoryFlyout,
  DeleteDialog,
  FilterGroup,
  GroupFilter,
  ListPanel,
} from './snapshot_parts';

const COLUMNS: Array<TableColumn<Repository>> = [
  {
    field: 'id',
    name: 'Repository name',
    sortable: true,
    width: '15%',
    render: (row) => <span title={row.id}>{truncate(row.id, 30)}</span>,
  },
  { field: 'type', name: 'Type', sortable: true, width: '10%', render: (row) => row.type },
  {
    field: 'snapshotCount',
    name: 'Snapshot count',
    sortable: true,
    width: '80%',
    render: (row) => row.snapshotCount,
  },
];

export const SMALL_PAGE_SIZES = [10, 25, 50];

export function Repositories() {
  useBreadcrumbs([CRUMBS.SNAPSHOT_MANAGEMENT, CRUMBS.REPOSITORIES]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Repository[]>([]);
  // What the box shows, and what was last searched for: the list is searched when Enter is pressed
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<'create' | 'delete'>();
  const here = useRef(true);

  const load = async () => {
    setLoading(true);
    const answer = await ism.get<Repository[]>('_repositores');
    if (!here.current) return;
    if (answer.ok) {
      const found = answer.response ?? [];
      setRepositories(found);
      setSelected((before) => found.filter((row) => before.some((item) => item.id === row.id)));
    } else {
      toasts.danger(answer.error || 'There was a problem loading the repositories.');
    }
    setLoading(false);
  };
  useEffect(() => {
    here.current = true;
    void load();
    return () => {
      here.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The dialog has closed already, as the plugin's: each deletion is told as it is done
  const remove = async () => {
    for (const repository of selected) {
      const answer = await ism.delete(`_repositores/${encodeURIComponent(repository.id)}`);
      if (answer.ok) toasts.success(`Deleted repository ${repository.id}.`);
      else toasts.danger(answer.error || 'There was a problem deleting the repository.');
    }
    if (here.current) await load();
  };

  const filter = (types: string[]) => {
    const next = withFieldValues(text, 'type', types);
    setText(next);
    setSearch(next);
  };

  const shown = searchItems(
    repositories as unknown as Array<Record<string, unknown>>,
    search
  ) as unknown as Repository[];
  return (
    <>
      <ListPanel
        title="Repositories"
        description="Repositories are remote storage locations used to store snapshots."
        actions={
          <>
            <Button icon="refresh" onClick={() => void load()} testId="refreshButton">
              Refresh
            </Button>
            <Button
              variant="danger"
              disabled={selected.length === 0}
              onClick={() => setDialog('delete')}
              testId="deleteButton"
            >
              Delete
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setDialog('create')}>
              Create repository
            </Button>
          </>
        }
      >
        <div className="ismSearchRow">
          <div className="atlGrow">
            <SearchField
              compact
              value={text}
              onChange={(value) => {
                setText(value);
                if (value === '') setSearch('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSearch(text);
              }}
              placeholder="Search repository"
              aria-label="Search repository"
            />
          </div>
          <FilterGroup>
            <GroupFilter
              name="Type"
              options={distinct(repositories.map((row) => row.type))}
              selected={fieldValues(text, 'type')}
              onChange={filter}
            />
          </FilterGroup>
        </div>
        <LocalTable
          columns={COLUMNS}
          rows={shown}
          rowId={(row) => row.id}
          pageSizes={SMALL_PAGE_SIZES}
          selected={selected}
          onSelect={setSelected}
          empty={loading ? 'Loading repositories...' : 'No items found'}
        />
      </ListPanel>
      {dialog === 'create' && (
        <CreateRepositoryFlyout
          onClose={() => setDialog(undefined)}
          onCreated={async () => {
            setDialog(undefined);
            await load();
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteDialog
          type="repository"
          ids={selected.map((row) => row.id).join(', ')}
          warning={snapshotCountsWarning(selected)}
          confirm
          onCancel={() => setDialog(undefined)}
          onDelete={() => void remove()}
        />
      )}
    </>
  );
}
