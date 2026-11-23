/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Snapshot policies: the list of them, and the page that shows one with what it last did.
 */

import { useEffect, useRef, useState } from 'react';
import { Accordion, Button, CodeBlock, Health } from '../../components/basic';
import { SearchField } from '../../components/form';
import { MenuButton } from '../../components/overlay';
import { navigateHash, useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import {
  ExternalLink,
  LocalTable,
  Table,
  go,
  ism,
  renderTime,
  toasts,
  type TableColumn,
} from './common';
import { InfoModal } from './indices';
import { CRUMBS, ROUTES } from './routes';
import {
  activityInfoWord,
  capitalize,
  humanCron,
  isOn,
  latestActivities,
  notifiedActivities,
  parseCron,
  policyListParams,
  policyListQuery,
  retainedCount,
  truncate,
  type Activity,
  type PolicyListQuery,
  type PolicyMetadata,
  type SMPolicy,
} from './snapshot_model';
import {
  DeletePolicyDialog,
  Facts,
  ListPanel,
  PolicyPanel,
  SNAPSHOT_DOCS,
} from './snapshot_parts';

const policyPath = (id: string) => `smPolicies/${encodeURIComponent(id)}`;

/** Starts a policy or stops it, and says how that went */
async function switchPolicy(policyId: string, on: boolean): Promise<void> {
  const answer = await ism.post(`${policyPath(policyId)}/${on ? '_start' : '_stop'}`);
  if (answer.ok) toasts.success(`"${policyId}" successfully ${on ? 'started' : 'stopped'}!`);
  else toasts.danger(`Could not ${on ? 'start' : 'stop'} policy "${policyId}" :  ${answer.error}`);
}

// --- The list ------------------------------------------------------------------------------------------------

const PAGE_SIZES = [5, 10, 20, 50];

export function SnapshotPolicies() {
  useBreadcrumbs([CRUMBS.SNAPSHOT_MANAGEMENT, CRUMBS.SNAPSHOT_POLICIES]);
  const { hashPath, hashParams } = useLocation();
  const key = JSON.stringify(hashParams);
  const query = policyListQuery(hashParams);
  const [policies, setPolicies] = useState<SMPolicy[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SMPolicy[]>([]);
  const [text, setText] = useState(query.queryString);
  const [deleting, setDeleting] = useState(false);
  const here = useRef(true);
  const latest = useRef(query);
  latest.current = query;

  const setQuery = (changes: Partial<PolicyListQuery>) =>
    navigateHash(hashPath, policyListParams({ ...latest.current, ...changes }), { replace: true });

  const load = async () => {
    setLoading(true);
    const answer = await ism.get<{ policies: Array<{ policy: SMPolicy }>; totalPolicies: number }>(
      'smPolicies',
      { ...latest.current }
    );
    if (!here.current) return;
    if (answer.ok && answer.response) {
      const found = answer.response.policies.map((item) => item.policy);
      setPolicies(found);
      setTotal(answer.response.totalPolicies);
      setSelected((before) => found.filter((row) => before.some((item) => item.name === row.name)));
    } else {
      toasts.danger(answer.error || 'There was a problem loading the snapshot policies.');
    }
    setLoading(false);
  };
  useEffect(() => {
    here.current = true;
    // The address tells what the list shows from the first look, and the list is read once it does
    if (Object.keys(hashParams).length === 0) setQuery({});
    else void load();
    return () => {
      here.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const turn = async (on: boolean) => {
    for (const policy of selected) await switchPolicy(policy.name ?? '', on);
    // The policies say what they are a moment after they were told
    window.setTimeout(() => {
      if (here.current) void load();
    }, 1000);
  };

  const remove = async () => {
    for (const policy of selected) {
      const policyId = policy.name ?? '';
      const answer = await ism.delete(policyPath(policyId));
      if (answer.ok) toasts.success(`"${policyId}" successfully deleted!`);
      else toasts.danger(`Could not delete policy "${policyId}" :  ${answer.error}`);
    }
    if (!here.current) return;
    setDeleting(false);
    await load();
  };

  const create = () => go(ROUTES.CREATE_SNAPSHOT_POLICY);
  const columns: Array<TableColumn<SMPolicy>> = [
    {
      field: 'name',
      name: 'Policy name',
      sortable: true,
      render: (row) => (
        <button
          type="button"
          className="atlLinkButton"
          onClick={() => go(ROUTES.SNAPSHOT_POLICY_DETAILS, { id: row.name })}
        >
          <span title={row.name}>{truncate(row.name, 60)}</span>
        </button>
      ),
    },
    {
      field: 'enabled',
      name: 'Status',
      sortable: true,
      width: '100px',
      render: (row) =>
        row.enabled ? (
          <Health tone="healthy">Enabled</Health>
        ) : (
          <Health tone="critical">Disabled</Health>
        ),
    },
    {
      field: 'snapshot_config.indices',
      name: 'Indices',
      render: (row) => (
        <span title={row.snapshot_config?.indices}>
          {truncate(row.snapshot_config?.indices, 60)}
        </span>
      ),
    },
    {
      field: 'creation.schedule.cron.expression',
      name: 'Snapshot schedule',
      width: '180px',
      render: (row) =>
        row.creation
          ? humanCron(
              row.creation.schedule?.cron?.expression,
              row.creation.schedule?.cron?.timezone ?? ''
            )
          : '-',
    },
    {
      field: 'last_updated_time',
      name: 'Time last updated',
      sortable: true,
      width: '150px',
      render: (row) => renderTime(row.last_updated_time),
    },
    {
      field: 'description',
      name: 'Description',
      width: '150px',
      render: (row) => <span title={row.description}>{truncate(row.description, 20)}</span>,
    },
  ];

  const none = selected.length === 0;
  return (
    <>
      <ListPanel
        title="Snapshot policies"
        description={
          <>
            Define an automated snapshot schedule and retention period with a snapshot policy.{' '}
            <ExternalLink href={SNAPSHOT_DOCS} />
          </>
        }
        actions={
          <>
            <Button icon="refresh" onClick={() => void load()} testId="refreshButton">
              Refresh
            </Button>
            <Button disabled={none} onClick={() => void turn(false)}>
              Disable
            </Button>
            <Button disabled={none} onClick={() => void turn(true)}>
              Enable
            </Button>
            <MenuButton
              align="left"
              button={(toggle) => (
                <Button
                  icon="chevronDown"
                  iconSide="right"
                  disabled={none}
                  onClick={toggle}
                  testId="actionButton"
                >
                  Actions
                </Button>
              )}
              items={[
                {
                  label: 'Edit',
                  disabled: selected.length !== 1,
                  testId: 'editButton',
                  onClick: () => go(ROUTES.EDIT_SNAPSHOT_POLICY, { id: selected[0]?.name }),
                },
                {
                  label: 'Delete',
                  disabled: none,
                  testId: 'deleteButton',
                  onClick: () => setDeleting(true),
                },
              ]}
            />
            <Button variant="primary" icon="plus" onClick={create}>
              Create policy
            </Button>
          </>
        }
      >
        <div className="ismSearchRow ismSearchRow--alone">
          <div className="atlGrow">
            <SearchField
              compact
              value={text}
              onChange={(value) => {
                setText(value);
                if (value === '' && query.queryString !== '')
                  setQuery({ queryString: '', from: 0 });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setQuery({ queryString: text, from: 0 });
              }}
              placeholder="Search snapshot policies"
              aria-label="Search snapshot policies"
            />
          </div>
        </div>
        <Table
          columns={columns}
          rows={policies}
          total={total}
          query={{
            from: query.from,
            size: query.size,
            sortField: query.sortField,
            sortDirection: query.sortOrder,
          }}
          onQuery={({ sortDirection, from, size, sortField }) =>
            setQuery({
              ...(from === undefined ? {} : { from }),
              ...(size === undefined ? {} : { size }),
              ...(sortField === undefined ? {} : { sortField }),
              ...(sortDirection === undefined ? {} : { sortOrder: sortDirection }),
            })
          }
          rowId={(row) => row.name ?? ''}
          selected={selected}
          onSelect={setSelected}
          loading={loading}
          pageSizes={PAGE_SIZES}
          empty={
            <div className="ismEmpty">
              <p>{loading ? 'Loading policies...' : 'There are no existing policies.'}</p>
              <Button variant="primary" size="s" icon="plus" onClick={create}>
                Create policy
              </Button>
            </div>
          }
        />
      </ListPanel>
      {deleting && (
        <DeletePolicyDialog
          policyIds={selected.map((policy) => policy.name).join(', ')}
          onCancel={() => setDeleting(false)}
          onDelete={() => void remove()}
        />
      )}
    </>
  );
}

// --- One policy ----------------------------------------------------------------------------------------------

interface PolicyDocument {
  id: string;
  seqNo?: number;
  primaryTerm?: number;
  policy?: SMPolicy;
  metadata?: PolicyMetadata | null;
}

interface ChannelConfig {
  config_id: string;
  config: { name?: string; config_type?: string };
}

export function SnapshotPolicyDetails() {
  const { hashParams } = useLocation();
  const id = hashParams.id ?? '';
  useBreadcrumbs([CRUMBS.SNAPSHOT_MANAGEMENT, CRUMBS.SNAPSHOT_POLICIES, { text: id }]);
  const [policy, setPolicy] = useState<SMPolicy>();
  const [metadata, setMetadata] = useState<PolicyMetadata | null>();
  const [channel, setChannel] = useState<ChannelConfig>();
  const [deleting, setDeleting] = useState(false);
  const [info, setInfo] = useState<{ shown: Activity['info'] }>();
  const here = useRef(true);

  const load = async (): Promise<SMPolicy | undefined> => {
    const answer = await ism.get<PolicyDocument | null>(policyPath(id));
    if (!here.current) return undefined;
    if (answer.ok && answer.response?.policy) {
      setPolicy(answer.response.policy);
      setMetadata(answer.response.metadata);
      return answer.response.policy;
    }
    const why = !answer.ok
      ? answer.error
      : answer.response
        ? 'Policy was empty'
        : "policy doesn't exist";
    toasts.danger(`Could not load the policy: ${why}`);
    go(ROUTES.SNAPSHOT_POLICIES);
    return undefined;
  };

  useEffect(() => {
    here.current = true;
    if (!id) {
      toasts.danger(`Invalid policy id: ${id}`);
      go(ROUTES.SNAPSHOT_POLICIES);
      return undefined;
    }
    void load().then(async (found) => {
      const channelId = found?.notification?.channel?.id;
      if (!channelId) return;
      const answer = await ism.get<{ config_list?: ChannelConfig[] }>(
        `_notifications/channels/${encodeURIComponent(channelId)}`
      );
      if (!here.current) return;
      if (answer.ok) {
        const configs = answer.response?.config_list ?? [];
        setChannel(configs.length === 1 ? configs[0] : undefined);
      } else {
        toasts.danger(`Could not load notification channel: ${answer.error}`);
      }
    });
    return () => {
      here.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!policy) {
    return (
      <div className="ismPage ismPage--loading">
        <span className="atlSpinner atlSpinner--xl" />
      </div>
    );
  }

  const remove = async () => {
    const answer = await ism.delete(policyPath(id));
    if (answer.ok) {
      setDeleting(false);
      toasts.success(`"Policy ${id}" successfully deleted`);
      go(ROUTES.SNAPSHOT_POLICIES);
    } else {
      toasts.danger(`Could not delete the policy "${id}" : ${answer.error}`);
    }
  };

  const creation = policy.creation?.schedule?.cron;
  const deletion = policy.deletion;
  const deletionCron = deletion?.schedule?.cron;
  const activityColumns: Array<TableColumn<Activity>> = [
    { field: 'activityType', name: 'Activity type', render: (row) => row.activityType },
    { field: 'status', name: 'Status', render: (row) => row.status },
    {
      field: 'start_time',
      name: 'Time started',
      sortable: true,
      render: (row) => renderTime(row.start_time),
    },
    {
      field: 'end_time',
      name: 'Time completed',
      sortable: true,
      render: (row) => renderTime(row.end_time),
    },
    {
      field: 'info',
      name: 'Info',
      render: (row) => (
        <button
          type="button"
          className="atlLinkButton"
          onClick={() => setInfo({ shown: row.info })}
        >
          {activityInfoWord(row.info)}
        </button>
      ),
    },
  ];

  return (
    <div className="ismSnapshotPolicyPage">
      <header className="ismSnapshotPolicyPage__header">
        <h1 className="atlTitleL">{truncate(id)}</h1>
        <div className="ismSnapshotPolicyPage__actions">
          <Button onClick={() => go(ROUTES.EDIT_SNAPSHOT_POLICY, { id })}>Edit</Button>
          <Button variant="danger" onClick={() => setDeleting(true)} testId="deleteButton">
            Delete
          </Button>
        </div>
      </header>

      <PolicyPanel title="Policy settings">
        <Facts
          items={[
            ['Policy name', <span title={id}>{truncate(id, 30)}</span>],
            ['Status', policy.enabled ? 'Enabled' : 'Disabled'],
            ['Last updated time', policy.last_updated_time],
            ['Indices', policy.snapshot_config?.indices],
            ['Repository', policy.snapshot_config?.repository],
            [
              'Description',
              <span title={policy.description}>{truncate(policy.description, 30)}</span>,
            ],
          ]}
        />
        <Accordion title="Advanced settings" initiallyOpen={false}>
          <Facts
            items={[
              [
                'Include cluster state',
                String(isOn(policy, 'snapshot_config.include_global_state')),
              ],
              [
                'Ignore unavailable indices',
                String(isOn(policy, 'snapshot_config.ignore_unavailable')),
              ],
              ['Allow partial snapshots', String(isOn(policy, 'snapshot_config.partial'))],
            ]}
          />
        </Accordion>
      </PolicyPanel>

      <PolicyPanel title="Snapshot schedule">
        <Facts
          items={[
            [
              'Frequency',
              policy.creation ? capitalize(parseCron(creation?.expression).frequencyType) : '-',
            ],
            [
              'Cron schedule',
              policy.creation ? humanCron(creation?.expression, creation?.timezone ?? '') : '-',
            ],
            ['Next snapshot time', renderTime(metadata?.creation?.trigger?.time)],
          ]}
        />
      </PolicyPanel>

      <PolicyPanel title="Snapshot retention period">
        {deletion ? (
          <Facts
            items={[
              ['Maximum age of snapshots', deletion.condition?.max_age ?? '-'],
              ['Minimum of snapshots retained', retainedCount(deletion.condition?.min_count)],
              ['Maximum of snapshots retained', retainedCount(deletion.condition?.max_count)],
            ]}
          />
        ) : (
          <Facts items={[['Retention period', 'Keep all snapshots']]} />
        )}
        {deletion && deletionCron?.expression != null && (
          <Facts
            items={[
              ['Frequency', capitalize(parseCron(deletionCron.expression).frequencyType)],
              ['Cron schedule', humanCron(deletionCron.expression, deletionCron.timezone ?? '-')],
              ['Next retention time', renderTime(metadata?.deletion?.trigger?.time)],
            ]}
          />
        )}
      </PolicyPanel>

      <PolicyPanel title="Notifications">
        <Facts
          columns={2}
          items={[
            ['Notify on snapshot activities', notifiedActivities(policy)],
            [
              'Channel',
              channel?.config.name ? (
                <a
                  href={`/app/notifications-dashboards#/channel-details/${channel.config_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {channel.config.name} ({channel.config.config_type})
                </a>
              ) : (
                <p>None</p>
              ),
            ],
          ]}
        />
      </PolicyPanel>

      <PolicyPanel
        title="Last creation/deletion"
        action={
          <Button icon="refresh" onClick={() => void load()} testId="refreshButton">
            Refresh
          </Button>
        }
      >
        <LocalTable
          columns={activityColumns}
          rows={latestActivities(metadata)}
          rowId={(row) => row.activityType ?? ''}
          paged={false}
        />
      </PolicyPanel>

      {deleting && (
        <DeletePolicyDialog
          policyIds={id}
          onCancel={() => setDeleting(false)}
          onDelete={() => void remove()}
        />
      )}
      {info && (
        <InfoModal title=" " onClose={() => setInfo(undefined)}>
          <CodeBlock>{JSON.stringify(info.shown, null, 4)}</CodeBlock>
        </InfoModal>
      )}
    </div>
  );
}
