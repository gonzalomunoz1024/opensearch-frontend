/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Query Workbench: SQL or PPL typed at the right, the indices listed at the left, the answers
 * below. It asks the server's `/api/sql_console` routes, as the plugin of OpenSearch Dashboards
 * does, and says the same things in the same places.
 */

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import '../../styles/query_workbench.css';
import { Button, Spinner, cx } from '../../components/basic';
import { CodeEditor, SuggestList, type CodeEditorHandle } from '../../components/code_editor';
import { Icon } from '../../components/icon';
import { Modal, copyText, downloadFile } from '../../components/overlay';
import { HttpFetchError } from '../../services/http';
import { services } from '../../services';
import { useBreadcrumbs } from '../../shell/state';
import {
  DOCS,
  INDICES_QUERY,
  OUTPUT_TAB,
  SQL_START,
  firstTab,
  getQueries,
  indexNames,
  readAnswer,
  reasonOf,
  suggestSql,
  tableOf,
  tokenizeSql,
  type Language,
  type QueryAnswer,
  type SqlSuggestions,
  type TableResult,
} from './model';
import { DownloadError, Results, type DownloadKind, type ResultTab } from './results';

const ROUTE = '/api/sql_console';

/** One query sent to a route of the server; a request that fails is an answer that says why */
async function ask(route: string, query: string): Promise<QueryAnswer> {
  try {
    return readAnswer(await services.http.post(`${ROUTE}/${route}`, { body: { query } }));
  } catch (error) {
    const body = error instanceof HttpFetchError ? (error.body as { message?: unknown } | undefined) : undefined;
    return readAnswer(undefined, reasonOf(body?.message) || (error as Error).message);
  }
}

// --- The indices --------------------------------------------------------------------------------

type Tree = { state: 'loading' } | { state: 'loaded'; names: string[] } | { state: 'failed'; message: string };

function IndexTree() {
  const [tree, setTree] = useState<Tree>({ state: 'loading' });
  useEffect(() => {
    let stale = false;
    void (async () => {
      let next: Tree;
      try {
        const answer = readAnswer(await services.http.post(`${ROUTE}/sqlquery`, { body: { query: INDICES_QUERY } }));
        const names = indexNames(answer);
        next = names.length
          ? { state: 'loaded', names }
          : { state: 'failed', message: 'Failed to load OpenSearch indices' };
      } catch {
        next = { state: 'failed', message: 'Failed to load OpenSearch indices, please check user permissions' };
      }
      if (!stale) setTree(next);
    })();
    return () => {
      stale = true;
    };
  }, []);

  if (tree.state === 'loading') {
    return (
      <div className="qwbTreeNote">
        <Spinner size="l" />
        <span>Loading indices</span>
      </div>
    );
  }
  if (tree.state === 'failed') {
    return (
      <div className="qwbTreeNote">
        <Icon name="warning" />
        <span>Failed to load indices</span>
        <span className="atlSubdued">{tree.message}</span>
      </div>
    );
  }
  return (
    <ul className="qwbTree" aria-label="OpenSearch Folder Tree" data-test-subj="opensearch-tree">
      {tree.names.map((name) => (
        <li key={name} className="qwbTree__item" title={name}>
          <Icon name="database" />
          <span>{name.length > 50 ? `${name.slice(0, 47)}...` : name}</span>
        </li>
      ))}
    </ul>
  );
}

// --- The editors --------------------------------------------------------------------------------

function SqlEditor({ value, onChange, onRun }: { value: string; onChange: (text: string) => void; onRun: () => void }) {
  const editor = useRef<CodeEditorHandle>(null);
  const [line, setLine] = useState(0);
  const [menu, setMenu] = useState<(SqlSuggestions & { active: number }) | undefined>();
  const [menuAt, setMenuAt] = useState<{ left: number; top: number }>();

  useLayoutEffect(() => {
    if (!menu) {
      setMenuAt(undefined);
      return;
    }
    const start = value.lastIndexOf('\n', menu.from - 1) + 1;
    const place = editor.current?.coordinates(value.slice(0, menu.from).split('\n').length - 1, menu.from - start);
    setMenuAt(place ? { left: place.left, top: place.bottom + 2 } : undefined);
  }, [menu, value]);

  const open = (text: string, offset: number) => {
    const found = suggestSql(text, offset);
    setMenu(found ? { ...found, active: 0 } : undefined);
  };

  const accept = (index: number) => {
    const item = menu?.items[index];
    if (!menu || !item) return;
    const next = `${value.slice(0, menu.from)}${item.label}${value.slice(menu.to)}`;
    setMenu(undefined);
    onChange(next);
    editor.current?.select(menu.from + item.label.length);
    editor.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const count = menu.items.length;
        setMenu({ ...menu, active: (menu.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count });
        return;
      }
      if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
        event.preventDefault();
        accept(menu.active);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(undefined);
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      onRun();
    } else if (event.ctrlKey && event.key === ' ') {
      event.preventDefault();
      open(value, event.currentTarget.selectionStart);
    }
  };

  return (
    <>
      <CodeEditor
        handle={editor}
        value={value}
        onChange={(next) => {
          onChange(next);
          const [start, end] = editor.current?.selection() ?? [0, 0];
          // Suggestions follow what is typed, and go when text is taken away
          if (start === end && next.length > value.length) open(next, start);
          else setMenu(undefined);
        }}
        onCursor={(start, end) => {
          setLine(value.slice(0, end).split('\n').length - 1);
          if (menu && (start !== end || start < menu.from)) setMenu(undefined);
        }}
        onKeyDown={onKeyDown}
        tokenize={tokenizeSql}
        markedLines={[line, line]}
        fontSize={14}
        height="10rem"
        ariaLabel="Code Editor"
        testId="sqlCodeEditor"
      />
      {menu && menuAt && (
        <SuggestList items={menu.items} active={menu.active} at={menuAt} onPick={accept} testId="sqlAutocomplete" />
      )}
    </>
  );
}

function PplEditor({ value, onChange, onRun }: { value: string; onChange: (text: string) => void; onRun: () => void }) {
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          onRun();
        }
      }}
      gutter={false}
      fontSize={14}
      height="10rem"
      ariaLabel="Code Editor"
      testId="pplCodeEditor"
    />
  );
}

// --- The page -----------------------------------------------------------------------------------

interface Translation {
  fulfilled: boolean;
  data?: unknown;
  errorMessage?: string;
}

/** An answer of `/api/sql_console/translate*` */
function readTranslation(response: unknown): Translation {
  const data = (response as { data?: { ok?: boolean; resp?: unknown } } | undefined)?.data;
  if (!data) return { fulfilled: false, errorMessage: 'no response' };
  if (!data.ok) return { fulfilled: false, errorMessage: String(data.resp ?? '') };
  return { fulfilled: true, data: data.resp };
}

const FILE_KINDS: Record<DownloadKind, { route?: string; extension: string; type: string; name: string }> = {
  jdbc: { extension: 'json', type: 'text/json', name: 'JDBC' },
  csv: { route: 'sqlcsv', extension: 'csv', type: 'text/csv', name: 'CSV' },
  text: { route: 'sqltext', extension: 'txt', type: 'text/plain', name: 'Text' },
};

export function QueryWorkbench() {
  useBreadcrumbs([{ text: 'Query Workbench' }]);
  const [language, setLanguage] = useState<Language>('SQL');
  const [sql, setSql] = useState(SQL_START);
  const [ppl, setPpl] = useState('');
  // What was last run or explained, and what came back
  const [queries, setQueries] = useState<string[]>([]);
  const [answers, setAnswers] = useState<QueryAnswer[]>([]);
  const [results, setResults] = useState<TableResult[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [tab, setTab] = useState<ResultTab>({ id: OUTPUT_TAB, name: OUTPUT_TAB });
  const [search, setSearch] = useState('');
  const [fullScreen, setFullScreen] = useState(false);
  const [explaining, setExplaining] = useState<'asking' | 'shown' | undefined>();
  const [downloadError, setDownloadError] = useState<string>();
  // A slow answer to an earlier run does not replace a later one's
  const runs = useRef(0);

  const text = language === 'SQL' ? sql : ppl;
  const setText = language === 'SQL' ? setSql : setPpl;

  const run = async () => {
    const list = getQueries(text);
    if (list.length === 0) return;
    const turn = (runs.current += 1);
    const route = language === 'SQL' ? 'sqlquery' : 'pplquery';
    const got = await Promise.all(list.map((query) => ask(route, query)));
    if (turn !== runs.current) return;
    const tables = got.map(tableOf);
    setQueries(list);
    setAnswers(got);
    setResults(tables);
    setMessages(tables.map((table) => table.message));
    setTab(firstTab(tables, list));
    setSearch('');
  };

  const explain = async () => {
    const list = getQueries(text);
    setExplaining(list.length ? 'asking' : 'shown');
    if (list.length === 0) return;
    const route = language === 'SQL' ? 'translatesql' : 'translateppl';
    const got = await Promise.all(
      list.map(async (query) => {
        try {
          return readTranslation(await services.http.post(`${ROUTE}/${route}`, { body: { query } }));
        } catch {
          return readTranslation(undefined);
        }
      })
    );
    setQueries(list);
    setTranslations(got);
    setMessages(got.map((translation) => (translation.data ? 'Success' : (translation.errorMessage ?? ''))));
    setExplaining((now) => (now ? 'shown' : undefined));
  };

  const clear = () => {
    runs.current += 1;
    setText('');
    setQueries([]);
    setAnswers([]);
    setResults([]);
    setMessages([]);
    setTranslations([]);
    setTab({ id: OUTPUT_TAB, name: OUTPUT_TAB });
  };

  const download = async (kind: DownloadKind) => {
    const index = Number(tab.id);
    const query = queries[index];
    const file = FILE_KINDS[kind];
    if (query === undefined) return;
    if (!file.route) {
      // The rows as they came, laid out for reading
      try {
        const data = JSON.stringify(JSON.parse(answers[index]?.data ?? ''), undefined, 4);
        downloadFile(`${tab.name}.${file.extension}`, data, file.type);
      } catch {
        setDownloadError('The result cannot be read as JSON.');
      }
      return;
    }
    const answer = await ask(file.route, query);
    if (answer.fulfilled) downloadFile(`${tab.name}.${file.extension}`, answer.data, file.type);
    else setDownloadError(answer.reason || `The result could not be fetched as ${file.name}.`);
  };

  const resultsPanel = (
    <Results
      language={language}
      queries={queries}
      results={results}
      messages={messages}
      tab={tab}
      onTab={(next) => {
        setTab(next);
        setSearch('');
      }}
      search={search}
      onSearch={setSearch}
      fullScreen={fullScreen}
      onFullScreen={setFullScreen}
      onDownload={(kind) => void download(kind)}
    />
  );

  const explained =
    translations.length > 0 && translations[0].fulfilled
      ? translations.map((translation) => JSON.stringify(translation.data, null, 2)).join('\n')
      : 'This query is not explainable.';

  const docs = DOCS[language];
  return (
    <div className={cx('qwbPage', fullScreen && 'qwbPage--full')}>
      <h1 className="atlScreenReaderOnly">Query Workbench</h1>
      {fullScreen ? (
        resultsPanel
      ) : (
        <>
          <aside className="qwbSide">
            <IndexTree />
          </aside>
          <div className="qwbMain">
            <div className="qwbTop">
              <div className="atlSegments" role="group" aria-label="Query language" data-test-subj="switch-button">
                {(['SQL', 'PPL'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="atlSegment"
                    aria-pressed={language === id}
                    onClick={() => {
                      if (id === language) return;
                      // The other language starts with no table; its own text is as it was left
                      runs.current += 1;
                      setLanguage(id);
                      setResults([]);
                    }}
                    data-test-subj={`switch-button-${id.toLowerCase()}`}
                  >
                    {id}
                  </button>
                ))}
              </div>
              <a className="atlButton atlButton--s" href={docs.link} target="_blank" rel="noopener noreferrer">
                {docs.title}
                <Icon name="external" />
              </a>
            </div>

            <section className="qwbEditor">
              {language === 'PPL' && <h3 className="atlTitleS qwbEditor__title">Query editor</h3>}
              {language === 'SQL' ? (
                <SqlEditor value={sql} onChange={setSql} onRun={() => void run()} />
              ) : (
                <PplEditor value={ppl} onChange={setPpl} onRun={() => void run()} />
              )}
              <div className="qwbActions">
                <Button variant="primary" size="s" onClick={() => void run()} testId={language === 'SQL' ? 'sqlRunButton' : 'pplRunButton'}>
                  Run
                </Button>
                <Button size="s" onClick={clear} testId={language === 'SQL' ? 'sqlClearButton' : 'pplClearButton'}>
                  Clear
                </Button>
                <Button size="s" onClick={() => void explain()} testId={language === 'SQL' ? 'sqlExplainButton' : 'pplExplainButton'}>
                  Explain
                </Button>
              </div>
            </section>

            {resultsPanel}
          </div>
        </>
      )}

      {explaining && (
        <Modal
          title="Explain"
          wide
          onClose={() => setExplaining(undefined)}
          testId="explainModal"
          footer={
            <Button variant="primary" size="s" onClick={() => setExplaining(undefined)}>
              Close
            </Button>
          }
        >
          {explaining === 'asking' ? (
            <Spinner size="l" />
          ) : (
            <div className="qwbExplain">
              <button
                type="button"
                className="qwbExplain__copy"
                aria-label="Copy"
                title="Copy"
                onClick={() => copyText(explained, 'Copied')}
              >
                <Icon name="copy" />
              </button>
              <pre className="atlCode qwbExplain__code">{explained}</pre>
            </div>
          )}
        </Modal>
      )}
      {downloadError && <DownloadError message={downloadError} onClose={() => setDownloadError(undefined)} />}
    </div>
  );
}
