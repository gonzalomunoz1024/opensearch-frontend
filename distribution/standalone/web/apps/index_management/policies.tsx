/* SPDX-License-Identifier: Apache-2.0 */

/*
 * State management policies: the list of them, the page that writes one as JSON, and the page
 * that shows one with its templates and states.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Button, CallOut, Spinner } from '../../components/basic';
import { TextField } from '../../components/form';
import { Modal, copyText } from '../../components/overlay';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import {
  ConfirmationModal,
  DeleteModal,
  JSONModal,
  LocalTable,
  PanelButton,
  Table,
  go,
  ism,
  renderTime,
  to,
  toasts,
  useListQuery,
  type TableColumn,
} from './common';
import {
  AceJsonEditor,
  DocsLink,
  FormButtons,
  ListEmptyPrompt,
  ListPanel,
  ListSearch,
  Radio,
  Rule,
  Spacer,
  TitledPanel,
  useDialogFocus,
  useListLoad,
} from './job_parts';
import { DEFAULT_POLICY_JSON, templatesOf, type IsmTemplate, type PolicyDocument } from './policy_model';
import { StatesPanel, VisualCreatePolicy } from './policy_visual';
import { CRUMBS, ROUTES } from './routes';

const DOCS = 'https://opensearch.org/docs/im-plugin/ism/index/';

/**
 * Asks whether a policy is to be written with forms or as JSON: the plugin's "Configuration method"
 * dialog, 600 px wide, each way in a panel of its own. Both panels are drawn alike, as the original
 * draws them: the plugin's rule that tints the chosen one (`.selected-radio-panel`) loses to the
 * panel's own in every theme, so only the radio says which way is chosen.
 */
export function EditorChoiceModal({
  isEdit = false,
  onClose,
  onContinue,
}: {
  isEdit?: boolean;
  onClose: () => void;
  onContinue: (visual: boolean) => void;
}) {
  const [visual, setVisual] = useState(true);
  const body = useDialogFocus<HTMLDivElement>();
  // As the plugin's, the two radios are no group: each is told what the other one says
  const choice = (chosen: boolean, id: string, label: string, help: string, testId: string) => (
    <div className="atlPanel">
      <Radio id={id} label={label} checked={visual === chosen} onChange={() => setVisual(chosen)} testId={testId} />
      <div className="ismChoice__help">{help}</div>
    </div>
  );
  return (
    <Modal
      title="Configuration method"
      titleSize="l"
      className="ismChoiceModal ismMasked"
      onClose={onClose}
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="createPolicyModalCancelButton">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onContinue(visual);
            }}
            testId="createPolicyModalContinueButton"
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="ismChoiceBody" ref={body}>
        <p>
          Choose how you would like to {isEdit ? 'modify' : 'define'} your policy, either using a visual editor or
          writing JSON.
        </p>
        <div className="ismChoices">
          {choice(
            true,
            'create-policy-visual',
            'Visual editor',
            `Use the visual editor to ${isEdit ? 'update' : 'create'} your policy${isEdit ? '' : ' using pre-defined options.'}`,
            'createPolicyModalVisualRadio'
          )}
          {choice(
            false,
            'create-policy-json',
            'JSON editor',
            `Use the JSON editor to ${isEdit ? 'update' : 'create or import'} your policy using JSON.`,
            'createPolicyModalJsonRadio'
          )}
        </div>
      </div>
    </Modal>
  );
}

const createPolicy = (visual: boolean) => go(ROUTES.CREATE_POLICY, visual ? { type: 'visual' } : {});
const editPolicy = (id: string, visual: boolean) => go(ROUTES.EDIT_POLICY, visual ? { id, type: 'visual' } : { id });

// --- The list ---------------------------------------------------------------------------------------------

const EMPTY = {
  filtered: 'There are no policies matching your applied filters. Reset your filters to view your policies.',
  none: 'There are no existing policies. Create a policy to apply to your indices.',
  loading: 'Loading policies...',
};

const COLUMNS: Array<TableColumn<PolicyDocument>> = [
  {
    field: 'id',
    name: 'Policy',
    sortable: true,
    render: (row) => (
      <div className="ismCell">
        <a href={`#${ROUTES.POLICY_DETAILS}?id=${encodeURIComponent(row.id)}`} data-test-subj={`policyLink_${row.id}`}>
          {row.id}
        </a>
      </div>
    ),
  },
  {
    field: 'policy.description',
    name: 'Description',
    sortable: true,
    render: (row) => <div className="ismCell">{row.policy.description}</div>,
  },
  {
    field: 'policy.last_updated_time',
    name: 'Last updated time',
    sortable: true,
    render: (row) => renderTime(row.policy.last_updated_time),
  },
];

/** What the list of policies says when it has no rows, and what it offers to do */
export function PolicyEmptyPrompt({
  loading,
  filtered,
  onReset,
  onCreate,
}: {
  loading: boolean;
  filtered: boolean;
  onReset: () => void;
  onCreate: () => void;
}) {
  return (
    <ListEmptyPrompt
      body={loading ? EMPTY.loading : filtered ? EMPTY.filtered : EMPTY.none}
      actions={
        loading ? null : filtered ? (
          <Button variant="primary" onClick={onReset} testId="policyEmptyPromptRestFilters">
            Reset Filters
          </Button>
        ) : (
          <Button variant="primary" icon="plus" onClick={onCreate}>
            Create policy
          </Button>
        )
      }
    />
  );
}

export function Policies() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDEX_POLICIES]);
  const [query, setQuery] = useListQuery({ sortField: 'id' });
  const [policies, setPolicies] = useState<PolicyDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PolicyDocument[]>([]);
  const [dialog, setDialog] = useState<'create' | 'edit' | 'delete'>();

  const load = async () => {
    setLoading(true);
    const answer = await ism.get<{ policies: PolicyDocument[]; totalPolicies: number }>('policies', {
      from: query.from,
      size: query.size,
      search: query.search,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
    });
    if (answer.ok && answer.response) {
      setPolicies(answer.response.policies);
      setTotal(answer.response.totalPolicies);
      setSelected([]);
    } else {
      toasts.danger(answer.error || 'There was a problem loading the policies');
    }
    setLoading(false);
  };
  const reload = useListLoad(load, [query.from, query.size, query.search, query.sortField, query.sortDirection]);

  const deletePolicies = async () => {
    const results = await Promise.all(
      selected.map(async ({ id }) => {
        const answer = await ism.delete(`policies/${encodeURIComponent(id)}`);
        if (answer.ok) toasts.success(`Deleted the policy: ${id}`);
        else toasts.danger(`Failed to delete the policy, ${answer.error}`);
        return answer.ok;
      })
    );
    if (results.every(Boolean)) reload();
  };

  const what = selected.length === 1 ? selected[0].id : `${selected.length} policies`;
  const filtered = query.search !== '';
  const close = () => setDialog(undefined);
  const pages = Math.ceil(total / query.size) || 1;

  return (
    <ListPanel
      title="State management policies"
      count={total}
      actions={
        <>
          <PanelButton text="Delete" size="m" disabled={selected.length === 0} onClick={() => setDialog('delete')} />
          <PanelButton text="Edit" size="m" disabled={selected.length !== 1} onClick={() => setDialog('edit')} />
          <PanelButton text="Create policy" size="m" onClick={() => setDialog('create')} />
        </>
      }
    >
      <ListSearch
        search={query.search}
        onSearch={(search) => setQuery({ search, from: 0 })}
        page={Math.floor(query.from / query.size)}
        pages={pages}
        onPage={(page) => setQuery({ from: page * query.size })}
        paginationTestId="policyControlsPagination"
      />
      <Rule />
      <div className="ismFixed">
        <Table
          columns={COLUMNS}
          rows={policies}
          total={total}
          query={query}
          onQuery={setQuery}
          rowId={(row) => row.id}
          selected={selected}
          onSelect={setSelected}
          loading={loading}
          empty={
            <PolicyEmptyPrompt
              loading={loading}
              filtered={filtered}
              onReset={() => setQuery({ search: '' })}
              onCreate={() => setDialog('create')}
            />
          }
        />
      </div>
      {dialog === 'create' && <EditorChoiceModal onClose={close} onContinue={createPolicy} />}
      {dialog === 'edit' && selected.length === 1 && (
        <EditorChoiceModal isEdit onClose={close} onContinue={(visual) => editPolicy(selected[0].id, visual)} />
      )}
      {dialog === 'delete' && (
        <ConfirmationModal
          title={`Delete ${what}`}
          bodyMessage={`Delete ${what} permanently? This action cannot be undone.`}
          actionMessage="Delete"
          onClose={close}
          onAction={deletePolicies}
        />
      )}
    </ListPanel>
  );
}

// --- A policy written as JSON ---------------------------------------------------------------------------------

function JsonCreatePolicy({ isEdit }: { isEdit: boolean }) {
  const { hashParams } = useLocation();
  const id = hashParams.id ?? '';
  useBreadcrumbs(
    isEdit
      ? [CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDEX_POLICIES, CRUMBS.EDIT_POLICY, { text: id }]
      : [CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDEX_POLICIES, CRUMBS.CREATE_POLICY]
  );
  const [policyId, setPolicyId] = useState('');
  const [policyIdError, setPolicyIdError] = useState('');
  const [json, setJson] = useState(isEdit ? '' : DEFAULT_POLICY_JSON);
  const [version, setVersion] = useState<{ seqNo: number; primaryTerm: number }>();
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    if (!id) {
      toasts.danger(`Invalid policy id: ${id}`);
      go(ROUTES.INDEX_POLICIES);
      return;
    }
    void ism.get<PolicyDocument>(`policies/${encodeURIComponent(id)}`).then((answer) => {
      if (answer.ok && answer.response) {
        setVersion({ seqNo: answer.response.seqNo, primaryTerm: answer.response.primaryTerm });
        setPolicyId(answer.response.id);
        setJson(JSON.stringify({ policy: answer.response.policy }, null, 4));
      } else {
        toasts.danger(`Could not load the policy: ${answer.error}`);
        go(ROUTES.INDEX_POLICIES);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  let jsonError = false;
  try {
    JSON.parse(json);
  } catch {
    jsonError = true;
  }

  const submit = async () => {
    setSubmitError('');
    setSubmitted(true);
    if (!policyId) {
      setPolicyIdError('Required');
      return;
    }
    let policy: unknown;
    try {
      policy = JSON.parse(json);
    } catch {
      toasts.danger('Invalid Policy JSON');
      return;
    }
    if (isEdit && !version) {
      toasts.danger('Could not update policy without seqNo and primaryTerm');
      return;
    }
    setSubmitting(true);
    const answer = await ism.put<{ _id: string }>(
      `policies/${encodeURIComponent(policyId)}`,
      policy,
      isEdit ? { seqNo: version?.seqNo, primaryTerm: version?.primaryTerm } : undefined
    );
    setSubmitting(false);
    if (answer.ok && answer.response) {
      toasts.success(`${isEdit ? 'Updated' : 'Created'} policy: ${answer.response._id}`);
      go(ROUTES.INDEX_POLICIES);
    } else {
      setSubmitError(answer.error ?? `There was a problem ${isEdit ? 'updating' : 'creating'} the policy`);
    }
  };

  return (
    <div className="ismPolicyEditor">
      <h1 className="atlTitleL">{`${isEdit ? 'Edit' : 'Create'} policy`}</h1>
      <Spacer />
      {isEdit && (
        <>
          <CallOut
            tone="accent"
            icon="help"
            title="Edits to the policy are not automatically applied to indices that are already being managed by this policy."
          >
            <p>
              This ensures that any update to a policy doesn't harm indices that are running under an older version of
              the policy. To carry over your edits to these indices, please use the "Change Policy" under "Managed
              Indices" to reapply the policy after submitting your edits. <DocsLink href={DOCS} />
            </p>
          </CallOut>
          <Spacer />
        </>
      )}
      <TitledPanel title="Name policy">
        <p className="ismSmallText">Policies let you automatically perform administrative operations on indices.</p>
        <Spacer size="s" />
        <div className="ismFormRow">
          <label className="ismFormRow__label" htmlFor="ismPolicyId">
            Policy ID
          </label>
          <TextField
            id="ismPolicyId"
            compact
            invalid={Boolean(policyIdError)}
            placeholder="example_policy"
            readOnly={isEdit}
            value={policyId}
            onChange={(next) => {
              setPolicyId(next);
              if (submitted) setPolicyIdError(next ? '' : 'Required');
            }}
          />
          {policyIdError && <span className="ismFormRow__error">{policyIdError}</span>}
          <span className="ismFormRow__help">Specify a unique ID that is easy to recognize and remember.</span>
        </div>
      </TitledPanel>
      <Spacer />
      <TitledPanel
        title="Define policy"
        actions={
          <>
            <Button icon="copyClipboard" onClick={() => copyText(json)}>
              Copy
            </Button>
            <Button
              icon="editorAlignLeft"
              disabled={jsonError}
              onClick={() => setJson(JSON.stringify(JSON.parse(json), null, 4))}
            >
              Auto indent
            </Button>
          </>
        }
      >
        <p className="ismSmallText">
          You can think of policies as state machines. "Actions" are the operations ISM performs when an index is in a
          certain state. "Transitions" define when to move from one state to another. <DocsLink href={DOCS} />
        </p>
        <Spacer size="m" />
        <AceJsonEditor value={json} onChange={setJson} height={500} />
      </TitledPanel>
      <Spacer />
      {submitError && (
        <CallOut tone="critical" icon="alert" title="Sorry, there was an error">
          <p>{submitError}</p>
        </CallOut>
      )}
      <Spacer />
      <FormButtons>
        <Button
          variant="empty"
          onClick={() => (isEdit ? window.history.back() : go(ROUTES.INDEX_POLICIES))}
          testId="createPolicyCancelButton"
        >
          Cancel
        </Button>
        <Button variant="primary" loading={submitting} onClick={submit} testId="createPolicyCreateButton">
          {isEdit ? 'Update' : 'Create'}
        </Button>
      </FormButtons>
    </div>
  );
}

/** The page that creates or edits a policy, with forms when the address asks for them */
export function CreatePolicy({ isEdit }: { isEdit: boolean }) {
  const { hashParams } = useLocation();
  return hashParams.type === 'visual' ? <VisualCreatePolicy isEdit={isEdit} /> : <JsonCreatePolicy isEdit={isEdit} />;
}

// --- One policy --------------------------------------------------------------------------------------------------

const TEMPLATE_COLUMNS: Array<TableColumn<IsmTemplate>> = [
  { field: 'index_patterns', name: 'Index patterns', render: (row) => (row.index_patterns ?? []).join(', ') },
  { field: 'priority', name: 'Priority', render: (row) => row.priority },
];

export function PolicyDetails() {
  const { hashParams } = useLocation();
  const id = hashParams.id ?? '';
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDEX_POLICIES, { text: id }]);
  const [document, setDocument] = useState<PolicyDocument>();
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'json' | 'notification'>();

  useEffect(() => {
    void ism.get<PolicyDocument>(`policies/${encodeURIComponent(id)}`).then((answer) => {
      if (answer.ok && answer.response?.policy) {
        setDocument(answer.response);
      } else {
        toasts.danger(`Could not load the policy: ${answer.ok ? 'Policy was empty' : answer.error}`);
        go(ROUTES.INDEX_POLICIES);
      }
    });
  }, [id]);

  if (!document) {
    return (
      <div className="ismLoadingCenter">
        <Spinner size="xl" />
      </div>
    );
  }

  const { policy } = document;
  const policyId = document.id;
  const templates = templatesOf(policy.ism_template);
  const close = () => setDialog(undefined);

  const remove = async () => {
    const answer = await ism.delete(`policies/${encodeURIComponent(policyId)}`);
    if (answer.ok) {
      close();
      toasts.success(`"Policy ${policyId}" successfully deleted`);
      go(ROUTES.INDEX_POLICIES);
    } else {
      toasts.danger(`Could not delete the policy "${policyId}" : ${answer.error}`);
    }
  };

  const settings: Array<[string, ReactNode]> = [
    ['Policy name', policyId],
    [
      'Error notification',
      policy.error_notification ? (
        <button type="button" className="atlLinkButton" onClick={() => setDialog('notification')}>
          View code
        </button>
      ) : (
        '-'
      ),
    ],
    ['Primary term', document.primaryTerm],
    ['Last updated', policy.last_updated_time ? new Date(policy.last_updated_time).toLocaleString() : '-'],
    ['Policy description', policy.description || '-'],
    ['Sequence number', document.seqNo],
  ];

  return (
    <div className="ismPolicyPage">
      <div className="ismDetailsHeader">
        <h1 className="atlTitleL">{policyId}</h1>
        <div className="ismDetailsHeader__actions">
          <Button onClick={() => setDialog('edit')} testId="policy-details-edit-button">
            Edit
          </Button>
          <Button variant="danger" onClick={() => setDialog('delete')} testId="deleteButton">
            Delete
          </Button>
          <Button onClick={() => setDialog('json')} testId="viewButton">
            View JSON
          </Button>
        </div>
      </div>
      <Spacer />
      <TitledPanel title="Policy settings">
        <div className="ismPolicySettings">
          {settings.map(([term, value]) => (
            <dl key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </dl>
          ))}
        </div>
      </TitledPanel>
      <Spacer />
      <TitledPanel title={`ISM Templates (${templates.length})`}>
        <div className="ismFixed">
          <LocalTable
            columns={TEMPLATE_COLUMNS}
            rows={templates}
            rowId={(_, index) => String(index)}
            empty="No items found"
          />
        </div>
      </TitledPanel>
      <Spacer />
      <StatesPanel policy={policy} readOnly />
      {dialog === 'edit' && (
        <EditorChoiceModal isEdit onClose={close} onContinue={(visual) => editPolicy(policyId, visual)} />
      )}
      {dialog === 'json' && <JSONModal title={`View JSON of ${policyId}`} json={document} onClose={close} />}
      {dialog === 'notification' && (
        <JSONModal title="Error notification" json={policy.error_notification} onClose={close} />
      )}
      {dialog === 'delete' && (
        <DeleteModal title="Delete policy" onClose={close} onDelete={remove}>
          Delete "<strong>{policyId}</strong>" permanently? Indices will no longer be managed using this policy.
        </DeleteModal>
      )}
    </div>
  );
}

/** The address of the page that shows a policy */
export const policyDetails = (id: string) => to(ROUTES.POLICY_DETAILS, { id });
