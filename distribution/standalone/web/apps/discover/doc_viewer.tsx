/* SPDX-License-Identifier: Apache-2.0 */

/* One document, opened: every field as a table, or the document as OpenSearch returned it. */

import { useMemo, useState } from 'react';
import { Button, CodeBlock, FieldToken, IconButton, Link, Tabs } from '../../components/basic';
import { FieldValue } from '../../components/formatted';
import { Icon } from '../../components/icon';
import { copyText } from '../../components/overlay';
import { flattenHit, type RawHit } from '../../lib/docs';
import { appUrl } from '../../lib/url';
import type { IndexPattern } from '../../lib/types';

export interface DocActions {
  columns: string[];
  onToggleColumn?: (fieldName: string) => void;
  onFilter?: (fieldName: string, value: unknown, negate: boolean) => void;
  onFilterExists?: (fieldName: string) => void;
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
  const flat = useMemo(() => flattenHit(hit, indexPattern), [hit, indexPattern]);
  const names = useMemo(() => Object.keys(flat).sort((a, b) => a.localeCompare(b)), [flat]);
  return (
    <table className="atlTable atlTable--compact dscDocFields" data-test-subj="tableDocViewRow">
      <tbody>
        {names.map((name) => {
          const field = indexPattern.fields.find((candidate) => candidate.name === name);
          const value = flat[name];
          const filterable = Boolean(field?.searchable) && !field?.scripted && value !== undefined;
          return (
            <tr key={name} data-test-subj={`tableDocViewRow-${name}`}>
              {actions && (
                <td className="dscDocFields__actions">
                  <IconButton
                    icon="plusCircle"
                    size="s"
                    label="Filter for value"
                    disabled={!filterable || !actions.onFilter}
                    onClick={() => actions.onFilter?.(name, value, false)}
                    testId="addInclusiveFilterButton"
                  />
                  <IconButton
                    icon="minusCircle"
                    size="s"
                    label="Filter out value"
                    disabled={!filterable || !actions.onFilter}
                    onClick={() => actions.onFilter?.(name, value, true)}
                    testId="removeInclusiveFilterButton"
                  />
                  <IconButton
                    icon="table"
                    size="s"
                    label={actions.columns.includes(name) ? 'Remove column from table' : 'Toggle column in table'}
                    disabled={!actions.onToggleColumn}
                    onClick={() => actions.onToggleColumn?.(name)}
                    testId="toggleColumnButton"
                  />
                  <IconButton
                    icon="filter"
                    size="s"
                    label="Filter for field present"
                    disabled={!field?.searchable || !actions.onFilterExists}
                    onClick={() => actions.onFilterExists?.(name)}
                    testId="addExistsFilterButton"
                  />
                </td>
              )}
              <td className="dscDocFields__name">
                <span className="atlRow" style={{ gap: 6 }}>
                  <FieldToken type={field?.type ?? 'unknown'} />
                  <span>{name}</span>
                </span>
              </td>
              <td className="dscDocFields__value">
                <FieldValue indexPattern={indexPattern} fieldName={name} value={value} hit={hit} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
  const json = useMemo(() => JSON.stringify(hit, null, 2), [hit]);
  return (
    <div className="atlStack">
      <Tabs
        selected={tab}
        onSelect={setTab}
        tabs={[
          { id: 'table', label: 'Table' },
          { id: 'json', label: 'JSON' },
        ]}
      />
      {tab === 'table' ? (
        <DocTableView hit={hit} indexPattern={indexPattern} actions={actions} />
      ) : (
        <>
          <div className="atlRow" style={{ justifyContent: 'flex-end' }}>
            <Button size="s" icon="copy" onClick={() => copyText(json)}>
              Copy to clipboard
            </Button>
          </div>
          <CodeBlock>{json}</CodeBlock>
        </>
      )}
    </div>
  );
}

export function DocDetails({
  hit,
  indexPattern,
  actions,
  basePath,
}: {
  hit: RawHit;
  indexPattern: IndexPattern;
  actions?: DocActions;
  /** The application's path, for the links to the document on its own */
  basePath: string;
}) {
  return (
    <div className="dscDetails" data-test-subj="docTableDetailsRow">
      <div className="atlRow atlRowBetween">
        <span className="atlRow dscDetails__title">
          <Icon name="folder" /> Expanded document
        </span>
        <span className="atlRow dscDetails__links">
          {indexPattern.timeFieldName && (
            <Link
              to={appUrl(basePath, `/context/${encodeURIComponent(indexPattern.id)}/${encodeURIComponent(hit._id)}`)}
              testId="docTableRowAction-context"
            >
              View surrounding documents
            </Link>
          )}
          <Link
            to={appUrl(basePath, `/doc/${encodeURIComponent(indexPattern.id)}/${encodeURIComponent(hit._index)}`, {
              id: hit._id,
            })}
            testId="docTableRowAction-single"
          >
            View single document
          </Link>
        </span>
      </div>
      <DocViewer hit={hit} indexPattern={indexPattern} actions={actions} />
    </div>
  );
}
