/* SPDX-License-Identifier: Apache-2.0 */

/*
 * One document, opened, as the original's document viewer: every field as a table, or the
 * document as OpenSearch returned it.
 */

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { FieldToken, cx } from '../../components/basic';
import { Icon, type IconName } from '../../components/icon';
import { Tooltip, copyText } from '../../components/overlay';
import type { RawHit } from '../../lib/docs';
import { fieldFormatter } from '../../lib/field_formats';
import { tokenizeJson } from '../../lib/json_text';
import { appUrl, decodeState } from '../../lib/url';
import type { Filter, IndexPattern } from '../../lib/types';
import { href } from '../../router';
import { services } from '../../services';
import { currentGlobalParam } from '../../shell/state';
import { CellValue, cellHeightStyle, isFilterable, sourceEntries } from './doc_table';

export interface DocActions {
  columns: string[];
  onToggleColumn?: (fieldName: string) => void;
  onFilter?: (fieldName: string, value: unknown, negate: boolean) => void;
  onFilterExists?: (fieldName: string) => void;
}

const META_FIELDS = ['_source', '_id', '_type', '_index', '_score'];

/** A value longer than this many characters is shown cut, with a button that opens it */
const COLLAPSE_LINE_LENGTH = 350;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The kind of field the original's table names: the pattern's, or nested for a name the pattern
 * does not hold but at the root of a nested path, or none
 */
export function docFieldType(indexPattern: IndexPattern, name: string): string {
  const field = indexPattern.fields.find((candidate) => candidate.name === name);
  if (field) return field.type;
  const root = new RegExp(`${escapeRegExp(name)}(\\.|$)`);
  return indexPattern.fields.some((candidate) => root.test(candidate.subType?.nested?.path ?? '')) ? 'nested' : 'undefined';
}

/** The fields of a document in the order the original's table lists them: by the code of their characters */
export function docFields(hit: RawHit, indexPattern: IndexPattern, metaFields: string[]): Array<[string, unknown]> {
  return sourceEntries(hit, indexPattern, metaFields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function RowButton({
  icon,
  label,
  tooltip,
  testId,
  disabled,
  pressed,
  onClick,
}: {
  icon: IconName;
  label: string;
  tooltip: string;
  testId: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        className="dscDocViewer__actionButton"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        data-test-subj={testId}
      >
        <Icon name={icon} />
      </button>
    </Tooltip>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <span className="dscDocViewer__warning" role="img" aria-label="Warning">
        <Icon name="warning" />
      </span>
    </Tooltip>
  );
}

export function DocTableView({
  hit,
  indexPattern,
  actions,
}: {
  hit: RawHit;
  indexPattern: IndexPattern;
  actions?: DocActions;
}) {
  const metaFields = services.uiSettings.get<string[]>('metaFields', META_FIELDS);
  const cellHeight = services.uiSettings.get<number>('truncate:maxHeight', 115);
  const entries = useMemo(() => docFields(hit, indexPattern, metaFields), [hit, indexPattern, metaFields]);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  return (
    <table className="dscDocViewer__table" style={cellHeightStyle(cellHeight)} data-test-subj="osdDocViewerTable">
      <tbody>
        {entries.map(([name, value]) => {
          const field = indexPattern.fields.find((candidate) => candidate.name === name);
          const filterable = isFilterable(field, name);
          const text = value === undefined || value === null ? ' - ' : fieldFormatter(indexPattern, name, services.formatSettings())(value).text;
          const collapsible = text.length > COLLAPSE_LINE_LENGTH;
          const collapsed = collapsible && !opened.has(name);
          const arrayOfObjects = Array.isArray(value) && value.some((item) => item !== null && typeof item === 'object');
          const underscore = !field && name.startsWith('_');
          const noMapping = !field && !underscore && !arrayOfObjects;
          return (
            <tr key={name} data-test-subj={`tableDocViewRow-${name}`}>
              {actions?.onFilter && (
                <td className="dscDocViewer__buttons" data-test-subj="osdDocViewerButtons">
                  <RowButton
                    icon="zoomIn"
                    label="Filter for value"
                    tooltip={filterable ? 'Filter for value' : 'Unindexed fields can not be searched'}
                    disabled={!filterable}
                    onClick={() => actions.onFilter?.(name, value, false)}
                    testId="addInclusiveFilterButton"
                  />
                  <RowButton
                    icon="zoomOut"
                    label="Filter out value"
                    tooltip={filterable ? 'Filter out value' : 'Unindexed fields can not be searched'}
                    disabled={!filterable}
                    onClick={() => actions.onFilter?.(name, value, true)}
                    testId="removeInclusiveFilterButton"
                  />
                  {actions.onToggleColumn && (
                    <RowButton
                      icon="table"
                      label="Toggle column in table"
                      tooltip="Toggle column in table"
                      pressed={actions.columns.includes(name)}
                      onClick={() => actions.onToggleColumn?.(name)}
                      testId="toggleColumnButton"
                    />
                  )}
                  <RowButton
                    icon="filter"
                    label="Filter for field present"
                    tooltip={
                      filterable
                        ? 'Filter for field present'
                        : field?.scripted
                          ? 'Unable to filter for presence of scripted fields'
                          : 'Unable to filter for presence of meta fields'
                    }
                    disabled={!filterable || !actions.onFilterExists}
                    onClick={() => actions.onFilterExists?.(name)}
                    testId="addExistsFilterButton"
                  />
                </td>
              )}
              <td className="dscDocViewer__field" data-test-subj="osdDocViewerField">
                <span className="dscDocViewer__fieldName">
                  <FieldToken type={docFieldType(indexPattern, name)} plain />
                  <span className="dscDocViewer__name" title={name}>
                    {name}
                  </span>
                </span>
              </td>
              <td>
                {collapsible && (
                  <Tooltip content="Toggle field details">
                    <button
                      type="button"
                      className="dscDocViewer__actionButton dscDocViewer__collapse"
                      aria-expanded={!collapsed}
                      aria-label="Toggle field details"
                      onClick={() =>
                        setOpened((current) => {
                          const next = new Set(current);
                          if (!next.delete(name)) next.add(name);
                          return next;
                        })
                      }
                      data-test-subj="collapseBtn"
                    >
                      <Icon name={collapsed ? 'arrowRight' : 'arrowDown'} />
                    </button>
                  </Tooltip>
                )}
                {underscore && <Warning text="Field names beginning with _ are not supported" />}
                {noMapping && (
                  <Warning text="No cached mapping for this field. Refresh field list from the Management > Index Patterns page" />
                )}
                <div className={cx('dscDocViewer__value', collapsed && 'dscDocViewer__value--cut')} data-test-subj={`tableDocViewRow-${name}-value`}>
                  <CellValue indexPattern={indexPattern} name={name} value={value} hit={hit} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A run of JSON text without a kind: its brackets and commas dimmed, as the original's code block dims punctuation */
function plainJson(text: string, key: string): ReactNode[] {
  return text.split(/([{}[\],])/).map((part, index) =>
    /^[{}[\],]$/.test(part) ? (
      <span key={`${key}-${index}`} className="dscJson__punctuation">
        {part}
      </span>
    ) : (
      part
    )
  );
}

/** The document as OpenSearch returned it, coloured, with the button that copies it */
function JsonView({ hit }: { hit: RawHit }) {
  const json = useMemo(() => JSON.stringify(hit, null, 2), [hit]);
  const lines = useMemo(() => tokenizeJson(json), [json]);
  return (
    <div className="dscDocViewer__code">
      <pre className="dscDocViewer__pre">
        <code aria-label="Read only JSON view of an opensearch document">
          {lines.map((tokens, line) => (
            <Fragment key={line}>
              {tokens.map((token, index) =>
                token.kind ? (
                  <span key={index} className={`dscJson__${token.kind.toLowerCase()}`}>
                    {token.text}
                  </span>
                ) : (
                  plainJson(token.text, `${index}`)
                )
              )}
              {line < lines.length - 1 && '\n'}
            </Fragment>
          ))}
        </code>
      </pre>
      <Tooltip content="Copy">
        <button type="button" className="dscDocViewer__copy" aria-label="Copy" onClick={() => copyText(json)}>
          <Icon name="copy" />
        </button>
      </Tooltip>
    </div>
  );
}

export function DocViewer({
  hit,
  indexPattern,
  actions,
}: {
  hit: RawHit;
  indexPattern: IndexPattern;
  actions?: DocActions;
}) {
  const [tab, setTab] = useState('table');
  const tabs = [
    { id: 'table', label: 'Table' },
    { id: 'json', label: 'JSON' },
  ];
  return (
    <div className="dscDocViewer" data-test-subj="osdDocViewer">
      <div className="dscDocViewer__tabs" role="tablist">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`osd_doc_viewer_tab_${index}`}
            className="dscDocViewer__tab"
            aria-selected={item.id === tab}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'table' ? (
        <DocTableView hit={hit} indexPattern={indexPattern} actions={actions} />
      ) : (
        <JsonView hit={hit} />
      )}
    </div>
  );
}

/** A link of the opened document, which opens in a new tab as the original's */
function DocLink({ to, index, children }: { to: string; index: number; children: string }) {
  return (
    <a className="dscDetails__link" href={href(to)} target="_blank" rel="noopener noreferrer" data-test-subj={`docTableRowAction-${index}`}>
      {children}
      <Icon name="external" />
      <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
    </a>
  );
}

/**
 * What the original's link to the surrounding documents carries: of the address's `_g` the pinned
 * filters and nothing else (the time range stays behind), then the columns and the page's own
 * filters switched off
 */
export function contextLinkState(globalParam: string | undefined, columns?: string[], appFilters?: Filter[]): Record<string, unknown> {
  const pinned = decodeState<{ filters: Filter[] }>(globalParam).filters;
  return {
    _g: { filters: Array.isArray(pinned) ? pinned : [] },
    _a:
      columns || appFilters
        ? {
            columns: columns ?? ['_source'],
            filters: (appFilters ?? []).map((filter) => ({ ...filter, meta: { ...filter.meta, disabled: true } })),
          }
        : undefined,
  };
}

export function DocDetails({
  hit,
  indexPattern,
  actions,
  basePath,
  appFilters,
}: {
  hit: RawHit;
  indexPattern: IndexPattern;
  actions?: DocActions;
  /** The application's path, for the links to the document on its own */
  basePath: string;
  /** The page's own filters, which the original hands to the surrounding documents disabled */
  appFilters?: Filter[];
}) {
  const links = [
    ...(indexPattern.timeFieldName
      ? [
          {
            label: 'View surrounding documents',
            to: appUrl(
              basePath,
              `/context/${encodeURIComponent(indexPattern.id)}/${encodeURIComponent(hit._id)}`,
              contextLinkState(currentGlobalParam(), actions?.columns, appFilters)
            ),
          },
        ]
      : []),
    {
      label: 'View single document',
      to: appUrl(basePath, `/doc/${encodeURIComponent(indexPattern.id)}/${encodeURIComponent(hit._index)}`, { id: hit._id }),
    },
  ];
  return (
    <div className="dscDetails" data-test-subj="docTableDetailsRow">
      <div className="dscDetails__header">
        <span className="dscDetails__icon" data-test-subj="osdDocTableDetailsIconContainer">
          <Icon name="folder" />
        </span>
        <h4 className="dscDetails__title">Expanded document</h4>
        <span className="dscDetails__links">
          {links.map((link, index) => (
            <DocLink key={link.label} to={link.to} index={index}>
              {link.label}
            </DocLink>
          ))}
        </span>
      </div>
      <DocViewer hit={hit} indexPattern={indexPattern} actions={actions} />
    </div>
  );
}
