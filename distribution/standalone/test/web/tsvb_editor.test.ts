/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  drawnInterval,
  extractIndexPatterns,
  formatInterval,
  isDuration,
  isModelInvalid,
  newSeries,
  panelAdditions,
  reIdSeries,
  stableKey,
  tsvbDefaults,
  uuid,
  validateInterval,
  withTsvbDefaults,
  type Series,
} from '../../web/apps/visualize/tsvb/model';
import { colorOutput, cssColor, parseColor, toHex } from '../../web/components/color_picker';

const UUID_V1 = /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('the params a TSVB editor keeps', () => {
  it('gives series and metrics time-based ids, each new', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuid()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, UUID_V1);
  });

  it('reads saved params over the defaults of the type, without changing what was saved', () => {
    const saved = { id: 'panel', type: 'gauge', series: [], show_legend: 0, interval: '>=4h' };
    const params = withTsvbDefaults(saved);
    assert.equal(params.tooltip_mode, 'show_all');
    assert.equal(params.axis_formatter, 'number');
    assert.equal(params.show_legend, 0);
    assert.equal(params.interval, '>=4h');
    assert.deepEqual(params.series, []);
    assert.equal(tsvbDefaults().series[0].split_color_mode, 'opensearchDashboards');
  });

  it('adds what a kind of panel lacks when it opens, and nothing else', () => {
    const metric = panelAdditions({ type: 'metric', background_color_rules: [] });
    assert.deepEqual(Object.keys(metric), ['background_color_rules']);
    assert.deepEqual(panelAdditions({ type: 'metric', background_color_rules: [{ id: 'a' }] }), {});
    assert.deepEqual(Object.keys(panelAdditions({ type: 'top_n' })), ['bar_color_rules']);
    assert.deepEqual(Object.keys(panelAdditions({ type: 'table' })), ['bar_color_rules']);
    const gauge = panelAdditions({ type: 'gauge', gauge_width: 0, gauge_style: null });
    assert.deepEqual(Object.keys(gauge), ['gauge_color_rules', 'gauge_inner_width', 'gauge_style']);
    assert.equal(gauge.gauge_inner_width, 10);
    assert.equal(gauge.gauge_style, 'half');
    assert.deepEqual(panelAdditions({ type: 'timeseries' }), {});
    assert.deepEqual(panelAdditions({ type: 'markdown' }), {});
  });

  it('lists the index patterns whose fields the editor needs', () => {
    assert.deepEqual(extractIndexPatterns({ index_pattern: '', series: [] }), ['']);
    assert.deepEqual(
      extractIndexPatterns({
        index_pattern: 'logs',
        series: [
          { id: 'a', metrics: [], override_index_pattern: 1, series_index_pattern: 'flights' },
          { id: 'b', metrics: [], override_index_pattern: 0, series_index_pattern: 'ignored' },
        ],
        annotations: [{ id: 'c', index_pattern: 'logs' }, { id: 'd', index_pattern: 'ecommerce' }],
      }),
      ['ecommerce', 'flights', 'logs']
    );
  });

  it('accepts the intervals OpenSearch takes and says what is wrong with the others', () => {
    for (const interval of ['', 'auto', '1m', '7d', '1w', '1M', '1y', '>=1m', '>=4h', '10 s', '500ms']) {
      assert.equal(validateInterval(interval).valid, true, interval);
    }
    assert.deepEqual(validateInterval('abc'), { valid: false, message: 'Invalid interval format: abc' });
    assert.deepEqual(validateInterval('0m'), { valid: false, message: 'Invalid interval format: 0m' });
    assert.deepEqual(validateInterval('2w'), { valid: false, message: 'Invalid calendar interval: 2w, value must be 1' });
    assert.equal(isModelInvalid({ interval: 'abc', series: [] }), true);
    assert.equal(isModelInvalid({ interval: 'auto', series: [{ id: 'a', metrics: [], series_interval: '3M' }] }), true);
    assert.equal(isModelInvalid({ series: [{ id: 'a', metrics: [] }] }), false);
  });

  it('shows the interval a panel was drawn at in its largest unit', () => {
    assert.equal(formatInterval(24 * 3600000), '24h');
    assert.equal(formatInterval(3 * 3600000), '3h');
    assert.equal(formatInterval(30000), '30s');
    assert.equal(formatInterval(6 * 24 * 3600000), '6d');
    assert.equal(formatInterval(8 * 24 * 3600000), '1w');
    assert.equal(formatInterval(45 * 24 * 3600000), '1M');
    assert.equal(formatInterval(500), null);
    assert.equal(
      drawnInterval([
        { data: [[0, 1], [3600000, 2]] },
        { data: [[0, 1], [60000, 2]] },
        { data: [[0, 1]] },
      ]),
      60000
    );
    assert.equal(drawnInterval([{ data: [[0, 1]] }]), 0);
  });

  it('tells a duration format from a number format', () => {
    assert.equal(isDuration('ms,ms,'), true);
    assert.equal(isDuration('s,humanize,2'), true);
    assert.equal(isDuration('0,0.[00]'), false);
    assert.equal(isDuration('number'), false);
  });

  it('copies a series with new ids whose metrics still point at each other', () => {
    const source: Series = newSeries({
      metrics: [
        { id: 'm1', type: 'avg', field: 'bytes' },
        { id: 'm2', type: 'derivative', field: 'm1' },
        { id: 'm3', type: 'calculation', variables: [{ id: 'v1', name: 'a', field: 'm2' }] },
      ],
      terms_order_by: 'm1',
    });
    const copy = reIdSeries(source);
    assert.notEqual(copy.id, source.id);
    const [first, second, third] = copy.metrics;
    assert.notEqual(first.id, 'm1');
    assert.equal(second.field, first.id);
    assert.equal(copy.terms_order_by, first.id);
    const variables = third.variables as Array<{ id: string; field: string }>;
    assert.equal(variables[0].field, second.id);
    assert.notEqual(variables[0].id, 'v1');
    assert.equal(source.metrics[1].field, 'm1');
  });

  it('starts a new series as the editor does', () => {
    const series = newSeries();
    assert.equal(series.color, '#68BC00');
    assert.equal(series.split_mode, 'everything');
    assert.equal(series.metrics[0].type, 'count');
    assert.equal(series.split_color_mode, undefined);
  });

  it('compares params whatever the order of their keys', () => {
    assert.equal(stableKey({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } }), stableKey({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
});

describe('the colours a TSVB colour picker reads', () => {
  it('reads a hex colour or its channels separated by commas, and nothing else', () => {
    assert.deepEqual(parseColor('#68BC00'), [104, 188, 0, 1]);
    assert.deepEqual(parseColor('fff'), [255, 255, 255, 1]);
    assert.deepEqual(parseColor('#00000080'), [0, 0, 0, 0.5]);
    assert.deepEqual(parseColor('104,188,0,1'), [104, 188, 0, 1]);
    assert.deepEqual(parseColor('104, 188, 0'), [104, 188, 0, 1]);
    assert.equal(parseColor('red'), undefined);
    assert.equal(parseColor('rgba(104,188,0,1)'), undefined);
    assert.equal(parseColor('1,2'), undefined);
    assert.equal(parseColor(''), undefined);
  });

  it('answers what the editor saves: the channels, or no hex for no colour', () => {
    const output = colorOutput('#68BC00');
    assert.equal(`rgba(${output.rgba.join(',')})`, 'rgba(104,188,0,1)');
    assert.equal(output.hex, '#68bc00');
    assert.equal(colorOutput('#68BC0').hex, '');
    assert.equal(toHex([0, 0, 0, 0.5]), '#00000080');
    assert.equal(cssColor('104,188,0,0.5'), 'rgba(104,188,0,0.5)');
    assert.equal(cssColor(null), 'transparent');
  });
});
