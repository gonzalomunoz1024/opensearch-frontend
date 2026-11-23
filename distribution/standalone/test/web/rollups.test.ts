/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_ROLLUP_FORM,
  addDimensions,
  addMetrics,
  changeDimension,
  commonFields,
  cronScheduleText,
  delayToMs,
  editOf,
  editedRollup,
  histogramIntervalText,
  indicesErrors,
  intervalScheduleText,
  metricsError,
  moveDimension,
  msToDelay,
  parseDimensions,
  parseFieldOptions,
  parseMetrics,
  parseTimeunit,
  removeDimension,
  rollupBody,
  rollupStatus,
  rollupWindow,
  scheduleText,
  setMetricKind,
  toggleMetric,
  unitOption,
  wildcardOption,
  type Rollup,
  type RollupForm,
} from '../../web/apps/index_management/rollup_model';
import { TIME_ZONES } from '../../web/apps/index_management/time_zones';

const NOW = 1790000000;

const form = (changes: Partial<RollupForm> = {}): RollupForm => ({
  ...EMPTY_ROLLUP_FORM,
  rollupId: 'sales',
  sourceIndex: 'orders*',
  targetIndex: 'orders-rollup',
  timestamp: 'order_date',
  ...changes,
});

const stored = (changes: Partial<Rollup> = {}): Rollup => ({
  ...rollupBody(form(), NOW).rollup,
  rollup_id: 'sales',
  enabled_time: 1790000000123,
  last_updated_time: 1790000000123,
  schema_version: 21,
  ...changes,
});

describe('the words of a rollup job', () => {
  it('names a unit however the job or the form spells it', () => {
    assert.equal(parseTimeunit('MINUTES'), 'minute(s)');
    assert.equal(parseTimeunit('Minutes'), 'minute(s)');
    assert.equal(parseTimeunit('m'), 'minute(s)');
    assert.equal(parseTimeunit('M'), 'month');
    assert.equal(parseTimeunit('ms'), 'millisecond(s)');
    assert.equal(parseTimeunit('s'), 'second(s)');
    assert.equal(parseTimeunit('HOURS'), 'hour(s)');
    assert.equal(parseTimeunit('d'), 'day(s)');
    assert.equal(parseTimeunit('w'), 'week');
    assert.equal(parseTimeunit('q'), 'quarter');
    assert.equal(parseTimeunit('y'), 'year');
    assert.equal(parseTimeunit('fortnight'), 'fortnight');
  });

  it('keeps a wait in milliseconds and gives it back in its unit', () => {
    assert.equal(delayToMs(2, 'HOURS'), 7200000);
    assert.equal(delayToMs(3, 'SECONDS'), 3000);
    assert.equal(delayToMs(1, 'DAYS'), 86400000);
    assert.equal(delayToMs(undefined, 'MINUTES'), 0);
    assert.equal(delayToMs(NaN, 'MINUTES'), 0);
    assert.equal(msToDelay(7200000, 'MINUTES'), 120);
    assert.equal(msToDelay(500, 'weeks'), 500);
  });

  it('says a schedule in a sentence', () => {
    assert.equal(intervalScheduleText(true, 3, 'Hours'), 'Continuous, every 3 hour(s)');
    assert.equal(intervalScheduleText(false, 3, 'Hours'), 'Not continuous');
    assert.equal(cronScheduleText(true, '0 0 * * *'), 'Continuous, defined by cron expression: 0 0 * * *');
    assert.equal(cronScheduleText(false, '0 0 * * *'), 'Not continuous');
    assert.equal(scheduleText(stored({ continuous: true })), 'Continuous, every 1 minute(s)');
    assert.equal(
      scheduleText(stored({ continuous: true, schedule: { cron: { expression: '5 4 * * *', timezone: 'UTC' } } })),
      'Continuous, defined by cron expression: 5 4 * * *'
    );
  });

  it('says the interval of a date histogram', () => {
    assert.equal(histogramIntervalText('1h'), '1 hour(s)');
    assert.equal(histogramIntervalText('30m'), '30 minute(s)');
    assert.equal(histogramIntervalText('1M'), '1 month');
    assert.equal(histogramIntervalText(undefined), '');
    assert.equal(histogramIntervalText('soon'), '');
  });

  it('offers what was typed as a pattern', () => {
    assert.equal(wildcardOption('orders'), 'orders*');
    assert.equal(wildcardOption('orders*'), 'orders*');
  });

  it('lists the time zones the original lists, UTC among them', () => {
    assert.equal(TIME_ZONES.length, 595);
    for (const zone of ['UTC', 'America/Chicago', 'Europe/Madrid', 'US/Pacific', 'Zulu']) {
      assert.ok(TIME_ZONES.includes(zone), zone);
    }
    assert.equal(new Set(TIME_ZONES).size, TIME_ZONES.length);
  });
});

describe('the fields of a source', () => {
  const mappings = {
    category: { type: 'text', fields: { keyword: { type: 'keyword' } } },
    customer: { properties: { age: { type: 'integer' }, address: { type: 'object', properties: { city: { type: 'keyword' } } } } },
    items: { type: 'nested', properties: { price: { type: 'float' } } },
    order_date: { type: 'date' },
  };

  it('names every field that holds values, those inside others by their whole names', () => {
    assert.deepEqual(parseFieldOptions('', mappings), [
      { label: 'category', type: 'text' },
      { label: 'category.keyword', type: 'keyword' },
      { label: 'customer.age', type: 'integer' },
      { label: 'customer.address.city', type: 'keyword' },
      { label: 'items.price', type: 'float' },
      { label: 'order_date', type: 'date' },
    ]);
    assert.deepEqual(parseFieldOptions('', undefined), []);
  });

  it('keeps for a pattern the fields every index has with one type', () => {
    const fields = commonFields({
      'orders-1': { mappings: { properties: { total: { type: 'float' }, day: { type: 'date' }, note: { type: 'text' } } } },
      'orders-2': { mappings: { properties: { total: { type: 'long' }, day: { type: 'date' } } } },
    });
    assert.deepEqual(fields, [{ label: 'day', type: 'date' }]);
    assert.deepEqual(commonFields({}), []);
    assert.deepEqual(commonFields({ empty: {} }), []);
  });
});

describe('the aggregations of a rollup form', () => {
  const price = { label: 'price', type: 'float' };
  const city = { label: 'city', type: 'keyword' };
  const day = { label: 'day', type: 'date' };

  it('adds numbers in ranges and the rest by value, once each, numbered in order', () => {
    const first = addDimensions([], [price, city]);
    assert.deepEqual(first, [
      { sequence: 1, field: price, aggregationMethod: 'histogram', interval: 5 },
      { sequence: 2, field: city, aggregationMethod: 'terms' },
    ]);
    const second = addDimensions(first, [city, day]);
    assert.deepEqual(
      second.map((dimension) => [dimension.sequence, dimension.field.label]),
      [
        [1, 'price'],
        [2, 'city'],
        [3, 'day'],
      ]
    );
  });

  it('moves one a place, and not past either end', () => {
    const three = addDimensions([], [price, city, day]);
    const labels = (list: typeof three) => list.map((dimension) => `${dimension.sequence}:${dimension.field.label}`);
    assert.deepEqual(labels(moveDimension(three, 'city', -1)), ['1:city', '2:price', '3:day']);
    assert.deepEqual(labels(moveDimension(three, 'city', 1)), ['1:price', '2:day', '3:city']);
    assert.equal(moveDimension(three, 'price', -1), three);
    assert.equal(moveDimension(three, 'day', 1), three);
    assert.equal(moveDimension(three, 'nothing', 1), three);
  });

  it('removes one and numbers the rest again', () => {
    const left = removeDimension(addDimensions([], [price, city, day]), 'city');
    assert.deepEqual(
      left.map((dimension) => [dimension.sequence, dimension.field.label]),
      [
        [1, 'price'],
        [2, 'day'],
      ]
    );
  });

  it('changes the method of one, a range starting at 5 again', () => {
    const two = addDimensions([], [price, city]);
    const asTerms = changeDimension(two, 'price', { aggregationMethod: 'terms' });
    assert.deepEqual(asTerms[0], { sequence: 1, field: price, aggregationMethod: 'terms' });
    const back = changeDimension(asTerms, 'price', { aggregationMethod: 'histogram' });
    assert.deepEqual(back[0], { sequence: 1, field: price, aggregationMethod: 'histogram', interval: 5 });
    assert.equal(changeDimension(two, 'price', { interval: 20 })[0].interval, 20);
    assert.ok(Number.isNaN(changeDimension(two, 'price', { interval: undefined })[0].interval));
    assert.equal(changeDimension(two, 'price', { interval: 20 })[1], two[1]);
  });
});

describe('the metrics of a rollup form', () => {
  const price = { label: 'price', type: 'float' };
  const quantity = { label: 'quantity', type: 'integer' };

  it('adds a field once, with nothing to compute yet', () => {
    const metrics = addMetrics(addMetrics([], [price]), [price, quantity]);
    assert.deepEqual(
      metrics.map((metric) => metric.source_field.label),
      ['price', 'quantity']
    );
    assert.deepEqual(metrics[0], {
      source_field: price,
      all: false,
      min: false,
      max: false,
      sum: false,
      avg: false,
      value_count: false,
    });
  });

  it('ticks one, and all of them with "all", which clears only itself', () => {
    const metrics = addMetrics([], [price, quantity]);
    const one = toggleMetric(metrics, 'price', 'max');
    assert.equal(one[0].max, true);
    assert.equal(one[0].min, false);
    assert.equal(one[1].max, false);
    const all = toggleMetric(metrics, 'price', 'all');
    assert.deepEqual(
      [all[0].all, all[0].min, all[0].max, all[0].sum, all[0].avg, all[0].value_count],
      [true, true, true, true, true, true]
    );
    const cleared = toggleMetric(all, 'price', 'all');
    assert.deepEqual([cleared[0].all, cleared[0].min, cleared[0].value_count], [false, true, true]);
    assert.equal(toggleMetric(one, 'price', 'max')[0].max, false);
  });

  it('sets one kind for every field', () => {
    const metrics = setMetricKind(addMetrics([], [price, quantity]), 'sum', true);
    assert.deepEqual(
      metrics.map((metric) => metric.sum),
      [true, true]
    );
    assert.deepEqual(
      setMetricKind(metrics, 'sum', false).map((metric) => metric.sum),
      [false, false]
    );
  });

  it('names the last field with nothing to compute', () => {
    const metrics = addMetrics([], [price, quantity]);
    assert.equal(metricsError(metrics), 'Must specify at least one metric to aggregate on for: quantity');
    assert.equal(
      metricsError(toggleMetric(metrics, 'quantity', 'avg')),
      'Must specify at least one metric to aggregate on for: price'
    );
    assert.equal(metricsError(toggleMetric(toggleMetric(metrics, 'quantity', 'avg'), 'price', 'all')), '');
    assert.equal(metricsError([]), '');
  });
});

describe('the job a rollup form asks for', () => {
  it('says what the first step misses', () => {
    assert.deepEqual(indicesErrors(EMPTY_ROLLUP_FORM), {
      rollupId: 'Job name is required.',
      sourceIndex: 'Source index is required.',
      targetIndex: 'Target index is required.',
    });
    assert.deepEqual(indicesErrors(form()), {});
  });

  it('writes the job as the original does, key for key', () => {
    const price = { label: 'price', type: 'float' };
    const city = { label: 'city', type: 'keyword' };
    const body = rollupBody(
      form({
        description: 'Sales by day',
        dimensions: addDimensions([], [price, city]),
        metrics: toggleMetric(toggleMetric(addMetrics([], [price]), 'price', 'max'), 'price', 'min'),
        delayTime: 2,
        delayTimeunit: 'HOURS',
      }),
      NOW
    );
    assert.equal(
      JSON.stringify(body),
      JSON.stringify({
        rollup: {
          continuous: false,
          description: 'Sales by day',
          dimensions: [
            { date_histogram: { source_field: 'order_date', fixed_interval: '1h', timezone: 'UTC' } },
            { histogram: { source_field: 'price', interval: 5 } },
            { terms: { source_field: 'city' } },
          ],
          enabled: true,
          metrics: [{ source_field: 'price', metrics: [{ min: {} }, { max: {} }] }],
          page_size: 1000,
          roles: [],
          schedule: { interval: { start_time: NOW, unit: 'MINUTES', period: '1' } },
          source_index: 'orders*',
          target_index: 'orders-rollup',
          delay: 7200000,
        },
      })
    );
  });

  it('counts by the calendar one unit at a time, in the time zone chosen', () => {
    const { rollup } = rollupBody(form({ intervalType: 'calendar', intervalValue: 7, timeunit: 'w', timezone: 'America/Chicago' }), NOW);
    assert.equal(
      JSON.stringify(rollup.dimensions[0]),
      JSON.stringify({
        date_histogram: { source_field: 'order_date', timezone: 'America/Chicago', calendar_interval: '1w' },
      })
    );
  });

  it('runs by a cron expression in its time zone when asked to', () => {
    const { rollup } = rollupBody(
      form({ continuous: true, continuousDefinition: 'cron', cronExpression: '0 3 * * *', cronTimezone: 'Europe/Madrid' }),
      NOW
    );
    assert.deepEqual(rollup.schedule, { cron: { expression: '0 3 * * *', timezone: 'Europe/Madrid' } });
    assert.equal(rollup.continuous, true);
  });

  it('sends no page size as null and no wait as nothing to wait', () => {
    const { rollup } = rollupBody(form({ pageSize: undefined, enabled: false }), NOW);
    assert.equal(rollup.page_size, null);
    assert.equal(rollup.delay, 0);
    assert.equal(rollup.enabled, false);
  });
});

describe('a rollup job read back', () => {
  it('lists the aggregations after the date histogram and what each field computes', () => {
    const job = stored({
      dimensions: [
        { date_histogram: { source_field: 'order_date', fixed_interval: '1h', timezone: 'UTC' } },
        { terms: { source_field: 'city' } },
        { histogram: { source_field: 'price', interval: 10 } },
      ],
      metrics: [{ source_field: 'price', metrics: [{ avg: {} }, { value_count: {} }] }],
    });
    assert.deepEqual(parseDimensions(job.dimensions), [
      { sequence: 1, aggregationMethod: 'terms', field: { label: 'city' }, interval: null },
      { sequence: 2, aggregationMethod: 'histogram', field: { label: 'price' }, interval: 10 },
    ]);
    assert.deepEqual(parseMetrics(job.metrics), [
      { source_field: { label: 'price' }, all: false, min: false, max: false, sum: false, avg: true, value_count: true },
    ]);
  });

  it('opens for editing with the schedule it has, the unit as OpenSearch spells it', () => {
    const edit = editOf(
      stored({
        description: 'Daily',
        schedule: { interval: { start_time: NOW, unit: 'Hours', period: 3 } },
        page_size: 500,
        delay: 7200000,
      })
    );
    assert.deepEqual(edit, {
      description: 'Daily',
      continuousDefinition: 'fixed',
      interval: 3,
      intervalTimeunit: 'Hours',
      cronExpression: '',
      cronTimezone: 'UTC',
      pageSize: 500,
      delayTime: 120,
      delayTimeunit: 'MINUTES',
    });
    // The select shows the job's own unit
    assert.equal(unitOption(edit.intervalTimeunit), 'HOURS');
    assert.equal(unitOption('MINUTES'), 'MINUTES');
  });

  it('sends the unit back as OpenSearch spelt it while it is not changed', () => {
    const job = stored({ schedule: { interval: { start_time: NOW, unit: 'Days', period: 1 } } });
    const { rollup } = editedRollup(job, editOf(job), NOW + 60);
    assert.deepEqual(rollup.schedule, { interval: { start_time: NOW + 60, unit: 'Days', period: 1 } });
  });

  it('opens a job that runs by cron with its expression and its time zone', () => {
    const edit = editOf(stored({ schedule: { cron: { expression: '0 3 * * *', timezone: 'Europe/Madrid' } }, delay: 0 }));
    assert.equal(edit.continuousDefinition, 'cron');
    assert.equal(edit.cronExpression, '0 3 * * *');
    assert.equal(edit.cronTimezone, 'Europe/Madrid');
    assert.equal(edit.interval, 2);
    assert.equal(edit.delayTime, undefined);
  });

  it('saves the job as it was with only what the page changes', () => {
    const job = stored({ description: 'Before' });
    const { rollup } = editedRollup(
      job,
      { ...editOf(job), description: 'After', interval: 3, intervalTimeunit: 'HOURS', pageSize: 500, delayTime: 2, delayTimeunit: 'HOURS' },
      NOW + 60
    );
    assert.equal(rollup.description, 'After');
    assert.equal(rollup.page_size, 500);
    assert.equal(rollup.delay, 7200000);
    assert.deepEqual(rollup.schedule, { interval: { start_time: NOW + 60, unit: 'HOURS', period: 3 } });
    assert.equal(rollup.source_index, job.source_index);
    assert.deepEqual(rollup.dimensions, job.dimensions);
    assert.equal(rollup.rollup_id, 'sales');
    assert.equal(rollup.schema_version, 21);
  });
});

describe('what a rollup job is doing', () => {
  const metadata = (status: string, more: Record<string, unknown> = {}) => ({
    rollup_metadata: { status, stats: {}, ...more },
  });

  it('says each state in a word and a colour', () => {
    assert.deepEqual(rollupStatus(metadata('failed', { failure_reason: 'no such field' })), {
      icon: 'warning',
      tone: 'critical',
      text: 'Failed: no such field',
    });
    assert.deepEqual(rollupStatus(metadata('finished')), { icon: 'check', tone: 'healthy', text: 'Complete' });
    assert.deepEqual(rollupStatus(metadata('init')), { icon: 'clock', tone: 'accent', text: 'Initializing' });
    assert.deepEqual(rollupStatus(metadata('started')), { icon: 'play', tone: 'healthy', text: 'Started' });
    assert.deepEqual(rollupStatus(metadata('stopped')), { icon: 'stop', tone: 'subdued', text: 'Stopped' });
  });

  it('says nothing of a job that has not run or of a state it does not know', () => {
    assert.equal(rollupStatus(undefined), undefined);
    assert.equal(rollupStatus(null), undefined);
    assert.equal(rollupStatus({}), undefined);
    assert.equal(rollupStatus(metadata('retry')), undefined);
  });

  it('gives the window of a continuous job only', () => {
    assert.deepEqual(
      rollupWindow(metadata('started', { continuous: { next_window_start_time: 10, next_window_end_time: 20 } })),
      [10, 20]
    );
    assert.equal(rollupWindow(metadata('started')), undefined);
    assert.equal(rollupWindow(null), undefined);
  });
});
