/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The metric visualization as OpenSearch Dashboards 3.9.0's works it out (vis_type_metric:
 * metric_vis_fn and MetricVisComponent): the options and their defaults, the metrics in the order
 * of the columns and then the rows, their labels, the range a value is in and its colour, the
 * percentage mode, and the text on a dark background. The colours are those measured in the
 * original with the Atlas theme.
 */

process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OTHER_KEY, tabify, type AggConfig, type AggContext, type Table } from '../../web/lib/aggs';
import type { Field, IndexPattern } from '../../web/lib/types';
import {
  groupColumn,
  isColorDark,
  metricConfig,
  metricItems,
  needsLightText,
  rangeColors,
  rangeIndex,
  rangeLabels,
  type MetricConfig,
} from '../../web/vis/metric_data';

const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: true });

const logs: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [field('timestamp', 'date'), field('bytes', 'number'), field('machine.os', 'string')],
  fieldFormatMap: {},
};
const context: AggContext = { indexPattern: logs };

const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
const avgBytes: AggConfig = { id: '2', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes' } };
const sumBytes: AggConfig = { id: '4', enabled: true, type: 'sum', schema: 'metric', params: { field: 'bytes' } };
const os: AggConfig = {
  id: '3',
  enabled: true,
  type: 'terms',
  schema: 'group',
  params: { field: 'machine.os', size: 2, order: 'desc', orderBy: '1' },
};

/** 14,074 documents of 5,664.75 bytes on average, 79,725,689 in all */
const totals = (): Table =>
  tabify(
    [count, avgBytes, sumBytes],
    { hits: { total: 14074 }, aggregations: { '2': { value: 5664.75 }, '4': { value: 79725689 } } },
    context
  );

/** Two systems: 2,000 and 1,200 documents of 6,000 and 5,000 bytes on average */
const systems = (): Table =>
  tabify(
    [count, avgBytes, os],
    {
      aggregations: {
        '3': {
          buckets: [
            { key: 'win 8', doc_count: 2000, '2': { value: 6000 } },
            { key: 'ios', doc_count: 1200, '2': { value: 5000 } },
          ],
        },
      },
    },
    context
  );

const config = (metric: Record<string, unknown> = {}): MetricConfig => metricConfig({ metric });

const threeRanges = [
  { from: 0, to: 6000 },
  { from: 6000, to: 100000 },
  { from: 100000, to: 100000000 },
];

describe('the options of the metric', () => {
  it('has the defaults of the original: green to red, no colours, one range, labels, 60 points', () => {
    assert.deepEqual(config(), {
      percentageMode: false,
      colorSchema: 'Green to Red',
      colorMode: 'None',
      colorsRange: [{ from: 0, to: 10000 }],
      invertColors: false,
      showLabels: true,
      fontSize: 60,
    });
    // A visualization saved without its options at all
    assert.deepEqual(metricConfig({}), config());
  });

  it('reads the saved options', () => {
    const read = config({
      percentageMode: true,
      colorSchema: 'Blues',
      metricColorMode: 'Background',
      colorsRange: threeRanges,
      invertColors: true,
      labels: { show: false },
      style: { fontSize: 24 },
    });
    assert.equal(read.percentageMode, true);
    assert.equal(read.colorSchema, 'Blues');
    assert.equal(read.colorMode, 'Background');
    assert.deepEqual(read.colorsRange, threeRanges);
    assert.equal(read.invertColors, true);
    assert.equal(read.showLabels, false);
    assert.equal(read.fontSize, 24);
  });

  it('takes the size as a whole number, as the original parses it, and any other mode as none', () => {
    assert.equal(config({ style: { fontSize: '36.7' } }).fontSize, 36);
    assert.equal(config({ style: { fontSize: 'large' } }).fontSize, 60);
    assert.equal(config({ metricColorMode: 'Rainbow' }).colorMode, 'None');
    assert.equal(config({ colorsRange: [] }).colorsRange.length, 1);
  });
});

describe('the ranges of the metric and their colours', () => {
  it('calls a range by its ends, and in percentage mode by their shares of the last end', () => {
    assert.deepEqual(rangeLabels(config({ colorsRange: threeRanges })), ['0 - 6000', '6000 - 100000', '100000 - 100000000']);
    const halves = [
      { from: 0, to: 10000 },
      { from: 10000, to: 20000 },
    ];
    assert.deepEqual(rangeLabels(config({ colorsRange: halves, percentageMode: true })), ['0 - 50', '50 - 100']);
    // Rounded to whole per cents
    const thirds = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ];
    assert.deepEqual(rangeLabels(config({ colorsRange: thirds, percentageMode: true })), ['0 - 33', '33 - 67', '67 - 100']);
  });

  it('finds the range a value starts in or is under the end of', () => {
    assert.equal(rangeIndex(0, threeRanges), 0);
    assert.equal(rangeIndex(5999.99, threeRanges), 0);
    assert.equal(rangeIndex(6000, threeRanges), 1);
    assert.equal(rangeIndex(100000, threeRanges), 2);
  });

  it('gives a value under every range the first, and any other the last', () => {
    const ranges = [
      { from: 6000, to: 7000 },
      { from: 7000, to: 8000 },
    ];
    assert.equal(rangeIndex(5664.75, ranges), 0);
    assert.equal(rangeIndex(14074, ranges), 1);
    assert.equal(rangeIndex(8000, ranges), 1);
    // A gap between two ranges is past the first, so the last
    const apart = [
      { from: 0, to: 10 },
      { from: 20, to: 30 },
      { from: 30, to: 40 },
    ];
    assert.equal(rangeIndex(15, apart), 2);
  });

  it('counts no value as 0, as the original compares it', () => {
    assert.equal(rangeIndex(null, threeRanges), 0);
    assert.equal(
      rangeIndex(null, [
        { from: 10, to: 20 },
        { from: 20, to: 30 },
      ]),
      0
    );
    // What is not a number is in no range and under none: the last
    assert.equal(rangeIndex(Number.NaN, threeRanges), 2);
  });

  it('spreads the schema over the ranges from its first colour to its last', () => {
    const greens = rangeColors(config({ colorSchema: 'Greens', colorsRange: threeRanges }));
    assert.deepEqual(greens, {
      '0 - 6000': 'rgb(255,255,255)',
      '6000 - 100000': 'rgb(153,200,189)',
      '100000 - 100000000': 'rgb(32,146,128)',
    });
    const signal = rangeColors(config({ colorsRange: threeRanges }));
    assert.equal(signal['0 - 6000'], 'rgb(52,199,89)');
    assert.equal(signal['100000 - 100000000'], 'rgb(255,59,48)');
  });

  it('turns the schema round when inverted', () => {
    const reds = rangeColors(config({ colorSchema: 'Reds', colorsRange: threeRanges, invertColors: true }));
    assert.deepEqual(reds, {
      '0 - 6000': 'rgb(204,86,66)',
      '6000 - 100000': 'rgb(238,170,156)',
      '100000 - 100000000': 'rgb(255,255,255)',
    });
  });

  it('gives one range the first colour of the schema', () => {
    assert.deepEqual(rangeColors(config()), { '0 - 10000': 'rgb(52,199,89)' });
  });

  it('lets a later range take the colour of an earlier one of the same name', () => {
    const twice = [
      { from: 0, to: 10 },
      { from: 0, to: 10 },
    ];
    assert.deepEqual(rangeColors(config({ colorsRange: twice })), { '0 - 10': 'rgb(255,59,48)' });
  });
});

describe('the text on a coloured metric', () => {
  it('is light on a dark colour, by the luminance the component library measures', () => {
    assert.equal(isColorDark(0, 0, 0), true);
    assert.equal(isColorDark(52, 55, 65), true);
    assert.equal(isColorDark(255, 255, 255), false);
    assert.equal(isColorDark(255, 59, 48), false);
    assert.equal(needsLightText('rgb(52,55,65)'), true);
    assert.equal(needsLightText('rgb(254, 255, 255)'), false);
  });

  it('stays as it is with no colour, or one that is not written as rgb()', () => {
    assert.equal(needsLightText(undefined), false);
    assert.equal(needsLightText('#000000'), false);
  });
});

describe('the metrics shown', () => {
  it('shows one for every metric of the answer, under the name of its column', () => {
    const items = metricItems(totals(), config(), context);
    assert.deepEqual(
      items.map((item) => [item.label, item.value.text]),
      [
        ['Count', '14,074'],
        ['Average bytes', '5,664.75'],
        ['Sum of bytes', '79,725,689'],
      ]
    );
    // No colours without a colour mode, whatever the ranges
    assert.ok(items.every((item) => item.color === undefined && item.bgColor === undefined && !item.lightText));
  });

  it('shows one for every bucket of every metric, metric by metric, named "<bucket> - <metric>"', () => {
    const items = metricItems(systems(), config(), context);
    assert.deepEqual(
      items.map((item) => [item.label, item.value.text, item.rowIndex]),
      [
        ['win 8 - Count', '2,000', 0],
        ['ios - Count', '1,200', 1],
        ['win 8 - Average bytes', '6,000', 0],
        ['ios - Average bytes', '5,000', 1],
      ]
    );
    assert.equal(groupColumn(systems())?.name, 'machine.os: Descending');
    assert.equal(groupColumn(totals()), undefined);
    // The row goes with the metric, for the filter of a click
    const table = systems();
    assert.equal(metricItems(table, config(), context)[3].row, table.rows[1]);
  });

  it('shows nothing for an answer with no rows', () => {
    const empty = tabify([count, os], { aggregations: { '3': { buckets: [] } } }, context);
    assert.deepEqual(metricItems(empty, config(), context), []);
  });

  it('colours the value by its range in the mode "Labels"', () => {
    const items = metricItems(totals(), config({ colorSchema: 'Greens', metricColorMode: 'Labels', colorsRange: threeRanges }), context);
    assert.deepEqual(
      items.map((item) => item.color),
      ['rgb(153,200,189)', 'rgb(255,255,255)', 'rgb(32,146,128)']
    );
    assert.ok(items.every((item) => item.bgColor === undefined && !item.lightText));
  });

  it('colours behind the metric in the mode "Background", with light text on a dark colour', () => {
    const greys = config({
      colorSchema: 'Greys',
      metricColorMode: 'Background',
      colorsRange: [
        { from: 0, to: 10000 },
        { from: 10000, to: 20000 },
      ],
    });
    const items = metricItems(totals(), greys, context).slice(0, 2);
    assert.deepEqual(
      items.map((item) => [item.bgColor, item.color, item.lightText]),
      [
        ['rgb(52,55,65)', undefined, true],
        ['rgb(254,255,255)', undefined, false],
      ]
    );
  });

  it('colours nothing with one range only', () => {
    const items = metricItems(totals(), config({ metricColorMode: 'Background' }), context);
    assert.ok(items.every((item) => item.bgColor === undefined && item.color === undefined));
  });

  it('colours nothing for a schema that does not exist', () => {
    const items = metricItems(totals(), config({ colorSchema: 'Mauves', metricColorMode: 'Labels', colorsRange: threeRanges }), context);
    assert.ok(items.every((item) => item.color === undefined));
  });

  it('writes the value as its share of the span of the ranges in percentage mode, coloured by the value itself', () => {
    const halves = config({
      percentageMode: true,
      colorSchema: 'Greys',
      metricColorMode: 'Background',
      colorsRange: [
        { from: 0, to: 10000 },
        { from: 10000, to: 20000 },
      ],
    });
    const items = metricItems(totals(), halves, context).slice(0, 2);
    assert.deepEqual(
      items.map((item) => [item.value.text, item.bgColor]),
      [
        ['70.37%', 'rgb(52,55,65)'],
        ['28.324%', 'rgb(254,255,255)'],
      ]
    );
    // From the start of the first range
    const from = config({ percentageMode: true, colorsRange: [{ from: 4074, to: 24074 }] });
    assert.equal(metricItems(totals(), from, context)[0].value.text, '50%');
  });

  it('writes a dash between spaces for no value, and 0% in percentage mode as the original does', () => {
    const table = totals();
    const none: Table = { ...table, rows: [{ ...table.rows[0], [table.columns[1].id]: null }] };
    assert.deepEqual(metricItems(none, config(), context)[1].value, { text: ' - ' });
    assert.equal(metricItems(none, config({ percentageMode: true }), context)[1].value.text, '0%');
  });

  it('writes a bare dash for what is not a number', () => {
    const table = totals();
    const broken: Table = { ...table, rows: [{ ...table.rows[0], [table.columns[1].id]: Number.NaN }] };
    assert.deepEqual(metricItems(broken, config(), context)[1].value, { text: '-', bare: true });
  });

  it('leaves out a metric that sizes dots, and names the bucket of the other terms as its label', () => {
    const radius: AggConfig = { ...avgBytes, schema: 'radius' };
    const others: AggConfig = { ...os, params: { ...os.params, otherBucket: true, otherBucketLabel: 'The rest' } };
    const table = tabify(
      [count, radius, others],
      {
        aggregations: {
          '3': {
            buckets: [
              { key: 'win 8', doc_count: 2000, '2': { value: 6000 } },
              { key: OTHER_KEY, doc_count: 30, '2': { value: 10 } },
            ],
          },
        },
      },
      context
    );
    assert.deepEqual(
      metricItems(table, config(), context).map((item) => item.label),
      ['win 8 - Count', 'The rest - Count']
    );
  });

  it('names the bucket of an empty word by nothing, as the original writes it', () => {
    const table = tabify([count, os], { aggregations: { '3': { buckets: [{ key: '', doc_count: 7 }] } } }, context);
    assert.deepEqual(
      metricItems(table, config(), context).map((item) => item.label),
      [' - Count']
    );
  });
});
