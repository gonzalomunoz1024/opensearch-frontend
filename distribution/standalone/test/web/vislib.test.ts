/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggLabel, bucketFilter, buildAggsDsl, otherBucketTerms, tabify, type AggConfig, type AggContext, type TableColumn } from '../../web/lib/aggs';
import { DEFAULT_FORMAT_SETTINGS } from '../../web/lib/field_formats';
import type { Filter, IndexPattern } from '../../web/lib/types';
import { splitDrawing, splitParts, splitTables, splitTimeFilter } from '../../web/vis/types';
import { axisConfig, drawAxis, keptTicks, placeTick, truncateLabel, type AxisScaleInfo } from '../../web/vis/vislib/axis';
import { heatmapColor } from '../../web/vis/vislib/color_maps';
import { drawMeter, gaugeBucket, gaugeColors, gaugeLabels, gaugeSize, meterConfig } from '../../web/vis/vislib/gauge';
import { seriesColors, standardizeColor } from '../../web/vis/vislib/colors';
import { HandlerError, TOO_SMALL } from '../../web/vis/vislib/handler_error';
import { buildSplitHeatmapModels, colorBucket, heatmapColors, heatmapLabels, type HeatmapParams } from '../../web/vis/vislib/heatmap';
import { groupedCount, groupedNum, isColorDark } from '../../web/vis/vislib/point_series_chart';
import {
  buildPointSeries,
  injectZeros,
  orderXValues,
  stackSeries,
  type VislibSeries,
} from '../../web/vis/vislib/point_series_data';
import { hoverAfter } from '../../web/vis/vislib/legend';
import { layoutPointSeries } from '../../web/vis/vislib/point_series_layout';
import { keptPieLabels, pieTooSmall } from '../../web/vis/vislib/pie_chart';
import { splitTooltipDetail } from '../../web/vis/vislib/series_events';
import { cutSplitTitle, splitTitleRowHeight, splitTitleText, splitTitleTooltip } from '../../web/vis/vislib/split';
import {
  buildSlices,
  convertToPercentage,
  partition,
  percentText,
  pieNames,
  removeZeroSlices,
} from '../../web/vis/vislib/pie_data';
import {
  VislibError,
  axisPoints,
  buildSplitPointSeriesModels,
  scaleValueAxis,
  seriesConfigOf,
  valueDomain,
  valueExtents,
  type PointSeriesParams,
  type SeriesConfig,
} from '../../web/vis/vislib/point_series_model';
import { bandScale, linearNice, linearTicks, tickCount, utcTicks, zonedTimeTicks } from '../../web/vis/vislib/scales';
import { dimmingOpacity, zoneOffset } from '../../web/vis/vislib/settings';
import { arcCentroid, arcPath } from '../../web/vis/vislib/shapes';
import { placeTooltip } from '../../web/vis/vislib/tooltip';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const iso = (time: number) => new Date(time).toISOString();
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

describe('the scales of the classic charts', () => {
  it('ask an axis for as many ticks as its length allows', () => {
    // 0 at 20 pixels, 3 at 40 and 11 at 1000, rounded up in between
    assert.equal(tickCount(10), 0);
    assert.equal(tickCount(20), 0);
    assert.equal(tickCount(40), 3);
    assert.equal(tickCount(164), 5);
    assert.equal(tickCount(400), 6);
    assert.equal(tickCount(1000), 11);
    assert.equal(tickCount(3000), 11);
  });

  it('step by 1, 2 or 5 times a power of ten', () => {
    assert.deepEqual(linearTicks([0, 1200], 6), [0, 200, 400, 600, 800, 1000, 1200]);
    assert.deepEqual(linearTicks([0, 82], 5), [0, 20, 40, 60, 80]);
    assert.deepEqual(linearTicks([0, 1], 4), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('widen a value axis to round ends', () => {
    assert.deepEqual(linearNice([0, 9876]), [0, 10000]);
    assert.deepEqual(linearNice([-3.2, 7.9]), [-4, 8]);
  });

  it('count the ticks of a week by halves of a day, in UTC', () => {
    const ticks = utcTicks([Date.parse('2026-11-15T23:00:00Z'), Date.parse('2026-11-22T23:00:00Z')], 10);
    assert.equal(ticks.length, 14);
    assert.equal(iso(ticks[0]), '2026-11-16T00:00:00.000Z');
    assert.equal(iso(ticks[1]), '2026-11-16T12:00:00.000Z');
    assert.equal(iso(ticks[13]), '2026-11-22T12:00:00.000Z');
  });

  it('put the ticks of a time axis on round moments of the zone the dates are shown in', () => {
    const paris = () => 60;
    const ticks = zonedTimeTicks([Date.parse('2026-11-15T23:00:00Z'), Date.parse('2026-11-22T23:00:00Z')], 10, paris);
    // Midnight and noon in a zone an hour east of UTC
    assert.equal(iso(ticks[0]), '2026-11-15T23:00:00.000Z');
    assert.equal(iso(ticks[1]), '2026-11-16T11:00:00.000Z');
    assert.equal(iso(ticks[ticks.length - 1]), '2026-11-22T23:00:00.000Z');
  });

  it('band names with a tenth of each band left between them', () => {
    const scale = bandScale(['a', 'b', 'c', 'b'], [0, 100], 0.1, 0);
    assert.deepEqual(scale.domain, ['a', 'b', 'c']);
    const step = 100 / 2.9;
    assert.equal(scale('a'), 0);
    close(scale('c'), step * 2);
    close(scale.band, step * 0.9);
    assert.ok(Number.isNaN(scale('d')));
  });
});

describe('the axes of the classic charts', () => {
  it('take the defaults of vislib for what a visualization does not say', () => {
    const value = axisConfig({}, 'value', { ordinal: false, title: 'Count' });
    assert.equal(value.position, 'left');
    assert.deepEqual(value.labels, { show: true, rotate: 0, filter: false, truncate: 100 });
    assert.equal(value.title, 'Count');
    const log = axisConfig({ scale: { type: 'log' } }, 'value', { ordinal: false, title: '' });
    assert.equal(log.labels.filter, true);
    const time = axisConfig({}, 'category', { ordinal: false, title: '' });
    assert.equal(time.position, 'bottom');
    assert.deepEqual(time.labels, { show: true, rotate: 0, filter: true, truncate: 0 });
    // Names under a chart are turned on their side and cut at 100 characters
    const names = axisConfig({}, 'category', { ordinal: true, title: '' });
    assert.deepEqual(names.labels, { show: true, rotate: 90, filter: false, truncate: 100 });
    // A stack round a moving baseline hides its axis but keeps its title
    const wiggle = axisConfig({ scale: { mode: 'wiggle' } }, 'value', { ordinal: false, title: 'Count' });
    assert.equal(wiggle.show, false);
    assert.equal(wiggle.titleShow, true);
  });

  it('cut a label to a number of characters', () => {
    assert.equal(truncateLabel("Women's Accessories", 5), 'Women…');
    assert.equal(truncateLabel("Women's Accessories", 0), "Women's Accessories");
    assert.equal(truncateLabel('Shoes', 5), 'Shoes');
  });

  it('place a label under its tick, and turn it about its end', () => {
    const size = { width: 20, left: 0, advance: 20, ascent: 8, descent: 2 };
    const labels = { show: true, rotate: 0, filter: true, truncate: 0 };
    const flat = placeTick('bottom', labels, 'label', size, 10);
    assert.equal(flat.y, 9);
    assert.equal(flat.dy, '.71em');
    assert.equal(flat.anchor, 'middle');
    assert.equal(flat.box.x, -10);
    assert.equal(flat.box.width, 20);
    assert.equal(Math.round(flat.box.height * 10) / 10, 18.1);
    const turned = placeTick('bottom', { ...labels, rotate: 90 }, 'label', size, 10);
    assert.equal(turned.anchor, 'end');
    assert.equal(turned.dy, '0.3em');
    assert.equal(turned.transform, 'rotate(-90, 0, 9)');
    const left = placeTick('left', labels, 'label', size, 10);
    assert.equal(left.anchor, 'end');
    assert.equal(left.x, -9);
    assert.equal(left.dy, '.32em');
  });

  it('leave out labels past either end and those running into the last one kept', () => {
    const scale: Pick<AxisScaleInfo, 'raw' | 'range'> = { raw: (value) => Number(value), range: [0, 100] };
    const ticks = [0, 20, 40, 60, 80, 100].map((value) => ({ value, box: { x: -15, y: 0, width: 30, height: 10 } }));
    assert.deepEqual(keptTicks(ticks, scale, true, 100), [false, true, false, true, false, false]);
  });

  it('make an axis as deep as its deepest tick and five pixels, and one with no tick left five pixels', () => {
    const scale = (values: number[]): AxisScaleInfo => ({ values, at: () => 0, raw: () => 0, range: [0, 100], extent: [0, 100] });
    const hidden = axisConfig({ labels: { show: false } }, 'value', { ordinal: false, title: '' });
    assert.equal(drawAxis(hidden, scale([0]), String).size, 11);
    assert.equal(drawAxis(hidden, scale([]), String).size, 5);
  });

  it('lay out a chart with its value axis on the left and its categories under it', () => {
    const axis = (config: ReturnType<typeof axisConfig>) => ({
      config,
      format: String,
      scaleFor: (length: number): AxisScaleInfo => ({
        values: [0],
        at: () => 0,
        raw: () => 0,
        range: [0, length],
        extent: [0, length],
      }),
    });
    const value = axisConfig({ labels: { show: false } }, 'value', { ordinal: false, title: '' });
    const category = axisConfig({ labels: { show: false } }, 'category', { ordinal: false, title: '' });
    const layout = layoutPointSeries(500, 300, [axis(value)], [axis(category)]);
    // An axis with no labels is its ticks and five pixels; a title beside it with no text is a
    // pixel wide (its min-width), one under it nothing
    assert.deepEqual(layout.charts, [{ x: 12, y: 10, width: 487, height: 269 }]);
    const [left, bottom] = layout.axes;
    assert.deepEqual(left.rects, [{ x: 1, y: 10, width: 11, height: 269 }]);
    assert.equal(left.transform, 'translate(11,0)');
    assert.deepEqual(bottom.rects, [{ x: 12, y: 279, width: 487, height: 11 }]);
    assert.equal(layout.splitTitles, undefined);
  });

  const hiddenAxis = (config: ReturnType<typeof axisConfig>) => ({
    config,
    format: String,
    scaleFor: (length: number): AxisScaleInfo => ({ values: [0], at: () => 0, raw: () => 0, range: [0, length], extent: [0, length] }),
  });
  const hiddenValue = () => hiddenAxis(axisConfig({ labels: { show: false } }, 'value', { ordinal: false, title: '' }));
  const hiddenCategory = () => hiddenAxis(axisConfig({ labels: { show: false } }, 'category', { ordinal: false, title: '' }));

  it('lay out the rows of a split one under another, a value axis beside each and their titles at the left', () => {
    const layout = layoutPointSeries(500, 130, [hiddenValue()], [hiddenCategory()], { rows: true, count: 2 });
    // The axis under the rows gives way to them: 11 of the 121 pixels asked for 110 is 10
    assert.deepEqual(layout.charts, [
      { x: 26, y: 10, width: 473, height: 45 },
      { x: 26, y: 65, width: 473, height: 45 },
    ]);
    const [left, bottom] = layout.axes;
    assert.deepEqual(left.rects, [
      { x: 15, y: 10, width: 11, height: 45 },
      { x: 15, y: 65, width: 11, height: 45 },
    ]);
    assert.deepEqual(left.title?.rects.map((rect) => rect.x), [14, 14]);
    assert.deepEqual(bottom.rects, [{ x: 26, y: 110, width: 473, height: 11 }]);
    // Each title's SVG is as high as the first one's room was, before the value axes were drawn
    assert.equal(layout.splitTitles?.width, 14);
    assert.equal(layout.splitTitles?.height, 50);
    assert.deepEqual(layout.splitTitles?.boxes, [
      { x: 0, y: 10, width: 14, height: 50 },
      { x: 0, y: 60, width: 14, height: 50 },
    ]);
  });

  it('lay out the columns of a split side by side, an axis of names under each and their titles under them', () => {
    const layout = layoutPointSeries(500, 300, [hiddenValue()], [hiddenCategory()], { rows: false, count: 2, titleRow: 16 });
    assert.deepEqual(layout.charts, [
      { x: 12, y: 10, width: 238.5, height: 253 },
      { x: 260.5, y: 10, width: 238.5, height: 253 },
    ]);
    const [left, bottom] = layout.axes;
    assert.deepEqual(left.rects, [{ x: 1, y: 10, width: 11, height: 253 }]);
    assert.deepEqual(bottom.rects, [
      { x: 12, y: 263, width: 238.5, height: 11 },
      { x: 260.5, y: 263, width: 238.5, height: 11 },
    ]);
    assert.equal(layout.splitTitles?.width, 249);
    assert.equal(layout.splitTitles?.height, 14);
    assert.deepEqual(layout.splitTitles?.boxes, [
      { x: 12, y: 274, width: 243.5, height: 16 },
      { x: 255.5, y: 274, width: 243.5, height: 16 },
    ]);
  });

  it('make the row of titles under the columns as high as a line of their text, 16 pixels at most', () => {
    // The SVG on the baseline, and under it the descent less the greater half of the leading:
    // 3 less 1 of the -3 pixels a face of 17 leaves in a line of 14
    assert.equal(splitTitleRowHeight({ ascent: 14, descent: 3 }), 16);
    assert.equal(splitTitleRowHeight({ ascent: 14, descent: 2 }), 15);
    assert.equal(splitTitleRowHeight({ ascent: 13, descent: 1 }), 15);
    assert.equal(splitTitleRowHeight({ ascent: 9, descent: 2 }), 16);
  });
});

const aggOf = (id: string, type: string, schema: string): AggConfig => ({ id, type, schema, params: {} });
const columnOf = (id: string, name: string, agg: AggConfig, extra: Partial<TableColumn> = {}): TableColumn => ({
  id,
  name,
  kind: agg.schema === 'metric' ? 'metric' : 'bucket',
  agg,
  schema: agg.schema,
  format: (value) => (value === '' ? '-' : String(value)),
  ...extra,
});

describe('the series of a chart', () => {
  const x = columnOf('col-0-2', 'timestamp per day', aggOf('2', 'date_histogram', 'segment'), { isDate: true, interval: DAY });
  const group = columnOf('col-1-3', 'extension', aggOf('3', 'terms', 'group'));
  const count = columnOf('col-2-1', 'Count', aggOf('1', 'count', 'metric'));

  it('are named after their group, and an empty name stays empty', () => {
    const data = buildPointSeries(
      [x, group, count],
      [
        { 'col-0-2': 0, 'col-1-3': 'css', 'col-2-1': 3 },
        { 'col-0-2': 0, 'col-1-3': '', 'col-2-1': 1 },
        { 'col-0-2': 3 * DAY, 'col-1-3': 'css', 'col-2-1': 2 },
      ]
    );
    assert.deepEqual(
      data.series.map((series) => [series.rawId, series.label]),
      [
        ['css-col-2-1', 'css'],
        ['-col-2-1', ''],
      ]
    );
    assert.equal(data.xLabel, 'timestamp per day');
    assert.equal(data.yLabel, 'Count');
  });

  it('name each measure apart when there are several', () => {
    const average = columnOf('col-3-4', 'Average bytes', aggOf('4', 'avg', 'metric'));
    const data = buildPointSeries([x, group, count, average], [{ 'col-0-2': 0, 'col-1-3': 'css', 'col-2-1': 3, 'col-3-4': 5 }]);
    assert.deepEqual(
      data.series.map((series) => series.label),
      ['css: Count', 'css: Average bytes']
    );
    assert.equal(data.yLabel, '');
  });

  it('put back the buckets a histogram skips, a step apart', () => {
    const data = buildPointSeries(
      [x, count],
      [
        { 'col-0-2': 0, 'col-2-1': 3 },
        { 'col-0-2': 3 * DAY, 'col-2-1': 2 },
      ]
    );
    assert.deepEqual(orderXValues(data), [0, DAY, 2 * DAY, 3 * DAY]);
  });

  const series = (label: string, values: Array<[number, number]>): VislibSeries => ({
    rawId: label,
    aggId: '1',
    label,
    values: values.map(([at, y]) => ({ x: at, y, series: label, seriesId: label })),
    metric: count,
    format: String,
    groupKeys: [label],
  });

  it('stack with a zero where a series has no bucket, negative values apart', () => {
    const items = [
      series('a', [
        [0, 2],
        [1, -1],
      ]),
      series('b', [[0, 3]]),
      series('c', [
        [0, 1],
        [1, -2],
      ]),
    ];
    injectZeros(items, [0, 1]);
    // The zero put in belongs to no series
    assert.equal(items[1].values[1].seriesId, undefined);
    stackSeries(items, 'normal');
    assert.deepEqual(
      items.map((item) => item.values.map((value) => value.y0)),
      [
        [0, 0],
        [2, 0],
        [5, -1],
      ]
    );
  });

  it('stack as shares of each bucket in the percentage mode', () => {
    const items = [series('a', [[0, 1]]), series('b', [[0, 3]])];
    stackSeries(items, 'percentage');
    assert.deepEqual(
      items.map((item) => [item.values[0].y0, item.values[0].y]),
      [
        [0, 0.25],
        [0.25, 0.75],
      ]
    );
  });

  it('take the settings of their measure, matched without what a percentile adds to its id', () => {
    const percentile = { ...series('p', []), aggId: '1.95' };
    const config = seriesConfigOf(
      { seriesParams: [{ data: { id: '1', label: 'Count' }, show: 'false', type: 'histogram', mode: 'stacked', valueAxis: 'ValueAxis-1' }] },
      percentile
    );
    // vislib shows a series whose show is any value, the text "false" included
    assert.equal(config.show, true);
    assert.equal(config.type, 'histogram');
    assert.equal(config.mode, 'stacked');
    const fallback = seriesConfigOf({ type: 'area', mode: 'stacked' }, series('q', []));
    assert.equal(fallback.type, 'area');
    assert.equal(fallback.mode, 'stacked');
  });
});

describe('the value axis of a chart', () => {
  const config = (scale: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    axisConfig({ scale, ...extra }, 'value', { ordinal: false, title: '' });

  it('reaches zero and the values on either side of it', () => {
    assert.deepEqual(valueExtents(config({}), [3, 9]), [0, 9]);
    assert.deepEqual(valueExtents(config({}), [-4, -1]), [-4, 0]);
  });

  it('takes the bounds it is set to, as shares in the percentage mode', () => {
    assert.deepEqual(valueExtents(config({ setYExtents: true, min: 10, max: 50 }), [3, 9]), [10, 50]);
    assert.deepEqual(valueExtents(config({ setYExtents: true, min: 10, max: 50, mode: 'percentage' }), [3, 9]), [0.1, 0.5]);
    // A bound given without setting the extents still counts, as vislib reads it
    assert.deepEqual(valueExtents(config({ max: 50 }), [3, 9]), [0, 50]);
  });

  it('fits the data with a margin when it is asked to', () => {
    assert.deepEqual(valueExtents(config({ defaultYExtents: true, boundsMargin: 2 }), [3, 9]), [1, 9]);
  });

  it('refuses what a logarithm cannot show', () => {
    assert.throws(() => valueExtents(config({ type: 'log' }), [-3, 9]), VislibError);
    assert.deepEqual(valueExtents(config({ type: 'log' }), [3, 900]), [1, 900]);
    assert.throws(() => scaleValueAxis(config({ type: 'log', mode: 'percentage' }), [3, 9], 200), /Can't mix percentage mode with log scale/);
  });

  it('makes room for the values written on the marks', () => {
    const padded = axisConfig({}, 'value', { ordinal: false, title: '', valuesOnChart: true });
    const [low, high] = valueDomain(padded, [0, 100], 150);
    assert.equal(low, 0);
    close(high, 110);
  });

  it('is made round at its ends, with as many ticks as its length allows', () => {
    const { scale, info } = scaleValueAxis(config({}), [0, 9876], 164);
    assert.deepEqual(scale.domain, [0, 10000]);
    assert.deepEqual(info.values, [0, 2000, 4000, 6000, 8000, 10000]);
    assert.equal(scale(5000), 82);
  });
});

describe('the bars of a bucket', () => {
  const config = (rawId: string, type: SeriesConfig['type'], mode: SeriesConfig['mode'], valueAxis?: string) =>
    ({ type, mode, valueAxis, data: { rawId } }) as SeriesConfig;

  it('stand side by side, a stack taking one place', () => {
    const series = [
      config('a', 'histogram', 'stacked'),
      config('b', 'histogram', 'stacked'),
      config('c', 'histogram', 'normal'),
      config('d', 'line', 'normal'),
    ];
    assert.equal(groupedCount(series, 'ValueAxis-1'), 2);
    assert.equal(groupedNum(series, 'ValueAxis-1', 'a'), 0);
    assert.equal(groupedNum(series, 'ValueAxis-1', 'b'), 0);
    assert.equal(groupedNum(series, 'ValueAxis-1', 'c'), 1);
    // vislib counts the lines too
    assert.equal(groupedNum(series, 'ValueAxis-1', 'd'), 2);
  });

  it('carry their values in white on a dark colour', () => {
    assert.equal(isColorDark(0, 0, 0), true);
    assert.equal(isColorDark(255, 255, 255), false);
    assert.equal(isColorDark(0x54, 0xb3, 0x99), false);
    assert.equal(isColorDark(0x2a, 0x5a, 0x4d), true);
  });
});

describe('the tooltip of a chart', () => {
  const chart = { top: 0, left: 0, width: 600, height: 400 };
  const page = { top: 0, left: 0, width: 1400, height: 900 };

  it('sits right of and below the pointer', () => {
    assert.deepEqual(placeTooltip({ width: 200, height: 60 }, { x: 100, y: 100 }, [chart, page]), {
      top: 110,
      left: 110,
      _top: 'south',
      _left: 'east',
    });
  });

  it('turns to the other side where it would leave the chart, and keeps to it', () => {
    const placement = placeTooltip({ width: 200, height: 60 }, { x: 500, y: 380 }, [chart, page]);
    assert.deepEqual(placement, { top: 310, left: 290, _top: 'north', _left: 'west' });
    // Back where both sides fit, it stays where it went last
    assert.deepEqual(placeTooltip({ width: 200, height: 60 }, { x: 300, y: 200 }, [chart, page], placement), {
      top: 130,
      left: 90,
      _top: 'north',
      _left: 'west',
    });
  });
});

describe('the colours of a classic chart', () => {
  it('write a colour of the setting as lower-case hex, as the original standardizes it', () => {
    assert.equal(standardizeColor('#54B399'), '#54b399');
    assert.equal(standardizeColor('#ABC'), '#aabbcc');
    assert.equal(standardizeColor('#54B39980'), '#54b399');
    assert.equal(standardizeColor('rgba(84, 179, 153, 0.5)'), '#54b399');
    assert.equal(standardizeColor('red', () => '#ff0000'), '#ff0000');
  });

  it('take the picked colour first, then the setting, then the palette', () => {
    const colors = seriesColors(['vislibPicked', 'vislibSet', 'vislibOther'], { vislibPicked: '#3F6833' }, { vislibSet: '#D36086' });
    assert.equal(colors.get('vislibPicked'), '#3F6833');
    assert.equal(colors.get('vislibSet'), '#d36086');
    assert.match(colors.get('vislibOther') ?? '', /^#[0-9A-F]{6}$/i);
  });
});

describe('the settings the classic charts read', () => {
  it('dim the other series by a share, a half when the setting is no share', () => {
    assert.equal(dimmingOpacity('0.3'), 0.3);
    assert.equal(dimmingOpacity(0), 0);
    assert.equal(dimmingOpacity('2'), 0.5);
    assert.equal(dimmingOpacity(undefined), 0.5);
  });

  it('know how far east of UTC a zone is at a moment', () => {
    assert.equal(zoneOffset('UTC')(Date.parse('2026-11-16T00:00:00Z')), 0);
    const paris = zoneOffset('Europe/Paris');
    assert.equal(paris(Date.parse('2026-11-16T00:00:00Z')), 60);
    assert.equal(paris(Date.parse('2026-07-01T00:00:00Z')), 120);
    assert.equal(zoneOffset('America/New_York')(Date.parse('2026-11-16T00:00:00Z')), -300);
  });
});

describe('a pie', () => {
  const os = columnOf('col-0-2', 'machine.os', aggOf('2', 'terms', 'segment'));
  const osCount = columnOf('col-1-1', 'Count', aggOf('1', 'count', 'metric'));
  const ext = columnOf('col-2-3', 'extension', aggOf('3', 'terms', 'segment'));
  const extCount = columnOf('col-3-1', 'Count', aggOf('1', 'count', 'metric'));
  const table = {
    columns: [os, osCount, ext, extCount],
    rows: [
      { 'col-0-2': 'win', 'col-1-1': 6, 'col-2-3': 'css', 'col-3-1': 4 },
      { 'col-0-2': 'win', 'col-1-1': 6, 'col-2-3': 'gif', 'col-3-1': 2 },
      { 'col-0-2': 'osx', 'col-1-1': 2, 'col-2-3': 'css', 'col-3-1': 2 },
      { 'col-0-2': 'ios', 'col-1-1': 0, 'col-2-3': 'gif', 'col-3-1': 0 },
    ],
  };

  it('has a slice per bucket inside the slice of the bucket before it', () => {
    const root = buildSlices(table);
    assert.deepEqual(
      root.children.map((slice) => [slice.name, slice.size, slice.children.map((child) => child.name)]),
      [
        ['win', 6, ['css', 'gif']],
        ['osx', 2, ['css']],
        ['ios', 0, ['gif']],
      ]
    );
    assert.equal(root.children[0].bucket?.column, os);
    // The legend names the slices ring by ring, each once
    assert.deepEqual(pieNames([root]), ['win', 'osx', 'ios', 'css', 'gif']);
  });

  it('shares the circle by the shares of the whole, the rings by area', () => {
    const root = removeZeroSlices(buildSlices(table));
    assert.equal(root.children.length, 2);
    convertToPercentage(root);
    const nodes = partition(root);
    assert.deepEqual(
      nodes.map((node) => node.name || 'root'),
      ['root', 'win', 'css', 'gif', 'osx', 'css']
    );
    close(root.value, 100);
    const [, win, winCss, , osx] = nodes;
    close(win.dx, 0.75);
    close(osx.x, 0.75);
    close(winCss.dx, 0.5);
    assert.equal(win.y, 1 / 3);
    assert.equal(winCss.depth, 2);
    assert.equal(winCss.percentOfGroup, 4 / 6);
  });

  it('writes shares as numeral does, with at most two decimals', () => {
    assert.equal(percentText(0.2639), '26.39%');
    assert.equal(percentText(0.247), '24.7%');
    assert.equal(percentText(0.25), '25%');
    assert.equal(percentText(1 / 3), '33.33%');
    assert.equal(percentText(0.123456), '12.35%');
  });

  it('draws its slices as d3 draws arcs', () => {
    assert.equal(arcPath(0, 10, 0, 2 * Math.PI), 'M0,10A10,10 0 1,1 0,-10A10,10 0 1,1 0,10Z');
    assert.equal(arcPath(0, 100, 0, Math.PI / 2), `M${100 * Math.cos(-Math.PI / 2)},-100A100,100 0 0,1 100,0L0,0Z`);
    const ring = arcPath(50, 100, Math.PI / 2, Math.PI);
    assert.match(ring, /^M100,0A100,100 0 0,1 [-\d.e]+,100L[-\d.e]+,50A50,50 0 0,0 50,0Z$/);
    const [x, y] = arcCentroid(50, 100, 0, Math.PI / 2);
    close(x, 75 * Math.cos(-Math.PI / 4));
    close(y, 75 * Math.sin(-Math.PI / 4));
  });

  it('leaves out a name that runs into one kept before it on the same side', () => {
    assert.deepEqual(
      keptPieLabels([
        { left: 100, top: 0, bottom: 20 },
        { left: 120, top: 10, bottom: 30 },
        { left: -200, top: 10, bottom: 30 },
        { left: 100, top: 40, bottom: 60 },
        undefined,
      ]),
      [true, false, true, true, false]
    );
  });

  it('is too small for a room 20 pixels wide or high or less, one of no width too', () => {
    assert.equal(pieTooSmall({ width: 0, height: 194 }), true);
    assert.equal(pieTooSmall({ width: 42, height: 9.6 }), true);
    assert.equal(pieTooSmall({ width: 20, height: 100 }), true);
    assert.equal(pieTooSmall({ width: 100, height: 20 }), true);
    assert.equal(pieTooSmall({ width: 21, height: 21 }), false);
  });
});

describe("vislib's handler", () => {
  it('says why the charts cannot be drawn in a heading of a box that takes their place', () => {
    assert.equal(
      renderToStaticMarkup(createElement(HandlerError, { message: TOO_SMALL })),
      '<div class="visError chart error" role="alert" data-test-subj="visLibVisualizeError">' +
        '<h4>This container is too small to render the visualization</h4></div>'
    );
  });
});

describe('a heat map', () => {
  it("takes its colours from the theme's maps, as getHeatmapColors does", () => {
    // As OpenSearch Dashboards 3.9.0 gives them with the Atlas theme
    assert.equal(heatmapColor(0, 'Greens'), 'rgb(255,255,255)');
    assert.equal(heatmapColor(0.25, 'Greens'), 'rgb(204,227,222)');
    assert.equal(heatmapColor(0.75, 'Greens'), 'rgb(101,173,158)');
    assert.equal(heatmapColor(0, 'Green to Red'), 'rgb(52,199,89)');
    assert.equal(heatmapColor(0.5, 'Green to Red'), 'rgb(255,149,0)');
    assert.equal(heatmapColor(0.1, 'Green to Red'), 'rgb(93,189,71)');
    // The dark theme's own green, orange and red
    assert.equal(heatmapColor(0, 'Green to Red', true), 'rgb(48,209,88)');
    assert.equal(heatmapColor(0, 'Greens', true), heatmapColor(0, 'Greens'));
    assert.throws(() => heatmapColor(1.5, 'Greens'), /from 0 to 1/);
    assert.throws(() => heatmapColor(0.5, 'Purples'), /invalid colorSchemaName/);
  });

  it('names its ranges as vislib does', () => {
    const format = (value: number) => String(value);
    // Over a stretch of more than ten, whole numbers
    assert.deepEqual(heatmapLabels({ colorsNumber: 4 }, [0, 200000], format), [
      '0 - 50000',
      '50000 - 100000',
      '100000 - 150000',
      '150000 - 200000',
    ]);
    assert.deepEqual(heatmapLabels({ colorsNumber: 2 }, [1.5, 101.5], format), ['1 - 52', '52 - 102']);
    // Over a shorter one, as they fall
    assert.deepEqual(heatmapLabels({ colorsNumber: 2 }, [0.5, 10.5], format), ['0.5 - 5.5', '5.5 - 10.5']);
    assert.deepEqual(heatmapLabels({ colorsNumber: 3, percentageMode: true }, [0, 9], format), ['0% - 34%', '34% - 67%', '67% - 100%']);
    assert.deepEqual(heatmapLabels({ colorsNumber: 4 }, [5, 5], format), ['5']);
    const ranges = { setColorRange: true, colorsRange: [{ from: 0, to: 10 }, { from: 10, to: null }] };
    assert.deepEqual(heatmapLabels(ranges, [0, 100], (value) => `#${value}`), ['#0 - #10', '#10 - ']);
  });

  it('colours its ranges along the map, an empty name not at all', () => {
    const colors = heatmapColors(['a', '', 'b', 'c'], 'Greens', false, false);
    assert.deepEqual(Object.keys(colors), ['a', 'b', 'c']);
    assert.equal(colors.a, heatmapColor(0, 'Greens'));
    assert.equal(colors.b, heatmapColor(0.5, 'Greens'));
    assert.equal(heatmapColors(['a', 'b'], 'Greens', true, false).a, heatmapColor(1, 'Greens'));
  });

  it('puts a value in the range it falls in', () => {
    const params = { colorsNumber: 4 };
    assert.equal(colorBucket(0, params, [0, 100]), 0);
    assert.equal(colorBucket(60, params, [0, 100]), 2);
    assert.equal(colorBucket(100, params, [0, 100]), 3);
    assert.equal(colorBucket(7, params, [7, 7]), 0);
    assert.equal(colorBucket(7, params, [NaN, NaN]), 3);
    assert.equal(colorBucket(null, params, [0, 100]), -1);
    const ranges = { setColorRange: true, colorsRange: [{ from: 0, to: 10 }, { from: 10, to: 20 }] };
    assert.equal(colorBucket(15, ranges, [0, 100]), 1);
    assert.equal(colorBucket(25, ranges, [0, 100]), -1);
    // Nothing counts as zero among ranges
    assert.equal(colorBucket(null, ranges, [0, 100]), 0);
  });
});

describe('the charts of a split', () => {
  const day = columnOf('col-0-2', 'timestamp per day', aggOf('2', 'date_histogram', 'segment'), { isDate: true, interval: DAY });
  const os = columnOf('col-0-3', 'machine.os', aggOf('3', 'terms', 'segment'));
  const ext = columnOf('col-1-4', 'extension', aggOf('4', 'terms', 'group'));
  const count = columnOf('col-2-1', 'Count', aggOf('1', 'count', 'metric'));
  const stacked: PointSeriesParams = {
    seriesParams: [{ data: { id: '1', label: 'Count' }, show: true, type: 'histogram', mode: 'stacked', valueAxis: 'ValueAxis-1' }],
    valueAxes: [{ id: 'ValueAxis-1', type: 'value', scale: { mode: 'normal' } }],
  };
  const byDay = (rows: Array<[number, number]>) => ({
    columns: [day, count],
    rows: rows.map(([at, value]) => ({ 'col-0-2': at, 'col-2-1': value })),
  });
  const byName = (rows: Array<[string, string, number]>) => ({
    columns: [os, ext, count],
    rows: rows.map(([name, group, value]) => ({ 'col-0-3': name, 'col-1-4': group, 'col-2-1': value })),
  });
  const days = [
    byDay([
      [2 * DAY, 1],
      [0, 3],
    ]),
    byDay([
      [DAY, 5],
      [4 * DAY, 2],
    ]),
  ];

  it('share the values along the axis: those of every chart, ordered, none put back between them', () => {
    const { frame, charts } = buildSplitPointSeriesModels({ params: stacked, tables: days, columnCount: 3, percentFormat: String });
    assert.deepEqual(frame.xValues, [0, DAY, 2 * DAY, 4 * DAY]);
    assert.equal(charts.length, 2);
    assert.equal(charts[1].xValues, frame.xValues);
    // With no time range about it, the time runs from the first value of all of them to the last
    assert.deepEqual([charts[0].ordered?.min, charts[0].ordered?.max, charts[0].ordered?.endzones], [0, 4 * DAY, false]);
    // A chart that is not split puts back the days it skips
    assert.deepEqual(orderXValues(buildPointSeries(days[1].columns, days[1].rows)), [DAY, 2 * DAY, 3 * DAY, 4 * DAY]);
    assert.deepEqual(orderXValues(buildPointSeries(days[1].columns, days[1].rows), false, false), [DAY, 4 * DAY]);
  });

  it('stack each chart over the values they share, its value axis reaching the values of all of them', () => {
    const { frame, charts } = buildSplitPointSeriesModels({ params: stacked, tables: days, columnCount: 3, percentFormat: String });
    assert.deepEqual(
      charts[0].series[0].data.values.map((point) => [point.x, point.y]),
      [
        [0, 3],
        [DAY, 0],
        [2 * DAY, 1],
        [4 * DAY, 0],
      ]
    );
    assert.equal(frame.series.length, 2);
    assert.equal(Math.max(...axisPoints(frame, 'ValueAxis-1')), 5);
    assert.equal(Math.max(...axisPoints(charts[0], 'ValueAxis-1')), 3);
    // The tooltip counts the columns of the whole table, the split's among them
    assert.equal(charts[0].data.columnCount, 3);
  });

  it('order names as the charts bring them, chart after chart, and name the legend after the series of all of them', () => {
    const { frame, charts } = buildSplitPointSeriesModels({
      params: {},
      tables: [
        byName([
          ['b', 'css', 1],
          ['a', 'gif', 2],
        ]),
        byName([
          ['c', 'png', 3],
          ['a', 'css', 4],
        ]),
      ],
      columnCount: 4,
      percentFormat: String,
    });
    assert.deepEqual(frame.xValues, ['b', 'a', 'c']);
    assert.deepEqual(frame.labels, ['css', 'gif', 'png']);
    assert.deepEqual(
      charts.map((chart) => chart.series.map((series) => series.data.label)),
      [
        ['css', 'gif'],
        ['png', 'css'],
      ]
    );
  });

  it('give heat maps the names of every chart beside them and ranges over all their values, asking the first alone whether it has too many', () => {
    const tables = [
      byName([
        ['win', 'css', 1],
        ['win', 'gif', 2],
      ]),
      byName([['osx', 'png', 10]]),
    ];
    const params: HeatmapParams = {
      type: 'heatmap',
      colorsNumber: 4,
      colorSchema: 'Greens',
      valueAxes: [{ id: 'ValueAxis-1', type: 'value', show: false, scale: { type: 'linear', defaultYExtents: false }, labels: { show: false } }],
    };
    const { frame, charts } = buildSplitHeatmapModels({ params, tables, columnCount: 4, percentFormat: String, maxBuckets: 2, dark: false });
    assert.equal(frame.error, undefined);
    assert.deepEqual(charts[1].categoryAxes[1].values, ['css', 'gif', 'png']);
    assert.deepEqual(charts[1].heatmap?.labels, ['0 - 2.5', '2.5 - 5', '5 - 7.5', '7.5 - 10']);
    assert.deepEqual(frame.labels, ['0 - 2.5', '2.5 - 5', '5 - 7.5', '7.5 - 10']);
    const tooMany = buildSplitHeatmapModels({ params, tables, columnCount: 4, percentFormat: String, maxBuckets: 1, dark: false });
    assert.equal(tooMany.charts[1].error, 'There are too many series defined (2). The configured maximum is 1.');
  });

  it("end the tooltip with the split's name and the chart's key as it is", () => {
    const cell = { table: { columns: [], rows: [] }, row: {} };
    const range = { ...os, format: (value: unknown) => `range ${JSON.stringify(value)}` };
    assert.deepEqual(splitTooltipDetail({ column: os, key: 'ios', cell }), { label: 'machine.os', value: 'ios' });
    assert.deepEqual(splitTooltipDetail({ column: day, key: 3 * DAY, cell }), { label: 'timestamp per day', value: String(3 * DAY) });
    assert.deepEqual(splitTooltipDetail({ column: os, key: null, cell }), { label: 'machine.os', value: '' });
    // A range, which the original's tooltip fails on, as its bucket's text
    assert.deepEqual(splitTooltipDetail({ column: range, key: { from: 0, to: 10 }, cell }), {
      label: 'machine.os',
      value: 'range {"from":0,"to":10}',
    });
  });
});

const logs: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [
    { name: 'timestamp', type: 'date', searchable: true, aggregatable: true },
    { name: 'bytes', type: 'number', searchable: true, aggregatable: true },
    { name: 'clientip', type: 'ip', searchable: true, aggregatable: true },
    { name: 'machine.os.keyword', type: 'string', searchable: true, aggregatable: true },
  ],
  fieldFormatMap: {},
};
const logsContext: AggContext = { indexPattern: logs, formatSettings: { ...DEFAULT_FORMAT_SETTINGS, timeZone: 'UTC' } };
const countAgg: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };

describe('the buckets of a chart', () => {
  const keysOf = (agg: AggConfig, buckets: unknown[]) => {
    const table = tabify([countAgg, agg], { aggregations: { '2': { buckets } } }, logsContext);
    return table.rows.map((row) => table.columns[0].format(row[table.columns[0].id]));
  };

  it("write a range of numbers as the original's range format", () => {
    const agg: AggConfig = { id: '2', enabled: true, type: 'range', schema: 'segment', params: { field: 'bytes' } };
    assert.deepEqual(
      keysOf(agg, [
        { key: '*-1000.0', to: 1000, doc_count: 1 },
        { key: '1000.0-5000.0', from: 1000, to: 5000, doc_count: 2 },
        { key: '5000.0-*', from: 5000, doc_count: 3 },
      ]),
      ['≥ -∞ and < 1,000', '≥ 1,000 and < 5,000', '≥ 5,000 and < +∞']
    );
  });

  it('write a range of dates from, to, before or after', () => {
    const agg: AggConfig = { id: '2', enabled: true, type: 'date_range', schema: 'segment', params: { field: 'timestamp' } };
    const day = Date.UTC(2026, 10, 16);
    assert.deepEqual(
      keysOf(agg, [
        { key: 'a', to: day, doc_count: 1 },
        { key: 'b', from: day, to: day + DAY, doc_count: 1 },
        { key: 'c', from: day + DAY, doc_count: 1 },
      ]),
      [
        'Before Nov 16, 2026 @ 00:00:00.000',
        'Nov 16, 2026 @ 00:00:00.000 to Nov 17, 2026 @ 00:00:00.000',
        'After Nov 17, 2026 @ 00:00:00.000',
      ]
    );
  });

  it('write a range of addresses from one to another, and a mask as it is', () => {
    const agg = (ipRangeType: string): AggConfig => ({
      id: '2',
      enabled: true,
      type: 'ip_range',
      schema: 'segment',
      // The buckets are those asked: here a range from one address on
      params: { field: 'clientip', ipRangeType, ranges: { fromTo: [{ from: '0.0.0.0', to: '127.255.255.255' }, { from: '128.0.0.0' }] } },
    });
    const buckets = [
      { key: '0.0.0.0-127.255.255.255', from: '0.0.0.0', to: '127.255.255.255', doc_count: 1 },
      { key: '128.0.0.0-*', from: '128.0.0.0', doc_count: 1 },
    ];
    assert.deepEqual(keysOf(agg('fromTo'), buckets), ['0.0.0.0 to 127.255.255.255', '128.0.0.0 to Infinity']);
    assert.deepEqual(keysOf(agg('mask'), [{ key: '0.0.0.0/1', from: '0.0.0.0', to: '128.0.0.0', doc_count: 1 }]), ['0.0.0.0/1']);
  });

  it('end a month of a date histogram a calendar month on', () => {
    const agg: AggConfig = { id: '2', enabled: true, type: 'date_histogram', schema: 'segment', params: { field: 'timestamp', interval: 'M' } };
    const december = new Date(2026, 11, 1).getTime();
    const table = tabify([countAgg, agg], { aggregations: { '2': { buckets: [{ key: december, doc_count: 1 }] } } }, logsContext);
    const filter = bucketFilter(table.columns[0], december, logsContext);
    assert.deepEqual(filter?.range?.timestamp, {
      gte: new Date(december).toISOString(),
      lt: new Date(2027, 0, 1).toISOString(),
      format: 'strict_date_optional_time',
    });
  });

  it('give each chart of a split its bucket', () => {
    const split = columnOf('col-0-4', 'machine.os.keyword', aggOf('4', 'terms', 'split'));
    const count = columnOf('col-1-1', 'Count', aggOf('1', 'count', 'metric'));
    const parts = splitTables({
      columns: [split, count],
      rows: [
        { 'col-0-4': 'ios', 'col-1-1': 1 },
        { 'col-0-4': 'osx', 'col-1-1': 2 },
        { 'col-0-4': 'ios', 'col-1-1': 3 },
      ],
    });
    assert.deepEqual(
      parts.map((part) => [part.label, part.split?.key, part.table.rows.length, part.table.columns.length]),
      [
        ['ios: machine.os.keyword', 'ios', 2, 1],
        ['osx: machine.os.keyword', 'osx', 1, 1],
      ]
    );
    assert.equal(parts[0].split?.column, split);
    // Its click is in the table before the split, at the bucket's first row
    assert.equal(parts[1].split?.cell.table.rows.length, 3);
    assert.deepEqual(parts[1].split?.cell.row, { 'col-0-4': 'osx', 'col-1-1': 2 });
  });

  it('title the chart of an empty bucket by nothing before its name, as vislib writes it', () => {
    const split = columnOf('col-0-4', 'extension.keyword', aggOf('4', 'terms', 'split'));
    const count = columnOf('col-1-1', 'Count', aggOf('1', 'count', 'metric'));
    const parts = splitTables({ columns: [split, count], rows: [{ 'col-0-4': '', 'col-1-1': 1 }] });
    assert.deepEqual(
      parts.map((part) => part.label),
      [': extension.keyword']
    );
  });

  it('leave a chart that is not split whole', () => {
    const count = columnOf('col-0-1', 'Count', aggOf('1', 'count', 'metric'));
    const table = { columns: [count], rows: [{ 'col-0-1': 4 }] };
    assert.equal(splitParts(table), undefined);
    assert.deepEqual(splitTables(table), [{ table }]);
  });

  it('leave the split of a data table to the table, which draws a table of each bucket from the whole', () => {
    assert.equal(splitDrawing('table'), 'whole');
    // vislib's charts lay out their charts in its frame; the page draws the parts of the rest
    assert.deepEqual(['pie', 'gauge', 'goal'].map(splitDrawing), ['frame', 'frame', 'frame']);
    assert.deepEqual(
      ['area', 'line', 'histogram', 'horizontal_bar', 'heatmap'].map(splitDrawing),
      ['frame', 'frame', 'frame', 'frame', 'frame']
    );
    assert.deepEqual(['metric', 'tagcloud', 'markdown'].map(splitDrawing), ['parts', 'parts', 'parts']);
  });

  it('cut the title of a chart of a split as vislib does: to the letters nine tenths of its room hold, less five', () => {
    // Ten pixels a letter
    const measure = (text: string) => text.length * 10;
    assert.equal(splitTitleText('abcdefghij', 200, measure), 'abcdefghij');
    assert.equal(splitTitleText('abcdefghij', 100, measure), 'abcd...');
    assert.equal(splitTitleText('abcdefghij', 20, measure), '...');
  });

  it('show the whole of a title that was cut in the tooltip, and nothing for one that fits', () => {
    const measure = (text: string) => text.length * 10;
    assert.deepEqual(cutSplitTitle('abcdefghij', 200, measure), { text: 'abcdefghij', cut: false });
    assert.deepEqual(cutSplitTitle('abcdefghij', 100, measure), { text: 'abcd...', cut: true });
    // Nine tenths of its room: a title of exactly that length is left whole
    assert.equal(cutSplitTitle('abcdefghi', 100, measure).cut, false);
    assert.deepEqual(cutSplitTitle('abcdefghij', 20, measure), { text: '...', cut: true });
    // A line of plain text where the pointer is, no rows
    assert.deepEqual(splitTitleTooltip('CN: geo.dest: Descending', 37, 873), {
      clientX: 37,
      clientY: 873,
      text: 'CN: geo.dest: Descending',
      details: [],
    });
  });

  it('filter out the terms beside the "Other" bucket, those of the rows it was clicked in', () => {
    const terms = (otherBucket: boolean): AggConfig => ({
      id: '3',
      enabled: true,
      type: 'terms',
      schema: 'group',
      params: { field: 'machine.os.keyword', otherBucket },
    });
    const time: AggConfig = { id: '2', enabled: true, type: 'date_histogram', schema: 'segment', params: { field: 'timestamp', interval: 'd' } };
    const day = Date.UTC(2026, 10, 16);
    const response = {
      aggregations: {
        '2': {
          buckets: [
            { key: day, doc_count: 5, '3': { buckets: [{ key: 'ios', doc_count: 2 }, { key: 'osx', doc_count: 1 }, { key: '__other__', doc_count: 2 }] } },
            { key: day + DAY, doc_count: 3, '3': { buckets: [{ key: 'win 8', doc_count: 2 }, { key: '__missing__', doc_count: 1 }, { key: '__other__', doc_count: 1 }] } },
          ],
        },
      },
    };
    const table = tabify([countAgg, time, terms(true)], response, logsContext);
    const group = table.columns[1];
    const otherOf = (at: number) => table.rows.filter((row) => row[group.id] === '__other__')[at];
    const first = bucketFilter(group, '__other__', logsContext, { table, row: otherOf(0) });
    assert.equal(first?.meta.negate, true);
    assert.equal(first?.meta.type, 'phrases');
    assert.deepEqual(first?.meta.params, ['ios', 'osx']);
    assert.deepEqual(first?.query, {
      bool: { should: [{ match_phrase: { 'machine.os.keyword': 'ios' } }, { match_phrase: { 'machine.os.keyword': 'osx' } }], minimum_should_match: 1 },
    });
    // The second day's: its own terms, the missing bucket left out
    assert.deepEqual(bucketFilter(group, '__other__', logsContext, { table, row: otherOf(1) })?.meta.params, ['win 8']);
    // No filter without the cell it was clicked in, nor for a terms aggregation that asks no other bucket
    assert.equal(bucketFilter(group, '__other__', logsContext), undefined);
    const plain = tabify([countAgg, time, terms(false)], response, logsContext);
    assert.equal(bucketFilter(plain.columns[1], '__other__', logsContext, { table: plain, row: plain.rows[2] }), undefined);
    // A column before every other: the terms of the whole table, once each
    const os = columnOf('col-0-3', 'machine.os.keyword', aggOf('3', 'terms', 'segment'));
    const count = columnOf('col-1-1', 'Count', aggOf('1', 'count', 'metric'));
    const rows = [
      { 'col-0-3': 'ios', 'col-1-1': 1 },
      { 'col-0-3': 'osx', 'col-1-1': 2 },
      { 'col-0-3': 'ios', 'col-1-1': 3 },
      { 'col-0-3': '__other__', 'col-1-1': 4 },
    ];
    assert.deepEqual(otherBucketTerms(os, { table: { columns: [os, count], rows }, row: rows[3] }), ['ios', 'osx']);
  });
});

describe('the filters of a click', () => {
  const range = (field: string, params: Record<string, unknown>, negate = false): Filter => ({
    meta: { index: 'logs', alias: null, negate, disabled: false, type: 'range', key: field, params },
    range: { [field]: params },
  });
  const phrase: Filter = {
    meta: { index: 'logs', alias: null, negate: false, disabled: false, type: 'phrase', key: 'geo.src', params: { query: 'US' } },
    query: { match_phrase: { 'geo.src': 'US' } },
  };

  it('set the time range by a range on the time field, and filter by the others', () => {
    const time = range('timestamp', { gte: '2026-11-16T15:00:00.000Z', lt: '2026-11-16T18:00:00.000Z', format: 'strict_date_optional_time' });
    const bytes = range('bytes', { gte: 0, lt: 1000 });
    const { timeRange, rest } = splitTimeFilter([time, phrase, bytes], 'timestamp');
    assert.deepEqual(timeRange, { from: '2026-11-16T15:00:00.000Z', to: '2026-11-16T18:00:00.000Z' });
    assert.deepEqual(rest, [phrase, bytes]);
  });

  it('stay filters without a time field, and when one leaves its range out', () => {
    const time = range('timestamp', { gte: '2026-11-16T15:00:00.000Z', lt: '2026-11-16T18:00:00.000Z' });
    assert.deepEqual(splitTimeFilter([time], undefined), { rest: [time] });
    const out = range('timestamp', { gte: '2026-11-16T15:00:00.000Z', lt: '2026-11-16T18:00:00.000Z' }, true);
    assert.deepEqual(splitTimeFilter([out], 'timestamp'), { rest: [out] });
  });
});

describe('a gauge', () => {
  const ranges = [
    { from: 0, to: 6000 },
    { from: 6000, to: 6500 },
    { from: 6500, to: 7000 },
  ];
  const config = meterConfig({
    gaugeType: 'Arc',
    colorSchema: 'Green to Red',
    colorsRange: ranges,
    extendRange: true,
    percentageMode: false,
    labels: { show: true },
    scale: { show: true },
    style: { bgWidth: 0.9, width: 0.9, subText: '' },
  });
  const colors = gaugeColors(config, false);
  // The paths' numbers cut to two decimals, as the comparisons with the original read them
  const cut = (path: string) => path.replace(/(\d+\.\d{2})\d+/g, '$1');

  it("takes the meter's defaults for what its settings leave out", () => {
    assert.equal(config.innerSpace, 5);
    assert.deepEqual(config.scale, { show: true, width: 2, ticks: 10, tickLength: 8 });
    const goal = meterConfig({ colorsRange: [{ from: 0, to: 10000 }], style: { subText: 'of the goal' } });
    assert.deepEqual([goal.style.bgWidth, goal.style.width, goal.style.subText], [0.5, 0.9, 'of the goal']);
    // The meter assumes the percentage mode, and extends its range only when told to
    assert.equal(goal.percentageMode, true);
    assert.equal(goal.extendRange, false);
    assert.deepEqual(meterConfig(undefined).colorsRange, []);
  });

  it('names its ranges by their ends, as shares of the last in the percentage mode', () => {
    assert.deepEqual(gaugeLabels(config), ['0 - 6000', '6000 - 6500', '6500 - 7000']);
    const goal = { percentageMode: true, colorsRange: [{ from: 0, to: 1e10 }, { from: 1e10, to: 2e10 }] };
    assert.deepEqual(gaugeLabels(goal), ['0 - 50', '50 - 100']);
  });

  it('colours its ranges along the schema, the other way round when inverted', () => {
    assert.deepEqual(colors, { '0 - 6000': 'rgb(52,199,89)', '6000 - 6500': 'rgb(255,149,0)', '6500 - 7000': 'rgb(255,59,48)' });
    assert.equal(gaugeColors({ ...config, invertColors: true }, false)['0 - 6000'], 'rgb(255,59,48)');
    // One range takes the start of the schema
    assert.deepEqual(gaugeColors({ ...config, colorsRange: [{ from: 0, to: 1 }] }, false), { '0 - 1': 'rgb(52,199,89)' });
  });

  it('puts a value in its range, one below them all in the first and one above in the last', () => {
    assert.equal(gaugeBucket(ranges, 6000), 1);
    assert.equal(gaugeBucket(ranges, -5), 0);
    assert.equal(gaugeBucket(ranges, 7000), 2);
  });

  it('shares the room between its gauges, side by side or one under the other', () => {
    assert.deepEqual(gaugeSize('automatic', 792, 715, 5), { width: 153, height: 690 });
    assert.deepEqual(gaugeSize('vertical', 792, 715, 5), { width: 792, height: 133 });
    assert.deepEqual(gaugeSize('horizontal', 300, 715, 2), { width: 137, height: 690 });
    // Automatic: one under the other where the room is taller than wide
    assert.deepEqual(gaugeSize(undefined, 300, 715, 2), { width: 300, height: 332 });
  });

  it('draws an arc as MeterGauge does', () => {
    const drawing = drawMeter({
      config,
      y: 6040.25,
      label: 'zip',
      width: 153,
      height: 690,
      format: (value) => String(value),
      colorOf: (label) => colors[label],
      measure: () => 10,
    });
    // As the original draws the gauge of "zip" in the sample "Average bytes by extension"
    assert.equal(drawing.transform, 'translate(76.5, 345)');
    assert.equal(drawing.holderLabel, '6000 - 6500');
    assert.equal(cut(drawing.background), 'M-68.54,22.27A72.06,72.06 0 1,1 68.54,22.27L58.17,18.90A61.16,61.16 0 1,0 -58.17,18.90Z');
    assert.equal(cut(drawing.value), 'M-68.54,22.27A72.06,72.06 0 1,1 70.59,-14.51L59.91,-12.31A61.16,61.16 0 1,0 -58.17,18.90Z');
    assert.equal(drawing.valueColor, 'rgb(255,149,0)');
    assert.equal(drawing.scale?.arcs.length, 3);
    assert.equal(cut(drawing.scale?.arcs[0].d ?? ''), 'M-59.50,19.33A62.56,62.56 0 1,1 60.99,-13.92L59.04,-13.47A60.56,60.56 0 1,0 -57.59,18.71Z');
    assert.equal(drawing.scale?.ticks.length, 11);
    const first = drawing.scale?.ticks[0];
    assert.deepEqual(first && [first.x1, first.y1, first.x2, first.y2].map((value) => Math.round(value * 100) / 100), [-57.6, 18.71, -49.99, 16.24]);
    assert.deepEqual(drawing.label, { text: 'zip', hidden: false });
    assert.deepEqual(drawing.subText, { text: '', hidden: false });
  });

  it('leaves out a value wider than the middle, and the sub text with it', () => {
    const draw = (width: number, show = true) =>
      drawMeter({
        config: { ...config, labels: { show } },
        y: 6040.25,
        label: 'zip',
        width: 153,
        height: 690,
        format: (value) => String(value),
        colorOf: (label) => colors[label],
        measure: (_text, large) => (large ? width : 10),
      });
    // The middle: the inner diameter less the ticks, 121.125 - 16, less six pixels
    assert.equal(draw(99.1).valueText.hidden, false);
    assert.equal(draw(99.2).valueText.hidden, true);
    assert.equal(draw(99.2).subText?.hidden, true);
    assert.equal(draw(99.2).label?.hidden, false);
    assert.equal(draw(10, false).label, undefined);
  });

  it('shows no names on a gauge less than 70 pixels high, and writes a share in the percentage mode', () => {
    const shares: Array<number | null> = [];
    const drawing = drawMeter({
      config: { ...config, percentageMode: true },
      y: 6500,
      label: 'zip',
      width: 60,
      height: 60,
      format: (value) => {
        shares.push(value);
        return `${value}`;
      },
      colorOf: (label) => colors[label],
      measure: () => 1,
    });
    assert.deepEqual(shares, [6500 / 7000]);
    assert.equal(drawing.label?.hidden, true);
    assert.equal(drawing.subText?.hidden, true);
    assert.equal(drawing.valueText.hidden, false);
  });

  it('runs a ring all round, and its value as far as it goes, past the end when the range extends', () => {
    const ring = meterConfig({ ...config, gaugeType: 'Circle', colorsRange: [{ from: 0, to: 100 }], scale: { show: false } });
    const draw = (y: number, extendRange: boolean) =>
      drawMeter({
        config: { ...ring, extendRange },
        y,
        label: 'spend',
        width: 767,
        height: 690,
        format: String,
        colorOf: () => 'red',
        measure: () => 1,
      });
    assert.equal(cut(draw(50, true).background), 'M0,325.01A325.01,325.01 0 1,1 0,-325.01A325.01,325.01 0 1,1 0,325.01M0,275.85A275.85,275.85 0 1,0 0,-275.85A275.85,275.85 0 1,0 0,275.85Z');
    // Half way: down to six o'clock
    assert.match(draw(50, true).value, /A325\.01875,325\.01875 0 0,1 1\.99\d*e-14,325\.01875L/);
    // Over the end: all round, unless the range extends to the value, which then ends it
    assert.equal(draw(150, false).value.startsWith('M0,325.01875A'), true);
    assert.equal(draw(150, true).value, draw(100, true).value);
    assert.equal(draw(150, true).scale, undefined);
  });
});

describe('the interval of a date histogram over a long time range', () => {
  const pattern: IndexPattern = {
    id: 'logs',
    title: 'logs',
    timeFieldName: 'timestamp',
    fields: [{ name: 'timestamp', type: 'date', searchable: true, aggregatable: true, esTypes: ['date'] }],
    fieldFormatMap: {},
  };
  const over = (days: number, interval = 'auto') => {
    const agg: AggConfig = { id: '2', enabled: true, type: 'date_histogram', schema: 'segment', params: { field: 'timestamp', interval } };
    const start = Date.UTC(2020, 0, 1);
    const context: AggContext = { indexPattern: pattern, timeZone: 'UTC', timeRange: { from: new Date(start), to: new Date(start + days * DAY) } };
    const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
    const dsl = buildAggsDsl([count, agg], context)['2'] as { date_histogram: Record<string, unknown> };
    const { fixed_interval: fixed, calendar_interval: calendar } = dsl.date_histogram;
    return { fixed, calendar, label: aggLabel(agg, context) };
  };

  it('asks for a month the time range chose as 30 fixed days, and a year as 365, as the original writes a length of time', () => {
    // About 22 and 73 days a bar: the original's month, which it asks for as 30 days
    assert.deepEqual(over(1096), { fixed: '30d', calendar: undefined, label: 'timestamp per 30 days' });
    assert.deepEqual(over(3653), { fixed: '30d', calendar: undefined, label: 'timestamp per 30 days' });
    // More than a year a bar: the original's year of 365 days
    assert.deepEqual(over(21915), { fixed: '365d', calendar: undefined, label: 'timestamp per 365 days' });
    // Weeks, days and hours as before
    assert.deepEqual(over(365), { fixed: undefined, calendar: '1w', label: 'timestamp per week' });
    assert.deepEqual(over(7), { fixed: '3h', calendar: undefined, label: 'timestamp per 3 hours' });
    assert.deepEqual(over(1), { fixed: '30m', calendar: undefined, label: 'timestamp per 30 minutes' });
  });

  it('widens an interval asked for that gives too many bars to 30 fixed days, and keeps a month or a year asked for', () => {
    assert.deepEqual(over(7305, 'w'), { fixed: '30d', calendar: undefined, label: 'timestamp per 30 days' });
    assert.deepEqual(over(1096, 'M'), { fixed: undefined, calendar: '1M', label: 'timestamp per month' });
    assert.deepEqual(over(21915, 'y'), { fixed: undefined, calendar: '1y', label: 'timestamp per year' });
  });
});

describe('pointing at a series of a chart or its legend', () => {
  it('lights up the series pointed at, and leaves every mark its whole opacity when the pointer goes', () => {
    assert.deepEqual(hoverAfter({ touched: false }, 'css'), { label: 'css', touched: true });
    assert.deepEqual(hoverAfter({ label: 'css', touched: true }, undefined), { touched: true });
  });

  it('dims nothing for a series without a name, an empty term, as vislib returns at an empty data-label', () => {
    const untouched = { touched: false };
    assert.equal(hoverAfter(untouched, ''), untouched);
    const left = { touched: true };
    assert.equal(hoverAfter(left, ''), left);
    // vislib's unHighlight sets the opacity of every mark even when its highlight did nothing
    assert.deepEqual(hoverAfter(hoverAfter(untouched, ''), undefined), { touched: true });
  });
});
