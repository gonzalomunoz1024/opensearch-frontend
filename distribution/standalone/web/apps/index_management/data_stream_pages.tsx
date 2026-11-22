/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The page of one data stream: it makes one out of a data stream template when the address
 * names none, and shows the one the address names with its backing indexes.
 */

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, CallOut, Health, Panel, cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Popover } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import {
  ExternalLink,
  IndexHealth,
  JSONModal,
  Labeled,
  LocalTable,
  capital,
  go,
  ism,
  to,
  toasts,
  type TableColumn,
} from './common';
import { DATA_STREAM_DOCS, DataStreamsActions, HEALTH_TIPS, HEALTH_TONES, type DataStream } from './data_streams';
import { MappingEditor, SettingsFields } from './index_form';
import {
  dataStreamNameErrors,
  inheritedBody,
  matchingTemplate,
  nameForTemplate,
  suggestedTemplates,
  type StreamTemplate,
} from './index_model';
import type { IndexRow } from './indices';
import { CRUMBS, INDEX_MANAGEMENT_PATH, ROUTES } from './routes';
import { Facts, MappingsHelp } from './template_pages';

const nothing = () => undefined;

// --- Creating one -----------------------------------------------------------------------------------------

/** The field for the name, which lists the templates the name may still come to match */
function NameField({
  name,
  templates,
  invalid,
  onName,
  onChoose,
  onLeave,
}: {
  name: string;
  templates: StreamTemplate[];
  invalid: boolean;
  onName: (name: string) => void;
  onChoose: (template: StreamTemplate) => void;
  /** Called when the field is left, which is when its template is looked for */
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const options = suggestedTemplates(name, templates);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      matchWidth
      anchorStyle={{ display: 'flex', width: '100%' }}
      button={
        <div
          className={cx('atlField', 'atlCombo', 'atlCombo--s', invalid && 'atlField--invalid')}
          onMouseDown={(event) => {
            if (event.target !== input.current) {
              event.preventDefault();
              input.current?.focus();
            }
            setOpen(true);
          }}
        >
          <input
            ref={input}
            value={name}
            placeholder="Enter data stream name"
            onChange={(event) => {
              onName(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              onLeave();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && open) {
                event.stopPropagation();
                setOpen(false);
              }
            }}
            role="combobox"
            aria-expanded={open}
            autoComplete="off"
            spellCheck={false}
            data-test-subj="comboBoxSearchInput"
          />
          {name !== '' && !open && (
            <button
              type="button"
              className="atlCombo__clear"
              aria-label="Clear input"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onName('')}
            >
              <Icon name="cross" />
            </button>
          )}
          <Icon name="chevronDown" className="atlCombo__caret" />
        </div>
      }
    >
      <div className="atlMenu atlCombo__list" role="listbox">
        {options.map((template) => (
          <button
            key={template.name}
            type="button"
            role="option"
            aria-selected={false}
            className="atlMenu__item"
            // The field keeps the cursor, so that the name can be finished
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(template)}
          >
            <span className="atlGrow atlTruncate">{(template.index_template.index_patterns ?? []).join(',')}</span>
            <Badge>{template.name}</Badge>
          </button>
        ))}
        {options.length === 0 && (
          <div className="atlCombo__empty">
            {name ? (
              <>
                <strong>{name}</strong> does not match index patterns from any templates. Enter another name or create
                a data stream template.
              </>
            ) : (
              "There aren't any options available"
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

export function CreateDataStream() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.DATA_STREAMS, CRUMBS.CREATE_DATA_STREAM]);
  const [templates, setTemplates] = useState<StreamTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [matched, setMatched] = useState<StreamTemplate>();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    void ism.request<{ index_templates?: StreamTemplate[] }>('GET', '/_index_template/*').then((answer) => {
      if (gone) return;
      const all = answer.ok ? (answer.response?.index_templates ?? []) : [];
      setTemplates(all.filter((template) => template.index_template.data_stream));
      setLoading(false);
    });
    return () => {
      gone = true;
    };
  }, []);

  // The template of a name is looked for when the field is left, and that is when the name is judged
  const settle = (value: string) => {
    const found = matchingTemplate(value, templates);
    setMatched(found);
    setErrors(dataStreamNameErrors(value, Boolean(found)));
    return found;
  };

  const create = async () => {
    const wrong = dataStreamNameErrors(name, Boolean(matched));
    setErrors(wrong);
    if (wrong.length > 0) return;
    setBusy(true);
    const result = await ism.request('PUT', `_data_stream/${name}`);
    setBusy(false);
    if (result.ok) {
      toasts.success(`${name} has been successfully created.`);
      go(ROUTES.DATA_STREAMS);
    } else {
      toasts.danger(result.error);
    }
  };

  const body = matched ? inheritedBody(matched) : undefined;
  return (
    <div className="ismPage ismPage--form">
      <div className="ismPageHeader ismPageHeader--center">
        <div>
          <h1 className="ismPageTitle">Create data stream</h1>
          <div className="ismLabeled__help">
            A data stream is composed of multiple backing indexes. Search requests are routed to all the backing
            indexes, while indexing requests are routed to the latest write index.{' '}
            <ExternalLink href={DATA_STREAM_DOCS} />
          </div>
        </div>
      </div>
      {!loading && templates.length === 0 && (
        <CallOut tone="warning" title="No data stream templates created">
          <p>
            To create a data stream, you must first define its mappings and settings by creating a data stream
            template.
          </p>
          <Button size="s" onClick={() => go(ROUTES.CREATE_TEMPLATE, { values: JSON.stringify({ data_stream: {} }) })}>
            Create template
          </Button>
        </CallOut>
      )}
      <Panel>
        <h2 className="ismPanel__heading">Define data stream</h2>
        <hr className="ismRule" />
        <div className="ismForm ismForm--wideHelp">
          <Labeled
            title="Data stream name"
            testId="form-row-name"
            help={
              <>
                Enter a data stream name. It must match an index pattern from a data stream template.{' '}
                <ExternalLink href={to(ROUTES.TEMPLATES)}>Manage templates.</ExternalLink>
              </>
            }
            error={errors.length > 0 ? errors.map((error) => <div key={error}>{error}</div>) : undefined}
          >
            <NameField
              name={name}
              templates={templates}
              invalid={errors.length > 0}
              onName={(next) => {
                setName(next);
                if (next === '') setMatched(undefined);
              }}
              onChoose={(template) => {
                const next = nameForTemplate(name, template);
                setName(next);
                settle(next);
              }}
              onLeave={() => settle(name)}
            />
          </Labeled>
          <Labeled title="Matching template">
            {matched ? (
              <a href={`#${ROUTES.CREATE_TEMPLATE}/${matched.name}`}>{matched.name}</a>
            ) : (
              <p className="ismMappings__none">No index template matched</p>
            )}
          </Labeled>
        </div>
      </Panel>
      {body && (
        <Panel>
          <h2 className="ismPanel__heading ismPanel__heading--l">Inherited settings from template</h2>
          <hr className="ismRule" />
          <div className="ismDefinition">
            <div>
              <h3 className="ismDefinition__title">Index alias</h3>
              <div className="ismLabeled__help">
                Allow the new indexes to be referenced by existing aliases or specify a new alias.
              </div>
            </div>
            <Facts items={[['Alias names', Object.keys(body.aliases ?? {}).join(',')]]} />
            <h3 className="ismDefinition__title">Index settings</h3>
            <SettingsFields value={body.settings} onChange={nothing} readOnly forTemplate across={false} />
            <div>
              <h3 className="ismDefinition__title">Index mapping</h3>
              <MappingsHelp />
            </div>
            <MappingEditor value={body.mappings} onChange={nothing} readOnly />
          </div>
        </Panel>
      )}
      <div className="ismButtons">
        <Button variant="empty" size="s" onClick={() => go(ROUTES.DATA_STREAMS)} testId="CreateDataStreamCancelButton">
          Cancel
        </Button>
        <Button variant="primary" size="s" loading={busy} onClick={create} testId="CreateDataStreamCreateButton">
          Create data stream
        </Button>
      </div>
    </div>
  );
}

// --- The one there is ---------------------------------------------------------------------------------------

const orDash = (value: unknown) => (value ? String(value) : '-');

export function DataStreamDetail({ name }: { name: string }) {
  useBreadcrumbs([
    CRUMBS.INDEX_MANAGEMENT,
    CRUMBS.DATA_STREAMS,
    { text: name, to: `${INDEX_MANAGEMENT_PATH}#${ROUTES.CREATE_DATA_STREAM}/${name}` },
  ]);
  const [stream, setStream] = useState<DataStream>();
  const [indexes, setIndexes] = useState<IndexRow[]>([]);
  const [json, setJson] = useState(false);

  useEffect(() => {
    let gone = false;
    setStream(undefined);
    void ism.request<{ data_streams?: DataStream[] }>('GET', `_data_stream/${name}`).then((answer) => {
      if (gone) return;
      const found = answer.ok ? answer.response?.data_streams?.find((item) => item.name === name) : undefined;
      if (found) {
        setStream(found);
      } else {
        toasts.danger(answer.ok ? `The data stream ${name} does not exist.` : answer.error || '');
        go(ROUTES.DATA_STREAMS);
      }
    });
    void ism
      .get<{ indices: IndexRow[] }>('_indices', {
        from: 0,
        size: 999,
        search: name,
        terms: name,
        sortField: 'index',
        sortDirection: 'desc',
        showDataStreams: true,
      })
      .then((answer) => {
        if (gone || !answer.ok) return;
        setIndexes((answer.response?.indices ?? []).filter((item) => item.data_stream === name));
      });
    return () => {
      gone = true;
    };
  }, [name]);

  if (!stream) return null;
  const backing = stream.indices ?? [];
  const writing = backing[backing.length - 1]?.index_name;
  const health = (stream.status || '').toLowerCase();

  const columns: Array<TableColumn<IndexRow>> = [
    {
      field: 'index',
      name: 'Index',
      width: '250px',
      render: (row) => <a href={`#${ROUTES.INDEX_DETAIL}/${row.index}`}>{row.index}</a>,
    },
    { field: 'health', name: 'Health', render: (row) => <IndexHealth health={row.health} status={row.status} /> },
    { field: 'managed', name: 'Managed by policy', render: (row) => orDash(row.managed) },
    {
      field: 'status',
      name: 'Status',
      render: (row) => <span className="ismCapital">{row.extraStatus || row.status}</span>,
    },
    { field: 'writing', name: 'Writing index', render: (row) => (row.index === writing ? 'Yes' : 'No') },
    { field: 'store.size', name: 'Total size', align: 'right', render: (row) => orDash(row['store.size']) },
    {
      field: 'pri.store.size',
      name: 'Size of primaries',
      align: 'right',
      render: (row) => orDash(row['pri.store.size']),
    },
    {
      field: 'docs.count',
      name: 'Total documents',
      align: 'right',
      render: (row) => <span title={row['docs.count']}>{row['docs.count'] || '-'}</span>,
    },
    {
      field: 'docs.deleted',
      name: 'Deleted documents',
      align: 'right',
      render: (row) => <span title={row['docs.deleted']}>{row['docs.deleted'] || '-'}</span>,
    },
    { field: 'pri', name: 'Primaries', align: 'right', render: (row) => row.pri },
    { field: 'rep', name: 'Replicas', align: 'right', render: (row) => row.rep },
  ];

  return (
    <div className="ismPage ismPage--form">
      <div className="ismPageHeader ismPageHeader--center">
        <h1 className="ismPageTitle" title={name}>
          {name}
        </h1>
        <div className="atlRow" style={{ gap: 'var(--space-5)' }}>
          <Button size="s" onClick={() => setJson(true)}>
            View JSON
          </Button>
          <DataStreamsActions selected={[stream]} onDelete={() => go(ROUTES.DATA_STREAMS)} />
        </div>
      </div>
      <Panel>
        <h2 className="ismPanel__heading">Data stream details</h2>
        <hr className="ismRule" />
        <Facts
          items={[
            ['Name', stream.name],
            [
              'Status',
              <span key="status" title={HEALTH_TIPS[health]}>
                <Health tone={HEALTH_TONES[health]}>{capital(health)}</Health>
              </span>,
            ],
            [
              'Template name',
              <a key="template" href={`#${ROUTES.CREATE_TEMPLATE}/${stream.template}`}>
                {stream.template}
              </a>,
            ],
            ['Backing indexes', backing.length],
            ['Timefield', stream.timestamp_field?.name],
          ]}
        />
      </Panel>
      <Panel>
        <h2 className="ismPanel__heading">Backing indexes</h2>
        <div className="ismLabeled__help">
          A data stream is composed of backing indexes. Search requests are routed to all backing indexes, while
          indexing requests are routed to the write backing index.
        </div>
        <hr className="ismRule" />
        <LocalTable columns={columns} rows={indexes} rowId={(row) => row.index} paged={false} />
      </Panel>
      {json && (
        <JSONModal
          title={name}
          json={stream as unknown as Record<string, unknown>}
          onClose={() => setJson(false)}
          indent={2}
          testId="dataStreamJSONDetailModal"
        />
      )}
    </div>
  );
}
