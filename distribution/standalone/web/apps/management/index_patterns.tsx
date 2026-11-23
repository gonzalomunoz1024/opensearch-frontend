/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Index patterns: the list, and the page of one with its fields, its scripted fields and its
 * source filters, drawn and run as the plugin index_pattern_management of OpenSearch Dashboards
 * draws and runs them. The wizard that makes one and the editor of a field are beside this file.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { searchItems } from '../../lib/search_syntax';
import { href, navigate, useUrlState } from '../../router';
import { services } from '../../services';
import { useBreadcrumbs } from '../../shell/state';
import { FieldEditor } from './field_editor';
import { MANAGEMENT_CRUMB, sectionCrumb } from './frame';
import {
  fieldPath,
  filterOptions,
  formatType,
  listItemsOf,
  patternName,
  SUPPORTED_SCRIPTING_LANGUAGES,
  tabsOf,
  TAB_INDEXED_FIELDS,
  TAB_SCRIPTED_FIELDS,
  TAB_SOURCE_FILTERS,
  type FieldRecord,
  type ManagedPattern,
  type PatternAttributes,
  type PatternListItem,
  type SourceFilter,
} from './index_pattern_model';
import { deletePattern, loadPattern, refreshFields, savePattern, sourceFilterMatcher } from './index_pattern_store';
import { ButtonIcon, Confirm, Dot, IconTip, InMemoryTable, type TableColumn } from './index_pattern_table';
import { CreateIndexPatternWizard } from './index_pattern_wizard';
import '../../styles/index_patterns.css';

export const ROOT = '/app/management/opensearch-dashboards/indexPatterns';
export { MANAGEMENT_CRUMB };
export const LIST_CRUMB = sectionCrumb('indexPatterns');

const MAPPING_API = 'https://opensearch.org/docs/latest/opensearch/index-templates';
const PAINLESS_DOCS = 'https://opensearch.org/docs/latest';

export const patternPath = (id: string, rest = '') => `${ROOT}/patterns/${id}${rest}`;
export const tabPath = (id: string, tab: string) => `${patternPath(id)}#/?_a=(tab:${tab})`;

export function IndexPatternsSection({ rest }: { rest: string[] }) {
  let page: ReactNode;
  if (rest[0] === 'create') page = <CreateIndexPatternWizard />;
  else if (rest[0] === 'patterns' && rest[1]) {
    if (rest[2] === 'field' && rest[3] !== undefined) {
      const name = rest.slice(3).join('/');
      page = <FieldEditor key={`${rest[1]}/${name}`} patternId={rest[1]} fieldName={name} />;
    } else if (rest[2] === 'create-field') {
      page = <FieldEditor key={`${rest[1]}/+`} patternId={rest[1]} />;
    } else page = <PatternPage key={rest[1]} id={rest[1]} />;
  } else page = <PatternList />;
  return <div className="inpPage">{page}</div>;
}

// --- Small pieces of EUI these pages share ----------------------------------------------------------

export function ExternalLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a className="inpLink" href={to} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" className="inpLink__external" title="External link" />
      <span className="inpScreenReader">(opens in a new tab or window)</span>
    </a>
  );
}

/** EuiSmallButton, filled or not, as a button or as a link to a page of this product */
export function SmallButton({
  children,
  fill,
  icon,
  onClick,
  to,
  disabled,
  loading,
  testId,
  className,
}: {
  children: ReactNode;
  fill?: boolean;
  icon?: 'plus' | 'plusCircle';
  onClick?: () => void;
  to?: string;
  disabled?: boolean;
  loading?: boolean;
  testId?: string;
  className?: string;
}) {
  const classes = cx('inpButton', fill && 'inpButton--fill', className);
  const content = (
    <span className="inpButton__content">
      {loading ? <span className="inpSpinner" /> : icon ? <Icon name={icon} /> : null}
      <span className="inpButton__text">{children}</span>
    </span>
  );
  if (to && !disabled) {
    return (
      <a
        className={classes}
        href={href(to)}
        data-test-subj={testId}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          navigate(to);
        }}
      >
        {content}
      </a>
    );
  }
  return (
    <button type="button" className={classes} onClick={onClick} disabled={disabled || loading} data-test-subj={testId}>
      {content}
    </button>
  );
}

/** EuiCompressedFormRow: a label above, help or an error below */
export function FormRow({
  label,
  help,
  error,
  invalid,
  children,
  id,
  wide,
}: {
  label?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  /** Drawn as wrong without saying why: the error is told in another row */
  invalid?: boolean;
  children: ReactNode;
  id?: string;
  wide?: boolean;
}) {
  const isInvalid = invalid || (error !== undefined && error !== null);
  return (
    <div className={cx('inpFormRow', wide && 'inpFormRow--wide')}>
      {label !== undefined && (
        <label className={cx('inpFormRow__label', isInvalid && 'inpFormRow__label--invalid')} htmlFor={id}>
          {label}
        </label>
      )}
      <div className="inpFormRow__field">{children}</div>
      {error !== undefined && error !== null && <div className="inpFormRow__error">{error}</div>}
      {help !== undefined && help !== null && <div className="inpFormRow__help">{help}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'hollow' }: { children: ReactNode; tone?: 'hollow' | 'warning' | 'default' }) {
  return (
    <span className={cx('inpBadge', `inpBadge--${tone}`)} title={typeof children === 'string' ? children : undefined}>
      <span className="inpBadge__text">{children}</span>
    </span>
  );
}

export function CallOut({
  title,
  tone,
  icon,
  size = 'm',
  children,
  testId,
}: {
  title: ReactNode;
  tone: 'primary' | 'success' | 'warning' | 'danger';
  icon?: 'warning' | 'cross' | 'help' | 'info' | 'check' | 'checkCircle';
  size?: 's' | 'm';
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={cx('inpCallOut', `inpCallOut--${tone}`, size === 's' && 'inpCallOut--small')} data-test-subj={testId}>
      <p className="inpCallOut__title">
        {icon && <Icon name={icon} className="inpCallOut__icon" />}
        <span>{title}</span>
      </p>
      {children !== undefined && <div className="inpCallOut__body">{children}</div>}
    </div>
  );
}

/** The search box of a table: EuiFieldSearch */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  testId,
  compressed = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  testId?: string;
  compressed?: boolean;
}) {
  return (
    <div className={cx('inpSearch', !compressed && 'inpSearch--large')}>
      <Icon name="search" className="inpSearch__icon" />
      <input
        type="search"
        className={cx('inpInput', 'inpInput--search', !compressed && 'inpInput--large')}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        data-test-subj={testId}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function SelectBox({
  value,
  options,
  onChange,
  label,
  testId,
  id,
  disabled,
  invalid,
}: {
  value: string;
  options: Array<{ value: string; text: string }>;
  onChange: (value: string) => void;
  label?: string;
  testId?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="inpSelectWrap">
      <select
        id={id}
        className={cx('inpSelect', invalid && 'inpSelect--invalid')}
        value={value}
        aria-label={label}
        data-test-subj={testId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" className="inpSelectWrap__arrow" />
    </div>
  );
}

// --- The list ---------------------------------------------------------------------------------------

function PatternList() {
  useBreadcrumbs([MANAGEMENT_CRUMB, LIST_CRUMB]);
  const [items, setItems] = useState<PatternListItem[]>();
  const [search, setSearch] = useState('');

  useEffect(() => {
    let live = true;
    services.http
      .get<{ saved_objects: Array<{ id: string; attributes: PatternAttributes; references?: Array<{ type: string; id: string; name: string }> }> }>(
        '/api/saved_objects/_find',
        { query: { fields: ['title', 'displayName', 'type'], per_page: 10000, type: 'index-pattern' } }
      )
      .then((answer) => {
        if (live) setItems(listItemsOf(answer.saved_objects, services.uiSettings.get<string | undefined>('defaultIndex')));
      })
      .catch((failure) => {
        if (!live) return;
        setItems([]);
        services.toasts.error(failure, 'The index patterns could not be listed');
      });
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => (items ? searchItems(items, search) : []), [items, search]);
  const columns = useMemo<Array<TableColumn<PatternListItem>>>(
    () => [
      {
        field: 'title',
        name: 'Pattern',
        sortable: (item) => item.sort,
        render: (_value, item) => (
          <>
            <a
              className="inpButtonEmpty inpButtonEmpty--xs inpButtonEmpty--primary"
              href={href(patternPath(item.id))}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                navigate(patternPath(item.id));
              }}
            >
              <span className="inpButtonEmpty__text">{item.title}</span>
            </a>
            {' '}
            <span className="inpBadgeGroup">
              {item.tags.map((tag) => (
                <span key={tag.key} className="inpBadgeGroup__item">
                  <Badge tone="default">{tag.name}</Badge>
                </span>
              ))}
            </span>
          </>
        ),
      },
      {
        field: 'referenceId',
        name: 'Data Source Connection',
        testId: 'indexPatternTableColumn-data_source',
        render: () => null,
      },
    ],
    []
  );

  if (!items) return null;
  return (
    <div className="inpPanel" data-test-subj="indexPatternTable" role="region" aria-label="Index patterns">
      <div className="inpListHeader">
        <div>
          <h1 className="inpTitle">Index patterns</h1>
          <p className="inpListHeader__lead">
            Create and manage the index patterns that help you retrieve your data from OpenSearch.
          </p>
        </div>
        <SmallButton fill icon="plus" testId="createIndexPatternButton" onClick={() => navigate(`${ROOT}/create`)}>
          Create index pattern
        </SmallButton>
      </div>
      <div className="inpListSearch">
        <SearchBox
          value={search}
          onChange={setSearch}
          compressed={false}
          placeholder="Search..."
          label="This is a search bar. As you type, the results lower in the page will automatically filter."
        />
      </div>
      <InMemoryTable
        rows={shown}
        columns={columns}
        rowKey={(item) => item.id}
        initialSort={{ field: 'title', direction: 'asc' }}
        allowNeutralSort={false}
      />
    </div>
  );
}

// --- The page of a pattern -------------------------------------------------------------------------------

export function usePattern(id: string): [ManagedPattern | undefined, () => void] {
  const [pattern, setPattern] = useState<ManagedPattern>();
  const [, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    loadPattern(id)
      .then((loaded) => live && setPattern(loaded))
      .catch((failure) => live && services.toasts.error(failure, `Could not locate that index-pattern (id: ${id})`));
    return () => {
      live = false;
    };
  }, [id]);
  // The pattern is changed in place, as the original's is; this draws it again
  const changed = useCallback(() => setTick((tick) => tick + 1), []);
  return [pattern, changed];
}

/** The name of the pattern, and its buttons: make it the default, read its fields again, delete it */
export function IndexHeader({
  pattern,
  defaultId,
  onSetDefault,
  onRefresh,
  onDelete,
}: {
  pattern: ManagedPattern;
  defaultId?: string;
  onSetDefault?: () => void;
  onRefresh?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="inpIndexHeader">
      <div className="inpIndexHeader__name">
        <h1 className="inpTitle" data-test-subj="indexPatternTitle">
          {pattern.displayName || pattern.title}
        </h1>
        {pattern.displayName && (
          <div className="inpIndexHeader__subtext" data-test-subj="indexPatternTitleSubtext">
            {pattern.title}
          </div>
        )}
      </div>
      <div className="inpIndexHeader__buttons">
        {defaultId !== pattern.id && onSetDefault && (
          <Tooltip content="Set as default index.">
            <ButtonIcon
              icon="star"
              size="s"
              tone="text"
              className="inpButtonIcon--filledStar"
              label="Set as default index."
              onClick={onSetDefault}
              testId="setDefaultIndexPatternButton"
            />
          </Tooltip>
        )}
        {onRefresh && (
          <Tooltip content="Refresh field list.">
            <ButtonIcon
              icon="refresh"
              size="s"
              tone="text"
              label="Reload field list."
              onClick={onRefresh}
              testId="refreshFieldsIndexPatternButton"
            />
          </Tooltip>
        )}
        {onDelete && (
          <Tooltip content="Remove index pattern.">
            <ButtonIcon
              icon="trash"
              size="s"
              tone="danger"
              label="Remove index pattern."
              onClick={onDelete}
              testId="deleteIndexPatternButton"
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function PatternPage({ id }: { id: string }) {
  const [pattern, changed] = usePattern(id);
  useBreadcrumbs(
    pattern
      ? [MANAGEMENT_CRUMB, LIST_CRUMB, { text: patternName(pattern), to: patternPath(pattern.id) }]
      : [MANAGEMENT_CRUMB, LIST_CRUMB]
  );
  if (!pattern) return null;
  return <PatternDetails pattern={pattern} changed={changed} />;
}

function PatternDetails({ pattern, changed }: { pattern: ManagedPattern; changed: () => void }) {
  const [defaultId, setDefaultId] = useState(services.uiSettings.get<string | undefined>('defaultIndex'));
  const [displayName, setDisplayName] = useState(pattern.displayName || '');
  const [confirm, setConfirm] = useState<'refresh' | 'delete'>();
  const dirty = displayName !== (pattern.displayName || '');
  const conflicts = pattern.fields.filter((field) => field.type === 'conflict');
  const isDefault = pattern.id === defaultId;

  const setDefault = async () => {
    try {
      await services.uiSettings.set('defaultIndex', pattern.id);
      setDefaultId(pattern.id);
    } catch (failure) {
      services.toasts.error(failure, 'The default index pattern could not be set');
    }
  };

  const saveDisplayName = async () => {
    const previous = pattern.displayName;
    try {
      // An empty name is written as such: the original leaves it out, and the stored name stays
      pattern.displayName = displayName;
      await savePattern(pattern);
      changed();
    } catch {
      pattern.displayName = previous;
      services.toasts.danger('Failed to save display name.');
    }
  };

  const refresh = async () => {
    setConfirm(undefined);
    await refreshFields(pattern);
    try {
      await savePattern(pattern);
    } catch (failure) {
      services.toasts.error(failure, 'The index pattern could not be saved');
    }
    changed();
  };

  const remove = async () => {
    setConfirm(undefined);
    try {
      if (isDefault) {
        const answer = await services.http.get<{ saved_objects: Array<{ id: string; attributes: PatternAttributes }> }>(
          '/api/saved_objects/_find',
          { query: { fields: ['title', 'displayName', 'type'], per_page: 10000, type: 'index-pattern' } }
        );
        const others = listItemsOf(answer.saved_objects, defaultId).filter((item) => item.id !== pattern.id);
        await services.uiSettings.remove('defaultIndex');
        if (others.length) await services.uiSettings.set('defaultIndex', others[0].id);
      }
      await deletePattern(pattern.id);
      navigate(ROOT);
    } catch (failure) {
      services.toasts.error(failure, 'The index pattern could not be deleted');
    }
  };

  return (
    <div className="inpPanel">
      <div data-test-subj="editIndexPattern" role="region" aria-label="Index pattern details">
        <IndexHeader
          pattern={pattern}
          defaultId={defaultId}
          onSetDefault={setDefault}
          onRefresh={() => setConfirm('refresh')}
          onDelete={() => setConfirm('delete')}
        />
        <div className="inpSpacer--s" />
        {(pattern.timeFieldName || isDefault) && (
          <div className="inpBadges">
            {pattern.timeFieldName && <Badge tone="warning">{`Time field: '${pattern.timeFieldName}'`}</Badge>}
            {isDefault && <Badge>Default</Badge>}
          </div>
        )}
        <div className="inpSpacer--m" />
        <p className="inpText">
          This page lists every field in the <strong>{patternName(pattern)}</strong> index and the field&apos;s
          associated core type as recorded by OpenSearch. To change a field type, use the OpenSearch{' '}
          <ExternalLink to={MAPPING_API}>Mapping API</ExternalLink>
        </p>
        <div className="inpSpacer--s" />
        <div className="inpDisplayName">
          <FormRow label="Display name" help="A friendly name shown in the UI instead of the index pattern." id="inpDisplayName">
            <input
              id="inpDisplayName"
              type="text"
              className="inpInput"
              value={displayName}
              placeholder={pattern.title}
              data-test-subj="editIndexPatternDisplayNameInput"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </FormRow>
          {dirty && (
            <SmallButton fill onClick={saveDisplayName} testId="saveDisplayNameButton">
              Save
            </SmallButton>
          )}
        </div>
        {conflicts.length > 0 && (
          <>
            <div className="inpSpacer--l" />
            <CallOut title="Mapping conflict" tone="warning" icon="warning">
              <p>
                {conflicts.length === 1 ? 'A field is' : `${conflicts.length} fields are`} defined as several types
                (string, integer, etc) across the indices that match this pattern. You may still be able to use these
                conflict fields in parts of OpenSearch Dashboards, but they will be unavailable for functions that
                require OpenSearch Dashboards to know their type. Correcting this issue will require reindexing your
                data.
              </p>
            </CallOut>
          </>
        )}
        <div className="inpSpacer--l" />
        <PatternTabs pattern={pattern} changed={changed} />
      </div>
      {confirm === 'refresh' && (
        <Confirm title="Refresh field list?" confirmLabel="Refresh" onCancel={() => setConfirm(undefined)} onConfirm={refresh}>
          <p>This action resets the popularity counter of each field.</p>
        </Confirm>
      )}
      {confirm === 'delete' && (
        <Confirm title="Delete index pattern?" confirmLabel="Delete" onCancel={() => setConfirm(undefined)} onConfirm={remove} />
      )}
    </div>
  );
}

// --- The tabs -------------------------------------------------------------------------------------------

function PatternTabs({ pattern, changed }: { pattern: ManagedPattern; changed: () => void }) {
  const [state, setState] = useUrlState('_a', { tab: TAB_INDEXED_FIELDS });
  const [fieldFilter, setFieldFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const tabs = tabsOf(pattern, fieldFilter);
  const selected = tabs.some((tab) => tab.id === state.tab) ? state.tab : TAB_INDEXED_FIELDS;

  // The address says which tab is open from the start, as the original's state does
  useEffect(() => {
    setState({ tab: selected }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeOptions = filterOptions(
    pattern.fields.filter((field) => !field.scripted).map((field) => field.type),
    'All field types'
  );
  const languageOptions = filterOptions(
    pattern.fields.filter((field) => field.scripted && field.lang).map((field) => field.lang as string),
    'All languages'
  );

  return (
    <div className="inpTabbed">
      <div className="inpTabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tab.id}
            aria-selected={tab.id === selected}
            className={cx('inpTab', tab.id === selected && 'inpTab--selected')}
            data-test-subj={`tab-${tab.id}`}
            onClick={() => setState({ tab: tab.id })}
          >
            <span className="inpTab__content">{tab.name}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={selected}>
        <div className="inpSpacer--m" />
        <div className="inpFilterBar">
          <div className="inpFilterBar__search">
            <SearchBox
              value={fieldFilter}
              onChange={setFieldFilter}
              placeholder="Search"
              label="Search fields"
              testId="indexPatternFieldFilter"
            />
          </div>
          {selected === TAB_INDEXED_FIELDS && typeOptions.length > 0 && (
            <SelectBox
              value={typeFilter}
              options={typeOptions}
              onChange={setTypeFilter}
              label="Filter field types"
              testId="indexedFieldTypeFilterDropdown"
            />
          )}
          {selected === TAB_SCRIPTED_FIELDS && languageOptions.length > 0 && (
            <SelectBox
              value={languageFilter}
              options={languageOptions}
              onChange={setLanguageFilter}
              testId="scriptedFieldLanguageFilterDropdown"
            />
          )}
        </div>
        <div className="inpSpacer--m" />
        {selected === TAB_INDEXED_FIELDS && <IndexedFields pattern={pattern} filter={fieldFilter} typeFilter={typeFilter} />}
        {selected === TAB_SCRIPTED_FIELDS && (
          <ScriptedFields pattern={pattern} filter={fieldFilter} languageFilter={languageFilter} changed={changed} />
        )}
        {selected === TAB_SOURCE_FILTERS && <SourceFilters pattern={pattern} filter={fieldFilter} changed={changed} />}
      </div>
    </div>
  );
}

interface IndexedFieldItem extends FieldRecord {
  displayName: string;
  format?: string;
  excluded: boolean;
}

const formatTitleOf = (pattern: ManagedPattern, name: string) => {
  const format = pattern.fieldFormatMap[name];
  return format ? formatType(format.id)?.title : undefined;
};

function IndexedFields({ pattern, filter, typeFilter }: { pattern: ManagedPattern; filter: string; typeFilter: string }) {
  const key = JSON.stringify([pattern.fields, pattern.sourceFilters, pattern.fieldFormatMap, filter, typeFilter]);
  const items = useMemo<IndexedFieldItem[]>(() => {
    const excluded = sourceFilterMatcher((pattern.sourceFilters ?? []).map((source) => source.value));
    const all = pattern.fields
      .filter((field) => !field.scripted)
      .map((field) => ({
        ...field,
        displayName: field.name,
        format: formatTitleOf(pattern, field.name),
        excluded: excluded(field.name),
      }));
    const lower = filter.toLowerCase();
    return all
      .filter((field) => !filter || field.name.toLowerCase().includes(lower))
      .filter((field) => !typeFilter || field.type === typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const columns: Array<TableColumn<IndexedFieldItem>> = [
    {
      field: 'displayName',
      name: 'Name',
      sortable: true,
      width: '38%',
      testId: 'indexedFieldName',
      render: (value, field) => (
        <span>
          {value as string}
          {pattern.timeFieldName === field.name && (
            <span>
              {' '}
              <IconTip icon="clock" label="Primary time field" content="This field represents the time that events occurred." />
            </span>
          )}
        </span>
      ),
    },
    {
      field: 'type',
      name: 'Type',
      sortable: true,
      testId: 'indexedFieldType',
      render: (value) => (
        <span>
          {value as string}
          {value === 'conflict' ? (
            <span>
              {' '}
              <IconTip
                icon="warning"
                tone="warning"
                label="Multiple type field"
                content="The type of this field changes across indices. It is unavailable for many analysis functions."
              />
            </span>
          ) : (
            ''
          )}
        </span>
      ),
    },
    { field: 'format', name: 'Format', sortable: true },
    {
      field: 'searchable',
      name: 'Searchable',
      description: 'These fields can be used in the filter bar',
      sortable: true,
      render: (value) => (value ? <Dot label="Is searchable" /> : <span />),
    },
    {
      field: 'aggregatable',
      name: 'Aggregatable',
      description: 'These fields can be used in visualization aggregations',
      sortable: true,
      render: (value) => (value ? <Dot label="Is aggregatable" /> : <span />),
    },
    {
      field: 'excluded',
      name: 'Excluded',
      description: 'Fields that are excluded from _source when it is fetched',
      sortable: true,
      render: (value) => (value ? <Dot label="Is excluded" /> : <span />),
    },
    {
      name: '',
      width: '40px',
      actions: [
        {
          name: 'Edit',
          description: 'Edit',
          icon: 'pencil',
          onClick: (field) => navigate(`${ROOT}${fieldPath(pattern.id, field.name)}`),
          testId: 'editFieldFormat',
        },
      ],
    },
  ];

  return <InMemoryTable rows={items} columns={columns} rowKey={(field) => field.name} />;
}

function ScriptedFields({
  pattern,
  filter,
  languageFilter,
  changed,
}: {
  pattern: ManagedPattern;
  filter: string;
  languageFilter: string;
  changed: () => void;
}) {
  const [toDelete, setToDelete] = useState<FieldRecord>();
  const key = JSON.stringify([pattern.fields, filter, languageFilter]);
  const items = useMemo(() => {
    const lower = filter.toLowerCase();
    return pattern.fields
      .filter((field) => field.scripted)
      .filter((field) => !languageFilter || field.lang === languageFilter)
      .filter((field) => !filter || field.name.toLowerCase().includes(lower))
      .map((field) => ({ ...field, displayName: field.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const deprecated = [
    ...new Set(
      pattern.fields
        .filter((field) => field.scripted)
        .map((field) => field.lang ?? '')
        .filter((lang) => !SUPPORTED_SCRIPTING_LANGUAGES.includes(lang))
    ),
  ];

  const columns: Array<TableColumn<FieldRecord & { displayName: string }>> = [
    { field: 'displayName', name: 'Name', description: 'Name of the field', sortable: true, width: '38%' },
    { field: 'lang', name: 'Lang', description: 'Language used for the field', sortable: true, testId: 'scriptedFieldLang' },
    { field: 'script', name: 'Script', description: 'Script for the field', sortable: true },
    {
      field: 'name',
      name: 'Format',
      description: 'Format used for the field',
      render: (value) => <span>{formatTitleOf(pattern, value as string) ?? ''}</span>,
    },
    {
      name: '',
      width: '40px',
      actions: [
        {
          name: 'Edit',
          description: 'Edit this field',
          icon: 'pencil',
          onClick: (field) => navigate(`${ROOT}${fieldPath(pattern.id, field.name)}`),
        },
        { name: 'Delete', description: 'Delete this field', icon: 'trash', tone: 'danger', onClick: setToDelete },
      ],
    },
  ];

  const remove = async () => {
    const field = toDelete;
    setToDelete(undefined);
    if (!field) return;
    pattern.fields = pattern.fields.filter((candidate) => !(candidate.scripted && candidate.name === field.name));
    changed();
    try {
      await savePattern(pattern);
    } catch (failure) {
      services.toasts.error(failure, 'The index pattern could not be saved');
    }
  };

  return (
    <>
      <div className="inpTabHeader">
        <div className="inpTabHeader__text">
          <h3 className="inpTitle inpTitle--s">Scripted fields</h3>
          <p className="inpText">
            You can use scripted fields in visualizations and display them in your documents. However, you cannot search
            scripted fields.
          </p>
        </div>
        <SmallButton to={`${ROOT}/patterns/${pattern.id}/create-field/`} testId="addScriptedFieldLink">
          Add scripted field
        </SmallButton>
      </div>
      {deprecated.length > 0 && (
        <>
          <CallOut title="Deprecation languages in use" tone="danger" icon="cross">
            <p>
              The following deprecated languages are in use: {deprecated.join(', ')}. Support for these languages will be
              removed in the next major version of OpenSearch Dashboards and OpenSearch. Convert you scripted fields to{' '}
              <a className="inpLink" href={PAINLESS_DOCS}>
                Painless
              </a>{' '}
              to avoid any problems.
            </p>
          </CallOut>
          <div className="inpSpacer--m" />
        </>
      )}
      <div className="inpSpacer--l" />
      <InMemoryTable rows={items} columns={columns} rowKey={(field) => field.name} />
      {toDelete && (
        <Confirm
          title={`Delete scripted field '${toDelete.name}'?`}
          confirmLabel="Delete"
          onCancel={() => setToDelete(undefined)}
          onConfirm={remove}
        />
      )}
    </>
  );
}

interface FilterRow extends SourceFilter {
  clientId: number | string;
}

function SourceFilters({ pattern, filter, changed }: { pattern: ManagedPattern; filter: string; changed: () => void }) {
  // Each filter is told apart by a number given here, again after every save, as the original does
  const counter = useRef(0);
  const numbered = useCallback(
    () => (pattern.sourceFilters ?? []).map((source) => ({ ...source, clientId: ++counter.current })),
    [pattern]
  );
  const [filters, setFilters] = useState<FilterRow[]>(numbered);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ id: number | string; value: string }>();
  const [toDelete, setToDelete] = useState<FilterRow>();

  const save = async (next: SourceFilter[]) => {
    pattern.sourceFilters = next;
    setSaving(true);
    try {
      await savePattern(pattern);
    } catch (failure) {
      services.toasts.error(failure, 'The index pattern could not be saved');
    }
    setFilters(numbered());
    setSaving(false);
    changed();
  };

  const saveEdit = (id: number | string, value: string) => {
    setEditing(undefined);
    void save(filters.map((row) => (row.clientId === id ? { value, clientId: id } : row)));
  };

  const shown = useMemo(() => {
    const lower = filter.toLowerCase();
    return filter ? filters.filter((row) => String(row.value).toLowerCase().includes(lower)) : filters;
  }, [filters, filter]);

  const fieldNames = pattern.fields.filter((field) => !field.scripted).map((field) => field.name);
  const columns: Array<TableColumn<FilterRow>> = [
    {
      field: 'value',
      name: 'Filter',
      description: 'Filter name',
      sortable: true,
      render: (value, row) =>
        editing && editing.id === row.clientId ? (
          <input
            type="text"
            className="inpInput"
            autoFocus
            value={editing.value}
            onChange={(event) => setEditing({ id: row.clientId, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && editing.id && editing.value) saveEdit(editing.id, editing.value);
              if (event.key === 'Escape') setEditing(undefined);
            }}
          />
        ) : (
          <span>{value as string}</span>
        ),
    },
    {
      field: 'value',
      name: 'Matches',
      description: 'Language used for the field',
      sortable: true,
      render: (value, row) => {
        const matcher = sourceFilterMatcher([editing && editing.id === row.clientId ? editing.value : (value as string)]);
        const matches = fieldNames.filter(matcher).sort();
        return matches.length ? (
          <span>{matches.join(', ')}</span>
        ) : (
          <em>The source filter doesn&apos;t match any known fields.</em>
        );
      },
    },
    {
      name: '',
      width: '100px',
      align: 'right',
      render: (_value, row) =>
        editing && editing.id === row.clientId ? (
          <>
            <ButtonIcon
              icon="checkCircle"
              label="Save"
              size="s"
              disabled={saving}
              className="inpButtonIcon--filledCheck"
              onClick={() => saveEdit(editing.id, editing.value)}
            />
            <ButtonIcon icon="cross" label="Cancel" size="s" disabled={saving} onClick={() => setEditing(undefined)} />
          </>
        ) : (
          <>
            <Tooltip content="Edit">
              <ButtonIcon
                icon="pencil"
                label="Edit"
                size="s"
                disabled={saving}
                onClick={() => setEditing({ id: row.clientId, value: String(row.value) })}
              />
            </Tooltip>
            <Tooltip content="Delete">
              <ButtonIcon icon="trash" label="Delete" size="s" tone="danger" disabled={saving} onClick={() => setToDelete(row)} />
            </Tooltip>
          </>
        ),
    },
  ];

  return (
    <>
      <h3 className="inpTitle inpTitle--s">Source filters</h3>
      <div className="inpText">
        <p>
          Source filters can be used to exclude one or more fields when fetching the document source. This happens when
          viewing a document in the Discover app, or with a table displaying results from a saved search in the Dashboard
          app. Each row is built using the source of a single document, and if you have documents with large or unimportant
          fields you may benefit from filtering those out at this lower level.
        </p>
        <p>
          Note that multi-fields will incorrectly appear as matches in the table below. These filters only actually apply
          to fields in the original source document, so matching multi-fields are not actually being filtered.
        </p>
      </div>
      <div className="inpSpacer--s" />
      <div className="inpAddFilter">
        <div className="inpAddFilter__input">
          <input
            type="text"
            className="inpInput"
            value={adding}
            placeholder="source filter, accepts wildcards (e.g., `user*` to filter fields starting with 'user')"
            onChange={(event) => setAdding(event.target.value.trim())}
          />
        </div>
        <div className="inpAddFilter__button">
          <SmallButton
            disabled={adding.length === 0 || saving}
            onClick={() => {
              const value = adding;
              setAdding('');
              void save([...(pattern.sourceFilters ?? []), { value }]);
            }}
          >
            Add
          </SmallButton>
        </div>
      </div>
      <div className="inpSpacer--l" />
      <InMemoryTable rows={shown} columns={columns} rowKey={(row) => String(row.clientId)} loading={saving} />
      {toDelete && (
        <Confirm
          title={`Delete source filter '${toDelete.value}'?`}
          confirmLabel="Delete"
          danger
          busy={saving}
          onCancel={() => setToDelete(undefined)}
          onConfirm={() => {
            const row = toDelete;
            void save(filters.filter((candidate) => candidate.clientId !== row.clientId)).then(() => setToDelete(undefined));
          }}
        />
      )}
    </>
  );
}
