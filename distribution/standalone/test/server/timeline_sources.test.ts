/* SPDX-License-Identifier: Apache-2.0 */

// Upstream's tests of graphite, graphite_helper and quandl, and tests of worldbank, with fetch stubbed.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  graphite,
  graphiteHelper,
  quandl,
  worldbank,
  worldbankIndicators,
} from '../../server/timeline/series_functions/sources';
import { formatGraphiteTime, formatYear, yearTimestamp } from '../../server/timeline/dates';
import { invoke, stubFetch } from './timeline_helpers';

const MISS_CHECKLIST_MESSAGE = `Please configure on the opensearch_dashboards.yml file. You can always enable the default allowlist configuration.`;
const INVALID_URL_MESSAGE = `The Graphite URL provided by you is invalid. Please update your config from OpenSearch Dashboards' Advanced Settings.`;
const HOSTED = 'https://www.hostedgraphite.com/UID/ACCESS_KEY/graphite';

// The tests run without a network: host names resolve as they would, IP addresses as themselves
const originalGetIpAddress = graphiteHelper.getIpAddress;
const HOSTS: Record<string, string> = {
  localhost: '127.0.0.1',
  'opensearch.org': '192.0.2.10',
  'www.opensearch.org': '192.0.2.11',
  'www.hostedgraphite.com': '192.0.2.12',
};

function withoutNetwork() {
  graphiteHelper.getIpAddress = async (url: URL) =>
    HOSTS[url.hostname] ?? originalGetIpAddress(url);
}

function restoreHelper() {
  graphiteHelper.getIpAddress = originalGetIpAddress;
}

describe('graphite', () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  beforeEach(() => {
    withoutNetwork();
    fetchStub = stubFetch(async (url) => {
      if (url.includes('redirect')) throw new Error('maximum redirect reached at: ' + url);
      return {
        json: async () => [
          {
            target: '__beer__',
            datapoints: [
              [3, 1000],
              [14, 2000],
              [1.5, 3000],
              [92.6535, 4000],
            ],
          },
        ],
      };
    });
  });
  afterEach(() => {
    fetchStub.restore();
    restoreHelper();
  });

  const lists = (allowed: string[], blocked: string[], url?: string) => ({
    ...(url === undefined ? {} : { settings: { 'timeline:graphite.url': url } }),
    allowedGraphiteUrls: allowed,
    blockedGraphiteIPs: blocked,
  });

  it('should wrap the graphite response up in a seriesList', async () => {
    const result = await invoke(graphite, [], lists([HOSTED], []));
    assert.equal(result.output.list[0].data[0][1], 3);
    assert.equal(result.output.list[0].data[1][1], 14);
  });

  it('should convert the seconds to milliseconds', async () => {
    const result = await invoke(graphite, [], lists([HOSTED], []));
    assert.equal(result.output.list[0].data[1][0], 2000 * 1000);
  });

  it('should set the label to that of the graphite target', async () => {
    const result = await invoke(graphite, [], lists([HOSTED], []));
    assert.equal(result.output.list[0].label, '__beer__');
  });

  it('asks the render API for the time span of the chart', async () => {
    await invoke(graphite, [], lists([HOSTED], []));
    assert.deepEqual(fetchStub.calls, [
      `${HOSTED}/render/?format=json&from=${formatGraphiteTime(Date.UTC(1980, 0, 1))}` +
        `&until=${formatGraphiteTime(Date.UTC(1983, 0, 1))}&target=undefined`,
    ]);
  });

  it('should return error message if both allowlist and blockedlist are disabled', async () => {
    await assert.rejects(invoke(graphite, [], lists([], [], 'http://127.0.0.1')), {
      message: MISS_CHECKLIST_MESSAGE,
    });
  });

  it('setting with matched allowlist url should return result', async () => {
    const result = await invoke(graphite, [], lists([HOSTED], [], HOSTED));
    assert.equal(result.output.list.length, 1);
  });

  it('setting with unmatched allowlist url should return error message', async () => {
    await assert.rejects(invoke(graphite, [], lists([HOSTED], [], 'http://127.0.0.1')), {
      message: INVALID_URL_MESSAGE,
    });
  });

  it('setting with matched denylist url should return error message', async () => {
    await assert.rejects(invoke(graphite, [], lists([], ['127.0.0.0/8'], 'http://127.0.0.1')), {
      message: INVALID_URL_MESSAGE,
    });
  });

  it('setting with matched denylist localhost should return error message', async () => {
    await assert.rejects(invoke(graphite, [], lists([], ['127.0.0.0/8'], 'http://localhost')), {
      message: INVALID_URL_MESSAGE,
    });
  });

  it('setting with unmatched denylist https url should return result', async () => {
    const r = await invoke(graphite, [], lists([], ['127.0.0.0/8'], 'https://opensearch.org/'));
    assert.equal(r.output.list.length, 1);
  });

  it('setting with unmatched denylist ftp url should return result', async () => {
    const r = await invoke(graphite, [], lists([], ['127.0.0.0/8'], 'ftp://www.opensearch.org'));
    assert.equal(r.output.list.length, 1);
  });

  it('setting with invalid url should return error message', async () => {
    await assert.rejects(invoke(graphite, [], lists([], ['127.0.0.0/8'], 'www.opensearch.org')), {
      message: INVALID_URL_MESSAGE,
    });
  });

  it('setting with redirection error message', async () => {
    const url = 'https://opensearch.org/redirect';
    await assert.rejects(invoke(graphite, [], lists([], ['127.0.0.0/8'], url)), (e: Error) => {
      assert.match(e.message, /maximum redirect reached/);
      return true;
    });
  });

  it('with both lists, a url not in the denylist but in the allowlist should return result', async () => {
    const r = await invoke(graphite, [], lists([HOSTED], ['127.0.0.0/8'], HOSTED));
    assert.equal(r.output.list.length, 1);
  });

  it('with conflicting lists, a url in both should return error message', async () => {
    const url = 'http://127.0.0.1';
    await assert.rejects(invoke(graphite, [], lists([url], ['127.0.0.0/8'], url)), {
      message: INVALID_URL_MESSAGE,
    });
  });
});

describe('graphite_helper', () => {
  beforeEach(withoutNetwork);
  afterEach(restoreHelper);

  const denied: Array<[string, string, string[], boolean]> = [
    ['valid Url should not be blocked', 'https://opensearch.org', ['127.0.0.0/8'], false],
    ['blocked Url should be blocked', 'https://127.0.0.1', ['127.0.0.0/8'], true],
    ['invalid Url should be blocked', 'www.opensearch.org', ['127.0.0.0/8'], true],
    ['should block IPv6 localhost addresses', 'http://[::1]', ['::1/128'], true],
    ['should block IPv6 addresses in denied CIDR range', 'http://[2001:db8::1]', ['2001:db8::/32'], true],
    ['should not block IPv6 addresses outside it', 'http://[2001:db9::1]', ['2001:db8::/32'], false],
    ['should block 10.0.0.0/8', 'http://10.0.0.1', ['10.0.0.0/8'], true],
    ['should block 172.16.0.0/12', 'http://172.16.0.1', ['172.16.0.0/12'], true],
    ['should block 192.168.0.0/16', 'http://192.168.1.1', ['192.168.0.0/16'], true],
    [
      'should handle multiple denied IP ranges and block if any match',
      'http://192.168.1.1',
      ['127.0.0.0/8', '10.0.0.0/8', '192.168.0.0/16'],
      true,
    ],
    [
      'should handle multiple denied IP ranges and allow if none match',
      'https://opensearch.org',
      ['127.0.0.0/8', '10.0.0.0/8', '192.168.0.0/16'],
      false,
    ],
    ['should block link-local IPv4 addresses', 'http://169.254.1.1', ['169.254.0.0/16'], true],
    ['should block a single IP address using /32', 'http://203.0.113.1', ['203.0.113.1/32'], true],
    ['should not block an address outside a /32', 'http://203.0.113.2', ['203.0.113.1/32'], false],
    [
      'should handle mixed IPv4 and IPv6 denied ranges',
      'http://[::1]',
      ['127.0.0.0/8', '::1/128', '10.0.0.0/8'],
      true,
    ],
  ];
  for (const [name, url, ips, expected] of denied) {
    it(`isDeniedURL: ${name}`, async () => {
      assert.equal(await graphiteHelper.isDeniedURL(url, ips), expected);
    });
  }

  it('resolves names it is given, and bracketed IPv6 addresses', async () => {
    restoreHelper();
    assert.equal(await graphiteHelper.getIpAddress(new URL('http://127.0.0.1')), '127.0.0.1');
    assert.equal(await graphiteHelper.getIpAddress(new URL('http://[::1]')), '::1');
  });

  describe('isValidConfig', () => {
    const original = graphiteHelper.isDeniedURL;
    afterEach(() => {
      graphiteHelper.isDeniedURL = original;
    });

    function spyOnDenied() {
      const calls: unknown[][] = [];
      graphiteHelper.isDeniedURL = async (...args: [string, string[]]) => {
        calls.push(args);
        return false;
      };
      return calls;
    }

    it('denylist should be checked if denylist is enabled', async () => {
      const calls = spyOnDenied();
      await graphiteHelper.isValidConfig(['127.0.0.0/8'], [], 'https://opensearch.org');
      assert.equal(calls.length, 1);
    });

    it('denylist should be checked it both allowlist and denylist are enabled', async () => {
      const calls = spyOnDenied();
      await graphiteHelper.isValidConfig(['127.0.0.0/8'], [HOSTED], 'https://opensearch.org');
      assert.equal(calls.length, 1);
    });

    const cases: Array<[string, string[], string[], string, boolean]> = [
      ['only allowlist, Url not in it', [], [HOSTED], 'https://opensearch.org', false],
      ['only allowlist, Url in it', [], [HOSTED], HOSTED, true],
      ['only denylist, Url in it', ['127.0.0.0/8'], [], 'https://127.0.0.1', false],
      ['only denylist, Url not in it', ['127.0.0.0/8'], [], 'https://opensearch.org', true],
      ['both, allowlist check fails', ['127.0.0.0/8'], [HOSTED], 'https://opensearch.org', false],
      ['both, denylist check fails', ['127.0.0.0/8'], [HOSTED], 'https://127.0.0.1', false],
      [
        'conflicting lists, denylist check fails',
        ['127.0.0.0/8'],
        ['https://127.0.0.1'],
        'https://127.0.0.1',
        false,
      ],
    ];
    for (const [name, deniedIPs, allowedUrls, url, expected] of cases) {
      it(name, async () => {
        assert.equal(await graphiteHelper.isValidConfig(deniedIPs, allowedUrls, url), expected);
      });
    }
  });
});

describe('quandl', () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  beforeEach(() => {
    fetchStub = stubFetch(async () => ({
      json: async () => ({
        name: '__beer__',
        data: [
          ['2015-01-01', 3],
          ['2015-01-02', 14],
          ['2015-01-03', 15.92],
          ['2015-01-04', 65.35],
        ],
      }),
    }));
  });
  afterEach(() => fetchStub.restore());

  const params = () => new URL(fetchStub.calls[0]).searchParams;

  it('should wrap the quandl response up in a seriesList', async () => {
    const result = await invoke(quandl, []);
    assert.equal(result.output.list[0].data[0][1], 3);
    assert.equal(result.output.list[0].data[1][1], 14);
  });

  it('should set the label to that of the quandl name', async () => {
    const result = await invoke(quandl, []);
    assert.equal(result.output.list[0].label, '__beer__');
  });

  it('should call the quandl API with the quandl code that has been passed', async () => {
    await invoke(quandl, ['BEER/IS_GOOD']);
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].match(/datasets\/(.*).json/)?.[1], 'BEER/IS_GOOD');
  });

  it('should limit the time span and interval to the stuff attached to tlConfig', async () => {
    await invoke(quandl, []);
    assert.equal(params().get('trim_start'), '1980-01-01');
    assert.equal(params().get('trim_end'), '1983-01-01');
    assert.equal(params().get('collapse'), 'annual');
  });

  it('should throw an error is passed an unsupported interval', async () => {
    await assert.rejects(invoke(quandl, [], { time: { interval: '2d' } }), {
      message: 'quandl() unsupported interval: 2d. quandl() supports: 1d, 1w, 1M, 1y',
    });
  });

  it('should use the configured API key when talking to quandl', async () => {
    await invoke(quandl, [], { settings: { 'timeline:quandl.key': 'bEeR' } });
    assert.equal(params().get('auth_token'), 'bEeR');
  });
});

describe('worldbank', () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  let answer: unknown;
  beforeEach(() => {
    answer = [
      { page: 1 },
      [
        { date: '1982', value: '30', country: { value: 'World' }, indicator: { value: 'Pop' } },
        { date: '1981', value: null, country: { value: 'World' }, indicator: { value: 'Pop' } },
        { date: '1980', value: '10', country: { value: 'World' }, indicator: { value: 'Pop' } },
      ],
    ];
    fetchStub = stubFetch(async () => ({ json: async () => answer }));
  });
  afterEach(() => fetchStub.restore());

  it('asks for the years of the time span and drops the years without a value', async () => {
    const result = await invoke(worldbank, []);
    const url =
      'https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL' +
      `?date=${formatYear(Date.UTC(1980, 0, 1))}:${formatYear(Date.UTC(1983, 0, 1))}` +
      '&format=json&per_page=1000';
    assert.deepEqual(fetchStub.calls, [url]);
    assert.deepEqual(result.output.list, [
      {
        data: [
          [yearTimestamp('1980'), 10],
          [yearTimestamp('1982'), 30],
        ],
        type: 'series',
        label: 'World Pop',
        fit: 'nearest',
        _meta: { worldbank_request: url },
      },
    ]);
  });

  it('throws when the answer has no value', async () => {
    answer = [{ page: 1 }, []];
    await assert.rejects(invoke(worldbank, ['beer']), {
      message: 'Worldbank request succeeded, but there was no data for beer',
    });
  });

  it('worldbank_indicators asks worldbank for a country and an indicator', async () => {
    await invoke(worldbankIndicators, ['fr', 'NY.GDP.MKTP.CD']);
    assert.match(fetchStub.calls[0], /\/v2\/country\/fr\/indicator\/NY\.GDP\.MKTP\.CD\?date=/);
  });
});
