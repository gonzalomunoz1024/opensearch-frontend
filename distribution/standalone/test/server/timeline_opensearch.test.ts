/* SPDX-License-Identifier: Apache-2.0 */

// Upstream's `series_functions/opensearch/opensearch.test.js`.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  buildRequest,
  createDateAgg,
  opensearch,
  timeBucketsToPairs,
  toSeriesList,
  type OpenSearchFunctionConfig,
} from '../../server/timeline/series_functions/opensearch';
import type { TlConfig } from '../../server/timeline/types';
import { merge } from '../../server/timeline/util';
import { invoke, opensearchResponseFixture, tlConfigFixture } from './timeline_helpers';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function stubSearch(response: unknown, indexPatternSavedObjects: unknown[] = []) {
  return {
    search: async () => response,
    savedObjectsClient: {
      find: async () => ({ saved_objects: indexPatternSavedObjects }),
    },
  };
}

describe('opensearch', () => {
  describe('seriesList processor', () => {
    it('throws an error then the index is missing', async () => {
      await assert.rejects(invoke(opensearch, [5], stubSearch({ _shards: { total: 0 } })), {
        message: 'OpenSearch index not found: _all',
      });
    });

    it('returns a seriesList', async () => {
      const r = await invoke(opensearch, [5], stubSearch(opensearchResponseFixture()));
      assert.equal(r.output.type, 'seriesList');
    });

    it('sends the request of build_request, with the scripted fields of the index pattern', async () => {
      const sent: unknown[] = [];
      const pattern = {
        attributes: {
          title: 'beer',
          fields: JSON.stringify([
            { name: 'ibu', scripted: true, script: 'doc["ibu"].value', lang: 'painless' },
            { name: 'name', scripted: false },
          ]),
        },
      };
      const config = stubSearch(opensearchResponseFixture(), [pattern]);
      config.search = async (request?: unknown) => {
        sent.push(request);
        return opensearchResponseFixture();
      };
      const tlConfig = merge(tlConfigFixture(), config) as TlConfig;
      const args = Object.assign([], { byName: { index: 'beer', metric: ['avg:ibu'] } });
      await opensearch.originalFn(args, tlConfig);
      assert.equal(sent.length, 1);
      const request = sent[0] as Any;
      assert.equal(request.params.index, 'beer');
      assert.equal(request.params.timeout, '30000ms');
      assert.deepEqual(request.params.body.aggs.q.aggs.time_buckets.aggs['avg(ibu)'], {
        avg: { script: { source: 'doc["ibu"].value', lang: 'painless' } },
      });
    });
  });

  describe('createDateAgg', () => {
    let tlConfig: TlConfig;
    let config: OpenSearchFunctionConfig;
    let agg: Any;
    beforeEach(() => {
      tlConfig = tlConfigFixture();
      config = { timefield: '@timestamp', interval: '1y' } as OpenSearchFunctionConfig;
      agg = createDateAgg(config, tlConfig, []);
    });

    it('creates a date_histogram with meta.type of time_buckets', () => {
      assert.equal(agg.time_buckets.meta.type, 'time_buckets');
      assert.equal(typeof agg.time_buckets.date_histogram, 'object');
    });

    it('has extended_bounds that match tlConfig', () => {
      assert.equal(agg.time_buckets.date_histogram.extended_bounds.min, tlConfig.time.from);
      assert.equal(agg.time_buckets.date_histogram.extended_bounds.max, tlConfig.time.to);
    });

    it('sets the timezone', () => {
      assert.equal(agg.time_buckets.date_histogram.time_zone, 'Etc/UTC');
    });

    it('sets the field', () => {
      assert.equal(agg.time_buckets.date_histogram.field, '@timestamp');
    });

    it('sets the interval for calendar_interval correctly', () => {
      assert.equal(agg.time_buckets.date_histogram.calendar_interval, '1y');
    });

    it('sets the interval for fixed_interval correctly', () => {
      const fixed = createDateAgg(
        { timefield: '@timestamp', interval: '24h' } as OpenSearchFunctionConfig,
        tlConfig,
        []
      ) as Any;
      assert.equal(fixed.time_buckets.date_histogram.fixed_interval, '24h');
    });

    it('sets min_doc_count to 0', () => {
      assert.equal(agg.time_buckets.date_histogram.min_doc_count, 0);
    });

    describe('metric aggs', () => {
      it('adds a metric agg for each metric', () => {
        config.metric = ['sum:beer', 'avg:bytes', 'percentiles:bytes'];
        agg = createDateAgg(config, tlConfig, []);
        assert.deepEqual(agg.time_buckets.aggs['sum(beer)'], { sum: { field: 'beer' } });
        assert.deepEqual(agg.time_buckets.aggs['avg(bytes)'], { avg: { field: 'bytes' } });
        assert.deepEqual(agg.time_buckets.aggs['percentiles(bytes)'], {
          percentiles: { field: 'bytes' },
        });
      });

      it('adds a scripted metric agg for each scripted metric', () => {
        config.metric = ['avg:scriptedBytes'];
        const scriptedFields = [
          { name: 'scriptedBytes', script: 'doc["bytes"].value', lang: 'painless' },
        ];
        agg = createDateAgg(config, tlConfig, scriptedFields);
        assert.deepEqual(agg.time_buckets.aggs['avg(scriptedBytes)'], {
          avg: { script: { source: 'doc["bytes"].value', lang: 'painless' } },
        });
      });

      it('has a special `count` metric that uses a script', () => {
        config.metric = ['count'];
        agg = createDateAgg(config, tlConfig, []);
        assert.equal(typeof agg.time_buckets.aggs.count.bucket_script, 'object');
        assert.equal(agg.time_buckets.aggs.count.bucket_script.buckets_path, '_count');
      });
    });
  });

  describe('buildRequest', () => {
    let tlConfig: TlConfig;
    let config: OpenSearchFunctionConfig & Any;
    beforeEach(() => {
      tlConfig = tlConfigFixture();
      config = { timefield: '@timestamp', interval: '1y', index: 'beer' } as typeof config;
    });

    it('sets the index on the request', () => {
      assert.equal(buildRequest(config, tlConfig, []).params.index, 'beer');
    });

    it('always sets body.size to 0', () => {
      assert.equal((buildRequest(config, tlConfig, []).params.body as Any).size, 0);
    });

    it('creates a filters agg that contains each of the queries passed', () => {
      config.q = ['foo', 'bar'];
      const body = buildRequest(config, tlConfig, []).params.body as Any;
      assert.equal(body.aggs.q.meta.type, 'split');
      assert.equal(body.aggs.q.filters.filters.foo.query_string.query, 'foo');
      assert.equal(body.aggs.q.filters.filters.bar.query_string.query, 'bar');
    });

    it('sets the timeout on the request', () => {
      assert.equal(buildRequest(config, tlConfig, [], 30000).params.timeout, '30000ms');
    });

    it('sets no timeout if opensearch.shardTimeout is set to 0', () => {
      assert.equal('timeout' in buildRequest(config, tlConfig, [], 0).params, false);
    });

    it('sets ignore_throttled=true on the request', () => {
      tlConfig.settings['search:includeFrozen'] = false;
      assert.equal(buildRequest(config, tlConfig, []).params.ignore_throttled, true);
    });

    it('sets ignore_throttled=false when frozen indices are included', () => {
      tlConfig.settings['search:includeFrozen'] = true;
      assert.equal(buildRequest(config, tlConfig, []).params.ignore_throttled, false);
    });

    describe('query body', () => {
      beforeEach(() => {
        tlConfig = merge(tlConfigFixture(), {
          time: { from: 1, to: 5 },
          request: {
            body: {
              extended: {
                es: {
                  filter: {
                    bool: {
                      must: [{ query: { query_string: { query: 'foo' } } }],
                      must_not: [
                        { query: { query_string: { query: 'bar' } } },
                        { query: { query_string: { query: 'baz' } } },
                      ],
                    },
                  },
                },
              },
            },
          },
        }) as TlConfig;
      });

      const bool = () => (buildRequest(config, tlConfig, []).params.body as Any).query.bool;

      it('adds the contents of body.extended.es.filter to a filter clause of the bool', () => {
        config.opensearchDashboards = true;
        config.kibana = true;
        const filter = bool().filter.bool;
        assert.equal(filter.must.length, 1);
        assert.equal(filter.must_not.length, 2);
      });

      it('does not include filters if config.opensearchDashboards = false', () => {
        config.opensearchDashboards = false;
        config.kibana = true;
        assert.equal(bool().filter, undefined);
      });

      it('does not include filters if config.kibana = false', () => {
        config.opensearchDashboards = true;
        config.kibana = false;
        assert.equal(bool().filter, undefined);
      });

      it('does not include filters if both are false', () => {
        config.opensearchDashboards = false;
        config.kibana = false;
        assert.equal(bool().filter, undefined);
      });

      it('adds a time filter to the bool querys must clause', () => {
        assert.equal(bool().must.length, 1);
        assert.deepEqual(bool().must[0], {
          range: {
            '@timestamp': {
              format: 'strict_date_optional_time',
              gte: '1970-01-01T00:00:00.001Z',
              lte: '1970-01-01T00:00:00.005Z',
            },
          },
        });
        config.opensearchDashboards = true;
        assert.equal(bool().must.length, 1);
      });
    });

    describe('config.split', () => {
      it('adds terms aggs, in order, under the filters agg', () => {
        config.split = ['beer:5', 'wine:10'];
        const aggs = (buildRequest(config, tlConfig, []).params.body as Any).aggs.q.aggs;
        assert.equal(aggs.beer.meta.type, 'split');
        assert.equal(aggs.beer.terms.field, 'beer');
        assert.equal(aggs.beer.terms.size, 5);
        assert.equal(aggs.beer.aggs.wine.meta.type, 'split');
        assert.equal(aggs.beer.aggs.wine.terms.field, 'wine');
        assert.equal(aggs.beer.aggs.wine.terms.size, 10);
      });

      it('adds scripted terms aggs, in order, under the filters agg', () => {
        config.split = ['scriptedBeer:5', 'scriptedWine:10'];
        const scriptedFields = [
          { name: 'scriptedBeer', script: 'doc["beer"].value', lang: 'painless' },
          { name: 'scriptedWine', script: 'doc["wine"].value', lang: 'painless' },
        ];
        const body = buildRequest(config, tlConfig, scriptedFields).params.body as Any;
        const aggs = body.aggs.q.aggs;
        assert.equal(aggs.scriptedBeer.meta.type, 'split');
        assert.deepEqual(aggs.scriptedBeer.terms.script, {
          source: 'doc["beer"].value',
          lang: 'painless',
        });
        assert.equal(aggs.scriptedBeer.terms.size, 5);
        assert.equal(aggs.scriptedBeer.aggs.scriptedWine.meta.type, 'split');
        assert.deepEqual(aggs.scriptedBeer.aggs.scriptedWine.terms.script, {
          source: 'doc["wine"].value',
          lang: 'painless',
        });
        assert.equal(aggs.scriptedBeer.aggs.scriptedWine.terms.size, 10);
      });
    });
  });

  describe('Aggregation flattening', () => {
    describe('timeBucketsToPairs', () => {
      it('Should convert a single metric agg', () => {
        const buckets = [
          { key: 1000, count: { value: 3 } },
          { key: 2000, count: { value: 14 } },
          { key: 3000, count: { value: 15 } },
        ];
        assert.deepEqual(timeBucketsToPairs(buckets), {
          count: [
            [1000, 3],
            [2000, 14],
            [3000, 15],
          ],
        });
      });

      it('Should convert multiple metric aggs', () => {
        const buckets = [
          { key: 1000, count: { value: 3 }, max: { value: 92 } },
          { key: 2000, count: { value: 14 }, max: { value: 65 } },
          { key: 3000, count: { value: 15 }, max: { value: 35 } },
        ];
        assert.deepEqual(timeBucketsToPairs(buckets), {
          count: [
            [1000, 3],
            [2000, 14],
            [3000, 15],
          ],
          max: [
            [1000, 92],
            [2000, 65],
            [3000, 35],
          ],
        });
      });

      it('Should convert percentiles metric aggs', () => {
        const buckets = [
          {
            key: 1000,
            percentiles: { values: { '50.0': 'NaN', '75.0': 65, '95.0': 73, '99.0': 75 } },
          },
          {
            key: 2000,
            percentiles: { values: { '50.0': 25, '75.0': 32, '95.0': 'NaN', '99.0': 67 } },
          },
          {
            key: 3000,
            percentiles: { values: { '50.0': 15, '75.0': 15, '95.0': 15, '99.0': 15 } },
          },
        ];
        assert.deepEqual(timeBucketsToPairs(buckets), {
          'percentiles:50.0': [
            [1000, NaN],
            [2000, 25],
            [3000, 15],
          ],
          'percentiles:75.0': [
            [1000, 65],
            [2000, 32],
            [3000, 15],
          ],
          'percentiles:95.0': [
            [1000, 73],
            [2000, NaN],
            [3000, 15],
          ],
          'percentiles:99.0': [
            [1000, 75],
            [2000, 67],
            [3000, 15],
          ],
        });
      });
    });

    it('flattens the aggregations into a list of series', () => {
      const expected: Array<[string, string, number, number]> = [
        ['QueryA > FieldA:ValueA > FieldB:Value2A > MetricA', 'Value2A', 264, 264],
        ['QueryA > FieldA:ValueA > FieldB:Value2A > MetricB', 'Value2A', 398, 1124],
        ['QueryA > FieldA:ValueA > FieldB:Value2B > MetricA', 'Value2B', 699, 110],
        ['QueryA > FieldA:ValueA > FieldB:Value2B > MetricB', 'Value2B', 457, 506],
        ['QueryA > FieldA:ValueB > FieldB:Value2B > MetricA', 'Value2B', 152, 518],
        ['QueryA > FieldA:ValueB > FieldB:Value2B > MetricB', 'Value2B', 61, 77],
        ['QueryA > FieldA:ValueB > FieldB:Value2A > MetricA', 'Value2A', 114, 264],
        ['QueryA > FieldA:ValueB > FieldB:Value2A > MetricB', 'Value2A', 23, 45],
        ['QueryB > FieldA:ValueA > FieldB:Value2B > MetricA', 'Value2B', 621, 751],
        ['QueryB > FieldA:ValueA > FieldB:Value2B > MetricB', 'Value2B', 12, 12],
        ['QueryB > FieldA:ValueA > FieldB:Value2A > MetricA', 'Value2A', 110, 648],
        ['QueryB > FieldA:ValueA > FieldB:Value2A > MetricB', 'Value2A', 11, 12],
        ['QueryB > FieldA:ValueC > FieldB:Value2C > MetricA', 'Value2C', 755, 713],
        ['QueryB > FieldA:ValueC > FieldB:Value2C > MetricB', 'Value2C', 10, 18],
        ['QueryB > FieldA:ValueC > FieldB:Value2A > MetricA', 'Value2A', 391, 802],
        ['QueryB > FieldA:ValueC > FieldB:Value2A > MetricB', 'Value2A', 4, 4],
      ];
      assert.deepEqual(
        toSeriesList(opensearchResponseFixture().aggregations, { fit: 'nearest' }),
        expected.map(([label, split, a, b]) => ({
          data: [
            [1000, a],
            [2000, b],
          ],
          fit: 'nearest',
          label: `q:${label}`,
          split,
          type: 'series',
        }))
      );
    });
  });
});
