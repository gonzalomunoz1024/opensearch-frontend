/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Finding text in a console editor, as Ace 1.2.9 finds it (its Search) with the search box
 * OpenSearch Dashboards loads (ext/searchbox): Ctrl+F opens it at the top right of the text, what
 * is typed is looked for from the selection on and round past the end, the matches in view are
 * marked, and the box counts them, "1 of 3", up to 999. The text searched is the whole text, not
 * what is drawn of it.
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cx } from '../../components/basic';
import { bindingNames, isMacPlatform, keyName, type TextRange } from './console_commands';
import type { Position } from './console_layout';

export interface SearchOptions {
  needle: string;
  regExp?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface FindOptions extends SearchOptions {
  backwards?: boolean;
  skipCurrent?: boolean;
  wrap?: boolean;
  /** Where to look from: the selection, as a range */
  start: TextRange;
  /** Only these rows (the selection, when searching in it) */
  range?: TextRange;
}

const escapeRegExp = (text: string) => text.replace(/([.*+?^${}()|[\]/\\])/g, '\\$1');

/** The expression of a search (Ace's $assembleRegExp), or none when there is nothing to look for or it is not one */
export function searchRegExp(options: SearchOptions): RegExp | undefined {
  let needle = options.needle;
  if (!needle) return undefined;
  if (!options.regExp) needle = escapeRegExp(needle);
  if (options.wholeWord) {
    const boundary = (c: string) => (/\w/.test(c) || options.regExp ? '\\b' : '');
    needle = `${boundary(needle[0])}${needle}${boundary(needle[needle.length - 1])}`;
  }
  try {
    return new RegExp(needle, options.caseSensitive ? 'gm' : 'gmi');
  } catch {
    return undefined;
  }
}

/** The matches of an expression in a line (Ace's getMatchOffsets) */
export function matchOffsets(text: string, re: RegExp): Array<{ offset: number; length: number }> {
  const out: Array<{ offset: number; length: number }> = [];
  text.replace(re, (match: string, ...rest: unknown[]) => {
    out.push({ offset: rest[rest.length - 2] as number, length: match.length });
    return match;
  });
  return out;
}

/** The first match from the selection on, round past the end (Ace's Search.find) */
export function findRange(lines: string[], options: FindOptions): TextRange | undefined {
  const re = searchRegExp(options);
  if (!re) return undefined;
  const backwards = options.backwards === true;
  const skipCurrent = options.skipCurrent !== false;
  const start: Position = options.start[skipCurrent !== backwards ? 'end' : 'start'];
  const firstRow = options.range ? options.range.start.row : 0;
  const lastRow = options.range ? options.range.end.row : lines.length - 1;
  let found: TextRange | undefined;
  const check = (line: string, row: number, offset = 0): boolean => {
    const matches = matchOffsets(line, re);
    const order = backwards ? [...matches].reverse() : matches;
    for (const match of order) {
      const column = match.offset + offset;
      const range = { start: { row, column }, end: { row, column: column + match.length } };
      // An empty match where the selection is, when the current one is to be skipped, is passed over
      if (
        !match.length &&
        skipCurrent &&
        range.start.row === options.start.start.row &&
        range.start.column === options.start.start.column &&
        range.end.row === options.start.end.row &&
        range.end.column === options.start.end.column
      ) {
        continue;
      }
      found = range;
      return true;
    }
    return false;
  };
  if (backwards) {
    let row = start.row;
    if (check((lines[row] ?? '').substring(0, start.column), row)) return found;
    for (row -= 1; row >= firstRow; row -= 1) if (check(lines[row], row)) return found;
    if (options.wrap === false) return undefined;
    for (row = lastRow; row >= start.row; row -= 1) if (check(lines[row], row)) return found;
    return undefined;
  }
  let row = start.row;
  if (check((lines[row] ?? '').substr(start.column), row, start.column)) return found;
  for (row += 1; row <= lastRow; row += 1) if (check(lines[row], row)) return found;
  if (options.wrap === false) return undefined;
  for (row = firstRow; row <= start.row; row += 1) if (check(lines[row], row)) return found;
  return undefined;
}

/** Every match, in the rows of a range when one is given (Ace's Search.findAll) */
export function findAllRanges(lines: string[], options: SearchOptions & { range?: TextRange }): TextRange[] {
  const re = searchRegExp(options);
  if (!re) return [];
  const range = options.range;
  const rows = range ? lines.slice(range.start.row, range.end.row + 1) : lines;
  let ranges: TextRange[] = [];
  rows.forEach((line, row) => {
    for (const match of matchOffsets(line, re)) ranges.push({ start: { row, column: match.offset }, end: { row, column: match.offset + match.length } });
  });
  if (range) {
    const startColumn = range.start.column;
    const endColumn = range.start.column;
    let i = 0;
    let j = ranges.length - 1;
    while (i < j && ranges[i].start.column < startColumn && ranges[i].start.row === 0) i += 1;
    while (i < j && ranges[j].end.column > endColumn && ranges[j].end.row === range.end.row - range.start.row) j -= 1;
    ranges = ranges.slice(i, j + 1).map((each) => ({
      start: { row: each.start.row + range.start.row, column: each.start.column },
      end: { row: each.end.row + range.start.row, column: each.end.column },
    }));
  }
  return ranges;
}

/** What a match is replaced with, or nothing when the text is not a match (Ace's Search.replace) */
export function replacement(input: string, replaceWith: string, options: SearchOptions): string | undefined {
  const re = searchRegExp(options);
  if (!re) return undefined;
  const single = new RegExp(re.source, re.flags.replace('g', ''));
  const match = single.exec(input);
  if (!match || match[0].length !== input.length) return undefined;
  return input.replace(re, replaceWith);
}

export const MAX_COUNT = 999;

/** "2 of 5": the matches up to the anchor of the selection, of all of them (the search box's updateCounter) */
export function searchCounter(text: string, re: RegExp | undefined, offset: number): string {
  let all = 0;
  let before = 0;
  if (re) {
    re.lastIndex = 0;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      all += 1;
      last = match.index;
      if (last <= offset) before += 1;
      if (all > MAX_COUNT) break;
      if (!match[0]) {
        last += 1;
        re.lastIndex = last;
        if (last >= text.length) break;
      }
    }
    re.lastIndex = 0;
  }
  return `${before} of ${all > MAX_COUNT ? `${MAX_COUNT}+` : all}`;
}

// --- The search box --------------------------------------------------------------------------------------

export interface SearchState extends SearchOptions {
  /** The rows searched in, when the search is in the selection */
  range?: TextRange;
}

/** What the box asks the editor to do */
export interface SearchHost {
  readOnly: boolean;
  /** Looks for the text, selects the match unless asked not to, and says whether there was one */
  find: (search: SearchState, how: { skipCurrent: boolean; backwards: boolean; preventScroll: boolean }) => boolean;
  findAll: (search: SearchState) => boolean;
  replace: (search: SearchState, replaceWith: string) => void;
  replaceAll: (search: SearchState, replaceWith: string) => void;
  /** The selection, for a search in it */
  selection: () => TextRange;
  counter: (search: SearchState) => string;
  close: () => void;
}

const SEARCH_KEYS: Array<[string, string]> = [
  ['Ctrl-f|Command-f', 'toggleForm'],
  ['Ctrl-H|Command-Option-F', 'showReplace'],
  ['Ctrl-G|Command-G', 'findNext'],
  ['Ctrl-Shift-G|Command-Shift-G', 'findPrev'],
  ['esc', 'hide'],
  ['Return', 'next'],
  ['Shift-Return', 'previous'],
  ['Alt-Return', 'all'],
  ['Tab', 'switch'],
];

const OPTION_KEYS = (mac: boolean): Array<[string, string]> => [
  [mac ? 'Ctrl-Alt-R|Ctrl-Alt-/' : 'Alt-R|Alt-/', 'regExp'],
  [mac ? 'Ctrl-Alt-R|Ctrl-Alt-I' : 'Alt-C|Alt-I', 'caseSensitive'],
  [mac ? 'Ctrl-Alt-B|Ctrl-Alt-W' : 'Alt-B|Alt-W', 'wholeWord'],
];

/** The search box of Ace, with its texts, its buttons and its keys */
export function SearchBox({
  host,
  initial,
  replaceShown,
  opened,
}: {
  host: SearchHost;
  /** The text selected when it was opened */
  initial: string;
  replaceShown: boolean;
  /** Counts the times it was asked for, each of which selects its text again */
  opened: number;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const active = useRef<'search' | 'replace'>('search');
  const [needle, setNeedle] = useState(initial);
  const [replaceWith, setReplaceWith] = useState('');
  const [options, setOptions] = useState({ regExp: false, caseSensitive: false, wholeWord: false });
  const [replacing, setReplacing] = useState(replaceShown);
  const [range, setRange] = useState<TextRange | undefined>();
  const [noMatch, setNoMatch] = useState(false);
  const [counter, setCounter] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const state = (next: Partial<SearchState> = {}): SearchState => ({ needle, ...options, range, ...next });

  const run = (search: SearchState, skipCurrent: boolean, backwards: boolean, preventScroll = false) => {
    const found = host.find(search, { skipCurrent, backwards, preventScroll });
    setNoMatch(!found && Boolean(search.needle));
    setCounter(host.counter(search));
  };

  useEffect(() => {
    if (initial) setNeedle(initial);
    setReplacing(replaceShown);
    const input = searchInput.current;
    input?.focus();
    input?.select();
    run(state(initial ? { needle: initial } : {}), false, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const sync = (next: Partial<SearchState>, preventScroll = false) => run(state(next), false, false, preventScroll);

  const commands: Record<string, () => void> = {
    hide: () => host.close(),
    findNext: () => run(state(), true, false),
    findPrev: () => run(state(), true, true),
    next: () => {
      if (active.current === 'replace') host.replace(state(), replaceWith);
      run(state(), true, false);
    },
    previous: () => {
      if (active.current === 'replace') host.replace(state(), replaceWith);
      run(state(), true, true);
    },
    all: () => {
      if (active.current === 'replace') host.replaceAll(state(), replaceWith);
      const found = host.findAll(state());
      setNoMatch(!found && Boolean(needle));
      host.close();
    },
    findAll: () => {
      const found = host.findAll(state());
      setNoMatch(!found && Boolean(needle));
      host.close();
    },
    switch: () => (active.current === 'replace' ? searchInput : replaceInput).current?.focus(),
    toggleForm: () => {
      setReplacing(false);
      sync({});
      searchInput.current?.focus();
    },
    showReplace: () => {
      setReplacing(true);
      sync({});
      window.setTimeout(() => replaceInput.current?.focus());
    },
    regExp: () => {
      setOptions({ ...options, regExp: !options.regExp });
      sync({ regExp: !options.regExp });
    },
    caseSensitive: () => {
      setOptions({ ...options, caseSensitive: !options.caseSensitive });
      sync({ caseSensitive: !options.caseSensitive });
    },
    wholeWord: () => {
      setOptions({ ...options, wholeWord: !options.wholeWord });
      sync({ wholeWord: !options.wholeWord });
    },
    toggleReplace: () => {
      setReplacing(!replacing);
      sync({});
    },
    searchInSelection: () => {
      const next = range ? undefined : host.selection();
      setRange(next);
      sync({ range: next });
    },
    replaceAndFindNext: () => {
      if (host.readOnly) return;
      host.replace(state(), replaceWith);
      run(state(), true, false);
    },
    replaceAll: () => {
      if (!host.readOnly) host.replaceAll(state(), replaceWith);
    },
  };

  const keys = useRef<Map<string, string> | undefined>(undefined);
  if (!keys.current) {
    const map = new Map<string, string>();
    for (const [binding, name] of [...SEARCH_KEYS, ...OPTION_KEYS(isMacPlatform())]) for (const key of bindingNames(binding)) map.set(key, name);
    keys.current = map;
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const name = keys.current?.get(keyName(event));
    if (!name) return;
    event.preventDefault();
    event.stopPropagation();
    commands[name]?.();
  };

  const button = (action: string, className: string, content: string, title?: string, style?: CSSProperties) => (
    <span
      className={className}
      title={title}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        commands[action]?.();
      }}
      data-action={action}
    >
      {content}
    </span>
  );

  return (
    <div
      className="dvtSearch dvtSearch--right"
      onMouseDown={(event) => {
        event.stopPropagation();
        window.setTimeout(() => (active.current === 'replace' ? replaceInput : searchInput).current?.focus(), 0);
      }}
      onKeyDown={onKeyDown}
      data-test-subj="consoleSearchBox"
    >
      {button('hide', 'dvtSearch__close', '')}
      <div className={cx('dvtSearch__form', noMatch && 'dvtSearch__form--nomatch')}>
        <input
          ref={searchInput}
          className="dvtSearch__field"
          placeholder="Search for"
          spellCheck={false}
          value={needle}
          onFocus={() => {
            active.current = 'search';
          }}
          onChange={(event) => {
            const value = event.target.value;
            setNeedle(value);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => run(state({ needle: value }), false, false), 20);
          }}
        />
        {button('findPrev', 'dvtSearch__button dvtSearch__button--prev', '')}
        {button('findNext', 'dvtSearch__button dvtSearch__button--next', '')}
        {button('findAll', 'dvtSearch__button', 'All', 'Alt-Enter')}
      </div>
      <div className="dvtSearch__form dvtSearch__form--replace" style={{ display: replacing ? undefined : 'none' }}>
        <input
          ref={replaceInput}
          className="dvtSearch__field"
          placeholder="Replace with"
          spellCheck={false}
          value={replaceWith}
          onFocus={() => {
            active.current = 'replace';
          }}
          onChange={(event) => setReplaceWith(event.target.value)}
        />
        {button('replaceAndFindNext', 'dvtSearch__button', 'Replace')}
        {button('replaceAll', 'dvtSearch__button', 'All')}
      </div>
      <div className="dvtSearch__options">
        {button('toggleReplace', cx('dvtSearch__option', range && 'dvtSearch__option--checked'), replacing ? '-' : '+', 'Toggel Replace mode', {
          float: 'left',
          marginTop: -2,
          padding: '0 5px',
        })}
        <span className="dvtSearch__counter">{counter}</span>
        {button('regExp', cx('dvtSearch__option', options.regExp && 'dvtSearch__option--checked'), '.*', 'RegExp Search')}
        {button('caseSensitive', cx('dvtSearch__option', options.caseSensitive && 'dvtSearch__option--checked'), 'Aa', 'CaseSensitive Search')}
        {button('wholeWord', cx('dvtSearch__option', options.wholeWord && 'dvtSearch__option--checked'), '\\b', 'Whole Word Search')}
        {button('searchInSelection', cx('dvtSearch__option', range && 'dvtSearch__option--checked'), 'S', 'Search In Selection')}
      </div>
    </div>
  );
}
