/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The console of Dev Tools: requests to OpenSearch written on the left, the answers on the
 * right. What is typed, the history and the settings are kept in the browser under the names
 * OpenSearch Dashboards uses, so a browser that had the one has its text in the other.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Badge, Button, CallOut, cx } from '../../components/basic';
import { CodeEditor, type CodeEditorHandle } from '../../components/code_editor';
import { Checkbox, FormRow, NumberField, RadioGroup, Switch } from '../../components/form';
import { Icon } from '../../components/icon';
import { ConfirmModal, Flyout, MenuButton, Modal, Portal, copyText, downloadFile } from '../../components/overlay';
import { formatDate } from '../../lib/dates';
import { services } from '../../services';
import {
  DEFAULT_TEXT,
  autoIndent,
  bodyOf,
  describePast,
  formatAnswer,
  insertRequest,
  lineOf,
  looksLikeCurl,
  parseCurl,
  parseRequests,
  replaceRequest,
  requestOffsets,
  requestsInRange,
  suggest,
  toCurl,
  tokenizeAnswer,
  tokenizeConsole,
  type ClusterNames,
  type ConsoleRequest,
  type PastRequest,
  type Suggestions,
} from './console_model';

// --- What the browser keeps --------------------------------------------------------------------

const PREFIX = 'sense:';

const stored = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // a browser that keeps nothing still has a console
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      // nothing to remove
    }
  },
  keys(): string[] {
    try {
      return Object.keys(window.localStorage)
        .filter((key) => key.startsWith(PREFIX))
        .map((key) => key.slice(PREFIX.length));
    } catch {
      return [];
    }
  },
};

interface TextObject {
  id: string;
  createdAt: number;
  updatedAt: number;
  text: string;
}

const TEXT_PREFIX = 'console_local_text';

function newId(): string {
  const random = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${random()}-${random().slice(0, 4)}-4${random().slice(0, 3)}-a${random().slice(0, 3)}-${random()}${random().slice(0, 4)}`;
}

function loadTextObject(): TextObject {
  const all = stored
    .keys()
    .filter((key) => key.includes(TEXT_PREFIX))
    .map((key) => stored.get<TextObject | undefined>(key, undefined))
    .filter((object): object is TextObject => typeof object?.text === 'string')
    .sort((a, b) => a.createdAt - b.createdAt);
  if (all[0]) return all[0];
  const fresh: TextObject = { id: newId(), createdAt: Date.now(), updatedAt: Date.now(), text: DEFAULT_TEXT };
  stored.set(`${TEXT_PREFIX}_${fresh.id}`, fresh);
  return fresh;
}

const saveTextObject = (object: TextObject) => stored.set(`${TEXT_PREFIX}_${object.id}`, object);

interface ConsoleSettings {
  fontSize: number;
  wrapMode: boolean;
  tripleQuotes: boolean;
  autocomplete: { fields: boolean; indices: boolean; templates: boolean };
  polling: boolean;
}

const loadSettings = (): ConsoleSettings => ({
  fontSize: Number(stored.get<number | string>('font_size', 14)) || 14,
  wrapMode: stored.get<boolean>('wrap_mode', true) !== false,
  tripleQuotes: stored.get<boolean>('triple_quotes', true) !== false,
  autocomplete: { fields: true, indices: true, templates: true, ...stored.get('autocomplete_settings', {}) },
  polling: Boolean(stored.get('console_polling', true)),
});

function saveSettings(settings: ConsoleSettings) {
  stored.set('font_size', settings.fontSize);
  stored.set('wrap_mode', settings.wrapMode);
  stored.set('triple_quotes', settings.tripleQuotes);
  stored.set('autocomplete_settings', settings.autocomplete);
  stored.set('console_polling', settings.polling);
}

const historyKeys = () =>
  stored
    .keys()
    .filter((key) => key.indexOf('hist_elem') === 0)
    .sort()
    .reverse();

const loadHistory = (): PastRequest[] =>
  historyKeys()
    .map((key) => stored.get<PastRequest | undefined>(key, undefined))
    .filter((request): request is PastRequest => Boolean(request?.endpoint));

let lastHistoryTime = 0;
function addToHistory(endpoint: string, method: string, data: string) {
  // Only the 500 latest are kept
  for (const key of historyKeys().slice(500)) stored.remove(key);
  lastHistoryTime = Math.max(Date.now(), lastHistoryTime + 1);
  stored.set(`hist_elem_${lastHistoryTime}`, { time: lastHistoryTime, endpoint, method, data });
}

// --- Sending -----------------------------------------------------------------------------------

interface Answer {
  ok: boolean;
  method: string;
  path: string;
  data: string;
  statusCode?: number;
  statusText?: string;
  timeMs: number;
  value: string;
}

const REASONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

async function send(request: ConsoleRequest, several: boolean, tripleQuotes: boolean, signal: AbortSignal): Promise<Answer> {
  const data = bodyOf(request);
  const heading = several ? `${request.method} ${request.url}` : undefined;
  const base = { method: request.method, path: request.url, data };
  const started = Date.now();
  try {
    const query = new URLSearchParams({ path: request.url, method: request.method });
    const response = await fetch(`${services.http.prepend('/api/console/proxy')}?${query.toString()}`, {
      method: 'POST',
      headers: { 'osd-xsrf': 'true', 'content-type': 'application/json' },
      body: data || undefined,
      credentials: 'same-origin',
      signal,
    });
    const text = await response.text();
    const status = response.status;
    // Deleting an index that is not there, say, is an answer and not a failure
    const ok = (status >= 200 && status < 300) || status === 404;
    const contentType = response.headers.get('content-type') ?? 'text/plain';
    const value =
      text === '' && !ok
        ? formatAnswer(`Request failed to get to the server (status code: ${status})`, 'text/plain', { heading })
        : formatAnswer(text, contentType, { warnings: ok ? response.headers.get('warning') : null, tripleQuotes, heading });
    return { ...base, ok, statusCode: status, statusText: response.statusText || REASONS[status] || '', timeMs: Date.now() - started, value };
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    const value = `\n\nFailed to connect to Console's backend.\nPlease check the ${services.boot.name} server is up and running`;
    return { ...base, ok: false, timeMs: Date.now() - started, value: heading ? `# ${heading}\n${value}` : value };
  }
}

// --- The names of the cluster, for what could be typed next ------------------------------------

interface Names {
  indices: Record<string, string[]>;
  templates: string[];
  fields: Record<string, string[]>;
}

function fieldNames(properties: unknown, prefix = ''): string[] {
  if (!properties || typeof properties !== 'object') return [];
  const out: string[] = [];
  for (const [name, mapping] of Object.entries(properties as Record<string, { properties?: unknown; fields?: unknown }>)) {
    const path = `${prefix}${name}`;
    if (mapping?.properties) out.push(...fieldNames(mapping.properties, `${path}.`));
    else out.push(path);
    if (mapping?.fields) out.push(...fieldNames(mapping.fields, `${path}.`));
  }
  return out;
}

function useClusterNames(settings: ConsoleSettings): [ClusterNames, () => void] {
  const [names, setNames] = useState<Names>({ indices: {}, templates: [], fields: {} });
  const wanted = settings.autocomplete;
  const refresh = useCallback(() => {
    const quiet = <T,>(request: Promise<T>, fallback: T) => request.catch(() => fallback);
    type Aliases = Record<string, { aliases?: Record<string, unknown> }>;
    type Mappings = Record<string, { mappings?: { properties?: unknown } }>;
    const none: Promise<Record<string, never>> = Promise.resolve({});
    void Promise.all([
      wanted.indices ? quiet(services.search.request<Aliases>('GET', '_aliases'), {} as Aliases) : (none as Promise<Aliases>),
      wanted.fields ? quiet(services.search.request<Mappings>('GET', '_mapping'), {} as Mappings) : (none as Promise<Mappings>),
      wanted.templates
        ? quiet(services.search.request<Array<{ name: string }>>('GET', '_cat/templates?format=json&h=name'), [])
        : Promise.resolve<Array<{ name: string }>>([]),
    ]).then(([aliases, mappings, templates]) => {
      setNames({
        indices: Object.fromEntries(Object.entries(aliases).map(([index, value]) => [index, Object.keys(value?.aliases ?? {})])),
        fields: Object.fromEntries(Object.entries(mappings).map(([index, value]) => [index, fieldNames(value?.mappings?.properties)])),
        templates: Array.isArray(templates) ? templates.map((template) => template.name) : [],
      });
    });
  }, [wanted.indices, wanted.fields, wanted.templates]);

  useEffect(() => {
    refresh();
    if (!settings.polling) return undefined;
    const timer = window.setInterval(refresh, 60000);
    return () => window.clearInterval(timer);
  }, [refresh, settings.polling]);

  const cluster = useMemo<ClusterNames>(() => {
    const indices = Object.keys(names.indices).sort();
    const aliases = [...new Set(Object.values(names.indices).flat())].sort();
    return {
      indices,
      aliases,
      templates: names.templates,
      fields: (target) => {
        const patterns = target.startsWith('_') || target === '' ? ['*'] : target.split(',');
        const matches = (index: string) =>
          patterns.some((pattern) => {
            if (pattern === index || names.indices[index]?.includes(pattern)) return true;
            if (!pattern.includes('*')) return false;
            return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(index);
          });
        const found = new Set<string>();
        for (const [index, fields] of Object.entries(names.fields)) if (matches(index)) for (const field of fields) found.add(field);
        return [...found].sort();
      },
    };
  }, [names]);
  return [cluster, refresh];
}

// --- Where the manual is -----------------------------------------------------------------------

const DOCS = 'https://opensearch.org/docs/latest';
const DOC_PAGES: Array<[RegExp, string]> = [
  [/(^|\/)_plugins\/_(sql|ppl)/, '/search-plugins/sql/sql-ppl-api/'],
  [/(^|\/)_plugins\/_ism/, '/im-plugin/ism/api/'],
  [/(^|\/)_plugins\/_rollup/, '/im-plugin/index-rollups/rollup-api/'],
  [/(^|\/)_plugins\/_transform/, '/im-plugin/index-transforms/transforms-apis/'],
  [/(^|\/)_plugins\/_sm/, '/tuning-your-cluster/availability-and-recovery/snapshots/sm-api/'],
  [/(^|\/)_msearch/, '/api-reference/multi-search/'],
  [/(^|\/)_search\/scroll/, '/api-reference/scroll/'],
  [/(^|\/)_search/, '/api-reference/search/'],
  [/(^|\/)_count/, '/api-reference/count/'],
  [/(^|\/)_bulk/, '/api-reference/document-apis/bulk/'],
  [/(^|\/)_mget/, '/api-reference/document-apis/multi-get/'],
  [/(^|\/)_reindex/, '/api-reference/document-apis/reindex/'],
  [/(^|\/)_update_by_query/, '/api-reference/document-apis/update-by-query/'],
  [/(^|\/)_delete_by_query/, '/api-reference/document-apis/delete-by-query/'],
  [/(^|\/)_(doc|create|update|source)(\/|$)/, '/api-reference/document-apis/index/'],
  [/^\/?_cat/, '/api-reference/cat/index/'],
  [/^\/?_cluster/, '/api-reference/cluster-api/index/'],
  [/^\/?_nodes/, '/api-reference/nodes-apis/index/'],
  [/^\/?_snapshot/, '/api-reference/snapshots/index/'],
  [/^\/?_ingest/, '/api-reference/ingest-apis/index/'],
  [/^\/?_tasks/, '/api-reference/tasks/'],
  [/(^|\/)_analyze/, '/api-reference/analyze-apis/'],
  [/(^|\/)_(mapping|settings|alias|aliases|template|index_template|component_template|data_stream|refresh|flush|forcemerge|open|close|rollover|shrink|split|clone|stats|segments|recovery)/, '/api-reference/index-apis/index/'],
];

const docsFor = (url: string) => `${DOCS}${DOC_PAGES.find(([pattern]) => pattern.test(url))?.[1] ?? '/api-reference/'}`;

// --- The panels around the editor --------------------------------------------------------------

const EXAMPLE = `# index a doc
PUT index/_doc/1
{
  "body": "here"
}

# and get it ...
GET index/_doc/1`;

function Example() {
  return <CodeEditor readOnly value={EXAMPLE} tokenize={tokenizeConsole} minLines={8} ariaLabel="Dev Tools Console editor example" />;
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  const keys: Array<[string, string]> = [
    ['Ctrl/Cmd + I', 'Auto indent current request'],
    ['Ctrl/Cmd + /', 'Open documentation for current request'],
    ['Ctrl + Space', 'Open Auto complete (even if not typing)'],
    ['Ctrl/Cmd + Enter', 'Submit request'],
    ['Ctrl/Cmd + Up/Down', 'Jump to the previous/next request start or end.'],
    ['Down arrow', 'Switch focus to auto-complete menu. Use arrows to further select a term'],
    ['Enter/Tab', 'Select the currently selected or the top most term in auto-complete menu'],
    ['Esc', 'Close auto-complete menu'],
  ];
  return (
    <Flyout title="Help" onClose={onClose} testId="helpFlyout">
      <div className="atlStack">
        <h3 className="atlTitleS">Request format</h3>
        <p>You can type one or more requests in the white editor. Console understands requests in a compact format:</p>
        <Example />
        <h3 className="atlTitleS">Keyboard commands</h3>
        <dl className="dvtKeys">
          {keys.map(([key, what]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Flyout>
  );
}

function WelcomePanel({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Flyout
      title="Welcome to Console"
      onClose={onDismiss}
      testId="welcomePanel"
      footer={
        <Button variant="primary" onClick={onDismiss} testId="help-close-button">
          Dismiss
        </Button>
      }
    >
      <div className="atlStack">
        <h4 className="atlTitleS">Quick intro to the UI</h4>
        <p>
          The Console UI is split into two panes: an editor pane (left) and a response pane (right). Use the editor to type requests and
          submit them to OpenSearch. The results will be displayed in the response pane on the right side.
        </p>
        <p>Console understands requests in a compact format, similar to cURL:</p>
        <Example />
        <p>
          While typing a request, Console will make suggestions which you can then accept by hitting Enter/Tab. These suggestions are made
          based on the request structure as well as your indices and types.
        </p>
        <h4 className="atlTitleS">A few quick tips, while I have your attention</h4>
        <ul className="dvtTips">
          <li>Submit requests to OpenSearch using the green triangle button.</li>
          <li>Use the wrench menu for other useful things.</li>
          <li>You can paste requests in cURL format and they will be translated to the Console syntax.</li>
          <li>You can resize the editor and output panes by dragging the separator between them.</li>
          <li>Study the keyboard shortcuts under the Help button. Good stuff in there!</li>
        </ul>
      </div>
    </Flyout>
  );
}

// Several controls under one heading: a form row would make one label of them all
function Group({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="atlFormRow atlFormRow--full" role="group" aria-label={label}>
      <span className="atlFormRow__label">{label}</span>
      {help && <span className="atlFormRow__help">{help}</span>}
      <div className="atlStack dvtTight">{children}</div>
    </div>
  );
}

function SettingsModal({
  settings,
  onSave,
  onRefresh,
  onClose,
}: {
  settings: ConsoleSettings;
  onSave: (settings: ConsoleSettings) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const autocomplete = (name: 'fields' | 'indices' | 'templates', label: string) => (
    <Checkbox
      checked={draft.autocomplete[name]}
      onChange={(checked) => setDraft({ ...draft, autocomplete: { ...draft.autocomplete, [name]: checked } })}
      label={label}
      testId={`autocomplete-${name}`}
    />
  );
  return (
    <Modal
      title="Console Settings"
      onClose={onClose}
      testId="devToolsSettingsModal"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="settingsCloseButton">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(draft)} testId="settings-save-button">
            Save
          </Button>
        </>
      }
    >
      <div className="atlStack">
        <FormRow label="Font Size">
          <NumberField min={6} max={50} value={draft.fontSize} onChange={(fontSize) => setDraft({ ...draft, fontSize: fontSize ?? 14 })} testId="setting-font-size-input" />
        </FormRow>
        <Checkbox checked={draft.wrapMode} onChange={(wrapMode) => setDraft({ ...draft, wrapMode })} label="Wrap long lines" testId="settingsWrapLines" />
        <Group label="JSON syntax">
          <Checkbox checked={draft.tripleQuotes} onChange={(tripleQuotes) => setDraft({ ...draft, tripleQuotes })} label="Use triple quotes in output pane" testId="tripleQuotes" />
        </Group>
        <Group label="Autocomplete">
          {autocomplete('fields', 'Fields')}
          {autocomplete('indices', 'Indices & Aliases')}
          {autocomplete('templates', 'Templates')}
        </Group>
        <Group
          label="Refreshing autocomplete suggestions"
          help="Console refreshes autocomplete suggestions by querying OpenSearch. Automatic refreshes may be an issue if you have a large cluster or if you have network limitations."
        >
          <Switch checked={draft.polling} onChange={(polling) => setDraft({ ...draft, polling })} label="Automatically refresh autocomplete suggestions" testId="autocompletePolling" />
          <div>
            <Button size="s" icon="refresh" onClick={onRefresh} testId="autocompletePollingRefresh">
              Refresh autocomplete suggestions
            </Button>
          </div>
        </Group>
      </div>
    </Modal>
  );
}

function ImportFlyout({ current, onImported, onClose }: { current: TextObject; onImported: (object: TextObject) => void; onClose: () => void }) {
  const [file, setFile] = useState<File>();
  const [mode, setMode] = useState<'merge' | 'overwrite'>('merge');
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (overwriteConfirmed: boolean) => {
    if (!file) return;
    setError(undefined);
    setBusy(true);
    try {
      let imported: { text?: unknown };
      try {
        imported = JSON.parse(await file.text()) as { text?: unknown };
      } catch (parseError) {
        setError(`The file could not be processed due to error: "${(parseError as Error).message}"`);
        return;
      }
      if (typeof imported?.text !== 'string' || imported.text === '') {
        setError('The selected file is not valid. Please select a valid JSON file.');
        return;
      }
      if (mode === 'overwrite') {
        if (!overwriteConfirmed) {
          setConfirming(true);
          return;
        }
        onImported({ ...current, createdAt: Date.now(), updatedAt: Date.now(), text: imported.text });
        services.toasts.success('Queries overwritten.');
      } else {
        const stamp = formatDate(new Date(), services.uiSettings.get('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS'), services.timeZone());
        onImported({
          ...current,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          text: `${current.text}\n\n#Imported on ${stamp}\n\n${imported.text}`,
        });
        services.toasts.success('Queries merged.');
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flyout
      title="Import queries"
      onClose={onClose}
      testId="importQueriesFlyout"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="importQueriesCancelBtn">
            Cancel
          </Button>
          <Button variant="primary" disabled={!file} loading={busy} onClick={() => void run(false)} testId="importQueriesConfirmBtn">
            Import
          </Button>
        </>
      }
    >
      <div className="atlStack">
        {error && (
          <CallOut tone="critical" title="Sorry, there was an error">
            {error}
          </CallOut>
        )}
        <FormRow label="Select a file to import" full>
          <input type="file" accept=".json,application/json" onChange={(event) => setFile(event.target.files?.[0])} data-test-subj="queryFilePicker" />
        </FormRow>
        <div className="atlStack dvtTight">
          <strong>Import options</strong>
          <RadioGroup<'merge' | 'overwrite'>
            value={mode}
            onChange={setMode}
            options={[
              { id: 'merge', label: 'Merge with existing queries' },
              { id: 'overwrite', label: 'Overwrite existing queries' },
            ]}
          />
        </div>
      </div>
      {confirming && (
        <ConfirmModal
          title="Confirm Overwrite"
          confirmLabel="Overwrite"
          cancelLabel="Skip"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run(true);
          }}
        >
          Are you sure you want to overwrite the existing queries? This action cannot be undone. All existing queries will be deleted and
          replaced with the imported queries. If you are unsure, please choose the "Merge with existing queries" option instead
        </ConfirmModal>
      )}
    </Flyout>
  );
}

function HistoryPanel({ fontSize, onApply, onClose }: { fontSize: number; onApply: (request: PastRequest) => void; onClose: () => void }) {
  const [requests, setRequests] = useState(loadHistory);
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState<number>();
  const list = useRef<HTMLUListElement>(null);
  const now = Date.now();
  const viewing = requests[hovered ?? selected];
  const text = viewing ? `${viewing.method} ${viewing.endpoint}${viewing.data ? `\n${viewing.data.replace(/\n$/, '')}` : ''}` : 'No history available';

  const choose = (index: number) => {
    const next = Math.min(Math.max(0, index), requests.length - 1);
    setSelected(next);
    list.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <section className="dvtHistory" data-test-subj="consoleHistoryPanel">
      <h2 className="atlTitleS">History</h2>
      <div className="dvtHistory__body">
        <ul
          ref={list}
          role="listbox"
          tabIndex={0}
          className="dvtHistory__list"
          aria-label="History of sent requests"
          aria-activedescendant={requests.length ? `historyReq${selected}` : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && requests[selected]) onApply(requests[selected]);
            else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              choose(selected + (event.key === 'ArrowUp' ? -1 : 1));
            }
          }}
        >
          {requests.map((request, index) => {
            const description = describePast(request, now);
            return (
              <li
                key={`${request.time}-${index}`}
                id={`historyReq${index}`}
                role="option"
                aria-selected={index === selected}
                aria-label={`Request: ${description}`}
                className={cx('dvtHistory__item', index === selected && 'dvtHistory__item--selected')}
                onClick={() => setSelected(index)}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(undefined)}
                onDoubleClick={() => onApply(request)}
              >
                <span className="atlTruncate">{description}</span>
                <Icon name="arrowRight" />
              </li>
            );
          })}
        </ul>
        <CodeEditor readOnly value={text} tokenize={viewing ? tokenizeConsole : undefined} height="100%" fontSize={fontSize} ariaLabel="History viewer" className="dvtHistory__viewer" />
      </div>
      <div className="dvtHistory__footer">
        <Button
          variant="empty"
          size="s"
          onClick={() => {
            for (const key of historyKeys()) stored.remove(key);
            setRequests([]);
            setSelected(0);
          }}
          testId="consoleClearHistoryButton"
        >
          Clear
        </Button>
        <span className="atlRow">
          <Button variant="empty" size="s" onClick={onClose} testId="consoleHistoryCloseButton">
            Close
          </Button>
          <Button variant="primary" size="s" disabled={!requests[selected]} onClick={() => requests[selected] && onApply(requests[selected])} testId="consoleHistoryApplyButton">
            Apply
          </Button>
        </span>
      </div>
    </section>
  );
}

function StatusBar({ running, answer }: { running: boolean; answer?: Answer }) {
  if (running) return <Badge>Request in progress</Badge>;
  if (!answer || answer.statusCode === undefined) return null;
  const code = answer.statusCode;
  const tone = code <= 199 ? undefined : code <= 299 ? 'healthy' : code <= 399 ? 'accent' : code <= 499 ? 'warning' : 'critical';
  return (
    <>
      <span title={`${answer.method} ${answer.path.startsWith('/') ? answer.path : `/${answer.path}`}`} data-test-subj="consoleResponseStatusBadge">
        <Badge tone={tone}>
          {code}&nbsp;-&nbsp;{answer.statusText}
        </Badge>
      </span>
      <span title="Time Elapsed">
        <Badge>{answer.timeMs}&nbsp;ms</Badge>
      </span>
    </>
  );
}

// --- The console -------------------------------------------------------------------------------

type Panel = 'history' | 'settings' | 'help' | 'import';

export function Console() {
  const [object, setObject] = useState(loadTextObject);
  const [text, setText] = useState(object.text);
  const [settings, setSettings] = useState(loadSettings);
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [output, setOutput] = useState('');
  const [answer, setAnswer] = useState<Answer>();
  const [running, setRunning] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const [welcome, setWelcome] = useState(() => stored.get<string>('version_welcome_shown', '') !== '@@SENSE_REVISION');
  const [scrollTop, setScrollTop] = useState(0);
  const [actionsTop, setActionsTop] = useState<number>();
  const [split, setSplit] = useState(() => Number(stored.get<number[]>('widths', [50, 50])[0]) || 50);
  const [menu, setMenu] = useState<(Suggestions & { active: number }) | undefined>();
  const [menuAt, setMenuAt] = useState<{ left: number; top: number }>();
  const [host, setHost] = useState('http://localhost:9200');
  const editor = useRef<CodeEditorHandle>(null);
  const panes = useRef<HTMLDivElement>(null);
  const sending = useRef<AbortController | undefined>(undefined);
  const [names, refreshNames] = useClusterNames(settings);

  // What is typed is kept as it is typed, and once more when the page is left
  const latest = useRef({ object, text });
  latest.current = { object, text };
  useEffect(() => {
    const timer = window.setTimeout(() => saveTextObject({ ...latest.current.object, text, updatedAt: Date.now() }), 500);
    return () => window.clearTimeout(timer);
  }, [text]);
  useEffect(
    () => () => {
      saveTextObject({ ...latest.current.object, text: latest.current.text, updatedAt: Date.now() });
      sending.current?.abort();
    },
    []
  );

  useEffect(() => {
    services.http
      .get<{ host?: string }>('/api/console/opensearch_config')
      .then((config) => config?.host && setHost(config.host))
      .catch(() => undefined);
  }, []);

  const requests = useMemo(() => parseRequests(text), [text]);
  const fromLine = lineOf(text, selection[0]);
  const toLine = lineOf(text, selection[1]);
  const current = useMemo(() => requestsInRange(requests, fromLine, toLine), [requests, fromLine, toLine]);
  const first = current[0];
  const last = current[current.length - 1];

  useLayoutEffect(() => {
    setActionsTop(first ? editor.current?.lineTop(first.startLine) : undefined);
  }, [first, text, settings.fontSize, settings.wrapMode, split, panel]);

  useLayoutEffect(() => {
    if (!menu) {
      setMenuAt(undefined);
      return;
    }
    const line = lineOf(text, menu.from);
    const column = menu.from - (text.lastIndexOf('\n', menu.from - 1) + 1);
    const place = editor.current?.coordinates(line, column);
    setMenuAt(place ? { left: place.left, top: place.bottom + 2 } : undefined);
  }, [menu, text, scrollTop]);

  const change = (next: string, start: number, end = start) => {
    setText(next);
    editor.current?.select(start, end);
    setSelection([start, end]);
  };

  const sendCurrent = async () => {
    if (current.length === 0 || running) return;
    const controller = new AbortController();
    sending.current = controller;
    setRunning(true);
    setMenu(undefined);
    const answers: Answer[] = [];
    try {
      for (const request of current) {
        const result = await send(request, current.length > 1, settings.tripleQuotes, controller.signal);
        if (!result.ok) {
          // A request that failed is all that is shown, as the ones after it were not sent
          setOutput(result.value);
          setAnswer(result);
          return;
        }
        answers.push(result);
      }
      for (const result of answers) addToHistory(result.path, result.method, result.data);
      setOutput(answers.map((result) => result.value).join('\n'));
      setAnswer(answers[answers.length - 1]);
    } catch {
      // the page was left while a request was out
    } finally {
      if (sending.current === controller) {
        sending.current = undefined;
        setRunning(false);
      }
    }
  };

  const indentCurrent = () => {
    if (!first || first.data.length === 0) return;
    const next = replaceRequest(text, first, autoIndent(first));
    const [start] = requestOffsets(text, first);
    change(next, start);
  };

  const openDocs = () => {
    if (first) window.open(docsFor(first.url), '_blank', 'noopener,noreferrer');
  };

  const jump = (direction: -1 | 1) => {
    const edges = [...new Set(requests.flatMap((request) => [request.startLine, request.endLine]))].sort((a, b) => a - b);
    const line = lineOf(text, direction === -1 ? selection[0] : selection[1]);
    const target = direction === -1 ? [...edges].reverse().find((edge) => edge < line) : edges.find((edge) => edge > line);
    if (target === undefined) return;
    const offset = text.split('\n').slice(0, target).reduce((sum, row) => sum + row.length + 1, 0);
    editor.current?.select(offset);
    setSelection([offset, offset]);
  };

  const openMenu = (value: string, offset: number) => {
    const found = suggest(value, offset, names);
    setMenu(found ? { ...found, active: 0 } : undefined);
  };

  const accept = (index: number) => {
    if (!menu) return;
    const item = menu.items[index];
    if (!item) return;
    const insert = item.insert ?? item.label;
    const next = `${text.slice(0, menu.from)}${insert}${text.slice(menu.to)}`;
    const cursor = menu.from + insert.length - (item.back ?? 0);
    setMenu(undefined);
    change(next, cursor);
    editor.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = event.ctrlKey || event.metaKey;
    if (menu) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const count = menu.items.length;
        setMenu({ ...menu, active: (menu.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count });
        return;
      }
      if ((event.key === 'Enter' && !mod) || event.key === 'Tab') {
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
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      void sendCurrent();
    } else if (mod && !event.altKey && (event.key === 'i' || event.key === 'I')) {
      event.preventDefault();
      indentCurrent();
    } else if (mod && event.key === '/') {
      event.preventDefault();
      openDocs();
    } else if (event.ctrlKey && event.key === ' ') {
      event.preventDefault();
      openMenu(text, event.currentTarget.selectionStart);
    } else if (mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      jump(event.key === 'ArrowUp' ? -1 : 1);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    if (!looksLikeCurl(pasted)) return;
    event.preventDefault();
    const { selectionStart, selectionEnd } = event.currentTarget;
    const written = parseCurl(pasted);
    change(`${text.slice(0, selectionStart)}${written}${text.slice(selectionEnd)}`, selectionStart + written.length);
  };

  const applyPast = (past: PastRequest) => {
    const inserted = insertRequest(text, lineOf(text, selection[0]), { ...past, data: past.data?.replace(/\n$/, '') });
    change(inserted.text, inserted.offset);
    editor.current?.focus();
  };

  const startResize = (down: ReactMouseEvent) => {
    down.preventDefault();
    const box = panes.current?.getBoundingClientRect();
    if (!box) return;
    let width = split;
    const move = (event: MouseEvent) => {
      width = Math.min(85, Math.max(15, ((event.clientX - box.left) / box.width) * 100));
      setSplit(width);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      stored.set('widths', [width, 100 - width]);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const exportText = () => {
    const saved: TextObject = { ...object, text, updatedAt: Date.now() };
    saveTextObject(saved);
    downloadFile('sense.json', JSON.stringify(saved), 'application/json');
  };

  const menuItems: Array<{ id: Panel | 'export'; label: string; testId: string; onClick: () => void }> = [
    { id: 'history', label: 'History', testId: 'consoleHistoryButton', onClick: () => setPanel(panel === 'history' ? undefined : 'history') },
    { id: 'settings', label: 'Settings', testId: 'consoleSettingsButton', onClick: () => setPanel('settings') },
    { id: 'help', label: 'Help', testId: 'consoleHelpButton', onClick: () => setPanel(panel === 'help' ? undefined : 'help') },
    { id: 'export', label: 'Export', testId: 'consoleExportButton', onClick: exportText },
    { id: 'import', label: 'Import', testId: 'consoleImportButton', onClick: () => setPanel(panel === 'import' ? undefined : 'import') },
  ];

  const actionsShown = actionsTop !== undefined && actionsTop - scrollTop >= 0;
  return (
    <div className="dvtConsole" data-test-subj="console">
      <h1 className="atlScreenReaderOnly">Console</h1>
      <div className="dvtMenu">
        {menuItems.map((item) => (
          <button key={item.id} type="button" className="dvtMenu__item" aria-pressed={panel === item.id} onClick={item.onClick} data-test-subj={item.testId}>
            {item.label}
          </button>
        ))}
        <span className="atlGrow" />
        <span className="dvtMenu__status">
          <StatusBar running={running} answer={answer} />
        </span>
      </div>
      {panel === 'history' && <HistoryPanel fontSize={settings.fontSize} onClose={() => setPanel(undefined)} onApply={applyPast} />}
      <div className="dvtPanes" ref={panes}>
        <div className="dvtPane" style={{ width: `${split}%` }}>
          <CodeEditor
            handle={editor}
            value={text}
            onChange={(next) => {
              setText(next);
              const [start, end] = editor.current?.selection() ?? [0, 0];
              // Suggestions follow what is typed, and go when text is taken away
              if (start === end && next.length > text.length) openMenu(next, start);
              else setMenu(undefined);
            }}
            onCursor={(start, end) => {
              setSelection([start, end]);
              if (menu && (start !== end || start < menu.from)) setMenu(undefined);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onScroll={setScrollTop}
            tokenize={tokenizeConsole}
            markedLines={first && last ? [first.startLine, last.endLine] : undefined}
            wrap={settings.wrapMode}
            fontSize={settings.fontSize}
            height="100%"
            ariaLabel="Console editor"
            testId="request-editor"
            className="dvtEditor"
          />
          {first && actionsShown && (
            <div className="dvtActions" style={{ top: (actionsTop ?? 0) - scrollTop + 1 }}>
              <button type="button" className="dvtActions__send" title="Click to send request" aria-label="Click to send request" onClick={() => void sendCurrent()} data-test-subj="sendRequestButton">
                <Icon name="play" />
              </button>
              <MenuButton
                align="right"
                items={[
                  { id: 'curl', label: 'Copy as cURL', testId: 'consoleMenuCopyAsCurl', onClick: () => copyText(toCurl(first, host), 'Request copied as cURL') },
                  { id: 'docs', label: 'Open documentation', testId: 'consoleMenuOpenDocs', onClick: openDocs },
                  { id: 'indent', label: 'Auto indent', testId: 'consoleMenuAutoIndent', onClick: indentCurrent },
                ]}
                button={(toggle) => (
                  <button type="button" className="dvtActions__more" aria-label="Request options" onClick={toggle} data-test-subj="toggleConsoleMenu">
                    <Icon name="wrench" />
                  </button>
                )}
              />
            </div>
          )}
        </div>
        <div className="dvtResizer" role="separator" aria-orientation="vertical" aria-label="Press left/right to adjust panels size" onMouseDown={startResize} data-test-subj="splitPanelResizer">
          <span aria-hidden>‖</span>
        </div>
        <div className="dvtPane atlGrow">
          <CodeEditor
            readOnly
            value={output}
            tokenize={tokenizeAnswer}
            wrap={settings.wrapMode}
            fontSize={settings.fontSize}
            height="100%"
            ariaLabel="Console output"
            testId="response-editor"
            className="dvtEditor"
          />
        </div>
      </div>

      {menu && menuAt && (
        <Portal>
          <ul className="dvtSuggest" role="listbox" style={{ left: menuAt.left, top: menuAt.top }} data-test-subj="consoleAutocomplete">
            {menu.items.slice(0, 200).map((item, index) => (
              <li
                key={item.label}
                role="option"
                aria-selected={index === menu.active}
                className={cx('dvtSuggest__item', index === menu.active && 'dvtSuggest__item--active')}
                onMouseDown={(event) => {
                  event.preventDefault();
                  accept(index);
                }}
                ref={index === menu.active ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
              >
                <span>{item.label}</span>
                {item.meta && <span className="dvtSuggest__meta">{item.meta}</span>}
              </li>
            ))}
          </ul>
        </Portal>
      )}

      {welcome && (
        <WelcomePanel
          onDismiss={() => {
            stored.set('version_welcome_shown', '@@SENSE_REVISION');
            setWelcome(false);
          }}
        />
      )}
      {panel === 'settings' && (
        <SettingsModal
          settings={settings}
          onRefresh={refreshNames}
          onClose={() => setPanel(undefined)}
          onSave={(next) => {
            saveSettings(next);
            setSettings(next);
            setPanel(undefined);
          }}
        />
      )}
      {panel === 'help' && <HelpPanel onClose={() => setPanel(undefined)} />}
      {panel === 'import' && (
        <ImportFlyout
          current={{ ...object, text }}
          onClose={() => setPanel(undefined)}
          onImported={(next) => {
            saveTextObject(next);
            setObject(next);
            setText(next.text);
          }}
        />
      )}
    </div>
  );
}
