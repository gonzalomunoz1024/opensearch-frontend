/* SPDX-License-Identifier: Apache-2.0 */

/* The list a kind of saved object opens with: search it, open one, create one, delete some. */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, EmptyPrompt, IconButton, Link, Loading, PageHeader, Panel } from '../components/basic';
import { SearchField } from '../components/form';
import { ConfirmModal } from '../components/overlay';
import { DataTable, type Column } from '../components/table';
import { formatDate } from '../lib/dates';
import { services } from '../services';
import type { SavedObject } from '../services/saved_objects';

export interface ListedAttributes {
  title?: string;
  description?: string;
  [other: string]: unknown;
}

export type Listed = SavedObject<ListedAttributes>;

export interface ListingProps {
  title: string;
  /** What one is called and what several are called: "dashboard", "dashboards" */
  entity: string;
  entities: string;
  types: string[];
  fields?: string[];
  createLabel: string;
  createTo?: string;
  onCreate?: () => void;
  linkTo: (object: Listed) => string;
  editTo?: (object: Listed) => string;
  extraColumns?: Array<Column<Listed>>;
  emptyBody?: ReactNode;
  /** Which of the objects found are listed: all of them unless it says otherwise */
  keep?: (object: Listed) => boolean;
  testId?: string;
}

export function Listing({
  title,
  entity,
  entities,
  types,
  fields = ['title', 'description'],
  createLabel,
  createTo,
  onCreate,
  linkTo,
  editTo,
  extraColumns = [],
  emptyBody,
  keep,
  testId,
}: ListingProps) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<{ objects: Listed[] }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const limit = services.uiSettings.get<number>('savedObjects:listingLimit', 1000);
  const typeKey = types.join(',');
  const fieldKey = fields.join(',');

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(
      () => {
        services.savedObjects
          .find<ListedAttributes>({
            type: typeKey.split(','),
            search: search.trim() ? `${search.trim().replace(/\*+$/, '')}*` : undefined,
            searchFields: ['title^3', 'description'],
            fields: fieldKey.split(','),
            perPage: limit,
          })
          .then((answer) => live && setFound({ objects: answer.saved_objects.filter((object) => !keep || keep(object)) }))
          .catch((failure) => {
            if (!live) return;
            setFound({ objects: [] });
            services.toasts.error(failure, `The ${entities} could not be listed`);
          });
      },
      search ? 250 : 0
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [typeKey, fieldKey, search, limit, entities, tick, keep]);

  const remove = useCallback(async () => {
    if (!found) return;
    setBusy(true);
    const chosen = found.objects.filter((object) => selected.includes(`${object.type}:${object.id}`));
    const results = await Promise.allSettled(chosen.map((object) => services.savedObjects.delete(object.type, object.id)));
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed) services.toasts.danger(`${failed} of ${chosen.length} could not be deleted`);
    else services.toasts.success(chosen.length === 1 ? `The ${entity} was deleted` : `${chosen.length} ${entities} were deleted`);
    setBusy(false);
    setConfirming(false);
    setSelected([]);
    setTick((count) => count + 1);
  }, [found, selected, entity, entities]);

  const createButton = (
    <Button variant="primary" icon="plus" to={createTo} onClick={onCreate} testId="newItemButton">
      {createLabel}
    </Button>
  );

  const columns: Array<Column<Listed>> = [
    {
      id: 'title',
      name: 'Title',
      render: (object) => (
        <Link to={linkTo(object)} testId={`${entity}ListingTitleLink-${(object.attributes.title ?? '').split(' ').join('-')}`}>
          {object.attributes.title || object.id}
        </Link>
      ),
      sortValue: (object) => object.attributes.title ?? '',
    },
    ...extraColumns,
    {
      id: 'description',
      name: 'Description',
      render: (object) => object.attributes.description ?? '',
      sortValue: (object) => object.attributes.description ?? '',
      truncate: true,
    },
    {
      id: 'updated',
      name: 'Last updated',
      width: 190,
      render: (object) => (object.updated_at ? formatDate(new Date(object.updated_at), 'MMM D, YYYY @ HH:mm', services.timeZone()) : ''),
      sortValue: (object) => object.updated_at ?? '',
    },
    ...(editTo
      ? [
          {
            id: 'actions',
            name: 'Actions',
            width: 72,
            render: (object: Listed) => <IconButton icon="pencil" label="Edit" to={editTo(object)} size="s" />,
          } as Column<Listed>,
        ]
      : []),
  ];

  const nothingAtAll = found && found.objects.length === 0 && search.trim() === '';
  return (
    <div className="shlPage" data-test-subj={testId}>
      <PageHeader title={title} actions={nothingAtAll ? undefined : createButton} />
      {!found ? (
        <Loading />
      ) : nothingAtAll ? (
        <Panel>
          <EmptyPrompt icon="plusCircle" title={`Create your first ${entity}`} actions={createButton}>
            {emptyBody}
          </EmptyPrompt>
        </Panel>
      ) : (
        <Panel>
          <div className="atlRow" style={{ marginBottom: 'var(--space-3)' }}>
            {selected.length > 0 && (
              <Button variant="danger" icon="trash" onClick={() => setConfirming(true)} testId="deleteSelectedItems">
                Delete {selected.length} {selected.length === 1 ? entity : entities}
              </Button>
            )}
            <div className="atlGrow">
              <SearchField value={search} onChange={setSearch} placeholder="Search..." aria-label={`Search ${entities}`} testId="tableListSearchBox" />
            </div>
          </div>
          <DataTable
            rows={found.objects}
            columns={columns}
            rowId={(object) => `${object.type}:${object.id}`}
            initialSort={{ column: 'title', direction: 'asc' }}
            pageSize={services.uiSettings.get<number>('savedObjects:perPage', 20)}
            selected={selected}
            onSelect={setSelected}
            empty={<EmptyPrompt title={`No ${entities} matched your search.`} />}
            testId="itemsInMemTable"
          />
        </Panel>
      )}
      {confirming && (
        <ConfirmModal
          title={`Delete ${selected.length === 1 ? `1 ${entity}` : `${selected.length} ${entities}`}?`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        >
          You can't recover deleted {entities}.
        </ConfirmModal>
      )}
    </div>
  );
}
