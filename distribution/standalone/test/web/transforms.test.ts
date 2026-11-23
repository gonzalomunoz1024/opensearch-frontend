/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldItem } from '../../web/apps/index_management/rollup_model';
import {
  FILTER_INVALID,
  dateHistogramItem,
  editedTransform,
  emptyTransformDraft,
  histogramItem,
  isGroupBy,
  isValidPercent,
  metricItem,
  optionsOf,
  percentilesItem,
  previewCell,
  previewColumns,
  quoteTransformId,
  removeItem,
  renameError,
  renameItem,
  reviewItems,
  sampleCell,
  scriptedMetricItem,
  settingsItems,
  termsItem,
  transformBody,
  transformEditOf,
  transformStatus,
  transformTime,
  withAggregations,
  withContinuous,
  withDescription,
  withFilter,
  withGroups,
  withPageSize,
  withSourceIndex,
  withTargetIndex,
  withoutDefinitions,
  type Transform,
} from '../../web/apps/index_management/transform_model';

const NOW = 1795366986;
// A moment of the machine's own day, so that the expected text does not depend on where the tests run
const MORNING = new Date(2026, 10, 22, 9, 5).getTime();
const EVENING = new Date(2026, 10, 22, 17, 30).getTime();

describe('what a field of a transform job can become', () => {
  it('offers every option for a number, a few for a date and for the rest, and none for text', () => {
    const numeric = ['histogram', 'terms', 'sum', 'max', 'min', 'avg', 'count', 'percentile', 'scripted'];
    assert.deepEqual(optionsOf('long'), numeric);
    assert.deepEqual(optionsOf('scaled_float'), numeric);
    assert.deepEqual(optionsOf('date'), ['date_histogram', 'terms', 'max', 'min', 'count']);
    assert.deepEqual(optionsOf('keyword'), ['terms', 'count']);
    assert.deepEqual(optionsOf('boolean'), ['terms', 'count']);
    assert.deepEqual(optionsOf(undefined), ['terms', 'count']);
    assert.deepEqual(optionsOf('text'), []);
  });

  it('tells a group from an aggregation', () => {
    assert.equal(isGroupBy('terms'), true);
    assert.equal(isGroupBy('histogram'), true);
    assert.equal(isGroupBy('date_histogram'), true);
    assert.equal(isGroupBy('value_count'), false);
    assert.equal(isGroupBy('percentiles'), false);
  });

  it('names a group by terms after its field', () => {
    assert.deepEqual(termsItem('category.keyword'), {
      type: 'terms',
      name: 'category.keyword_terms',
      item: { terms: { source_field: 'category.keyword', target_field: 'category.keyword_terms' } },
    });
  });

  it('names a histogram with the space the plugin puts in it', () => {
    assert.deepEqual(histogramItem('taxful_total_price', 5), {
      type: 'histogram',
      name: 'taxful_total_price _histogram_5',
      item: {
        histogram: { source_field: 'taxful_total_price', target_field: 'taxful_total_price _histogram_5', interval: 5 },
      },
    });
  });

  it('writes a date histogram with a calendar or a fixed interval', () => {
    assert.deepEqual(dateHistogramItem('order_date', 1, 'm', 'calendar'), {
      type: 'date_histogram',
      name: 'order_date _date_histogram_1_m_calendar',
      item: {
        date_histogram: {
          source_field: 'order_date',
          target_field: 'order_date _date_histogram_1_m_calendar',
          calendar_interval: '1m',
        },
      },
    });
    const fixed = dateHistogramItem('order_date', 30, 's', 'fixed');
    assert.equal(fixed.name, 'order_date _date_histogram_30_s_fixed');
    assert.deepEqual(fixed.item, {
      date_histogram: {
        source_field: 'order_date',
        target_field: 'order_date _date_histogram_30_s_fixed',
        fixed_interval: '30s',
      },
    });
  });

  it('names a metric after what it computes; a count is a value_count', () => {
    assert.deepEqual(metricItem('sum', 'price'), { type: 'sum', name: 'sum_price', item: { sum: { field: 'price' } } });
    assert.deepEqual(metricItem('value_count', 'category.keyword'), {
      type: 'value_count',
      name: 'count_category.keyword',
      item: { value_count: { field: 'category.keyword' } },
    });
  });

  it('takes percents between 0 and 100 and writes them as numbers', () => {
    assert.equal(isValidPercent('0'), true);
    assert.equal(isValidPercent('99.9'), true);
    assert.equal(isValidPercent('100'), true);
    assert.equal(isValidPercent('101'), false);
    assert.equal(isValidPercent('-1'), false);
    assert.equal(isValidPercent('abc'), false);
    assert.deepEqual(percentilesItem('price', ['25', '75']), {
      type: 'percentiles',
      name: 'percentiles_price',
      item: { percentiles: { field: 'price', percents: [25, 75] } },
    });
  });

  it('reads a scripted metric as JSON and refuses what is not', () => {
    assert.deepEqual(scriptedMetricItem('price', '{"init_script":"state.n = 0"}'), {
      type: 'scripted_metric',
      name: 'scripted_metric_price',
      item: { scripted_metric: { init_script: 'state.n = 0' } },
    });
    assert.throws(() => scriptedMetricItem('price', 'state.n = 0'));
  });
});

describe('the columns of a transform job', () => {
  const list = [termsItem('category.keyword'), metricItem('value_count', 'category.keyword')];

  it('refuses a name another column has, in the words of the plugin', () => {
    assert.equal(
      renameError(list, 'category.keyword_terms', 'count_category.keyword'),
      'Transformation with name "count_category.keyword"  already exists'
    );
    assert.equal(renameError(list, 'category.keyword_terms', 'category.keyword_terms'), '');
    assert.equal(renameError(list, 'category.keyword_terms', 'cat'), '');
  });

  it('renames a group and the field it writes to, and leaves the list it was given alone', () => {
    const renamed = renameItem(list, 'category.keyword_terms', 'cat');
    assert.deepEqual(renamed[0], {
      type: 'terms',
      name: 'cat',
      item: { terms: { source_field: 'category.keyword', target_field: 'cat' } },
    });
    assert.equal(renamed[1], list[1]);
    assert.equal(list[0].name, 'category.keyword_terms');
  });

  it('renames an aggregation by its name alone', () => {
    const renamed = renameItem(list, 'count_category.keyword', 'orders');
    assert.deepEqual(renamed[1], { type: 'value_count', name: 'orders', item: { value_count: { field: 'category.keyword' } } });
  });

  it('removes the first column of a name, and nothing when the name is unknown', () => {
    const twice = [...list, termsItem('category.keyword')];
    assert.deepEqual(
      removeItem(twice, 'category.keyword_terms').map((item) => item.name),
      ['count_category.keyword', 'category.keyword_terms']
    );
    assert.deepEqual(removeItem(list, 'nothing'), list);
  });

  it('shows the list while it is built and the first row of the result afterwards', () => {
    assert.deepEqual(previewColumns(list, [], false), ['category.keyword_terms', 'count_category.keyword']);
    assert.deepEqual(previewColumns([], [{ _doc_count: 2, 'count_category.keyword': 3 }], true), [
      '_doc_count',
      'count_category.keyword',
    ]);
    assert.deepEqual(previewColumns(list, [], true), []);
  });

  it('says what each column does for the review', () => {
    assert.deepEqual(
      reviewItems([
        ...list,
        histogramItem('price', 5),
        dateHistogramItem('order_date', 1, 'd', 'fixed'),
        scriptedMetricItem('price', '{}'),
      ]),
      [
        { title: 'Group by terms', field: 'category.keyword' },
        { title: 'value_count()', field: 'category.keyword' },
        { title: 'Group by histogram', field: 'price' },
        { title: 'Group by date_histogram', field: 'order_date' },
        { title: 'scripted_metric()', field: 'scripted_metric_price' },
      ]
    );
  });
});

describe('the document the transform form builds', () => {
  const list = [termsItem('category.keyword'), metricItem('value_count', 'category.keyword')];
  const filled = () =>
    withTargetIndex(
      withSourceIndex(withDescription(emptyTransformDraft(), 'A test transform'), 'ecommerce'),
      'zztransform-target'
    );

  it('starts as the plugin starts it', () => {
    assert.equal(
      JSON.stringify(emptyTransformDraft()),
      '{"transform":{"description":"","enabled":true,"page_size":1000,"roles":[],"schedule":{"interval":{"start_time":234802,"period":1,"unit":"MINUTES"}},"source_index":"","target_index":""}}'
    );
  });

  it('is sent with its keys in the order the plugin sends them', () => {
    const body = transformBody(withContinuous(filled(), true), list, 3, 'MINUTES', NOW);
    assert.equal(
      JSON.stringify(body),
      '{"transform":{"description":"A test transform","enabled":true,"page_size":1000,"roles":[],' +
        `"schedule":{"interval":{"start_time":${NOW},"unit":"MINUTES","period":"3"}},` +
        '"source_index":"ecommerce","target_index":"zztransform-target",' +
        '"continuous":true,' +
        '"groups":[{"terms":{"source_field":"category.keyword","target_field":"category.keyword_terms"}}],' +
        '"aggregations":{"count_category.keyword":{"value_count":{"field":"category.keyword"}}}}}'
    );
  });

  it('keeps the place of the groups and aggregations it had before the schedule step', () => {
    const defined = withAggregations(withGroups(filled(), list), list);
    const body = transformBody(withContinuous(defined, true), list, 3, 'MINUTES', NOW);
    assert.deepEqual(Object.keys(body.transform), [
      'description',
      'enabled',
      'page_size',
      'roles',
      'schedule',
      'source_index',
      'target_index',
      'groups',
      'aggregations',
      'continuous',
    ]);
  });

  it('does not change the draft it was given', () => {
    const draft = filled();
    const before = JSON.stringify(draft);
    transformBody(draft, list, 3, 'HOURS', NOW);
    withFilter(draft, '{"match_all":{}}');
    assert.equal(JSON.stringify(draft), before);
  });

  it('drops a cron schedule when it is given an interval', () => {
    const draft = { transform: { schedule: { cron: { expression: '0 0 * * *', timezone: 'UTC' } } } };
    assert.deepEqual(transformBody(draft, [], 2, 'DAYS', NOW).transform.schedule, {
      interval: { start_time: NOW, unit: 'DAYS', period: '2' },
    });
  });

  it('takes a filter that is JSON, forgets one that is emptied and refuses the rest', () => {
    const filtered = withFilter(filled(), '{"term":{"currency":"EUR"}}');
    assert.equal(filtered.error, '');
    assert.deepEqual(filtered.draft.transform.data_selection_query, { term: { currency: 'EUR' } });

    const emptied = withFilter(filtered.draft, '');
    assert.equal(emptied.error, '');
    assert.equal('data_selection_query' in emptied.draft.transform, false);

    const refused = withFilter(filtered.draft, '{"term":');
    assert.equal(refused.error, FILTER_INVALID);
    assert.equal(refused.draft, filtered.draft);
  });

  it('says nothing of groups when none is left, and always what its aggregations are', () => {
    const defined = withAggregations(withGroups(filled(), list), list);
    const left = [list[1]];
    const without = withAggregations(withGroups(defined, left), left);
    assert.equal('groups' in without.transform, false);
    assert.deepEqual(without.transform.aggregations, { 'count_category.keyword': { value_count: { field: 'category.keyword' } } });
    assert.deepEqual(withAggregations(without, []).transform.aggregations, {});
  });

  it('forgets what was defined on another source', () => {
    const defined = withAggregations(withGroups(filled(), list), list);
    const cleared = withoutDefinitions(defined);
    assert.equal('groups' in cleared.transform, false);
    assert.deepEqual(cleared.transform.aggregations, {});
    assert.equal('aggregations' in withoutDefinitions(filled()).transform, false);
  });

  it('writes an emptied number of pages as null and an emptied target as nothing', () => {
    assert.equal(withPageSize(filled(), undefined).transform.page_size, null);
    assert.equal(withPageSize(filled(), 50).transform.page_size, 50);
    assert.equal(JSON.stringify(withTargetIndex(filled(), undefined)).includes('target_index'), false);
  });
});

describe('the grids of sample data of a transform job', () => {
  const fields: FieldItem[] = [
    { label: 'category', type: 'text' },
    { label: 'category.keyword', type: 'keyword' },
    { label: 'order_date', type: 'date' },
    { label: 'taxful_total_price', type: 'half_float' },
    { label: 'paid', type: 'boolean' },
    { label: 'price', type: 'alias', path: 'taxful_total_price' },
    { label: 'kind', type: 'alias', path: 'category.keyword' },
  ];
  const source = {
    category: ["Men's Clothing", "Men's Shoes"],
    order_date: MORNING,
    taxful_total_price: 36.98,
    paid: false,
  };

  it('writes a moment as the plugin does, and a dash for none', () => {
    assert.equal(transformTime(MORNING), '11/22/26 9:05AM');
    assert.equal(transformTime(EVENING), '11/22/26 5:30PM');
    assert.equal(transformTime(undefined), '-');
    assert.equal(transformTime(0), '-');
    assert.equal(transformTime('not a date'), '-');
  });

  it('reads a cell of the source as the type of its field says', () => {
    assert.equal(sampleCell(fields, source, 'category'), '["Men\'s Clothing","Men\'s Shoes"]');
    assert.equal(sampleCell(fields, source, 'category.keyword'), "Men's ClothingMen's Shoes");
    assert.equal(sampleCell(fields, source, 'order_date'), '11/22/26 9:05AM');
    assert.equal(sampleCell(fields, source, 'taxful_total_price'), '36.98');
    assert.equal(sampleCell(fields, source, 'paid'), 'false');
    assert.equal(sampleCell(fields, source, 'unknown'), '-');
  });

  it('shows a dash for what a document does not have', () => {
    assert.equal(sampleCell(fields, {}, 'category.keyword'), '-');
    assert.equal(sampleCell(fields, {}, 'order_date'), '-');
    assert.equal(sampleCell(fields, {}, 'paid'), '-');
    assert.equal(sampleCell(fields, {}, 'taxful_total_price'), '-');
  });

  it('shows under an alias the field it stands for', () => {
    assert.equal(sampleCell(fields, source, 'price'), '36.98');
    assert.equal(sampleCell(fields, source, 'kind'), "Men's ClothingMen's Shoes");
  });

  it('reads a cell of the result: a time under a date histogram, JSON for what is not text', () => {
    const row = {
      'order_date _date_histogram_1_m_calendar': MORNING,
      'category.keyword_terms': "Men's Clothing",
      'count_category.keyword': 3202,
      percentiles_price: { '25.0': 7.9, '75.0': 8.1 },
      none: 0,
    };
    assert.equal(previewCell(row, 'order_date _date_histogram_1_m_calendar'), '11/22/26 9:05AM');
    assert.equal(previewCell(row, 'category.keyword_terms'), "Men's Clothing");
    assert.equal(previewCell(row, 'count_category.keyword'), '3202');
    assert.equal(previewCell(row, 'percentiles_price'), '{"25.0":7.9,"75.0":8.1}');
    assert.equal(previewCell(row, 'none'), '-');
    assert.equal(previewCell(row, 'missing'), '-');
  });
});

describe('a transform job read back', () => {
  const job: Transform = {
    transform_id: 'zztransform-a',
    schema_version: 31,
    schedule: { interval: { start_time: 1795366000, period: 3, unit: 'Minutes' } },
    metadata_id: 'abc',
    updated_at: 1795367026990,
    enabled: true,
    enabled_at: 1795366986291,
    description: 'A test transform',
    source_index: 'ecommerce',
    data_selection_query: { match_all: { boost: 1 } },
    target_index: 'zztransform-target',
    page_size: 1000,
    groups: [
      { terms: { source_field: 'category.keyword', target_field: 'category.keyword_terms' } },
      { histogram: { source_field: 'price', target_field: 'price _histogram_5', interval: 5 } },
      { date_histogram: { source_field: 'order_date', target_field: 'day', fixed_interval: '1d' } },
    ],
    aggregations: {
      'count_category.keyword': { value_count: { field: 'category.keyword' } },
      scripted_metric_price: { scripted_metric: { init_script: 'state.n = 0' } },
    },
    continuous: true,
  };

  it('says what its groups and aggregations do', () => {
    assert.deepEqual(settingsItems(job), [
      { title: 'Group by terms', field: 'category.keyword' },
      { title: 'Group by histogram', field: 'price' },
      { title: 'Group by date_histogram', field: 'order_date' },
      { title: 'value_count()', field: 'category.keyword' },
      { title: 'scripted_metric()', field: 'scripted_metric_price' },
    ]);
    assert.deepEqual(settingsItems({}), []);
  });

  it('shows no more than its first ten groups', () => {
    const many = Array.from({ length: 12 }, (_unused, at) => ({
      terms: { source_field: `field${at}`, target_field: `field${at}_terms` },
    }));
    assert.equal(settingsItems({ groups: many }).length, 10);
  });

  it('says what it is doing in a word', () => {
    const status = (state: string, more: object = {}) =>
      transformStatus({ transform_metadata: { transform_id: 'zztransform-a', status: state, ...more } });
    assert.deepEqual(status('started'), { tone: 'healthy', text: 'Started' });
    assert.deepEqual(status('finished'), { tone: 'healthy', text: 'Complete' });
    assert.deepEqual(status('init'), { tone: 'subdued', text: 'Initializing...' });
    assert.deepEqual(status('stopped'), { tone: 'pale', text: 'Stopped' });
    assert.deepEqual(status('failed', { failure_reason: 'zztransform-a could not write to its target' }), {
      tone: 'critical',
      text: 'Error',
      error: '"zztransform-a" could not write to its target',
    });
    assert.equal(status('something else'), undefined);
    assert.equal(transformStatus(undefined), undefined);
    assert.equal(transformStatus(null), undefined);
    assert.equal(transformStatus({ transform_metadata: null }), undefined);
  });

  it('puts the name of the job in quotes wherever a reason has it', () => {
    assert.equal(quoteTransformId('job', 'job failed: job is too large'), '"job" failed: "job" is too large');
    assert.equal(quoteTransformId(undefined, 'job failed'), 'job failed');
  });

  it('opens for editing with its schedule, and not at all when it runs by a cron expression', () => {
    assert.deepEqual(transformEditOf(job), {
      description: 'A test transform',
      enabled: true,
      pageSize: 1000,
      interval: 3,
      intervalTimeunit: 'Minutes',
    });
    assert.deepEqual(
      transformEditOf({ schedule: { interval: { start_time: 1, period: '7', unit: 'HOURS' } }, page_size: null }),
      { description: '', enabled: false, pageSize: undefined, interval: 7, intervalTimeunit: 'HOURS' }
    );
    assert.equal(transformEditOf({ schedule: { cron: { expression: '0 0 * * *' } } }), undefined);
    assert.equal(transformEditOf({}), undefined);
  });

  it('is saved whole, with what the page changed, on a schedule that starts now', () => {
    const saved = editedTransform(
      job,
      { description: 'Edited', enabled: false, pageSize: 500, interval: 5, intervalTimeunit: 'Minutes' },
      NOW
    );
    assert.equal(
      JSON.stringify(saved),
      '{"transform":{"transform_id":"zztransform-a","schema_version":31,' +
        `"schedule":{"interval":{"start_time":${NOW},"unit":"Minutes","period":5}},` +
        '"metadata_id":"abc","updated_at":1795367026990,"enabled":false,"enabled_at":1795366986291,' +
        '"description":"Edited","source_index":"ecommerce","data_selection_query":{"match_all":{"boost":1}},' +
        '"target_index":"zztransform-target","page_size":500,' +
        '"groups":[{"terms":{"source_field":"category.keyword","target_field":"category.keyword_terms"}},' +
        '{"histogram":{"source_field":"price","target_field":"price _histogram_5","interval":5}},' +
        '{"date_histogram":{"source_field":"order_date","target_field":"day","fixed_interval":"1d"}}],' +
        '"aggregations":{"count_category.keyword":{"value_count":{"field":"category.keyword"}},' +
        '"scripted_metric_price":{"scripted_metric":{"init_script":"state.n = 0"}}},"continuous":true}}'
    );
    assert.equal(job.description, 'A test transform');
  });

  it('saves an emptied interval and number of pages as null', () => {
    const saved = editedTransform(
      job,
      { description: '', enabled: true, pageSize: undefined, interval: undefined, intervalTimeunit: 'Days' },
      NOW
    );
    assert.equal(saved.transform.page_size, null);
    assert.deepEqual(saved.transform.schedule, { interval: { start_time: NOW, unit: 'Days', period: null } });
  });
});
