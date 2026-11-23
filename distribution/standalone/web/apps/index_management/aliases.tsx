/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Aliases: every alias with the indexes it points to, what can be done to the ticked ones, and
 * the dialog that creates an alias or changes its indexes.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, CallOut } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { TextField } from '../../components/form';
import { Flyout, type MenuItem } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import {
  ActionsMenu,
  ExternalLink,
  LocalTable,
  SearchRow,
  Table,
  go,
  ism,
  toasts,
  useListQuery,
  type TableColumn,
} from './common';
import { ContentPanel, ContentPanelActions, ListEmpty, TitleHelp } from './content_panel';
import { FormRow } from './form_row';
import { aliasIndexesError, aliasNameError } from './index_model';
import {
  INDEX_NAMING_MESSAGE,
  SYSTEM_ALIAS,
  SYSTEM_INDEX,
  aliasActions,
  groupAliases,
  matchesAny,
  pageChanges,
  pageQuery,
  type AliasRow,
} from './model';
import { ClearCacheModal, FlushModal, RefreshModal } from './operations';
import { ModalButtons, ModalNames, PluginModal, TypeTheWord } from './plugin_modal';
import { CRUMBS, ROUTES } from './routes';

const ALIAS_DOCS = 'https://opensearch.org/docs/latest/opensearch/index-alias/';
const STATUS_OPTIONS = ['open', 'closed', 'hidden', 'none', 'all'];

/**
 * The first three of some names and, when there are more, a link that opens them all in a flyout,
 * ten to a page: how the plugin's lists show the indexes of an alias and the patterns of a template.
 */
export function FewNames({
  names,
  title,
  hint,
  column,
  field,
  testId,
}: {
  names: string[];
  /** What the flyout with all of them is called, in the pieces the plugin writes it in */
  title: ReactNode;
  /** What the title says when pointed at */
  hint: string;
  column: string;
  /** The column's field, which names its header's test id */
  field: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <span>{names.slice(0, 3).join(', ')}</span>
      {names.length > 3 && (
        <button
          type="button"
          className="atlLinkButton ismCellLink ismFewNames__more"
          onClick={() => setOpen(!open)}
          data-test-subj={`${names.length - 3} more`}
        >
          {names.length - 3} more
        </button>
      )}
      {open && (
        <Flyout title={<span title={hint}>{title}</span>} onClose={() => setOpen(false)}>
          <div data-test-subj={testId}>
            <LocalTable
              fixed
              caption
              columns={[{ field, name: column, render: (row: { name: string }) => row.name }]}
              rows={names.map((name) => ({ name }))}
              rowId={(row) => row.name}
              pageSizes={[10, 25, 50]}
            />
          </div>
        </Flyout>
      )}
    </div>
  );
}

// --- Creating an alias, or changing the indexes of one ----------------------------------------------------

/** Chooses indexes, or writes patterns for them */
function IndexSelect({
  value,
  onChange,
  invalid,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  invalid?: boolean;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const turn = useRef(0);
  const search = async (text: string) => {
    const mine = (turn.current += 1);
    setLoading(true);
    const [indices, streams] = await Promise.all([
      ism.call<Array<{ index: string }>>(
        'cat.indices',
        text ? { format: 'json', index: `${text}*` } : { format: 'json' }
      ),
      ism.request<{ data_streams?: Array<{ name: string; indices: Array<{ index_name: string }> }> }>(
        'GET',
        '/_data_stream'
      ),
    ]);
    if (mine !== turn.current) return;
    // The indexes behind a data stream and the system's own cannot be given an alias here
    const ofStreams = (streams.response?.data_streams ?? []).flatMap((stream) => [
      stream.name,
      ...stream.indices.map((item) => item.index_name),
    ]);
    setOptions(
      (indices.ok ? (indices.response ?? []) : [])
        .map((item) => item.index)
        .filter((name) => !matchesAny(name, SYSTEM_INDEX) && !ofStreams.includes(name))
    );
    setLoading(false);
  };
  useEffect(() => {
    void search('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ComboBox
      compact
      fullWidth
      allowCustom
      placeholder="Select indexes"
      options={[...new Set([...options, ...value])].map((name) => ({ value: name, label: name }))}
      selected={value}
      onChange={onChange}
      onSearch={(text) => void search(text)}
      loading={loading}
      invalid={invalid}
    />
  );
}

function CreateAlias({
  alias,
  onClose,
  onSuccess,
}: {
  alias?: AliasRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = Boolean(alias);
  const [name, setName] = useState(alias?.alias);
  const [indexes, setIndexes] = useState<string[] | undefined>(alias?.indexArray);
  // A field says what is wrong with it once it was changed, and both do once the form was sent
  const [errors, setErrors] = useState<{ alias?: string; indexArray?: string }>({});

  const submit = async () => {
    const found = { alias: aliasNameError(name), indexArray: aliasIndexesError(indexes) };
    setErrors(found);
    if (found.alias || found.indexArray) return;
    const chosen = indexes ?? [];
    let result: { ok: boolean; error?: string };
    if (alias) {
      const actions = aliasActions(alias.indexArray, chosen, name ?? '');
      result =
        actions.length === 0 ? { ok: true } : await ism.call('indices.updateAliases', { body: { actions } });
    } else {
      result = await ism.call('indices.putAlias', { index: chosen, name });
    }
    if (result.ok) {
      toasts.success(`${name} has been successfully ${isEdit ? 'updated' : 'created'}`);
      onSuccess();
    } else {
      toasts.danger(result.error || '');
    }
  };

  return (
    <PluginModal
      title={<>{isEdit ? 'Update' : 'Create'} alias</>}
      onClose={onClose}
      footer={
        <div>
          <Button className="ismAliasCancel" onClick={onClose} testId="cancelCreateAliasButton">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} testId="createAliasButton">
            {isEdit ? 'Save changes' : 'Create alias'}
          </Button>
        </div>
      }
    >
      {alias && matchesAny(alias.alias, SYSTEM_ALIAS) && (
        <>
          <CallOut tone="warning" size="s">
            This alias may contain critical system data. Changing system aliases may break OpenSearch.
          </CallOut>
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      <div>
        <FormRow
          title="Alias name"
          help={INDEX_NAMING_MESSAGE}
          helpAt="bottom"
          error={errors.alias}
          testId="form-name-alias"
        >
          <TextField
            compact
            placeholder="Specify alias name"
            disabled={isEdit}
            value={name ?? ''}
            onChange={(value) => {
              setName(value);
              setErrors((before) => ({ ...before, alias: aliasNameError(value) }));
            }}
            invalid={Boolean(errors.alias)}
          />
        </FormRow>
        <FormRow
          title="Indexes or index patterns"
          help="Specify one or more indexes or index patterns to be part of the alias."
          error={errors.indexArray}
          testId="form-name-indexArray"
        >
          <IndexSelect
            value={indexes ?? []}
            onChange={(value) => {
              setIndexes(value);
              setErrors((before) => ({ ...before, indexArray: aliasIndexesError(value) }));
            }}
            invalid={Boolean(errors.indexArray)}
          />
        </FormRow>
      </div>
      <div className="ismSpacer ismSpacer--l" />
    </PluginModal>
  );
}

/** The plugin's DeleteAliasModal: "delete" typed before the aliases go */
function DeleteAliasModal({
  aliases,
  onClose,
  onDelete,
}: {
  aliases: AliasRow[];
  onClose: () => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState('');
  const names = aliases.map((item) => item.alias);
  const confirm = async () => {
    const result = await ism.call('indices.deleteAlias', {
      index: aliases.flatMap((item) => item.indexArray ?? []),
      name: names,
    });
    if (result.ok) {
      toasts.success(`Delete [${names.join(', ')}] successfully`);
      onDelete();
    } else {
      toasts.danger(result.error || '');
    }
  };
  return (
    <PluginModal
      title="Delete aliases"
      onClose={onClose}
      footer={
        <ModalButtons
          label="Delete"
          danger
          disabled={value !== 'delete'}
          onCancel={onClose}
          onConfirm={() => void confirm()}
          confirmTestId="deleteConfirmButton"
        />
      }
    >
      {names.some((name) => matchesAny(name, SYSTEM_ALIAS)) && (
        <>
          <CallOut tone="warning" size="s">
            These aliases may contain critical system data. Deleting system aliases may break OpenSearch.
          </CallOut>
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      <p>The following alias will be permanently deleted. This action cannot be undone.</p>
      <ModalNames names={names} />
      <div className="ismSpacer ismSpacer--l" />
      <TypeTheWord word="delete" value={value} onChange={setValue} testId="deleteInput" />
    </PluginModal>
  );
}

// --- The list ---------------------------------------------------------------------------------------------

type Dialog = 'create' | 'edit' | 'delete' | 'clearCache' | 'flush' | 'refresh';

export function Aliases() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.ALIASES]);
  const [query, setQuery] = useListQuery({ sortField: 'alias' }, { status: '' });
  const [all, setAll] = useState<AliasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AliasRow[]>([]);
  const [dialog, setDialog] = useState<Dialog>();
  // The alias whose name was clicked; the menu's Edit changes the ticked one
  const [editing, setEditing] = useState<AliasRow>();
  const turn = useRef(0);

  const load = async () => {
    const mine = (turn.current += 1);
    setLoading(true);
    const answer = await ism.call<Array<Omit<AliasRow, 'indexArray' | 'writeIndex'>>>('cat.aliases', {
      format: 'json',
      name: `*${query.search}*`,
      s: `${query.sortField}:${query.sortDirection}`,
      ...(query.status ? { expand_wildcards: query.status } : {}),
    });
    if (mine !== turn.current) return;
    if (answer.ok && answer.response) {
      const grouped = groupAliases(answer.response);
      setAll(grouped);
      setSelected((before) => before.flatMap((item) => grouped.filter((remote) => remote.alias === item.alias)));
    } else {
      toasts.danger(answer.error);
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.search, query.sortField, query.sortDirection, query.status]);

  const rows = all.slice(query.from * query.size, (query.from + 1) * query.size);
  const names = selected.map((item) => item.alias);
  const operands = selected.map((item) => ({ name: item.alias, indices: item.indexArray }));
  const none = selected.length === 0;
  const close = () => {
    setDialog(undefined);
    setEditing(undefined);
  };

  const columns: Array<TableColumn<AliasRow>> = [
    {
      field: 'alias',
      name: 'Alias name',
      sortable: true,
      render: (row) => (
        <button
          type="button"
          className="atlLinkButton ismCellLink"
          onClick={() => {
            setEditing(row);
            setDialog('edit');
          }}
          data-test-subj={`aliasDetail-${row.alias}`}
        >
          {row.alias}
        </button>
      ),
    },
    {
      field: 'writeIndex',
      name: 'Write index',
      render: (row): ReactNode =>
        row.writeIndex ? <a href={`#${ROUTES.INDEX_DETAIL}/${row.writeIndex}`}>{row.writeIndex}</a> : '-',
    },
    {
      field: 'indexArray',
      name: 'Index name',
      render: (row) => (
        <FewNames
          names={row.indexArray}
          title={
            <>
              Indices in {row.alias} ({row.indexArray.length})
            </>
          }
          hint={`Indices in ${row.alias} (${row.indexArray.length})`}
          column="Index"
          field="index"
          testId="indices-table"
        />
      ),
    },
  ];

  const items: MenuItem[] = [
    {
      id: 'edit',
      label: 'Edit',
      disabled: selected.length !== 1,
      testId: 'editAction',
      onClick: () => setDialog('edit'),
    },
    {
      id: 'forceMerge',
      label: 'Force merge',
      testId: 'ForceMergeAction',
      separated: true,
      onClick: () => go(`${ROUTES.FORCE_MERGE}/${names.join(',')}`),
    },
    {
      id: 'rollover',
      label: 'Roll over',
      disabled: selected.length > 1,
      testId: 'rolloverAction',
      onClick: () => go(none ? ROUTES.ROLLOVER : `${ROUTES.ROLLOVER}/${names[0]}`),
    },
    {
      id: 'clearCache',
      label: 'Clear cache',
      disabled: none,
      testId: 'ClearCacheAction',
      separated: true,
      onClick: () => setDialog('clearCache'),
    },
    { id: 'flush', label: 'Flush', disabled: none, testId: 'Flush Action', onClick: () => setDialog('flush') },
    { id: 'refresh', label: 'Refresh', disabled: none, testId: 'refreshAction', onClick: () => setDialog('refresh') },
    {
      id: 'delete',
      label: 'Delete',
      disabled: none,
      testId: 'deleteAction',
      separated: true,
      onClick: () => setDialog('delete'),
    },
  ];

  const filtered = query.search !== '' || query.status !== '';
  return (
    <ContentPanel
      bodyStyles={{ padding: 'initial' }}
      title={
        <>
          <h1 className="ismContentPanel__title">Aliases</h1>
          <TitleHelp half>
            An alias is a virtual index name that can point to one or more indexes. If your data is spread across
            multiple indexes, you can create and query an alias instead of keeping track of which indexes to query.{' '}
            <ExternalLink href={ALIAS_DOCS} />
          </TitleHelp>
        </>
      }
      actions={
        <ContentPanelActions
          actions={[
            { text: '', children: <ActionsMenu items={items} size="m" /> },
            {
              text: 'Create alias',
              buttonProps: { variant: 'primary', icon: 'plus', onClick: () => setDialog('create') },
            },
          ]}
        />
      }
    >
      <SearchRow
        className="ismIndexControls"
        clearable
        search={query.search}
        onSearch={(search) => setQuery({ search, from: 0 })}
        placeholder="Search..."
      >
        <div className="ismAliasStatus">
          <ComboBox
            compact
            fullWidth
            placeholder="Status"
            options={STATUS_OPTIONS.map((value) => ({ value, label: value }))}
            selected={query.status ? query.status.split(',') : []}
            onChange={(values) => setQuery({ status: values.join(','), from: 0 })}
          />
        </div>
      </SearchRow>
      <hr className="ismContentPanel__rule" />
      <div data-test-subj="aliases-table">
        <Table
          fixed
          caption
          columns={columns}
          rows={rows}
          total={all.length}
          query={pageQuery(query)}
          onQuery={(changes) => setQuery(pageChanges(changes, query.size))}
          rowId={(row) => row.alias}
          selected={selected}
          onSelect={setSelected}
          loading={loading}
          empty={
            <ListEmpty
              text={
                filtered
                  ? 'There are no aliases matching your applied filters. Reset your filters to view your aliases.'
                  : 'You have no aliases.'
              }
            >
              {filtered ? (
                <Button variant="primary" onClick={() => setQuery({ search: '', status: '' })}>
                  Reset filters
                </Button>
              ) : (
                <Button variant="primary" icon="plus" onClick={() => setDialog('create')}>
                  Create alias
                </Button>
              )}
            </ListEmpty>
          }
        />
      </div>
      {dialog === 'create' && (
        <CreateAlias
          onClose={close}
          onSuccess={() => {
            close();
            void load();
          }}
        />
      )}
      {dialog === 'edit' && (
        <CreateAlias
          alias={editing ?? selected[0]}
          onClose={close}
          onSuccess={() => {
            close();
            void load();
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteAliasModal
          aliases={selected}
          onClose={close}
          onDelete={() => {
            close();
            void load();
          }}
        />
      )}
      {dialog === 'clearCache' && <ClearCacheModal items={operands} target="aliases" onClose={close} />}
      {dialog === 'flush' && <FlushModal items={operands} target="aliases" onClose={close} />}
      {dialog === 'refresh' && <RefreshModal items={operands} target="aliases" onClose={close} />}
    </ContentPanel>
  );
}
