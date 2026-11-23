/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The fixtures and helpers of upstream's Timeline tests (`server/series_functions/fixtures` and
 * `helpers`): the five-series list, the tl_config, the OpenSearch answer and invoke_series_fn.
 */

import { getFunction } from '../../server/timeline';
import { cloneDeep, merge } from '../../server/timeline/util';
import { createTlConfig, getNamespacedSettings, indexArguments } from '../../server/timeline/lib';
import type {
  Args,
  Point,
  SearchResponse,
  SeriesList,
  TimelineFunctionLike,
  TlConfig,
} from '../../server/timeline/types';

/** `fixtures/bucket_list.js` */
export const BUCKETS = [
  Date.UTC(1980, 0, 1),
  Date.UTC(1981, 0, 1),
  Date.UTC(1982, 0, 1),
  Date.UTC(1983, 0, 1),
];

/** `helpers/get_series.js`; buckets that are not a list give no timestamps, as `_.map` does */
export function getSeries(name: string, buckets: unknown, points: unknown[]) {
  const times = Array.isArray(buckets) ? buckets.map((bucket) => Number(bucket)) : [];
  const length = Math.max(times.length, points.length);
  const data: unknown[][] = [];
  for (let i = 0; i < length; i += 1) data.push([times[i], points[i]]);
  return { data: data as Point[], type: 'series' as const, label: name };
}

/** `helpers/get_series_list.js` */
export function getSeriesList(list: unknown[], overrides?: object): SeriesList {
  return merge({ type: 'seriesList', list }, overrides) as unknown as SeriesList;
}

/** `helpers/get_single_series_list.js` */
export function getSingleSeriesList(name: string, data: Array<[number, number | null]>) {
  return getSeriesList([
    getSeries(
      name,
      data.map((point) => point[0]),
      data.map((point) => point[1])
    ),
  ]);
}

/** `fixtures/series_list.js` */
export function seriesListFixture(): SeriesList {
  return getSeriesList([
    getSeries('Negative', BUCKETS, [-51, 17, 82, 20]),
    getSeries('Nice', BUCKETS, [100, 50, 50, 20]),
    getSeries('All the same', BUCKETS, [1, 1, 1, 1]),
    getSeries('Decimals', BUCKETS, [3.1415926535, 2, 1.439, 0.3424235]),
    getSeries('PowerOfTen', BUCKETS, [10, 100, 10, 1]),
  ]);
}

function timeBuckets(values: Array<[number, number, number]>) {
  return {
    meta: { type: 'time_buckets' },
    buckets: values.map(([key, a, b]) => ({ key, MetricA: { value: a }, MetricB: { value: b } })),
  };
}

function fieldB(entries: Array<[string, Array<[number, number, number]>]>) {
  return {
    meta: { type: 'split' },
    buckets: entries.map(([key, values]) => ({ key, time_buckets: timeBuckets(values) })),
  };
}

/** `fixtures/opensearch_response.js` */
export function opensearchResponseFixture(): SearchResponse {
  return {
    _shards: { total: 1 },
    aggregations: {
      q: {
        meta: { type: 'split' },
        buckets: {
          QueryA: {
            FieldA: {
              meta: { type: 'split' },
              buckets: [
                {
                  key: 'ValueA',
                  FieldB: fieldB([
                    ['Value2A', [[1000, 264, 398], [2000, 264, 1124]]],
                    ['Value2B', [[1000, 699, 457], [2000, 110, 506]]],
                  ]),
                },
                {
                  key: 'ValueB',
                  FieldB: fieldB([
                    ['Value2B', [[1000, 152, 61], [2000, 518, 77]]],
                    ['Value2A', [[1000, 114, 23], [2000, 264, 45]]],
                  ]),
                },
              ],
            },
          },
          QueryB: {
            FieldA: {
              meta: { type: 'split' },
              buckets: [
                {
                  key: 'ValueA',
                  FieldB: fieldB([
                    ['Value2B', [[1000, 621, 12], [2000, 751, 12]]],
                    ['Value2A', [[1000, 110, 11], [2000, 648, 12]]],
                  ]),
                },
                {
                  key: 'ValueC',
                  FieldB: fieldB([
                    ['Value2C', [[1000, 755, 10], [2000, 713, 18]]],
                    ['Value2A', [[1000, 391, 4], [2000, 802, 4]]],
                  ]),
                },
              ],
            },
          },
        },
      },
    },
  } as unknown as SearchResponse;
}

/** `fixtures/tl_config.js` */
export function tlConfigFixture(): TlConfig {
  const tlConfig = createTlConfig({
    getFunction,
    search: async () => opensearchResponseFixture(),
    savedObjectsClient: { find: async () => ({ saved_objects: [] }) },
    opensearchShardTimeout: 30000,
    allowedGraphiteUrls: ['https://www.hostedgraphite.com/UID/ACCESS_KEY/graphite'],
    blockedGraphiteIPs: [],
  });

  tlConfig.time = {
    interval: '1y',
    from: Date.parse('1980-01-01T00:00:00Z'),
    to: Date.parse('1983-01-01T00:00:00Z'),
    timezone: 'Etc/UTC',
  };
  tlConfig.settings = getNamespacedSettings();
  // As upstream's fixture does; every test that needs these lists passes its own
  tlConfig.allowedGraphiteUrls = getNamespacedSettings() as unknown as string[];
  tlConfig.blockedGraphiteIPs = getNamespacedSettings() as unknown as string[];
  tlConfig.setTargetSeries();
  return tlConfig;
}

export interface Invoked {
  output: SeriesList;
  input: Args;
}

/** `helpers/invoke_series_fn.js` */
export async function invoke(
  fnDef: TimelineFunctionLike,
  args: unknown[],
  tlConfigOverrides?: object
): Promise<Invoked> {
  const tlConfig = merge(tlConfigFixture(), tlConfigOverrides) as TlConfig;
  const resolved = (await Promise.all(args)) as Args;
  resolved.byName = indexArguments(fnDef, resolved);
  const input = cloneDeep(resolved);
  const output = (await fnDef.originalFn(resolved, tlConfig)) as SeriesList;
  return { output, input };
}

/** `_.map(series.data, 1)` */
export function values(series: { data: Point[] }): unknown[] {
  return series.data.map((point) => point[1]);
}

/** Replaces the global fetch for the length of one test */
export function stubFetch(answer: (url: string) => Promise<unknown>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((url: string) => {
    calls.push(String(url));
    return answer(String(url));
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}
