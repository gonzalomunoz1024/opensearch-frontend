/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The console of Dev Tools: requests to OpenSearch written on the left, the answers on the
 * right, as OpenSearch Dashboards lays it out. What is typed, the history and the settings are
 * kept in the browser under the names OpenSearch Dashboards uses (see console_storage).
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, CallOut, cx } from '../../components/basic';
import { Checkbox, FormRow, NumberField, RadioGroup, Switch } from '../../components/form';
import { Icon } from '../../components/icon';
import { ConfirmModal, Flyout, Modal, Popover, Portal, Tooltip, downloadFile } from '../../components/overlay';
import { formatDate } from '../../lib/dates';
import { services } from '../../services';
import { ConsoleEditor, ConsoleSuggestions, type ConsoleEditorHandle } from './console_editor';
import {
  autoIndent,
  blocksBetween,
  bodyOf,
  describePast,
  expandToRequests,
  failedAnswer,
  formatAnswer,
  historyKey,
  insertRequest,
  lineOf,
  looksLikeCurl,
  outputOf,
  parseCurl,
  placeActions,
  readConsole,
  requestAt,
  requestEdge,
  requestOffsets,
  requestsBetween,
  suggest,
  toCurl,
  typedOnLine,
  type ActionsPlace,
  type Answer,
  type ClusterNames,
  type ConsoleRequest,
  type PastRequest,
  type Suggestions,
} from './console_model';
import { autocompleteRequests, consoleStorage, type ConsoleSettings, type TextObject } from './console_storage';

const storage = consoleStorage();

// --- Sending -----------------------------------------------------------------------------------

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

/** Sends one request through the console's proxy, as the original does */
async function send(request: ConsoleRequest, several: boolean, signal: AbortSignal): Promise<Answer> {
  const data = bodyOf(request);
  const base = { method: request.method, path: request.url, data };
  const started = Date.now();
  const titled = (value: string) => (several ? `# ${request.method} ${request.url}\n${value}` : value);
  try {
    const query = new URLSearchParams({ path: request.url, method: request.method });
    const response = await fetch(`${services.http.prepend('/api/console/proxy')}?${query.toString()}`, {
      method: 'POST',
      headers: { 'osd-xsrf': 'true', 'content-type': 'application/json' },
      body: data || undefined,
      credentials: 'same-origin',
      signal,
    });
    const status = response.status;
    const statusText = response.statusText || REASONS[status] || '';
    let text = await response.text();
    let contentType = response.headers.get('content-type') ?? 'text/plain';
    // OpenSearch Dashboards answers a HEAD request with its status as text
    if (request.method.toUpperCase() === 'HEAD') {
      text = `${status} - ${REASONS[status] ?? statusText}`;
      contentType = 'text/plain';
    }
    const ok = status >= 200 && status < 300;
    const timeMs = Date.now() - started;
    if (!ok) {
      const value = failedAnswer(text, contentType, status);
      return { ...base, ok, statusCode: status, statusText, contentType: text ? contentType : 'text/plain', timeMs, value: titled(value) };
    }
    const warnings = response.headers.get('warning');
    return { ...base, ok, statusCode: status, statusText, contentType, timeMs, value: titled(formatAnswer(text, contentType, { warnings })) };
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    const value = `\n\nFailed to connect to Console's backend.\nPlease check the ${services.boot.name} server is up and running`;
    return { ...base, ok: false, contentType: 'text/plain', timeMs: Date.now() - started, value: titled(value) };
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

async function systemGet<T>(path: string): Promise<T> {
  const query = new URLSearchParams({ path, method: 'GET' });
  const response = await fetch(`${services.http.prepend('/api/console/proxy')}?${query.toString()}`, {
    method: 'POST',
    headers: { 'osd-xsrf': 'true', 'osd-system-request': 'true' },
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

function useClusterNames(settings: ConsoleSettings): [ClusterNames, () => void] {
  const [names, setNames] = useState<Names>({ indices: {}, templates: [], fields: {} });
  const wanted = settings.autocomplete;
  const refresh = useCallback(() => {
    type Aliases = Record<string, { aliases?: Record<string, unknown> }>;
    type Mappings = Record<string, { mappings?: { properties?: unknown } }>;
    const asked = new Set(autocompleteRequests(wanted).map((request) => request.name));
    void Promise.all([
      asked.has('indices') ? systemGet<Aliases>('_aliases').catch(() => undefined) : Promise.resolve(undefined),
      asked.has('fields') ? systemGet<Mappings>('_mapping').catch(() => undefined) : Promise.resolve(undefined),
      asked.has('templates') ? systemGet<Record<string, unknown>>('_template').catch(() => undefined) : Promise.resolve(undefined),
    ]).then(([aliases, mappings, templates]) => {
      setNames((now) => ({
        indices: aliases ? Object.fromEntries(Object.entries(aliases).map(([index, value]) => [index, Object.keys(value?.aliases ?? {})])) : asked.has('indices') ? now.indices : {},
        fields: mappings ? Object.fromEntries(Object.entries(mappings).map(([index, value]) => [index, fieldNames(value?.mappings?.properties)])) : asked.has('fields') ? now.fields : {},
        templates: templates ? Object.keys(templates) : asked.has('templates') ? now.templates : [],
      }));
    });
  }, [wanted]);

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

function Example({ panel }: { panel: string }) {
  return (
    <>
      <label className="atlScreenReaderOnly" htmlFor={`help-example-${panel}-input`}>
        Dev Tools Console editor example
      </label>
      <ConsoleEditor
        readOnly
        value={EXAMPLE}
        mode="text"
        fontSize={12}
        wrap
        id={`help-example-${panel}`}
        inputId={`help-example-${panel}-input`}
        className="dvtExample"
      />
    </>
  );
}

interface MenuItem {
  label: string;
  id?: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * The items of a request's menu, as the original's context menu keeps them: the first one that can
 * be chosen has the focus when the menu opens, the arrows go from one to the next and round, the
 * first arrow down staying on the first, and Tab goes round them without leaving the menu
 */
function RequestMenu({ items, onChoose }: { items: MenuItem[]; onChoose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const focused = useRef<number | undefined>(undefined);
  useEffect(() => {
    // After the popover has placed itself, as the original waits for it
    const frame = requestAnimationFrame(() =>
      list.current?.querySelector<HTMLButtonElement>('.dvtMenu__item:not(:disabled)')?.focus()
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('.dvtMenu__item') ?? [])];
    const count = all.length;
    if (!count) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      const now = focused.current;
      const next = now === undefined ? (down ? 0 : count - 1) : (now + (down ? 1 : count - 1)) % count;
      focused.current = next;
      all[next]?.focus();
    } else if (event.key === 'Tab') {
      // Kept as it is before the focus moves, as the original's is
      const at = all.findIndex((button) => button === document.activeElement);
      focused.current = at >= 0 ? at : undefined;
      const enabled = all.filter((button) => !button.disabled);
      const from = enabled.findIndex((button) => button === document.activeElement);
      const step = event.shiftKey ? enabled.length - 1 : 1;
      event.preventDefault();
      enabled[from < 0 ? 0 : (from + step) % enabled.length]?.focus();
    }
  };
  return (
    <div role="menu" ref={list} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          id={item.id}
          className="dvtMenu__item"
          disabled={item.disabled}
          onClick={() => {
            onChoose();
            item.onClick();
          }}
          data-test-subj={item.testId}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A flyout of the console: small, over a mask that closes it and is not seen */
function ConsoleFlyout({ title, onClose, testId, footer, children }: { title: string; onClose: () => void; testId: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Portal>
        <div className="dvtMask" onMouseDown={onClose} aria-hidden />
      </Portal>
      <Flyout title={title} onClose={onClose} testId={testId} footer={footer} className="dvtFlyout">
        {children}
      </Flyout>
    </>
  );
}

const KEYS: Array<[string, string]> = [
  ['Ctrl/Cmd + I', 'Auto indent current request'],
  ['Ctrl/Cmd + /', 'Open documentation for current request'],
  ['Ctrl + Space', 'Open Auto complete (even if not typing)'],
  ['Ctrl/Cmd + Enter', 'Submit request'],
  ['Ctrl/Cmd + Up/Down', 'Jump to the previous/next request start or end.'],
  ['Ctrl/Cmd + Alt + L', 'Collapse/expand current scope.'],
  ['Ctrl/Cmd + Option + 0', 'Collapse all scopes but the current one. Expand by adding a shift.'],
  ['Down arrow', 'Switch focus to auto-complete menu. Use arrows to further select a term'],
  ['Enter/Tab', 'Select the currently selected or the top most term in auto-complete menu'],
  ['Esc', 'Close auto-complete menu'],
];

function HelpFlyout({ onClose }: { onClose: () => void }) {
  return (
    <ConsoleFlyout title="Help" onClose={onClose} testId="helpFlyout">
      <div className="dvtText">
        <h3>Request format</h3>
        <p className="dvtText__flush">You can type one or more requests in the white editor. Console understands requests in a compact format:</p>
        <Example panel="help" />
        <h3>Keyboard commands</h3>
        <div className="dvtSpacer" />
        <dl>
          {KEYS.map(([key, what]) => (
            <Fragment key={key}>
              <dt>{key}</dt>
              <dd>{what}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </ConsoleFlyout>
  );
}

function WelcomeFlyout({ onDismiss }: { onDismiss: () => void }) {
  return (
    <ConsoleFlyout
      title="Welcome to Console"
      onClose={onDismiss}
      testId="welcomePanel"
      footer={
        <Button variant="primary" onClick={onDismiss} testId="help-close-button" className="dvtWide">
          Dismiss
        </Button>
      }
    >
      <div className="dvtText">
        <h4>Quick intro to the UI</h4>
        <p>
          The Console UI is split into two panes: an editor pane (left) and a response pane (right). Use the editor to type requests and
          submit them to OpenSearch. The results will be displayed in the response pane on the right side.
        </p>
        <p>Console understands requests in a compact format, similar to cURL:</p>
        <Example panel="welcome" />
        <p>
          While typing a request, Console will make suggestions which you can then accept by hitting Enter/Tab. These suggestions are made
          based on the request structure as well as your indices and types.
        </p>
        <h4>A few quick tips, while I have your attention</h4>
        <ul>
          <li>Submit requests to OpenSearch using the green triangle button.</li>
          <li>Use the wrench menu for other useful things.</li>
          <li>You can paste requests in cURL format and they will be translated to the Console syntax.</li>
          <li>You can resize the editor and output panes by dragging the separator between them.</li>
          <li>Study the keyboard shortcuts under the Help button. Good stuff in there!</li>
        </ul>
      </div>
    </ConsoleFlyout>
  );
}

// Several controls under one heading: a form row would make one label of them all
function Group({ label, help, className, children }: { label: string; help?: string; className?: string; children: ReactNode }) {
  return (
    <div className="atlFormRow atlFormRow--full" role="group" aria-label={label}>
      <span className="atlFormRow__label">{label}</span>
      <div className={cx('atlStack dvtTight', className)}>{children}</div>
      {help && <span className="atlFormRow__help">{help}</span>}
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
  onRefresh: (autocomplete: ConsoleSettings['autocomplete']) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const autocomplete = (name: 'fields' | 'indices' | 'templates', label: string) => (
    <Checkbox
      checked={draft.autocomplete[name]}
      onChange={(checked) => setDraft({ ...draft, autocomplete: { ...draft.autocomplete, [name]: checked } })}
      label={label}
    />
  );
  const anyAutocomplete = draft.autocomplete.fields || draft.autocomplete.indices || draft.autocomplete.templates;
  return (
    <Modal
      title="Console Settings"
      onClose={onClose}
      testId="devToolsSettingsModal"
      className="dvtSettings"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="settingsCancelButton">
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
          <NumberField
            min={6}
            max={50}
            value={draft.fontSize}
            onChange={(fontSize) => {
              // The original keeps the size it had when the field holds no number
              if (fontSize) setDraft({ ...draft, fontSize: Math.trunc(fontSize) });
            }}
            testId="setting-font-size-input"
          />
        </FormRow>
        <Switch checked={draft.wrapMode} onChange={(wrapMode) => setDraft({ ...draft, wrapMode })} label="Wrap long lines" testId="settingsWrapLines" />
        <Group label="JSON syntax">
          <Switch checked={draft.tripleQuotes} onChange={(tripleQuotes) => setDraft({ ...draft, tripleQuotes })} label="Use triple quotes in output pane" testId="tripleQuotes" />
        </Group>
        <Group label="Autocomplete" className="dvtChecks">
          {autocomplete('fields', 'Fields')}
          {autocomplete('indices', 'Indices & Aliases')}
          {autocomplete('templates', 'Templates')}
        </Group>
        {anyAutocomplete && (
          <>
            <Group
              label="Refreshing autocomplete suggestions"
              help="Console refreshes autocomplete suggestions by querying OpenSearch. Automatic refreshes may be an issue if you have a large cluster or if you have network limitations."
            >
              <Switch checked={draft.polling} onChange={(polling) => setDraft({ ...draft, polling })} label="Automatically refresh autocomplete suggestions" testId="autocompletePolling" />
            </Group>
            <div>
              <Button className="dvtWide" onClick={() => onRefresh(draft.autocomplete)} testId="autocompletePolling">
                Refresh autocomplete suggestions
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ImportFlyout({ onImported, onClose }: { onImported: (object: TextObject) => void; onClose: () => void }) {
  const [file, setFile] = useState<File>();
  const [parsed, setParsed] = useState<{ text?: unknown }>();
  const [mode, setMode] = useState<'merge' | 'overwrite'>('merge');
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState<string>();

  const pick = async (picked: File | undefined) => {
    setError(undefined);
    setParsed(undefined);
    setFile(picked);
    if (!picked) return;
    try {
      setParsed(JSON.parse(await picked.text()) as { text?: unknown });
    } catch (parseError) {
      setError(`The file could not be processed due to error: "${(parseError as Error).message}"`);
    }
  };

  const run = (overwriteConfirmed: boolean) => {
    setError(undefined);
    const current = storage.loadText();
    if (typeof parsed?.text !== 'string' || !parsed.text) {
      setError('The selected file is not valid. Please select a valid JSON file.');
      return;
    }
    if (mode === 'overwrite') {
      if (!overwriteConfirmed) {
        setConfirming(true);
        return;
      }
      setLoading('Importing queries and overwriting existing ones...');
      onImported({ ...current, createdAt: Date.now(), updatedAt: Date.now(), text: parsed.text });
      services.toasts.success('Queries overwritten.');
    } else {
      setLoading('Importing queries and merging with existing ones...');
      const stamp = formatDate(new Date(), services.uiSettings.get('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS'), services.timeZone());
      onImported({ ...current, createdAt: Date.now(), updatedAt: Date.now(), text: `${current.text}\n\n#Imported on ${stamp}\n\n${parsed.text}` });
      services.toasts.success('Queries merged.');
    }
    setLoading(undefined);
    onClose();
  };

  return (
    <ConsoleFlyout
      title="Import queries"
      onClose={onClose}
      testId="importQueriesFlyout"
      footer={
        <>
          <Button variant="empty" disabled={Boolean(loading)} onClick={onClose} testId="importQueriesCancelBtn">
            Cancel
          </Button>
          <Button variant="primary" className="dvtWide" disabled={!file} loading={Boolean(loading)} onClick={() => run(false)} testId="importQueriesConfirmBtn">
            Import
          </Button>
        </>
      }
    >
      <div className="atlStack">
        {error && (
          <CallOut tone="critical" title="Sorry, there was an error">
            <p data-test-subj="importSenseObjectsErrorText">{error}</p>
          </CallOut>
        )}
        {loading ? (
          <p className="dvtText">{loading}</p>
        ) : (
          <>
            <FormRow label="Select a file to import" full>
              <input type="file" name="queryFileImport" accept=".ndjson, .json" onChange={(event) => void pick(event.target.files?.[0])} data-test-subj="queryFilePicker" />
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
          </>
        )}
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
            run(true);
          }}
        >
          Are you sure you want to overwrite the existing queries? This action cannot be undone. All existing queries will be deleted and
          replaced with the imported queries. If you are unsure, please choose the &quot;Merge with existing queries&quot; option instead
        </ConfirmModal>
      )}
    </ConsoleFlyout>
  );
}

function HistoryPanel({ settings, onApply, onClose }: { settings: ConsoleSettings; onApply: (request: PastRequest) => void; onClose: () => void }) {
  const [requests, setRequests] = useState(() => storage.history());
  const [selected, setSelected] = useState(0);
  // The request shown is the one the pointer is on, else the one chosen; it is the one marked
  const [viewing, setViewing] = useState<PastRequest | undefined>(() => requests[0]);
  const list = useRef<HTMLUListElement>(null);
  const now = Date.now();
  const chosen = requests[selected];
  const text = viewing ? `${viewing.method} ${viewing.endpoint}\n${viewing.data || ''}` : 'No history available';

  const choose = (index: number) => {
    const next = Math.min(Math.max(0, index), requests.length - 1);
    setSelected(next);
    setViewing(requests[next]);
    list.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <section className="dvtHistory" data-test-subj="consoleHistoryPanel">
      <h2>History</h2>
      <div className="dvtHistory__body">
        <ul
          ref={list}
          role="listbox"
          tabIndex={0}
          className="dvtHistory__list"
          aria-label="History of sent requests"
          aria-activedescendant={`historyReq${selected}`}
          onKeyDown={(event) => historyKey(event, selected, { choose, apply: () => chosen && onApply(chosen) })}
        >
          {requests.map((request, index) => {
            const description = describePast(request, now);
            return (
              <li
                key={`${request.time}-${index}`}
                id={`historyReq${index}`}
                role="option"
                aria-selected={viewing === request}
                aria-label={`Request: ${description}`}
                className={cx('dvtHistory__item', viewing === request && 'dvtHistory__item--selected')}
                onClick={() => choose(index)}
                onMouseEnter={() => setViewing(request)}
                onMouseLeave={() => setViewing(requests[selected])}
                onDoubleClick={() => chosen && onApply(chosen)}
              >
                {description}
                <Icon name="chevronRight" />
              </li>
            );
          })}
        </ul>
        <div className="dvtHistory__spacer" />
        <ConsoleEditor readOnly value={text} mode={viewing ? 'input' : 'text'} fontSize={settings.fontSize} wrap={settings.wrapMode} className="dvtHistory__viewer" label="History viewer" />
      </div>
      <div className="dvtHistory__footer">
        <Button
          variant="empty"
          className="dvtHistory__clear"
          onClick={() => {
            storage.clearHistory();
            const left = storage.history();
            setRequests(left);
            setSelected(0);
            setViewing(left[0]);
          }}
          testId="consoleClearHistoryButton"
        >
          Clear
        </Button>
        <span className="atlRow dvtNone">
          <Button variant="empty" onClick={onClose} testId="consoleHistoryCloseButton">
            Close
          </Button>
          <Button className="dvtWide" disabled={!chosen} onClick={() => chosen && onApply(chosen)} testId="consoleHistoryApplyButton">
            Apply
          </Button>
        </span>
      </div>
    </section>
  );
}

const badgeTone = (code: number) => (code <= 199 ? undefined : code <= 299 ? 'healthy' : code <= 399 ? 'accent' : code <= 499 ? 'warning' : 'critical');

function StatusBadges({ running, answer }: { running: boolean; answer?: Answer }) {
  if (running) return <span className="dvtBadge dvtBadge--hollow">Request in progress</span>;
  if (!answer || answer.statusCode === undefined) return null;
  const code = answer.statusCode;
  const tone = badgeTone(code);
  return (
    <>
      <Tooltip content={`${answer.method} ${answer.path.startsWith('/') ? answer.path : `/${answer.path}`}`}>
        <span className={cx('dvtBadge', tone && `dvtBadge--${tone}`)} data-test-subj="consoleResponseStatusBadge">
          {code}&nbsp;-&nbsp;{answer.statusText}
        </span>
      </Tooltip>
      <Tooltip content="Time Elapsed">
        <span className="dvtBadge">{answer.timeMs}&nbsp;ms</span>
      </Tooltip>
    </>
  );
}

// --- The console -------------------------------------------------------------------------------

type Panel = 'history' | 'settings' | 'help' | 'import';

export function Console() {
  const [object, setObject] = useState(() => storage.loadText());
  const [text, setText] = useState(object.text);
  const [settings, setSettings] = useState(() => storage.loadSettings());
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [running, setRunning] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const [welcome, setWelcome] = useState(() => !storage.welcomeShown());
  const [scrollTop, setScrollTop] = useState(0);
  // Counts the editor's new layouts, after which the buttons are placed again
  const [layouts, setLayouts] = useState(0);
  // Shown from the start, at the top of the editor, as the original's are
  const [actionsAt, setActionsAt] = useState<ActionsPlace>({ top: 0 });
  const [widths, setWidths] = useState(() => storage.widths());
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<(Suggestions & { active: number }) | undefined>();
  const [menuAt, setMenuAt] = useState<{ left: number; top: number }>();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [host, setHost] = useState('http://localhost:9200');
  const editor = useRef<ConsoleEditorHandle>(null);
  const panes = useRef<HTMLDivElement>(null);
  const sending = useRef<AbortController | undefined>(undefined);
  const [names, refreshNames] = useClusterNames(settings);

  // What is typed is kept half a second after it is typed, and once more when the page is left
  const latest = useRef({ object, text });
  latest.current = { object, text };
  useEffect(() => {
    const timer = window.setTimeout(() => storage.saveText({ ...latest.current.object, text, updatedAt: Date.now() }), 500);
    return () => window.clearTimeout(timer);
  }, [text]);
  useEffect(
    () => () => {
      storage.saveText({ ...latest.current.object, text: latest.current.text, updatedAt: Date.now() });
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

  const doc = useMemo(() => readConsole(text), [text]);
  const fromLine = lineOf(text, selection[0]);
  const toLine = lineOf(text, selection[1]);
  const marked = useMemo(() => expandToRequests(doc, fromLine, toLine), [doc, fromLine, toLine]);
  const snippet = useMemo<[number, number] | undefined>(() => (marked ? [marked[0], marked[1]] : undefined), [marked?.[0], marked?.[1]]);

  // The buttons follow the request under the cursor, and stay where they were while there is none
  useLayoutEffect(() => {
    const view = editor.current;
    if (!snippet || !view) return;
    const place = placeActions(doc.lines, snippet, {
      lineTop: view.lineTop,
      lineBottom: view.lineBottom,
      endTop: (line) => view.placeTop(doc.lines.slice(0, line + 1).reduce((sum, each) => sum + each.length + 1, -1)),
      height: view.height(),
      wrapLimit: view.wrapLimit(),
    });
    if (place) setActionsAt(place);
  }, [snippet, doc, layouts, panel, scrollTop]);

  useLayoutEffect(() => {
    if (!menu) {
      setMenuAt(undefined);
      return;
    }
    // Under the start of what is typed, after the quote that opens a name
    const place = editor.current?.coordinates(menu.from + (text[menu.from] === '"' ? 1 : 0));
    setMenuAt(place ? { left: place.left, top: place.bottom + 1 } : undefined);
  }, [menu, text, scrollTop]);

  const change = (from: number, to: number, inserted: string, cursor = from + inserted.length) => {
    editor.current?.replace(from, to, inserted, cursor, cursor);
  };

  const sendCurrent = async () => {
    if (running) return;
    const requests = requestsBetween(doc, fromLine, toLine);
    if (requests.length === 0) {
      services.toasts.plain('No request selected. Select a request by placing the cursor inside it.');
      return;
    }
    const controller = new AbortController();
    sending.current = controller;
    setRunning(true);
    setMenu(undefined);
    const results: Answer[] = [];
    try {
      for (const request of requests) {
        const result = await send(request, requests.length > 1, controller.signal);
        if (!result.ok) {
          // A request that failed is all that is shown, as the ones after it were not sent
          setAnswers([result]);
          return;
        }
        results.push(result);
      }
      for (const result of results) storage.addToHistory(result.path, result.method, result.data);
      // Something sent may have made an index or a field: the suggestions are asked for again
      if (settings.polling) refreshNames();
      setAnswers(results);
    } catch {
      // the page was left while a request was out
    } finally {
      if (sending.current === controller) {
        sending.current = undefined;
        setRunning(false);
      }
    }
  };

  // The request the cursor is on, laid out again (only that one, as the original does)
  const indentCurrent = () => {
    const request = requestAt(doc, lineOf(text, selection[1]));
    if (!request || request.data.length === 0) return;
    const [start, end] = requestOffsets(text, request);
    const trimmedEnd = start + text.slice(start, end).replace(/\s+$/, '').length;
    change(start, trimmedEnd, autoIndent(request), start);
    editor.current?.focus();
  };

  const openDocs = () => {
    const request = requestAt(doc, lineOf(text, selection[1]));
    if (request) window.open(docsFor(request.url), '_blank');
  };

  const copyAsCurl = () => {
    const curl = toCurl(blocksBetween(doc, fromLine, toLine, true), host);
    const done = () => services.toasts.plain('Request copied as cURL');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(curl).then(done, () => undefined);
  };

  const jump = (direction: -1 | 1) => {
    const row = requestEdge(doc, lineOf(text, editor.current?.selection()[1] ?? selection[1]), direction);
    const offset = doc.lines.slice(0, row).reduce((sum, line) => sum + line.length + 1, 0);
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
    setMenu(undefined);
    change(menu.from, menu.to, insert, menu.from + insert.length - (item.back ?? 0));
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
    change(selectionStart, selectionEnd, parseCurl(pasted));
  };

  const applyPast = (past: PastRequest) => {
    const inserted = insertRequest(text, lineOf(text, selection[1]), past);
    change(inserted.from, inserted.from, inserted.inserted, inserted.offset);
    editor.current?.focus();
  };

  const resize = (next: [number, number]) => {
    setWidths(next);
    storage.setWidths(next);
  };

  const startResize = (down: React.MouseEvent) => {
    down.preventDefault();
    const box = panes.current;
    if (!box) return;
    const [left, right] = [box.children[0], box.children[2]].map((child) => (child as HTMLElement).getBoundingClientRect().width);
    const total = left + right;
    let leftWidth = left;
    let position = down.clientX;
    setDragging(true);
    const move = (event: MouseEvent) => {
      const delta = event.clientX - position;
      position = event.clientX;
      leftWidth += delta;
      resize([(leftWidth / total) * 100, ((total - leftWidth) / total) * 100]);
    };
    const up = () => {
      setDragging(false);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const exportText = () => {
    const saved: TextObject = { ...object, text, updatedAt: Date.now() };
    storage.saveText(saved);
    downloadFile('sense.json', JSON.stringify(storage.loadText()), 'application/json');
  };

  const navItems: Array<{ id: string; label: string; testId: string; onClick: () => void }> = [
    { id: 'history', label: 'History', testId: 'consoleHistoryButton', onClick: () => setPanel(panel === 'history' ? undefined : 'history') },
    { id: 'settings', label: 'Settings', testId: 'consoleSettingsButton', onClick: () => setPanel('settings') },
    { id: 'help', label: 'Help', testId: 'consoleHelpButton', onClick: () => setPanel(panel === 'help' ? undefined : 'help') },
    { id: 'export', label: 'Export', testId: 'consoleExportButton', onClick: exportText },
    { id: 'import', label: 'Import', testId: 'consoleImportButton', onClick: () => setPanel(panel === 'import' ? undefined : 'import') },
  ];

  const output = useMemo(() => outputOf(answers, settings.tripleQuotes), [answers, settings.tripleQuotes]);
  const lastAnswer = answers[answers.length - 1];
  const typed = menu ? text.slice(menu.from, selection[1]).replace(/^"/, '') : '';

  return (
    <div className="dvtConsole" id="consoleRoot">
      <h1 className="atlScreenReaderOnly">Console</h1>
      <div className="dvtNav">
        <div className="dvtTabs" role="tablist">
          {navItems.map((item) => (
            <button key={item.id} type="button" role="tab" className="dvtTab" title={item.label} onClick={item.onClick} data-test-subj={item.testId}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="dvtNav__status">
          <StatusBadges running={running} answer={lastAnswer} />
        </div>
      </div>
      {panel === 'history' && <HistoryPanel settings={settings} onClose={() => setPanel(undefined)} onApply={applyPast} />}
      {running && <div className="dvtProgress" />}
      <div className="dvtPanes" ref={panes}>
        <div className="dvtPane" style={{ width: `${widths[0]}%` }}>
          <div
            className="dvtActions"
            id="ConAppEditorActions"
            style={'bottom' in actionsAt ? { top: 'auto', bottom: actionsAt.bottom } : { top: actionsAt.top }}
          >
            <Tooltip content="Click to send request">
              <button type="button" className="dvtActions__send" aria-label="Send request" onClick={() => void sendCurrent()} data-test-subj="sendRequestButton">
                <Icon name="play" />
              </button>
            </Tooltip>
            <Popover
              open={actionsOpen}
              onClose={() => setActionsOpen(false)}
              className="dvtMenu"
              button={
                <button type="button" className="dvtActions__more" aria-label="Request options" onClick={() => setActionsOpen(!actionsOpen)} data-test-subj="toggleConsoleMenu">
                  <Icon name="wrench" />
                </button>
              }
            >
              <p className="atlScreenReaderOnly">You are in a dialog. To close this dialog, hit escape.</p>
              <RequestMenu
                items={[
                  { label: 'Copy as cURL', id: 'ConCopyAsCurl', testId: 'copyAsCurl', onClick: copyAsCurl, disabled: !navigator.clipboard },
                  { label: 'Open documentation', testId: 'consoleMenuOpenDocs', onClick: openDocs },
                  { label: 'Auto indent', testId: 'consoleMenuAutoIndent', onClick: indentCurrent },
                ]}
                onChoose={() => setActionsOpen(false)}
              />
            </Popover>
          </div>
          <label className="atlScreenReaderOnly" htmlFor="ConAppInputTextarea">
            Dev Tools Console
          </label>
          <ConsoleEditor
            handle={editor}
            value={text}
            mode="input"
            highlighted={doc.highlighted}
            onChange={(next) => {
              const [start, end] = editor.current?.selection() ?? [0, 0];
              // Suggestions follow what is typed, and go when text is taken away or a line is begun
              if (start === end && next.length > text.length && typedOnLine(next, start)) openMenu(next, start);
              else setMenu(undefined);
              setText(next);
            }}
            onCursor={(start, end) => {
              setSelection([start, end]);
              if (menu && (start !== end || start < menu.from)) setMenu(undefined);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onScroll={setScrollTop}
            onLayout={() => setLayouts((count) => count + 1)}
            snippet={snippet}
            wrap={settings.wrapMode}
            fontSize={settings.fontSize}
            keyboardHint
            autoFocus
            id="ConAppEditor"
            inputId="ConAppInputTextarea"
            testId="request-editor"
          />
        </div>
        <button
          type="button"
          className={cx('dvtResizer', dragging && 'dvtResizer--active')}
          aria-label="Press left/right to adjust panels size"
          onMouseDown={startResize}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const step = event.key === 'ArrowLeft' ? -1 : 1;
            resize([widths[0] + step, widths[1] - step]);
          }}
          data-test-subj="splitPanelResizer"
        >
          <Icon name="grabHorizontal" />
        </button>
        <div className="dvtPane" style={{ width: `${widths[1]}%` }}>
          <label className="atlScreenReaderOnly" htmlFor="ConAppOutputTextarea">
            Dev Tools Console output
          </label>
          <ConsoleEditor
            readOnly
            value={output.value}
            mode={output.mode}
            wrap={settings.wrapMode}
            fontSize={settings.fontSize}
            inputId="ConAppOutputTextarea"
            testId="response-editor"
          />
        </div>
      </div>

      {menu && menuAt && (
        <ConsoleSuggestions
          items={menu.items}
          active={menu.active}
          typed={typed}
          at={menuAt}
          fontSize={12}
          onPick={accept}
          onHover={(active) => setMenu({ ...menu, active })}
        />
      )}

      {welcome && (
        <WelcomeFlyout
          onDismiss={() => {
            storage.setWelcomeShown();
            setWelcome(false);
          }}
        />
      )}
      {panel === 'settings' && (
        <SettingsModal
          settings={settings}
          onRefresh={() => refreshNames()}
          onClose={() => setPanel(undefined)}
          onSave={(next) => {
            storage.saveSettings(next);
            setSettings(storage.loadSettings());
            setPanel(undefined);
          }}
        />
      )}
      {panel === 'help' && <HelpFlyout onClose={() => setPanel(undefined)} />}
      {panel === 'import' && (
        <ImportFlyout
          onClose={() => setPanel(undefined)}
          onImported={(next) => {
            storage.saveText(next);
            setObject(next);
            setText(next.text);
          }}
        />
      )}
    </div>
  );
}
