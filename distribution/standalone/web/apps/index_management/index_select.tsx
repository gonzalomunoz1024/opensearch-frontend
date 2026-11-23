/* SPDX-License-Identifier: Apache-2.0 */

/* The field that picks what an operation starts on, among indexes, data streams and aliases. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComboBox } from '../../components/combo_box';
import { ism, toasts } from './common';
import {
  indexOptions,
  parseIndexNames,
  withoutOverlaps,
  withoutSystem,
  type FoundAlias,
  type FoundDataStream,
  type FoundIndex,
  type IndexOption,
} from './index_options';

/**
 * The indexes, data streams and aliases whose names hold the text. The indexes behind data streams
 * are among the indexes unless they are left out.
 */
export async function loadIndexOptions(search: string, withBackingIndexes = true): Promise<IndexOption[]> {
  const names = parseIndexNames(search).join(',');
  const [indices, dataStreams, aliases] = await Promise.all([
    ism.get<{ indices: FoundIndex[] }>('_indices', {
      from: 0,
      size: 50,
      search: names,
      indices: names,
      sortDirection: 'desc',
      sortField: 'index',
      showDataStreams: withBackingIndexes,
    }),
    ism.get<{ dataStreams: FoundDataStream[] }>('_data_streams', { search: search.trim() }),
    ism.get<{ aliases: FoundAlias[] }>('_aliases', { search: search.trim() }),
  ]);
  if (!indices.ok) toasts.danger(indices.error);
  if (!aliases.ok) toasts.danger(aliases.error);
  return indexOptions({
    indices: indices.ok ? indices.response?.indices : undefined,
    dataStreams: dataStreams.ok ? dataStreams.response?.dataStreams : undefined,
    aliases: aliases.ok ? aliases.response?.aliases : undefined,
  });
}

/** Runs at once, and once more after the wait with the latest of what came in between */
export function useSpaced<T>(run: (value: T) => void, wait: number): (value: T) => void {
  const latest = useRef(run);
  latest.current = run;
  const state = useRef<{ timer?: number; pending?: { value: T } }>({});
  useEffect(() => {
    const kept = state.current;
    return () => window.clearTimeout(kept.timer);
  }, []);
  return useCallback(
    (value: T) => {
      const kept = state.current;
      if (kept.timer === undefined) {
        latest.current(value);
      } else {
        window.clearTimeout(kept.timer);
        kept.pending = { value };
      }
      kept.timer = window.setTimeout(() => {
        kept.timer = undefined;
        const { pending } = kept;
        kept.pending = undefined;
        if (pending) latest.current(pending.value);
      }, wait);
    },
    [wait]
  );
}

export function IndexSelect({
  value,
  onChange,
  single,
  placeholder,
  invalid,
  testId,
  excludeSystem,
  exclude,
  load = loadIndexOptions,
}: {
  /** The names chosen */
  value: string[];
  /** Told the names, and what each of them is */
  onChange: (names: string[], options: IndexOption[]) => void;
  single?: boolean;
  placeholder?: string;
  invalid?: boolean;
  testId?: string;
  /** Leaves out what belongs to OpenSearch and its plugins */
  excludeSystem?: boolean;
  /** Leaves out what shares an index with these: the other side of the operation */
  exclude?: IndexOption[];
  load?: (search: string) => Promise<IndexOption[]>;
}) {
  const [options, setOptions] = useState<IndexOption[]>([]);
  const known = useRef(new Map<string, IndexOption>());
  const turn = useRef(0);

  const search = useCallback(
    (text: string) => {
      const mine = (turn.current += 1);
      load(text).then(
        (found) => {
          if (mine !== turn.current) return;
          for (const option of found) known.current.set(option.label, option);
          setOptions(found);
        },
        (error) => toasts.danger(`fetch indices error ${error}`)
      );
    },
    [load]
  );
  useEffect(() => {
    search('');
    return () => {
      turn.current += 1;
    };
  }, [search]);

  const offered = useMemo(
    () => withoutOverlaps(excludeSystem ? withoutSystem(options) : options, exclude),
    [options, excludeSystem, exclude]
  );

  return (
    <ComboBox
      compact
      searched
      single={single}
      placeholder={placeholder}
      invalid={invalid}
      testId={testId}
      options={offered.map((option) => ({ value: option.label, label: option.label, group: option.group }))}
      selected={value}
      onChange={(names) =>
        onChange(
          names,
          names.map((name) => known.current.get(name) ?? { label: name, group: 'indices' })
        )
      }
      // asked at every key, as the plugin's
      onSearch={search}
    />
  );
}
