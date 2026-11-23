/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Query Workbench without its page. The editors' tests replay what the plugin's Ace did in the
 * reference build: fixtures/query_workbench_ace.json holds, as recorded there, the colours of 30
 * texts of SQL, the text and selection 1132 sequences of keys left in the SQL and the PPL editor
 * (written ones for each rule, then random ones), the bracket Ace boxed at each place of 30 texts
 * in both editors, and the list of completions after each key of 13 sessions, with the scores Ace
 * kept.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  followList,
  insertCompletion,
  listAfterEdit,
  listKey,
  openList,
  type Listed,
} from '../../web/apps/query_workbench/completing';
import {
  editorKey,
  matchingBracket,
  screenColumn,
  type EditorKey,
  type PairMemory,
} from '../../web/apps/query_workbench/editing';
import {
  DEFAULT_CAPABILITIES,
  SQL_WORDS,
  TREE_EMPTY,
  TREE_FAILED,
  capabilitiesOf,
  cellText,
  coerceVersion,
  dataSourceOf,
  completionMeta,
  completionPrefix,
  completionRuns,
  completionsDone,
  downloadKinds,
  downloadRoute,
  fileContent,
  firstTab,
  getQueries,
  indentGuides,
  indexNames,
  indexTreeOf,
  indicesQuery,
  messageText,
  nestedNames,
  nestedTable,
  openCompletions,
  parseSearch,
  queryIndex,
  readAnswer,
  reasonOf,
  searchRows,
  startQuery,
  tabName,
  tableOf,
  tokenizeSql,
  truncateName,
  type Row,
} from '../../web/apps/query_workbench/model';

const answer = (value: unknown) => readAnswer({ data: { ok: true, resp: JSON.stringify(value) } });

/** Text, selection start and end, keys, then the text, selection and direction Ace left */
type KeyCase = [
  'sql' | 'ppl' | 'both',
  string,
  number,
  number,
  string[],
  string,
  number,
  number,
  boolean,
];
/** A key, the text and cursor after it, then, while the list is open, where its word begins, the
 * row chosen, the letters it filters by and its rows as "value/meta/score/exactMatch/matchMask" */
type CompletionStep = [string, string, number, number?, number?, string?, string[]?];

const fixture = JSON.parse(readFileSync('test/web/fixtures/query_workbench_ace.json', 'utf8')) as {
  tokens: Record<string, string[][]>;
  keys: KeyCase[];
  fuzz: KeyCase[];
  brackets: Record<'sql' | 'ppl', Record<string, Array<number | null>>>;
  completions: Array<{ name: string; text: string; at: number | null; steps: CompletionStep[] }>;
};

describe('the queries of an editor', () => {
  it('splits at semicolons and puts each on one line', () => {
    assert.deepEqual(getQueries('select a\nfrom x;\n\n select b from y ; ;'), [
      'select a from x',
      'select b from y',
    ]);
    assert.deepEqual(getQueries(''), []);
    assert.deepEqual(getQueries(' ;\n'), []);
  });

  it('names a tab after the index of the query', () => {
    assert.equal(queryIndex('select count(*) from Logs where a = 1'), 'logs');
    assert.equal(queryIndex('SELECT a FROM  logs'), 'logs');
    assert.equal(queryIndex("SHOW tables LIKE '%'"), "SHOW tables LIKE '%'");
    assert.equal(tabName('SQL', 'select a from logs'), 'logs');
    assert.equal(tabName('PPL', 'source = logs'), 'Events');
  });
});

describe('an answer as a table', () => {
  it('keeps the names only of SHOW tables', () => {
    const result = tableOf(
      answer({
        schema: [
          { name: 'TABLE_CAT' },
          { name: 'TABLE_SCHEM' },
          { name: 'TABLE_NAME' },
          { name: 'TABLE_TYPE' },
        ],
        datarows: [
          ['lite', null, 'logs', 'BASE TABLE'],
          ['lite', null, 'flights', 'BASE TABLE'],
        ],
      })
    );
    if (!result.fulfilled) throw new Error('expected a table');
    assert.deepEqual(result.table.fields, ['TABLE_NAME']);
    assert.deepEqual(result.table.records, [
      { rowId: 0, data: { TABLE_NAME: 'logs' } },
      { rowId: 1, data: { TABLE_NAME: 'flights' } },
    ]);
    assert.equal(result.message, 'Success');
  });

  it('keeps every column of DESCRIBE and of a select, by alias when there is one', () => {
    const described = tableOf(
      answer({
        schema: [{ name: 'TABLE_NAME' }, { name: 'COLUMN_NAME' }, { name: 'DATA_TYPE' }],
        datarows: [['logs', 'bytes', 'long']],
      })
    );
    if (!described.fulfilled) throw new Error('expected a table');
    assert.deepEqual(described.table.fields, ['TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE']);

    const selected = tableOf(
      answer({
        schema: [
          { name: 'bytes', alias: 'size', type: 'long' },
          { name: 'geo', type: 'object' },
        ],
        datarows: [
          [19986, { src: 'IR' }],
          [null, null],
        ],
      })
    );
    if (!selected.fulfilled) throw new Error('expected a table');
    assert.deepEqual(selected.table.fields, ['size', 'geo']);
    assert.deepEqual(selected.table.records[0].data, { size: 19986, geo: { src: 'IR' } });
    assert.deepEqual(selected.table.records[1].data, { size: '-', geo: '-' });
  });

  it('says why a query did not run', () => {
    const failed = tableOf(readAnswer(undefined, 'no such index [nowhere]'));
    assert.equal(failed.fulfilled, false);
    assert.equal(
      failed.message,
      'no response, this query is not runnable. \n \nno such index [nowhere]'
    );

    const ppl = tableOf(
      readAnswer({
        data: {
          ok: false,
          resp: 'Not Found',
          body: '{"error":{"reason":"no such index [x]","details":"no such index [x]"}}',
          statusCode: 404,
        },
      })
    );
    assert.equal(ppl.message, 'Not Found, this query is not runnable. \n \nno such index [x]');
  });

  it('reads the sentence of an error', () => {
    assert.equal(
      reasonOf('{"error":{"reason":"Invalid SQL query","details":"Query must start with SELECT"}}'),
      'Invalid SQL query: Query must start with SELECT'
    );
    assert.equal(reasonOf('{"error":"plain"}'), 'plain');
    assert.equal(reasonOf('not json'), 'not json');
    assert.equal(reasonOf(undefined), '');
  });

  it('has no rows for an answer that is not a table', () => {
    const result = tableOf(readAnswer({ data: { ok: true, resp: 'text' } }));
    if (!result.fulfilled) throw new Error('expected a table');
    assert.deepEqual(result.table, { fields: [], records: [] });
  });

  it('lists the indices from the third column', () => {
    assert.deepEqual(
      indexNames(
        answer({
          schema: [],
          datarows: [
            ['lite', null, 'logs'],
            ['lite', null, '.kibana'],
          ],
        })
      ),
      ['logs', '.kibana']
    );
    assert.deepEqual(indexNames(readAnswer(undefined)), []);
  });

  it('writes the output tab and opens the first table', () => {
    assert.equal(
      messageText(
        ['Success', 'no response, this query is not runnable. \n \n'],
        ['logs', 'nowhere']
      ),
      'Logs: Success\n\nNowhere: no response, this query is not runnable. \n \n\n\n'
    );
    assert.equal(messageText([], ['logs']), '');
    assert.equal(messageText(['Success'], []), '');
    const ok = tableOf(answer({ schema: [{ name: 'a' }], datarows: [[1]] }));
    const failed = tableOf(readAnswer(undefined));
    assert.deepEqual(firstTab([ok, failed], ['select a from Logs', 'x']), {
      id: '0',
      name: 'logs',
    });
    assert.deepEqual(firstTab([failed, ok], ['x', 'select a from logs']), {
      id: 'Output',
      name: 'Output',
    });
    assert.deepEqual(firstTab([], []), { id: 'Output', name: 'Output' });
  });
});

describe('the index tree and the addresses', () => {
  const reply = (resp: unknown) => ({ data: { ok: true, resp } });

  it('lists the third column of each row, as text', () => {
    const rows = [
      ['docker-cluster', null, '.kibana_1', 'BASE TABLE'],
      ['docker-cluster', null, 'logs', 'BASE TABLE'],
      ['docker-cluster', null, 7],
      ['docker-cluster', null],
    ];
    assert.deepEqual(indexTreeOf(reply(JSON.stringify({ datarows: rows }))), {
      names: ['.kibana_1', 'logs', '7', ''],
    });
  });

  it('says there are no indices when the rows are empty, or not a list with a length', () => {
    assert.deepEqual(indexTreeOf(reply(JSON.stringify({ datarows: [] }))), { message: TREE_EMPTY });
    assert.deepEqual(indexTreeOf(reply(JSON.stringify({ datarows: '' }))), { message: TREE_EMPTY });
    assert.deepEqual(indexTreeOf(reply(JSON.stringify({ datarows: 5 }))), { message: TREE_EMPTY });
  });

  it('says to check the permissions when the answer cannot be read as the plugin reads it', () => {
    const failed = { message: TREE_FAILED };
    // An error, whose text is no JSON, or JSON without rows
    assert.deepEqual(indexTreeOf({ data: { ok: false, resp: 'Forbidden' } }), failed);
    assert.deepEqual(indexTreeOf(reply('{"error":{"reason":"no"}}')), failed);
    assert.deepEqual(indexTreeOf(reply(JSON.stringify({ datarows: null }))), failed);
    assert.deepEqual(indexTreeOf(reply('null')), failed);
    // No answer at all, or rows the plugin cannot map
    assert.deepEqual(indexTreeOf(undefined), failed);
    assert.deepEqual(indexTreeOf({}), failed);
    assert.deepEqual(indexTreeOf(reply(JSON.stringify({ datarows: 'abc' }))), failed);
    assert.deepEqual(indexTreeOf(reply(JSON.stringify({ datarows: [null] }))), failed);
  });

  it('cuts a long name to 50 characters with three dots, as lodash does', () => {
    const fifty = 'a'.repeat(50);
    assert.equal(truncateName(fifty), fifty);
    assert.equal(truncateName(`${fifty}b`), `${'a'.repeat(47)}...`);
    assert.equal(truncateName('opensearch_dashboards_sample_data_ecommerce'), 'opensearch_dashboards_sample_data_ecommerce');
  });

  it('reads the data source of the plugin\'s two addresses, and none of any other', () => {
    assert.equal(dataSourceOf('/'), '');
    assert.equal(dataSourceOf('/my_glue'), 'my_glue');
    assert.equal(dataSourceOf('/my_glue/'), 'my_glue');
    assert.equal(dataSourceOf('/accelerate/my_glue'), 'my_glue');
    assert.equal(dataSourceOf('/accelerate'), 'accelerate');
    assert.equal(dataSourceOf('/a%20b'), 'a b');
    assert.equal(dataSourceOf('/a/b'), '');
    assert.equal(dataSourceOf('/accelerate/a/b'), '');
  });
});

describe('cells and rows that open', () => {
  it('writes plain values and links for what holds more', () => {
    assert.deepEqual(cellText(19986, 'bytes'), { text: '19986' });
    assert.deepEqual(cellText(false, 'ok'), { text: 'false' });
    assert.deepEqual(cellText(null, 'gone'), { text: '' });
    assert.deepEqual(cellText({ src: 'IR' }, 'geo'), { text: '', link: 'geo: {1}' });
    assert.deepEqual(cellText(['success', 'info'], 'tags'), { text: '', link: 'tags: [2]' });
    assert.deepEqual(cellText([{ a: 1 }, { a: 2 }, { a: 3 }], 'items'), {
      text: '',
      link: 'items: {3}',
    });
  });

  it('opens a row at the names that hold an object or a list', () => {
    assert.deepEqual(nestedNames({ ip: '1.2.3.4', geo: { src: 'IR' }, tags: ['a'], gone: null }), [
      'geo',
      'tags',
    ]);
    assert.deepEqual(nestedNames('text'), []);
    assert.deepEqual(nestedTable({ src: 'IR', dest: 'MM' }), {
      columns: ['src', 'dest'],
      rows: [{ src: 'IR', dest: 'MM' }],
    });
    assert.deepEqual(nestedTable(['a', 'b']), { columns: [], rows: ['a', 'b'] });
    assert.deepEqual(nestedTable([{ a: 1 }, { a: 2 }]), {
      columns: ['a'],
      rows: [{ a: 1 }, { a: 2 }],
    });
  });
});

describe('the search box', () => {
  const rows: Row[] = [
    {
      rowId: 0,
      data: {
        ip: '233.204.30.48',
        bytes: 19986,
        os: 'osx',
        tags: ['success', 'info'],
        geo: { src: 'IR' },
      },
    },
    {
      rowId: 1,
      data: { ip: '129.237.102.30', bytes: 19956, os: 'ios', tags: ['error'], geo: { src: 'IN' } },
    },
    {
      rowId: 2,
      data: { ip: '127.155.255.9', bytes: 120, os: 'win 8', tags: [], geo: { src: 'CN' } },
    },
  ];
  const ids = (text: string) => searchRows(rows, text).map((row) => row.rowId);

  it('looks for words in the columns that hold text, whatever the case', () => {
    assert.deepEqual(ids('OS'), [0, 1]);
    assert.deepEqual(ids('233.204'), [0]);
    // numbers and what is inside an object are not text
    assert.deepEqual(ids('19986'), []);
    assert.deepEqual(ids('IR'), []);
    assert.deepEqual(ids(''), [0, 1, 2]);
  });

  it('needs every word, and none of those taken away', () => {
    assert.deepEqual(ids('os 129'), [1]);
    assert.deepEqual(ids('-os'), [2]);
    assert.deepEqual(ids('"win 8"'), [2]);
    assert.deepEqual(ids('win xp'), []);
  });

  it('compares a column', () => {
    assert.deepEqual(ids('bytes:19986'), [0]);
    assert.deepEqual(ids('bytes>=19956'), [0, 1]);
    assert.deepEqual(ids('bytes<19956'), [2]);
    assert.deepEqual(ids('os:OS'), [0, 1]);
    assert.deepEqual(ids('os=os'), []);
    assert.deepEqual(ids('os=IOS'), [1]);
    assert.deepEqual(ids('-os:ios'), [0, 2]);
    assert.deepEqual(ids('tags:info'), [0]);
    assert.deepEqual(ids('os:(osx or "win 8")'), [0, 2]);
    assert.deepEqual(ids('nothing:here'), []);
  });

  it('takes either side of OR in brackets', () => {
    assert.deepEqual(ids('(osx OR bytes<200)'), [0, 2]);
    assert.deepEqual(ids('-(osx OR ios)'), [2]);
    assert.deepEqual(ids('is:bytes'), [0, 1, 2]);
    assert.deepEqual(ids('-is:missing'), [0, 1, 2]);
  });

  it('filters nothing with a text that is not a search', () => {
    assert.equal(parseSearch('"open'), undefined);
    assert.equal(parseSearch('(a OR'), undefined);
    assert.deepEqual(ids('"open'), [0, 1, 2]);
    assert.deepEqual(parseSearch('  a  -b '), [
      { type: 'term', match: 'must', value: 'a' },
      { type: 'term', match: 'must_not', value: 'b' },
    ]);
  });
});

describe('what OpenSearch can do, and the downloads', () => {
  it('reads the version as semver coerces it', () => {
    assert.deepEqual(coerceVersion('3.9.0'), [3, 9, 0]);
    assert.deepEqual(coerceVersion('v2.11'), [2, 11, 0]);
    assert.deepEqual(coerceVersion('3.9.0-SNAPSHOT'), [3, 9, 0]);
    assert.deepEqual(coerceVersion('1.2.3.4'), [1, 2, 3]);
    assert.equal(coerceVersion('none'), undefined);
  });

  it('offers what each version has, as the plugin gates it', () => {
    assert.deepEqual(capabilitiesOf('3.9.0'), {
      hasDslJsonFormat: false,
      hasPpl: true,
      legacy: false,
      hasDataSources: true,
    });
    assert.deepEqual(capabilitiesOf('2.10.0'), {
      hasDslJsonFormat: true,
      hasPpl: true,
      legacy: false,
      hasDataSources: false,
    });
    assert.equal(capabilitiesOf('2.11.0').hasDataSources, true);
    // Major 6 and 7 are Elasticsearch with OpenDistro, unless the cluster says it is OpenSearch;
    // the JSON format goes by the version alone, as the plugin compares it
    assert.deepEqual(capabilitiesOf('7.10.2'), {
      hasDslJsonFormat: false,
      hasPpl: true,
      legacy: true,
      hasDataSources: false,
    });
    assert.equal(capabilitiesOf('7.8.0').hasPpl, false);
    assert.equal(capabilitiesOf('7.9.0').hasPpl, true);
    assert.equal(capabilitiesOf('6.8.0').hasPpl, false);
    assert.equal(capabilitiesOf('7.10.2', true).legacy, false);
    assert.deepEqual(capabilitiesOf(undefined), DEFAULT_CAPABILITIES);
    assert.deepEqual(capabilitiesOf('unknown'), DEFAULT_CAPABILITIES);
  });

  it('asks the legacy SQL for the indices without quotes', () => {
    assert.equal(indicesQuery(DEFAULT_CAPABILITIES), "SHOW tables LIKE '%'");
    assert.equal(startQuery(DEFAULT_CAPABILITIES), "SHOW tables LIKE '%';");
    assert.equal(indicesQuery(capabilitiesOf('7.10.2')), 'SHOW tables LIKE %');
    assert.equal(startQuery(capabilitiesOf('7.10.2')), 'SHOW tables LIKE %;');
  });

  it('lists JSON only where OpenSearch still answers it, and names the routes', () => {
    assert.deepEqual(downloadKinds(capabilitiesOf('3.9.0')), ['jdbc', 'csv', 'text']);
    assert.deepEqual(downloadKinds(capabilitiesOf('2.19.1')), ['json', 'jdbc', 'csv', 'text']);
    assert.equal(downloadRoute('SQL', 'jdbc'), 'sqlquery');
    assert.equal(downloadRoute('SQL', 'json'), 'sqljson');
    assert.equal(downloadRoute('SQL', 'csv'), 'sqlcsv');
    assert.equal(downloadRoute('PPL', 'text'), 'ppltext');
  });

  it('writes JSON with four spaces, and CSV and text as they came', () => {
    assert.equal(
      fileContent('jdbc', '{"schema":[{"name":"a"}],"total":1}'),
      [
        '{',
        '    "schema": [',
        '        {',
        '            "name": "a"',
        '        }',
        '    ],',
        '    "total": 1',
        '}',
      ].join('\n')
    );
    assert.equal(fileContent('json', '{"hits":{}}'), '{\n    "hits": {}\n}');
    assert.equal(fileContent('csv', 'a,b\n1,2'), 'a,b\n1,2');
    assert.equal(fileContent('text', 'a|b'), 'a|b');
    assert.equal(fileContent('jdbc', 'not json'), undefined);
  });

  it('leaves empty a value a row does not have', () => {
    const result = tableOf(answer({ schema: [{ name: 'a' }, { name: 'b' }], datarows: [[1]] }));
    if (!result.fulfilled) throw new Error('expected a table');
    assert.deepEqual(result.table.records[0].data, { a: 1, b: undefined });
  });
});

// --- The editors, against what the plugin's Ace did --------------------------------------------

interface State {
  text: string;
  start: number;
  end: number;
  backwards: boolean;
  /** The column a text area keeps while the cursor goes up and down */
  goal?: number;
}

const parseKey = (name: string): EditorKey => {
  const parts = name.length > 1 ? name.split('+') : [name];
  const key = parts[parts.length - 1];
  return {
    key: key === 'Space' ? ' ' : key,
    shiftKey: parts.includes('Shift'),
    ctrlKey: parts.includes('Control'),
    metaKey: parts.includes('Meta'),
    altKey: parts.includes('Alt'),
  };
};

/** What a text area does with a key by itself */
function native(key: EditorKey, state: State): State {
  const { text, start, end, backwards } = state;
  const lineStart = (offset: number) => (offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1);
  const lineEnd = (offset: number) => {
    const at = text.indexOf('\n', offset);
    return at === -1 ? text.length : at;
  };
  const focus = backwards ? start : end;
  const anchor = backwards ? end : start;
  const moved = (to: number): State => {
    if (!key.shiftKey) return { text, start: to, end: to, backwards: false };
    return to < anchor
      ? { text, start: to, end: anchor, backwards: true }
      : { text, start: anchor, end: to, backwards: false };
  };
  const typed = (insert: string): State => ({
    text: text.slice(0, start) + insert + text.slice(end),
    start: start + insert.length,
    end: start + insert.length,
    backwards: false,
  });
  if (key.key.length === 1) return typed(key.key);
  switch (key.key) {
    case 'Enter':
      return typed('\n');
    case 'Backspace': {
      const from = start === end ? Math.max(0, start - 1) : start;
      return {
        text: text.slice(0, from) + text.slice(end),
        start: from,
        end: from,
        backwards: false,
      };
    }
    case 'Delete': {
      const to = start === end ? Math.min(text.length, end + 1) : end;
      return { text: text.slice(0, start) + text.slice(to), start, end: start, backwards: false };
    }
    case 'ArrowLeft':
      return moved(!key.shiftKey && start !== end ? start : Math.max(0, focus - 1));
    case 'ArrowRight':
      return moved(!key.shiftKey && start !== end ? end : Math.min(text.length, focus + 1));
    case 'Home':
      return moved(lineStart(focus));
    case 'End':
      return moved(lineEnd(focus));
    case 'ArrowUp': {
      const from = lineStart(focus);
      const goal = state.goal ?? focus - from;
      if (from === 0) return { ...moved(0), goal };
      return { ...moved(Math.min(lineStart(from - 1) + goal, from - 1)), goal };
    }
    case 'ArrowDown': {
      const to = lineEnd(focus);
      const goal = state.goal ?? focus - lineStart(focus);
      if (to === text.length) return { ...moved(text.length), goal };
      return { ...moved(Math.min(to + 1 + goal, lineEnd(to + 1))), goal };
    }
    default:
      return state;
  }
}

// The keys the kit's editor has a rule of its own for, unless the page takes them first
const kitTakes = (key: EditorKey, state: State) => {
  if (key.ctrlKey || key.metaKey) return false;
  if (key.key === 'Tab') return !key.altKey;
  if (key.key === 'Enter') return !key.shiftKey;
  if ('{[("'.includes(key.key) || '}])'.includes(key.key)) return true;
  return (
    key.key === 'Backspace' &&
    state.start === state.end &&
    ['{}', '[]', '()', '""'].includes(state.text.slice(state.start - 1, state.start + 1))
  );
};

/** The keys through the editor's rules, and what the text area does where they leave it */
function play(keys: string[], state: State, words?: ReadonlyMap<string, string>) {
  let memory: PairMemory = {};
  let now = state;
  const untaken: string[] = [];
  for (const name of keys) {
    const key = parseKey(name);
    const result = editorKey(key, now.text, now.start, now.end, memory, words, now.backwards);
    if (kitTakes(key, now) && !result?.edit) untaken.push(name);
    if (result) memory = result.memory;
    now = result?.edit
      ? { ...result.edit, backwards: result.edit.backwards === true }
      : native(key, now);
  }
  return { state: now, untaken };
}

describe('the keys of the editors, as Ace has them', () => {
  const replay = (cases: KeyCase[]) => {
    const wrong: string[] = [];
    const untaken: string[] = [];
    for (const [mode, text, start, end, keys, wantText, wantStart, wantEnd, wantBack] of cases) {
      for (const each of mode === 'both' ? ['sql', 'ppl'] : [mode]) {
        const label = `${each} ${JSON.stringify(text)} [${start},${end}] ${keys.join(' ')}`;
        const got = play(
          keys,
          { text, start, end, backwards: false },
          each === 'sql' ? SQL_WORDS : undefined
        );
        const { state } = got;
        const same =
          state.text === wantText &&
          state.start === wantStart &&
          state.end === wantEnd &&
          (state.start === state.end || state.backwards === wantBack);
        if (!same) wrong.push(`${label}: ${JSON.stringify(state)}`);
        if (got.untaken.length) untaken.push(`${label}: ${got.untaken.join(' ')}`);
      }
    }
    return { wrong, untaken };
  };

  it('leaves the text and the selection of each written case as Ace', () => {
    const { wrong } = replay(fixture.keys);
    assert.deepEqual(wrong, []);
  });

  it('and of each random one', () => {
    const { wrong } = replay(fixture.fuzz);
    assert.deepEqual(wrong, []);
  });

  it('keeps out the rules of the kit with an edit for every key the kit would take', () => {
    assert.deepEqual(replay(fixture.keys).untaken, []);
    assert.deepEqual(replay(fixture.fuzz).untaken, []);
  });

  it('leaves the keys with Ctrl, Alt or the command key to the browser', () => {
    for (const name of ['Control+a', 'Alt+ArrowLeft', 'Meta+z', 'Control+Enter']) {
      assert.equal(editorKey(parseKey(name), 'select', 6, 6, {}, SQL_WORDS), undefined);
    }
    // Keys that neither type nor move
    assert.equal(editorKey(parseKey('F2'), 'select', 6, 6, {}, SQL_WORDS), undefined);
  });

  it('draws a tab to the next step of four', () => {
    assert.equal(screenColumn('\tab', 1), 4);
    assert.equal(screenColumn('a\tb', 2), 4);
    assert.equal(screenColumn('abcd\te', 5), 8);
    assert.equal(screenColumn('abc', 3), 3);
  });

  it('boxes the bracket that pairs with the one before the cursor', () => {
    const wrong: string[] = [];
    for (const mode of ['sql', 'ppl'] as const) {
      for (const [text, found] of Object.entries(fixture.brackets[mode])) {
        found.forEach((want, offset) => {
          const got = matchingBracket(text, offset, mode === 'sql' ? SQL_WORDS : undefined) ?? null;
          if (got !== want) wrong.push(`${mode} ${JSON.stringify(text)} at ${offset}: ${got}`);
        });
      }
    }
    assert.deepEqual(wrong, []);
  });
});

describe('the colours of the SQL editor, as Ace has them', () => {
  const kinds = (text: string) =>
    tokenizeSql(text).map((line) => line.map((token) => `${token.kind ?? '-'}:${token.text}`));

  it('colours each recorded text as Ace did', () => {
    for (const [text, lines] of Object.entries(fixture.tokens))
      assert.deepEqual(kinds(text), lines, text);
  });

  it('carries a block comment over lines', () => {
    assert.deepEqual(kinds('a /* one\ntwo */ from /* x */ b'), [
      ['-:a ', 'SqlComment:/* one'],
      ['SqlComment:two */', '-: ', 'SqlKeyword:from', '-: ', 'SqlComment:/* x */', '-: b'],
    ]);
    assert.deepEqual(kinds(''), [['-:']]);
  });

  it('draws a guide for each step of four that ends before the last space of an indent', () => {
    const guides = (text: string) =>
      indentGuides([[{ text }]])[0].map((token) => `${token.kind ?? '-'}:${token.text}`);
    assert.deepEqual(guides('    x'), ['-:    x']);
    assert.deepEqual(guides('        x'), ['QwbGuide:    ', '-:    x']);
    assert.deepEqual(guides('          x'), ['QwbGuide:    ', 'QwbGuide:    ', '-:  x']);
    assert.deepEqual(guides('            x'), ['QwbGuide:    ', 'QwbGuide:    ', '-:    x']);
    assert.deepEqual(guides('\t\tx'), ['QwbGuide:\t', '-:\tx']);
    assert.deepEqual(guides('x    '), ['-:x    ']);
    // A run of another kind first has no guides
    assert.deepEqual(indentGuides([[{ text: '        ', kind: 'SqlComment' }]]), [
      [{ text: '        ', kind: 'SqlComment' }],
    ]);
  });
});

describe('the list of completions, as Ace has it', () => {
  const aceName = (key: EditorKey) =>
    `${key.ctrlKey ? 'Ctrl-' : ''}${key.altKey ? 'Alt-' : ''}${key.shiftKey ? 'Shift-' : ''}${
      key.metaKey ? 'Command-' : ''
    }${key.key}`;
  const rows = (listed: Listed) =>
    listed.list.filtered.map(
      (item) => `${item.value}/${item.meta}/${item.score}/${item.exactMatch}/${item.matchMask}`
    );

  for (const session of fixture.completions) {
    it(`follows the keys of a session: ${session.name}`, () => {
      const at = session.at ?? session.text.length;
      let state: State = { text: session.text, start: at, end: at, backwards: false };
      let memory: PairMemory = {};
      let listed: Listed | undefined;
      session.steps.forEach(([name, value, cursor, base, row, filterText, filtered], index) => {
        const key = parseKey(name);
        const lead = () => (state.backwards ? state.start : state.end);
        const onList = listed ? listKey(listed, aceName(key)) : undefined;
        if (listed && onList) {
          if (onList.insert !== undefined) {
            const edit = insertCompletion(
              listed,
              onList.insert,
              state.text,
              state.start,
              state.end
            );
            if (edit) state = { ...edit, backwards: false };
            listed = undefined;
          } else {
            listed = onList.listed;
          }
        } else if (['Ctrl- ', 'Ctrl-Shift- ', 'Alt- '].includes(aceName(key))) {
          listed = openList(state.text, lead());
        } else if (key.key !== 'Escape') {
          const result = editorKey(
            key,
            state.text,
            state.start,
            state.end,
            memory,
            SQL_WORDS,
            state.backwards
          );
          if (result) memory = result.memory;
          state = result?.edit
            ? { ...result.edit, backwards: result.edit.backwards === true }
            : native(key, state);
          listed = listAfterEdit(listed, state.text, lead(), result?.kind ?? 'other');
        }
        const step = `step ${index} (${name})`;
        assert.equal(state.text, value, step);
        assert.equal(lead(), cursor, step);
        if (filtered === undefined) {
          assert.equal(listed, undefined, step);
        } else {
          assert.ok(listed, step);
          if (!listed) return;
          assert.deepEqual(
            [listed.base, listed.row, listed.list.filterText, rows(listed)],
            [base, row, filterText, filtered],
            step
          );
        }
      });
    });
  }

  it('completes the letters of a word before the cursor', () => {
    assert.equal(completionPrefix('select cl', 9), 'cl');
    assert.equal(completionPrefix('select cl', 8), 'c');
    assert.equal(completionPrefix('a.b$c-d', 7), 'b$c-d');
    assert.equal(completionPrefix('x\nab', 4), 'ab');
    assert.equal(completionPrefix('select ', 7), '');
  });

  it('marks the letters typed, and cuts the kind short when the row has no room', () => {
    const list = openCompletions('select clientip from logs where cl', 34);
    const clientip = list.filtered.find((item) => item.value === 'clientip');
    assert.ok(clientip);
    if (!clientip) return;
    assert.deepEqual(completionRuns(clientip), [
      { text: 'cl', match: true },
      { text: 'ientip', match: false },
    ]);
    const item = { meta: 'local' as const, score: 0, exactMatch: 0, matchMask: 0 };
    assert.equal(completionMeta({ ...item, value: 'clientip' }, 33.1), 'local');
    assert.equal(completionMeta({ ...item, value: 'a_word_of_twenty_five_chrs' }, 33.1), 'local');
    assert.equal(completionMeta({ ...item, value: 'a_word_of_twenty_seven_chrs' }, 33.1), 'loc…');
    assert.equal(
      completionMeta({ ...item, value: 'opensearch_dashboards_sample_data_logs' }, 33.1),
      '…'
    );
  });

  it('has nothing to show when nothing matches or the one match is the word', () => {
    assert.equal(completionsDone(openCompletions('select qqq', 10)), true);
    assert.equal(completionsDone(openCompletions('zzz zzz', 7)), true);
    assert.equal(completionsDone(openCompletions('zzz zz', 6)), false);
    assert.equal(openList('select qqq', 10), undefined);
  });

  it('goes round the rows and closes with Escape', () => {
    const listed = openList('select ', 7);
    assert.ok(listed);
    if (!listed) return;
    const last = listed.list.filtered.length - 1;
    assert.equal(listKey(listed, 'ArrowUp')?.listed?.row, last);
    assert.equal(listKey({ ...listed, row: last }, 'ArrowDown')?.listed?.row, 0);
    assert.equal(listKey(listed, 'PageDown')?.listed?.row, 7);
    assert.equal(listKey({ ...listed, row: 3 }, 'PageUp')?.listed?.row, 0);
    assert.equal(listKey(listed, 'Ctrl-End')?.listed?.row, last);
    assert.deepEqual(listKey(listed, 'Escape'), {});
    assert.deepEqual(listKey({ ...listed, row: 2 }, 'Tab'), { insert: 2 });
    assert.equal(listKey(listed, 'ArrowLeft'), undefined);
    // A cursor out of the word's line closes the list
    assert.equal(followList(listed, 'select \n', 8), undefined);
  });
});
