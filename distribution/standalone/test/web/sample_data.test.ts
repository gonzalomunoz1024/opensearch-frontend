/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SampleDataSetSummary } from '../../common/sample_data';
import {
  clearsDefaultIndex,
  dashboardPath,
  defaultIndexAfterInstall,
  installSampleDataSet,
  listSampleDataSets,
  previewImageOf,
  sortSampleDataSets,
  uninstallSampleDataSet,
  viewDataLinks,
  withStatus,
  type SampleDataClientDeps,
} from '../../web/apps/sample_data/model';

const IMAGES = '/plugins/home/assets/sample_data_resources';

function set(id: string, name: string, extra: Partial<SampleDataSetSummary> = {}): SampleDataSetSummary {
  return {
    id,
    name,
    description: `The ${name}`,
    previewImagePath: `${IMAGES}/${id}/dashboard.png`,
    darkPreviewImagePath: `${IMAGES}/${id}/dashboard_dark.png`,
    hasNewThemeImages: true,
    overviewDashboard: `${id}-dashboard`,
    appLinks: [],
    defaultIndex: `${id}-pattern`,
    dataIndices: [{ id }],
    status: 'not_installed',
    ...extra,
  };
}

const FLIGHTS = set('flights', 'Sample flight data');
const OTEL = set('otel', 'Sample Observability Logs, Traces, and Metrics', {
  previewImagePath: `${IMAGES}/otel/otel_traces.png`,
  darkPreviewImagePath: `${IMAGES}/otel/otel_traces_dark.png`,
  overviewDashboard: '',
  defaultIndex: '',
  appLinks: [
    { path: 'observability-traces#/traces', icon: 'apmTrace', label: 'View traces', newPath: 'observability-traces-nav#/traces', appendDatasourceToPath: true },
    { path: '/app/observability-traces#/services', icon: 'graphApp', label: 'View services' },
  ],
});

interface Recorded {
  requests: string[];
  settings: Array<[string, unknown]>;
  cleared: number;
  settingErrors: unknown[];
}

function fakeDeps(
  options: {
    userDefault?: string | null;
    fail?: string;
    failSetting?: boolean;
    list?: SampleDataSetSummary[];
  } = {}
): SampleDataClientDeps & { recorded: Recorded } {
  const recorded: Recorded = { requests: [], settings: [], cleared: 0, settingErrors: [] };
  const answer = async <T>(method: string, path: string): Promise<T> => {
    recorded.requests.push(`${method} ${path}`);
    if (options.fail === method) throw new Error('Unable to create sample data index');
    return (method === 'GET' ? options.list ?? [] : {}) as T;
  };
  let defaultIndex = options.userDefault ?? null;
  return {
    recorded,
    http: {
      get: <T>(path: string) => answer<T>('GET', path),
      post: <T>(path: string) => answer<T>('POST', path),
      delete: <T>(path: string) => answer<T>('DELETE', path),
    },
    uiSettings: {
      isDefault: (key: string) => key !== 'defaultIndex' || defaultIndex === null,
      get: <T>(key: string, fallback?: T) => (key === 'defaultIndex' && defaultIndex !== null ? (defaultIndex as T) : (fallback as T)),
      set: async (key: string, value: unknown) => {
        recorded.settings.push([key, value]);
        if (options.failSetting) throw new Error('Forbidden');
        if (key === 'defaultIndex') defaultIndex = value as string;
      },
      remove: async (key: string) => {
        recorded.settings.push([key, null]);
        if (options.failSetting) throw new Error('Forbidden');
        if (key === 'defaultIndex') defaultIndex = null;
      },
    },
    indexPatterns: {
      clear: () => {
        recorded.cleared += 1;
      },
    },
    onSettingError: (error: unknown) => recorded.settingErrors.push(error),
  };
}

// Lets the settings written without waiting settle
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the cards of the sample data page', () => {
  it('come in the order of their names, whatever their case', () => {
    const sets = [
      set('logs', 'Sample web logs'),
      set('otel', 'Sample Observability Logs, Traces, and Metrics'),
      set('flights', 'Sample flight data'),
      set('ecommerce', 'Sample eCommerce orders'),
    ];
    assert.deepEqual(
      sortSampleDataSets(sets).map((item) => item.id),
      ['ecommerce', 'flights', 'otel', 'logs']
    );
    // and the list given is left as it was
    assert.equal(sets[0].id, 'logs');
  });

  it('show the picture of the theme: the _new one, dark in the dark theme', () => {
    assert.equal(previewImageOf(FLIGHTS, false), `${IMAGES}/flights/dashboard_new.png`);
    assert.equal(previewImageOf(FLIGHTS, true), `${IMAGES}/flights/dashboard_dark_new.png`);
    assert.equal(previewImageOf(OTEL, true), `${IMAGES}/otel/otel_traces_dark_new.png`);
    // A set with no dark picture, or none for the newer themes, shows the one it has
    assert.equal(previewImageOf({ ...FLIGHTS, darkPreviewImagePath: '' }, true), `${IMAGES}/flights/dashboard_new.png`);
    assert.equal(previewImageOf({ ...FLIGHTS, hasNewThemeImages: false }, false), `${IMAGES}/flights/dashboard.png`);
  });

  it('change the status of one set only, in a new list', () => {
    const sets = [FLIGHTS, OTEL];
    const installed = withStatus(sets, 'otel', true);
    assert.deepEqual(installed.map((item) => item.status), ['not_installed', 'installed']);
    assert.equal(sets[1].status, 'not_installed');
    assert.deepEqual(withStatus(installed, 'otel', false).map((item) => item.status), ['not_installed', 'not_installed']);
  });
});

describe('View data', () => {
  it('opens the dashboard of the set', () => {
    assert.equal(dashboardPath('7adfa750-4c81-11e8-b3d7-01146121b73d'), '/app/dashboards#/view/7adfa750-4c81-11e8-b3d7-01146121b73d');
  });

  it('offers the dashboard, then the pages of other applications, under the base path', () => {
    const base = (path: string) => `/proxy${path}`;
    assert.deepEqual(viewDataLinks({ ...FLIGHTS, appLinks: OTEL.appLinks }, base), [
      { label: 'Dashboard', icon: 'dashboardApp', href: '/proxy/app/dashboards#/view/flights-dashboard' },
      // A path without a slash is relative to the page, as the original leaves it
      { label: 'View traces', icon: 'apmTrace', href: 'observability-traces#/traces' },
      { label: 'View services', icon: 'graphApp', href: '/proxy/app/observability-traces#/services' },
    ]);
    // A set without a dashboard offers its links alone
    assert.deepEqual(viewDataLinks(OTEL, base).map((link) => link.label), ['View traces', 'View services']);
  });
});

describe('the default index pattern', () => {
  it('becomes the set\'s own when none is chosen, and only then', () => {
    assert.equal(defaultIndexAfterInstall(FLIGHTS, true), 'flights-pattern');
    assert.equal(defaultIndexAfterInstall(FLIGHTS, false), undefined);
    // A set without an index pattern leaves the setting as it is
    assert.equal(defaultIndexAfterInstall(OTEL, true), undefined);
  });

  it('goes back to none when the set it came from is removed', () => {
    assert.equal(clearsDefaultIndex(FLIGHTS, false, 'flights-pattern'), true);
    assert.equal(clearsDefaultIndex(FLIGHTS, false, 'my-pattern'), false);
    assert.equal(clearsDefaultIndex(FLIGHTS, true, undefined), false);
    // The empty one the original writes for the OpenTelemetry set goes with it
    assert.equal(clearsDefaultIndex(OTEL, false, ''), true);
  });
});

describe('adding and removing a set', () => {
  it('asks the server for the list and sorts it', async () => {
    const deps = fakeDeps({ list: [set('logs', 'Sample web logs'), FLIGHTS] });
    const list = await listSampleDataSets(deps);
    assert.deepEqual(deps.recorded.requests, ['GET /api/sample_data']);
    assert.deepEqual(list.map((item) => item.id), ['flights', 'logs']);
  });

  it('adds a set and makes its index pattern the default one when none was chosen', async () => {
    const deps = fakeDeps();
    await installSampleDataSet(deps, FLIGHTS);
    await settle();
    assert.deepEqual(deps.recorded.requests, ['POST /api/sample_data/flights']);
    assert.deepEqual(deps.recorded.settings, [['defaultIndex', 'flights-pattern']]);
    assert.equal(deps.recorded.cleared, 1);
  });

  it('keeps a default index pattern someone chose', async () => {
    const deps = fakeDeps({ userDefault: 'my-pattern' });
    await installSampleDataSet(deps, FLIGHTS);
    await settle();
    assert.deepEqual(deps.recorded.settings, []);
    assert.equal(deps.recorded.cleared, 1);
  });

  it('writes no default for a set without an index pattern', async () => {
    const deps = fakeDeps();
    await installSampleDataSet(deps, OTEL);
    await settle();
    assert.deepEqual(deps.recorded.requests, ['POST /api/sample_data/otel']);
    assert.deepEqual(deps.recorded.settings, []);
  });

  it('fails with the server\'s error and changes no setting', async () => {
    const deps = fakeDeps({ fail: 'POST' });
    let failure: unknown;
    try {
      await installSampleDataSet(deps, FLIGHTS);
    } catch (error) {
      failure = error;
    }
    assert.match(String((failure as Error).message), /Unable to create sample data index/);
    assert.deepEqual(deps.recorded.settings, []);
    assert.equal(deps.recorded.cleared, 0);
  });

  it('counts a set added though its setting could not be written, and says so', async () => {
    const deps = fakeDeps({ failSetting: true });
    await installSampleDataSet(deps, FLIGHTS);
    await settle();
    assert.equal(deps.recorded.settingErrors.length, 1);
    assert.equal((deps.recorded.settingErrors[0] as Error).message, 'Forbidden');
  });

  it('removes a set and the default index pattern that was its own', async () => {
    const deps = fakeDeps({ userDefault: 'flights-pattern' });
    await uninstallSampleDataSet(deps, FLIGHTS);
    await settle();
    assert.deepEqual(deps.recorded.requests, ['DELETE /api/sample_data/flights']);
    assert.deepEqual(deps.recorded.settings, [['defaultIndex', null]]);
    assert.equal(deps.recorded.cleared, 1);
  });

  it('removes a set and keeps a default index pattern of another', async () => {
    const deps = fakeDeps({ userDefault: 'my-pattern' });
    await uninstallSampleDataSet(deps, FLIGHTS);
    await settle();
    assert.deepEqual(deps.recorded.settings, []);
  });

  it('changes nothing when the server cannot remove the set', async () => {
    const deps = fakeDeps({ userDefault: 'flights-pattern', fail: 'DELETE' });
    let failed = false;
    try {
      await uninstallSampleDataSet(deps, FLIGHTS);
    } catch {
      failed = true;
    }
    assert.ok(failed);
    assert.deepEqual(deps.recorded.settings, []);
    assert.equal(deps.recorded.cleared, 0);
  });
});
