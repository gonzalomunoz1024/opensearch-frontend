/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The data sources other than OpenSearch: static, graphite, quandl, worldbank and
 * worldbank_indicators. Names, arguments and help are OpenSearch Dashboards' own; the requests
 * go out with Node's own `fetch`.
 */

import { promises as dnsPromises } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Datasource } from '../classes';
import { formatGraphiteTime, formatUtcDay, formatYear, toTimestamp, yearTimestamp } from '../dates';
import { i18n } from '../i18n';
import type { Args, Point, Series, SeriesList, TlConfig } from '../types';
import { defaults, listOf } from '../util';

export const staticFn = new Datasource('static', {
  aliases: ['value'],
  args: [
    {
      name: 'value', // _test-data.users.*.data
      types: ['number', 'string'],
      help: i18n.translate('timeline.help.functions.static.args.valueHelpText', {
        defaultMessage:
          'The single value to to display, you can also pass several values and I will interpolate them evenly across your time range.',
      }),
    },
    {
      name: 'label',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.static.args.labelHelpText', {
        defaultMessage:
          'A quick way to set the label for the series. You could also use the .label() function',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.staticHelpText', {
    defaultMessage: 'Draws a single value across the chart',
  }),
  fn: function staticFn(args: Args, tlConfig: TlConfig) {
    let data: Point[];
    const target = tlConfig.getTargetSeries();
    if (typeof args.byName.value === 'string') {
      const points = args.byName.value.split(':');
      const begin = target[0][0];
      const end = target[target.length - 1][0];
      const step = (end - begin) / (points.length - 1);
      data = points.map(function (point, i): Point {
        return [begin + i * step, parseFloat(point)];
      });
    } else {
      data = target.map(function (bucket): Point {
        return [bucket[0], args.byName.value as number];
      });
    }

    return Promise.resolve({
      type: 'seriesList',
      list: [
        {
          data: data,
          type: 'series',
          label: args.byName.label == null ? String(args.byName.value) : args.byName.label,
          fit: args.byName.fit || 'average',
        },
      ],
    });
  },
});

// --- graphite -----------------------------------------------------------------------------------

/** Whether an address is in a range written as CIDR (`10.0.0.0/8`, `fd00::/8`) */
export function cidrContains(cidr: string, ip: string): boolean {
  if (typeof cidr !== 'string' || !cidr.match('/')) {
    throw new Error('Invalid CIDR address.');
  }
  const [network, prefix] = cidr.split('/');
  const family = isIP(network);
  if (!family || !/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) {
    throw new Error('Invalid CIDR address.');
  }
  const ipFamily = isIP(ip);
  if (ipFamily !== family) return false;
  const list = new BlockList();
  const type = family === 4 ? 'ipv4' : 'ipv6';
  list.addSubnet(network, Number(prefix), type);
  return list.check(ip, type);
}

/** What `server/series_functions/helpers/graphite_helper.js` does; its parts can be replaced */
export const graphiteHelper = {
  async getIpAddress(urlObject: URL): Promise<string | null> {
    const hostname = urlObject.hostname;
    try {
      const { address } = await dnsPromises.lookup(hostname);
      if (address) {
        return address;
      }
    } catch {
      // Fall through to bracketed-IPv6 handling below.
    }
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      return hostname.substr(1).slice(0, -1);
    }
    return null;
  },

  async isDeniedURL(configuredUrl: string, deniedIPs: string[]): Promise<boolean> {
    let configuredUrlObject;
    try {
      configuredUrlObject = new URL(configuredUrl);
    } catch {
      return true;
    }
    const ip = await graphiteHelper.getIpAddress(configuredUrlObject);
    if (!ip) {
      return true;
    }
    return deniedIPs.some((deniedIP) => cidrContains(deniedIP, ip));
  },

  async isValidConfig(deniedIPs: string[], allowedUrls: string[], configuredUrl: string) {
    if (deniedIPs.length === 0) {
      if (!allowedUrls.includes(configuredUrl)) return false;
    } else if (allowedUrls.length === 0) {
      if (await graphiteHelper.isDeniedURL(configuredUrl, deniedIPs)) return false;
    } else {
      if (
        (await graphiteHelper.isDeniedURL(configuredUrl, deniedIPs)) ||
        !allowedUrls.includes(configuredUrl)
      )
        return false;
    }
    return true;
  },
};

export const graphite = new Datasource('graphite', {
  args: [
    {
      name: 'metric', // _test-data.users.*.data
      types: ['string'],
      help: i18n.translate('timeline.help.functions.graphite.args.metricHelpText', {
        defaultMessage: 'Graphite metric to pull, e.g., {metricExample}',
        values: {
          metricExample: '_test-data.users.*.data',
        },
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.graphiteHelpText', {
    defaultMessage: `[experimental] Pull data from graphite. Configure your graphite server in OpenSearch Dashboards's Advanced Settings`,
  }),
  fn: async function graphite(args: Args, tlConfig: TlConfig) {
    const config = args.byName;

    const time = {
      min: formatGraphiteTime(tlConfig.time.from),
      max: formatGraphiteTime(tlConfig.time.to),
    };

    const allowedUrls = tlConfig.allowedGraphiteUrls;
    const blockedIPs = tlConfig.blockedGraphiteIPs;
    const configuredUrl = tlConfig.settings['timeline:graphite.url'] as string;
    if (allowedUrls.length === 0 && blockedIPs.length === 0) {
      throw new Error(
        i18n.translate('timeline.help.functions.missCheckGraphiteConfig', {
          defaultMessage:
            'Please configure on the opensearch_dashboards.yml file. You can always enable the default allowlist configuration.',
        })
      );
    }

    if (!(await graphiteHelper.isValidConfig(blockedIPs, allowedUrls, configuredUrl))) {
      throw new Error(
        i18n.translate('timeline.help.functions.invalidGraphiteConfig', {
          defaultMessage: `The Graphite URL provided by you is invalid. Please update your config from OpenSearch Dashboards' Advanced Settings.`,
        })
      );
    }

    const GRAPHITE_URL =
      tlConfig.settings['timeline:graphite.url'] +
      '/render/' +
      '?format=json' +
      '&from=' +
      time.min +
      '&until=' +
      time.max +
      '&target=' +
      config.metric;

    const resp = await fetch(GRAPHITE_URL, { redirect: 'error' });
    const body: unknown = await resp.json();
    const list = listOf(body).map(function (item): Series {
      const series = item as { target: string; datapoints: unknown };
      const data = listOf(series.datapoints).map(function (value): Point {
        const point = value as [number, number];
        return [point[1] * 1000, point[0]];
      });
      return {
        data: data,
        type: 'series',
        fit: 'nearest', // TODO make this customizable
        label: series.target,
      };
    });

    return {
      type: 'seriesList',
      list: list,
    };
  },
});

// --- quandl -------------------------------------------------------------------------------------

export const quandl = new Datasource('quandl', {
  dataSource: true,
  args: [
    {
      name: 'code',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.quandl.args.codeHelpText', {
        defaultMessage: 'The quandl code to plot. You can find these on quandl.com.',
      }),
    },
    {
      name: 'position',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.quandl.args.positionHelpText', {
        defaultMessage:
          'Some quandl sources return multiple series, which one should I use? 1 based index.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.quandlHelpText', {
    defaultMessage: `
    [experimental]
    Pull data from quandl.com using the quandl code. Set {quandlKeyField} to your free API key in OpenSearch Dashboards's
    Advanced Settings. The API has a really low rate limit without a key.`,
    values: {
      quandlKeyField: '"timeline:quandl.key"',
    },
  }),
  fn: function quandlFn(args: Args, tlConfig: TlConfig) {
    const intervalMap: Record<string, string> = {
      '1d': 'daily',
      '1w': 'weekly',
      '1M': 'monthly',
      '1y': 'annual',
    };

    const config = defaults(args.byName, {
      code: 'WIKI/AAPL',
      position: 1,
      interval: Object.prototype.hasOwnProperty.call(intervalMap, tlConfig.time.interval)
        ? intervalMap[tlConfig.time.interval]
        : undefined,
      apikey: tlConfig.settings['timeline:quandl.key'],
    });

    if (!config.interval) {
      throw new Error(
        i18n.translate('timeline.serverSideErrors.quandlFunction.unsupportedIntervalErrorMessage', {
          defaultMessage:
            'quandl() unsupported interval: {interval}. quandl() supports: {intervals}',
          values: {
            interval: tlConfig.time.interval,
            intervals: Object.keys(intervalMap).join(', '),
          },
        })
      );
    }

    const time = {
      min: formatUtcDay(tlConfig.time.from),
      max: formatUtcDay(tlConfig.time.to),
    };

    // POSITIONS
    // 1. open
    // 2. high
    // 3. low
    // 4. close
    // 5. volume

    const URL =
      'https://www.quandl.com/api/v1/datasets/' +
      config.code +
      '.json' +
      '?sort_order=asc' +
      '&trim_start=' +
      time.min +
      '&trim_end=' +
      time.max +
      '&collapse=' +
      config.interval +
      '&auth_token=' +
      config.apikey;

    return fetch(URL)
      .then(function (resp) {
        return resp.json() as Promise<{ data?: unknown[][]; name?: string }>;
      })
      .then(function (resp): SeriesList {
        const data = listOf(resp.data).map(function (value): Point {
          const bucket = value as unknown[];
          return [toTimestamp(bucket[0]), bucket[config.position as number] as number];
        });

        return {
          type: 'seriesList',
          list: [
            {
              data: data,
              type: 'series',
              fit: 'nearest',
              label: resp.name,
            },
          ],
        };
      });
  },
});

// --- worldbank ----------------------------------------------------------------------------------

interface WorldbankBucket {
  value: unknown;
  date: string;
  country: { value: string };
  indicator: { value: string };
}

export const worldbank = new Datasource('worldbank', {
  args: [
    {
      name: 'code', // countries/all/indicators/SP.POP.TOTL
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.worldbank.args.codeHelpText', {
        defaultMessage:
          'Worldbank API path. This is usually everything after the domain, before the querystring. E.g.: {apiPathExample}.',
        values: {
          apiPathExample: '/en/countries/ind;chn/indicators/DPANUSSPF',
        },
      }),
    },
  ],
  aliases: ['wb'],
  help: i18n.translate('timeline.help.functions.worldbankHelpText', {
    defaultMessage: `
    [experimental]
    Pull data from {worldbankUrl} using path to series.
    The worldbank provides mostly yearly data, and often has no data for the current year.
    Try {offsetQuery} if you get no data for recent time ranges.`,
    values: {
      worldbankUrl: 'https://api.worldbank.org/v2/',
      offsetQuery: 'offset=-1y',
    },
  }),
  fn: function worldbank(args: Args, tlConfig: TlConfig) {
    // http://api.worldbank.org/en/countries/ind;chn/indicators/DPANUSSPF?date=2000:2006&MRV=5

    const config = defaults(args.byName, {
      code: 'country/all/indicator/SP.POP.TOTL',
    });

    const time = {
      min: formatYear(tlConfig.time.from),
      max: formatYear(tlConfig.time.to),
    };

    const URL =
      'https://api.worldbank.org/v2/' +
      config.code +
      '?date=' +
      time.min +
      ':' +
      time.max +
      '&format=json' +
      '&per_page=1000';

    return fetch(URL)
      .then(function (resp) {
        return resp.json() as Promise<unknown[]>;
      })
      .then(function (resp): SeriesList {
        let hasData = false;

        const respSeries = resp[1] as WorldbankBucket[] | undefined;

        const deduped: Record<string, unknown> = {};
        let description: string | undefined;
        (listOf(respSeries) as WorldbankBucket[]).forEach(function (bucket) {
          if (bucket.value != null) hasData = true;
          description = bucket.country.value + ' ' + bucket.indicator.value;
          deduped[bucket.date] = bucket.value;
        });

        const data = Object.keys(deduped)
          .map(function (date): Point | undefined {
            const val = deduped[date];
            // Discard nulls
            if (val == null) return undefined;
            return [yearTimestamp(date), Number(val)];
          })
          .filter((point): point is Point => Boolean(point));

        if (!hasData) {
          throw new Error(
            i18n.translate('timeline.serverSideErrors.worldbankFunction.noDataErrorMessage', {
              defaultMessage: 'Worldbank request succeeded, but there was no data for {code}',
              values: {
                code: config.code,
              },
            })
          );
        }

        return {
          type: 'seriesList',
          list: [
            {
              data: data,
              type: 'series',
              label: description,
              _meta: {
                worldbank_request: URL,
              },
            },
          ],
        };
      });
  },
});

export const worldbankIndicators = new Datasource('worldbank_indicators', {
  args: [
    {
      name: 'country', // countries/all/indicators/SP.POP.TOTL
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.worldbankIndicators.args.countryHelpText', {
        defaultMessage: `Worldbank country identifier. Usually the country's 2 letter code`,
      }),
    },
    {
      name: 'indicator',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.worldbankIndicators.args.indicatorHelpText', {
        defaultMessage:
          `The indicator code to use. You'll have to look this up on {worldbankUrl}. ` +
          'Often pretty obtuse. E.g., {indicatorExample} is population',
        values: {
          worldbankUrl: 'data.worldbank.org',
          indicatorExample: 'SP.POP.TOTL',
        },
      }),
    },
  ],
  aliases: ['wbi'],
  help: i18n.translate('timeline.help.functions.worldbankIndicatorsHelpText', {
    defaultMessage: `
    [experimental]
    Pull data from {worldbankUrl} using the country name and indicator. The worldbank provides
    mostly yearly data, and often has no data for the current year. Try {offsetQuery} if you get no data for recent
    time ranges.`,
    values: {
      worldbankUrl: 'https://api.worldbank.org/v2/',
      offsetQuery: 'offset=-1y',
    },
  }),
  fn: function worldbankIndicators(args: Args, tlConfig: TlConfig) {
    const config = defaults(args.byName, {
      country: 'wld',
      indicator: 'SP.POP.TOTL',
    });

    const countries = (config.country as string).split(':');
    const seriesLists = countries.map(function (country) {
      const code = 'country/' + country + '/indicator/' + config.indicator;
      const wbArgs = [code] as unknown as Args;
      wbArgs.byName = { code: code };
      return worldbank.timelineFn(wbArgs, tlConfig) as Promise<SeriesList>;
    });

    return Promise.all(seriesLists).then(function (resolved): SeriesList {
      return {
        type: 'seriesList',
        list: resolved.map((seriesList) => seriesList.list[0]),
      };
    });
  },
});
