/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the dashboard's "Add panels" and "Replace panel" flyouts list, as the original's finder
 * lists it: everything of the types it adds that matches the search (up to the listing limit),
 * sorted by title unless searched, filtered by type, and paged in the browser.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loading } from '../../components/basic';
import { SearchField } from '../../components/form';
import { Icon, type IconName } from '../../components/icon';
import { ContextMenu, Popover } from '../../components/overlay';
import { visIcon, visType } from '../../lib/vis';
import { services } from '../../services';
import type { SavedObject } from '../../services/saved_objects';
import { TablePagination } from '../../shell/listing';
import { VIS_BUILDER_TYPE } from '../vis_builder/model';
import { finderName } from './model';

export interface PanelFinderType {
  type: string;
  name: string;
  icon: IconName;
}

export type FoundObject = SavedObject<{ title?: string; visState?: string }>;

const PAGE_SIZES = [5, 10, 15, 25];

/**
 * Whether the original lists a found object: a visualization only of a kind it knows, and of a
 * kind still being tried out only while those are turned on.
 */
function listed(object: FoundObject, labs: boolean): boolean {
  if (object.type !== 'visualization') return true;
  try {
    const kind = visType((JSON.parse(object.attributes.visState ?? '') as { type?: string }).type ?? '');
    return Boolean(kind) && (labs || kind?.stage !== 'experimental');
  } catch {
    return false;
  }
}

/** The icon of a found object: a visualization's is its kind's */
function iconOf(object: FoundObject, types: PanelFinderType[]): IconName {
  if (object.type === 'visualization') {
    try {
      const type = (JSON.parse(object.attributes.visState ?? '{}') as { type?: string }).type;
      if (type) return visIcon(type) as IconName;
    } catch {
      // the type's own icon, below
    }
  }
  return types.find((candidate) => candidate.type === object.type)?.icon ?? (object.type === VIS_BUILDER_TYPE ? 'visBuilder' : 'document');
}

export function PanelFinder({
  types,
  onChoose,
  children,
}: {
  types: PanelFinderType[];
  onChoose: (object: FoundObject, name: string) => void;
  /** Put beside the filters: the original's "Create new" */
  children?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FoundObject[]>();
  const [fetching, setFetching] = useState(true);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>();
  const [filtered, setFiltered] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [sortOpen, setSortOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const typeKey = types.map((type) => type.type).join(',');

  useEffect(() => {
    let live = true;
    setFetching(true);
    const timer = window.setTimeout(() => {
      services.savedObjects
        .find<{ title?: string; visState?: string }>({
          type: typeKey.split(','),
          fields: ['title', 'displayName', 'visState'],
          search: query ? `${query}*` : undefined,
          page: 1,
          perPage: services.uiSettings.get<number>('savedObjects:listingLimit', 1000),
          searchFields: ['title^3', 'description'],
          defaultSearchOperator: 'AND',
        })
        .then((answer) => {
          if (!live) return;
          const labs = services.uiSettings.get<boolean>('visualize:enableLabs', true) !== false;
          setItems(answer.saved_objects.filter((object) => listed(object, labs)));
          setPage(0);
          setFetching(false);
        })
        .catch((failure) => {
          if (!live) return;
          setItems([]);
          setFetching(false);
          services.toasts.error(failure, 'The list could not be loaded');
        });
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [typeKey, query]);

  const shown = useMemo(() => {
    const all = (items ?? []).filter((item) => filtered.length === 0 || filtered.includes(item.type));
    // Searched, the server's order of relevance holds, unless a direction is chosen
    if (sortDirection || !query) {
      const order = sortDirection === 'desc' ? -1 : 1;
      all.sort((a, b) => order * (a.attributes.title ?? '').toLowerCase().localeCompare((b.attributes.title ?? '').toLowerCase()));
    }
    return all;
  }, [items, filtered, sortDirection, query]);
  const pages = Math.ceil(shown.length / perPage);
  const present = new Set((items ?? []).map((item) => item.type));

  const sortItems = [
    {
      label: 'Ascending',
      icon: sortDirection === 'asc' || (query === '' && sortDirection !== 'desc') ? ('check' as const) : undefined,
      onClick: () => setSortDirection('asc'),
    },
    { label: 'Descending', icon: sortDirection === 'desc' ? ('check' as const) : undefined, onClick: () => setSortDirection('desc') },
    ...(query
      ? [{ label: 'Best match', icon: !sortDirection ? ('check' as const) : undefined, onClick: () => setSortDirection(undefined) }]
      : []),
  ];

  return (
    <div className="dshFinder">
      <div className="dshFinder__bar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search…"
          aria-label="Search…"
          testId="savedObjectFinderSearchInput"
        />
        <div className="dshFinder__filters">
          <Popover
            open={sortOpen}
            onClose={() => setSortOpen(false)}
            position="downLeft"
            button={
              <button
                type="button"
                className="dshFinder__filter"
                aria-pressed={sortOpen}
                onClick={() => setSortOpen(!sortOpen)}
                data-test-subj="savedObjectFinderSortButton"
              >
                <span>Sort</span>
                <Icon name="chevronDown" />
              </button>
            }
          >
            <ContextMenu panels={[{ id: 'sort', items: sortItems }]} small />
          </Popover>
          <Popover
            open={typesOpen}
            onClose={() => setTypesOpen(false)}
            position="downLeft"
            button={
              <button
                type="button"
                className="dshFinder__filter"
                aria-pressed={typesOpen}
                onClick={() => setTypesOpen(!typesOpen)}
                data-test-subj="savedObjectFinderFilterButton"
              >
                <span>Types</span>
                <span className={filtered.length > 0 ? 'dshFinder__count dshFinder__count--active' : 'dshFinder__count'}>
                  {filtered.length > 0 ? filtered.length : types.length}
                </span>
                <Icon name="chevronDown" />
              </button>
            }
          >
            <ContextMenu
              small
              panels={[
                {
                  id: 'types',
                  items: types.map((type) => ({
                    label: type.name,
                    icon: filtered.includes(type.type) ? ('check' as const) : undefined,
                    disabled: !present.has(type.type),
                    testId: `savedObjectFinderFilter-${type.type}`,
                    onClick: () => {
                      setFiltered(filtered.includes(type.type) ? filtered.filter((t) => t !== type.type) : [...filtered, type.type]);
                      setPage(0);
                    },
                  })),
                },
              ]}
            />
          </Popover>
        </div>
        {children}
      </div>
      {fetching && (items ?? []).length === 0 && <Loading />}
      {shown.length > 0 ? (
        <ul className="dshFinder__list" data-test-subj="savedObjectFinderItemList">
          {shown.slice(page * perPage, page * perPage + perPage).map((item) => {
            const title = item.attributes.title ?? '';
            const name = finderName(item, types);
            return (
              <li key={`${item.type}:${item.id}`}>
                <button
                  type="button"
                  className="dshFinder__item"
                  title={name}
                  onClick={() => onChoose(item, name)}
                  data-test-subj={`savedObjectTitle${title.split(' ').join('-')}`}
                >
                  <Icon name={iconOf(item, types)} />
                  <span className="atlTruncate">{title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        !fetching && <p className="dshFinder__empty">No matching objects found.</p>
      )}
      {pages > 1 && (
        <TablePagination
          page={page}
          pages={pages}
          pageSize={perPage}
          sizes={PAGE_SIZES}
          onPage={setPage}
          onPageSize={(size) => {
            setPerPage(size);
            setPage(0);
          }}
        />
      )}
    </div>
  );
}
