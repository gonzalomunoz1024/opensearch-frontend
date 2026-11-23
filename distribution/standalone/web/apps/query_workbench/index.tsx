/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Query Workbench: SQL or PPL typed at the right, the indices listed at the left, the answers
 * below. It asks the server's `/api/sql_console` routes, as the plugin of OpenSearch Dashboards
 * does, and draws the plugin's boxes: a panel of 400 px for the tree beside the page's panel, the
 * switch and the link to the documentation above the editor's panel, then the results' panel.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import '../../styles/query_workbench.css';
import { Button, Spinner, cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Modal, Tooltip, downloadFile } from '../../components/overlay';
import { tokenizeJson } from '../../lib/json_text';
import { useLocation } from '../../router';
import { HttpFetchError } from '../../services/http';
import { services } from '../../services';
import { useBreadcrumbs } from '../../shell/state';
import { QueryEditor } from './editors';
import {
  DEFAULT_CAPABILITIES,
  DOCS,
  DOWNLOADS,
  OUTPUT_TAB,
  SQL_START,
  capabilitiesOf,
  dataSourceOf,
  downloadKinds,
  downloadRoute,
  fileContent,
  firstTab,
  getQueries,
  indicesQuery,
  readAnswer,
  reasonOf,
  startQuery,
  tableOf,
  type Capabilities,
  type DownloadKind,
  type Language,
  type QueryAnswer,
  type TableResult,
} from './model';
import { DownloadError, Results, type ResultTab } from './results';
import { ConnectionPrompt, IndexTree } from './tree';

const ROUTE = '/api/sql_console';

/** One query sent to a route of the server; a request that fails is an answer that says why */
async function ask(route: string, query: string): Promise<QueryAnswer> {
  try {
    return readAnswer(await services.http.post(`${ROUTE}/${route}`, { body: { query } }));
  } catch (error) {
    const body =
      error instanceof HttpFetchError
        ? (error.body as { message?: unknown } | undefined)
        : undefined;
    return readAnswer(undefined, reasonOf(body?.message) || (error as Error).message);
  }
}

/** What OpenSearch can do, by the version the server reads from it, as the plugin asks */
async function loadCapabilities(): Promise<Capabilities> {
  try {
    const answer = await services.http.get<{
      data?: { ok?: boolean; version?: string; isOpenSearch?: boolean };
    }>(`${ROUTE}/cluster_info`);
    if (answer?.data?.ok) return capabilitiesOf(answer.data.version, answer.data.isOpenSearch);
  } catch {
    // the defaults, as the plugin's
  }
  return capabilitiesOf(undefined);
}

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

/** What Explain shows: each translation as JSON, or that the first could not be had */
const explainText = (translations: Translation[]) =>
  translations.length > 0 && translations[0].fulfilled
    ? translations.map((translation) => JSON.stringify(translation.data, null, 2)).join('\n')
    : 'This query is not explainable.';

/** JSON coloured as the component library's code block colours it */
function JsonCode({ text }: { text: string }) {
  const kinds: Record<string, string> = {
    String: 'qwbTok--string',
    Number: 'qwbTok--number',
    Keyword: 'qwbTok--keyword',
  };
  return (
    <code>
      {tokenizeJson(text).map((tokens, line) => (
        <Fragment key={line}>
          {line > 0 && '\n'}
          {tokens.map((token, at) =>
            token.kind && kinds[token.kind] ? (
              <span key={at} className={kinds[token.kind]}>
                {token.text}
              </span>
            ) : (
              token.text
            )
          )}
        </Fragment>
      ))}
    </code>
  );
}

/** The component library's code block's copy button: "Copy" over it, "Copied" once it has */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="qwbCopy" onMouseLeave={() => setCopied(false)}>
      <Tooltip content={copied ? 'Copied' : 'Copy'}>
        <button
          type="button"
          className="qwbCopy__button"
          aria-label="Copy"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          <Icon name="copy" />
        </button>
      </Tooltip>
    </span>
  );
}

/** The SQL/PPL switch: the component library's group of two buttons, a radio each */
function LanguageSwitch({
  language,
  hasPpl,
  onChange,
}: {
  language: Language;
  hasPpl: boolean;
  onChange: (language: Language) => void;
}) {
  const options: Language[] = hasPpl ? ['SQL', 'PPL'] : ['SQL'];
  return (
    <fieldset className="qwbSwitch" data-test-subj="switch-button">
      <legend className="atlScreenReaderOnly">query-language-swtich</legend>
      <div className="qwbSwitch__buttons">
        {options.map((option) => (
          <label
            key={option}
            className={cx('qwbSwitch__button', option === language && 'qwbSwitch__button--selected')}
            data-test-subj={`switch-button-${option.toLowerCase()}`}
          >
            <span className="qwbSwitch__text" data-text={option} title={option}>
              <input
                className="atlScreenReaderOnly"
                type="radio"
                name="qwbLanguage"
                data-test-subj={option}
                checked={option === language}
                onChange={() => onChange(option)}
              />
              {option}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function QueryWorkbench() {
  useBreadcrumbs([{ text: 'Query Workbench' }]);
  const { hashPath } = useLocation();
  // The address names a data source when the page opens only, as the plugin's routes are read
  const [dataSourceTab] = useState(() => dataSourceOf(hashPath) !== '');
  const [capabilities, setCapabilities] = useState<Capabilities>(DEFAULT_CAPABILITIES);
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
  const [explaining, setExplaining] = useState<'asking' | 'shown'>();
  const [downloadError, setDownloadError] = useState<string>();
  // The answers of each download format, fetched for every query on the first download
  const files = useRef<Partial<Record<DownloadKind, QueryAnswer[]>>>({});
  // A slow answer to an earlier run does not replace a later one's
  const runs = useRef(0);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let stale = false;
    void (async () => {
      const next = await loadCapabilities();
      if (stale) return;
      setCapabilities(next);
      // A text the page seeded and nobody touched becomes the seed of the version
      setSql((now) =>
        (now === startQuery(DEFAULT_CAPABILITIES) || now === startQuery({ ...next, legacy: true })) &&
        now !== startQuery(next)
          ? startQuery(next)
          : now
      );
      if (next.hasDataSources) {
        // The plugin asks for the data sources of the SQL plugin; with none of S3 or Glue, which
        // this backend has not, it shows nothing of them
        await services.http.get('/api/get_datasources/').catch(() => undefined);
      }
    })();
    return () => {
      stale = true;
    };
  }, []);

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
    files.current = {};
    setQueries(list);
    setAnswers(got);
    setResults(tables);
    setMessages(tables.map((table) => table.message));
    setTab(firstTab(tables, list));
    setSearch('');
    setRunId((id) => id + 1);
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
    setMessages(
      got.map((translation) => (translation.data ? 'Success' : (translation.errorMessage ?? '')))
    );
    setExplaining((now) => (now ? 'shown' : undefined));
  };

  const clear = () => {
    runs.current += 1;
    files.current = {};
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
    const file = DOWNLOADS[kind];
    let got = kind === 'jdbc' ? answers : files.current[kind];
    if (!got || got.length === 0) {
      got = await Promise.all(queries.map((query) => ask(downloadRoute(language, kind), query)));
      if (kind !== 'jdbc') files.current[kind] = got;
    }
    const answer = got[index];
    const content = answer?.fulfilled ? fileContent(kind, answer.data) : undefined;
    if (content === undefined) {
      setDownloadError(answer?.reason || answer?.errorMessage || 'The result could not be fetched.');
      return;
    }
    downloadFile(`${tab.name}.${file.extension}`, content, file.type);
  };

  const resultsPanel = (
    <div className="qwbResultsWrap">
      <Results
        key={fullScreen ? 'full' : 'page'}
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
        downloads={downloadKinds(capabilities)}
        onDownload={(kind) => void download(kind)}
        runId={runId}
      />
    </div>
  );

  const docs = DOCS[language];
  const testIds = language === 'SQL' ? ['sqlRunButton', 'sqlClearButton'] : ['pplRunButton', 'pplClearButton'];
  return (
    <div className="qwbPage">
      <h1 className="atlScreenReaderOnly">Query Workbench</h1>
      <div className="qwbPage__body">
        {fullScreen ? (
          resultsPanel
        ) : (
          <div className="qwbFrame">
            <div className="qwbSide">
              <div className="qwbSide__bar">
                <p className="qwbSide__title">
                  <b />
                </p>
                <div className="qwbSpacer qwbSpacer--s" />
                <div className="qwbSpacer qwbSpacer--l" />
                <div className="qwbSide__column">
                  {dataSourceTab && (
                    <>
                      <div className="qwbSide__item">
                        <div className="qwbSpacer qwbSpacer--s" />
                      </div>
                      <div className="qwbSide__item" />
                    </>
                  )}
                  <div className="qwbSide__item">
                    {dataSourceTab ? (
                      <ConnectionPrompt />
                    ) : (
                      <IndexTree query={indicesQuery(capabilities)} />
                    )}
                    <div className="qwbSpacer qwbSpacer--l" />
                  </div>
                </div>
              </div>
            </div>

            <main className="qwbMain">
              <div className="qwbTop">
                <div className="qwbTop__item">
                  <LanguageSwitch
                    language={language}
                    hasPpl={capabilities.hasPpl}
                    onChange={(next) => {
                      // The other language starts with no table; its own text is as it was left
                      runs.current += 1;
                      setLanguage(next);
                      setResults([]);
                    }}
                  />
                  <div className="qwbSpacer qwbSpacer--l" />
                </div>
                <div className="qwbTop__item">
                  <a
                    className="atlButton qwbButton"
                    href={docs.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {docs.title}
                    <Icon name="popout" />
                  </a>
                </div>
              </div>

              <div className="qwbBody">
                <div className="qwbBody__empty" />
                <div>
                  <section
                    className={cx('qwbEditorPanel', language === 'PPL' && 'qwbEditorPanel--ppl')}
                  >
                    {language === 'PPL' && <h3 className="qwbPanelTitle">Query editor</h3>}
                    <div className="qwbSpacer qwbSpacer--s" />
                    <QueryEditor key={language} language={language} value={text} onChange={setText} />
                    <div className="qwbSpacer qwbSpacer--l" />
                    <div className="qwbActions">
                      <Button
                        variant="primary"
                        className="qwbButton"
                        onClick={() => void run()}
                        testId={testIds[0]}
                      >
                        Run
                      </Button>
                      <Button className="qwbButton" onClick={clear} testId={testIds[1]}>
                        Clear
                      </Button>
                      <Button className="qwbButton" onClick={() => void explain()}>
                        Explain
                      </Button>
                    </div>
                  </section>
                </div>
                <div className="qwbSpacer qwbSpacer--l" />
                {resultsPanel}
              </div>
            </main>
          </div>
        )}
      </div>

      {explaining && (
        <Modal
          title="Explain"
          className="qwbExplainModal"
          onClose={() => setExplaining(undefined)}
          testId="explainModal"
          footer={
            <Button variant="primary" onClick={() => setExplaining(undefined)}>
              Close
            </Button>
          }
        >
          {explaining === 'asking' ? (
            <Spinner size="l" />
          ) : (
            <div className="qwbExplain">
              <pre className="qwbExplain__code">
                <JsonCode text={explainText(translations)} />
              </pre>
              <CopyButton text={explainText(translations)} />
            </div>
          )}
        </Modal>
      )}
      {downloadError && (
        <DownloadError message={downloadError} onClose={() => setDownloadError(undefined)} />
      )}
    </div>
  );
}
