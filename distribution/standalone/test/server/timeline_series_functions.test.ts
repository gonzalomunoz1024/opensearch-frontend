/* SPDX-License-Identifier: Apache-2.0 */

// Upstream's tests of the series functions (`server/series_functions/*.test.js`), one by one.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  abs,
  aggregate,
  condition,
  cusum,
  derivative,
  divide,
  first,
  fit,
  log,
  max,
  min,
  multiply,
  precision,
  range,
  scaleInterval,
  subtract,
  sum,
  trim,
} from '../../server/timeline/series_functions/arithmetic';
import {
  DEFAULT_TIME_FORMAT,
  bars,
  color,
  hide,
  label,
  legend,
  lines,
  points,
  title,
  yaxis,
} from '../../server/timeline/series_functions/presentation';
import { movingaverage, movingstd } from '../../server/timeline/series_functions/smoothing';
import { staticFn } from '../../server/timeline/series_functions/sources';
import type { SeriesList } from '../../server/timeline/types';
import { cloneDeep } from '../../server/timeline/util';
import {
  getSeries,
  getSeriesList,
  getSingleSeriesList,
  invoke,
  seriesListFixture,
  values,
} from './timeline_helpers';

const utc = (iso: string) => Date.parse(iso);

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('the series functions of Timeline', () => {
  let seriesList: SeriesList;
  beforeEach(() => {
    seriesList = seriesListFixture();
  });

  describe('abs', () => {
    it('should return the positive value of every value', async () => {
      const result = await invoke(abs, [seriesList]);
      const input = (result.input[0] as SeriesList).list[0].data;
      assert.equal(input.filter((point) => (point[1] as number) < 0).length > 0, true);
      assert.equal(result.output.list[0].data.length > 0, true);
      assert.equal(result.output.list[0].data.filter((p) => (p[1] as number) < 0).length, 0);
    });
  });

  describe('aggregate', () => {
    const cases: Array<[string, number[]]> = [
      ['first', [100, 100, 100, 100]],
      ['last', [20, 20, 20, 20]],
      ['min', [20, 20, 20, 20]],
      ['max', [100, 100, 100, 100]],
      ['sum', [220, 220, 220, 220]],
      ['cardinality', [3, 3, 3, 3]],
      ['avg', [55, 55, 55, 55]],
    ];
    for (const [fn, expected] of cases) {
      it(fn, async () => {
        const r = await invoke(aggregate, [seriesList, fn]);
        assert.deepEqual(values(r.output.list[1]), expected);
      });
    }
  });

  describe('bars', () => {
    it('creates the bars property, with defaults, on all series', async () => {
      const r = await invoke(bars, [seriesList]);
      for (const series of r.output.list as Any[]) {
        assert.equal(typeof series.bars, 'object');
        assert.equal(series.bars.lineWidth, 6);
        assert.equal(series.bars.show, 1);
      }
    });

    it('leaves existing bars alone when called without option, if they exist', async () => {
      (seriesList.list[0] as Any).bars = { foo: true };
      const r = await invoke(bars, [seriesList]);
      const list = r.output.list as Any[];
      assert.equal(list[0].bars.foo, true);
      assert.equal(list[1].bars.foo, undefined);
    });

    it('sets lineWidth and show to the same value', async () => {
      const r = await invoke(bars, [seriesList, 0]);
      const list = r.output.list as Any[];
      assert.equal(list[0].bars.lineWidth, 0);
      assert.equal(list[0].bars.show, 0);
    });
  });

  describe('color', () => {
    it('sets the color, on all series', async () => {
      const r = await invoke(color, [seriesList, '#eee']);
      for (const series of r.output.list as Any[]) assert.equal(series.color, '#eee');
    });

    it('generates a gradient', async () => {
      const fourLongList = { type: 'seriesList', list: seriesList.list.slice(0, 4) };
      const r = await invoke(color, [fourLongList, '#000:#333']);
      assert.deepEqual(
        (r.output.list as Any[]).map((series) => series.color),
        ['#000000', '#111111', '#222222', '#333333']
      );
    });

    it('should handle more colors than number of series', async () => {
      const r = await invoke(color, [seriesList, '#000:#111:#222:#333:#444:#555']);
      assert.deepEqual(
        (r.output.list as Any[]).map((series) => series.color),
        ['#000000', '#111111', '#222222', '#333333', '#444444']
      );
    });

    it('should work with series.length=1 and more colors', async () => {
      const oneLongList = { type: 'seriesList', list: seriesList.list.slice(0, 1) };
      const r = await invoke(color, [oneLongList, '#000:#111']);
      assert.deepEqual(
        (r.output.list as Any[]).map((series) => series.color),
        ['#000']
      );
    });

    // Upstream's test of this never waits for its promise: an empty color is set as it is
    it('sets an empty color as one color', async () => {
      const r = await invoke(color, [seriesList, '']);
      for (const series of r.output.list as Any[]) assert.equal(series.color, '');
    });
  });

  describe('condition', () => {
    let comparable: SeriesList;
    beforeEach(() => {
      comparable = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), 12],
        [utc('1981-01-01T00:00:00.000Z'), 33],
        [utc('1982-01-01T00:00:00.000Z'), 82],
        [utc('1983-01-01T00:00:00.000Z'), -101],
      ]);
    });

    describe('a single number with', () => {
      const cases: Array<[string, number[]]> = [
        ['eq', [-51, 0, 82, 20]],
        ['ne', [0, 17, 0, 0]],
        ['gte', [-51, 0, 0, 0]],
        ['gt', [-51, 17, 0, 0]],
        ['lt', [0, 17, 82, 20]],
        ['lte', [0, 0, 82, 20]],
      ];
      for (const [operator, expected] of cases) {
        it(operator, async () => {
          const r = await invoke(condition, [seriesList, operator, 17, 0]);
          assert.deepEqual(values(r.output.list[0]), expected);
        });
      }
    });

    it('can compare against another series', async () => {
      const r = await invoke(condition, [seriesList, 'ne', comparable, 0]);
      assert.deepEqual(values(r.output.list[0]), [0, 0, 82, 0]);
    });

    it('can set the resultant value to that of another series', async () => {
      const r = await invoke(condition, [seriesList, 'lt', comparable, comparable]);
      assert.deepEqual(values(r.output.list[0]), [12, 33, 82, 20]);
    });

    it('can set the resultant value to null', async () => {
      const r = await invoke(condition, [seriesList, 'lt', 17, null]);
      assert.deepEqual(values(r.output.list[0]), [null, 17, 82, 20]);
    });

    it('has else', async () => {
      const r = await invoke(condition, [seriesList, 'lt', 30, 0, 1]);
      assert.deepEqual(values(r.output.list[0]), [0, 0, 1, 0]);
    });

    it('works with other series in else', async () => {
      const r = await invoke(condition, [seriesList, 'lt', 30, 0, comparable]);
      assert.deepEqual(values(r.output.list[0]), [0, 0, 82, 0]);
    });
  });

  it('cusum progressively adds the numbers in the list', async () => {
    const r = await invoke(cusum, [seriesList]);
    assert.deepEqual(values(r.output.list[1]), [100, 150, 200, 220]);
  });

  it('derivative gets the change in the set', async () => {
    const r = await invoke(derivative, [seriesList]);
    assert.deepEqual(values(r.output.list[1]), [null, -50, 0, -30]);
  });

  it('divide divides by a single number', async () => {
    const r = await invoke(divide, [seriesList, 2]);
    assert.deepEqual(values(r.output.list[1]), [50, 25, 25, 10]);
  });

  it('first should return exactly the data input', async () => {
    const r = await invoke(first, [seriesList]);
    assert.deepEqual(r.input[0], r.output);
  });

  describe('fit', () => {
    it('should not filter out zeros: all zeros', async () => {
      const list = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), 0],
        [utc('1981-01-01T00:00:00.000Z'), null],
        [utc('1982-01-01T00:00:00.000Z'), 0],
        [utc('1983-01-01T00:00:00.000Z'), 0],
      ]);
      const r = await invoke(fit, [list, 'carry']);
      assert.equal((r.input[0] as SeriesList).list[0].data[1][1], null);
      assert.deepEqual(values(r.output.list[0]), [0, 0, 0, 0]);
      assert.notEqual(r.output.list[0].data[1][0], r.output.list[0].data[0][0]);
    });

    it('should not filter out zeros: mixed zeros and numbers', async () => {
      const list = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), 26],
        [utc('1981-01-01T00:00:00.000Z'), 42],
        [utc('1982-01-01T00:00:00.000Z'), 0],
        [utc('1983-01-01T00:00:00.000Z'), null],
        [utc('1984-01-01T00:00:00.000Z'), 1],
      ]);
      const r = await invoke(fit, [list, 'carry']);
      assert.deepEqual(values(r.output.list[0]), [26, 42, 0, 0, 1]);
    });

    it('should return original series when all values are null', async () => {
      const list = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), null],
        [utc('1981-01-01T00:00:00.000Z'), null],
        [utc('1982-01-01T00:00:00.000Z'), null],
        [utc('1983-01-01T00:00:00.000Z'), null],
      ]);
      const r = await invoke(fit, [list, 'carry']);
      assert.deepEqual(values(r.output.list[0]), [null, null, null, null]);
    });

    it('carry should maintain the previous value until it changes', async () => {
      const list = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), 5],
        [utc('1981-01-01T00:00:00.000Z'), null],
        [utc('1982-01-01T00:00:00.000Z'), 3.4],
        [utc('1983-01-01T00:00:00.000Z'), 171],
      ]);
      const r = await invoke(fit, [list, 'carry']);
      assert.equal((r.input[0] as SeriesList).list[0].data[1][1], null);
      assert.deepEqual(values(r.output.list[0]), [5, 5, 3.4, 171]);
      assert.notEqual(r.output.list[0].data[1][0], r.output.list[0].data[0][0]);
    });

    it('nearest should use the closest temporal value to fill the null', async () => {
      const list = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), 5],
        [utc('1981-01-01T00:00:00.000Z'), null],
        [utc('1981-05-01T00:00:00.000Z'), 3.4],
        [utc('1983-01-01T00:00:00.000Z'), 171],
      ]);
      const r = await invoke(fit, [list, 'nearest']);
      assert.equal((r.input[0] as SeriesList).list[0].data[1][1], null);
      assert.deepEqual(values(r.output.list[0]), [5, 3.4, 3.4, 171]);
      assert.notEqual(r.output.list[0].data[1][0], r.output.list[0].data[0][0]);
    });

    it('average should produce a smooth, straight line between points', async () => {
      const list = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), 10],
        [utc('1981-07-01T00:00:00.000Z'), null],
        [utc('1982-01-01T00:00:00.000Z'), null],
        [utc('1983-01-01T00:00:00.000Z'), 40],
        [utc('1984-01-01T00:00:00.000Z'), 50],
      ]);
      const r = await invoke(fit, [list, 'average']);
      assert.equal((r.input[0] as SeriesList).list[0].data[1][1], null);
      assert.deepEqual(values(r.output.list[0]), [10, 20, 30, 40, 50]);
    });

    it("scale should distribute the next point's value across the preceeding nulls", async () => {
      const list = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), 10],
        [utc('1981-07-01T00:00:00.000Z'), null],
        [utc('1982-01-01T00:00:00.000Z'), null],
        [utc('1983-01-01T00:00:00.000Z'), 60],
        [utc('1984-01-01T00:00:00.000Z'), 50],
      ]);
      const r = await invoke(fit, [list, 'scale']);
      assert.deepEqual(values(r.output.list[0]), [10, 20, 20, 20, 50]);
    });

    it('none basically just drops the nulls', async () => {
      const list = getSingleSeriesList('', [
        [utc('1980-01-01T00:00:00.000Z'), 10],
        [utc('1981-07-01T00:00:00.000Z'), null],
        [utc('1982-01-01T00:00:00.000Z'), null],
        [utc('1983-01-01T00:00:00.000Z'), 40],
        [utc('1984-01-01T00:00:00.000Z'), 50],
      ]);
      const r = await invoke(fit, [list, 'none']);
      assert.deepEqual(values(r.output.list[0]), [10, 40, 50]);
    });
  });

  describe('hide', () => {
    it('hides a series', async () => {
      const r = await invoke(hide, [seriesList, true]);
      for (const series of r.output.list as Any[]) assert.equal(series._hide, true);
    });

    it('unhides a series', async () => {
      const r = await invoke(hide, [seriesList, false]);
      for (const series of r.output.list as Any[]) assert.equal(series._hide, false);
    });
  });

  describe('label', () => {
    it('changes the label on the series', async () => {
      const r = await invoke(label, [seriesList, 'free beer']);
      for (const series of r.output.list) assert.equal(series.label, 'free beer');
    });

    it('can use a regex to capture parts of a series label', async () => {
      const r = await invoke(label, [seriesList, 'beer$1', 'Neg(.*)']);
      assert.equal(r.output.list[0].label, 'beerative');
    });

    it('can use a regex to capture groups to modify series label', async () => {
      const r = await invoke(label, [seriesList, 'beer$2', '(N)(egative)']);
      assert.equal(r.output.list[0].label, 'beeregative');
    });

    it('can handle different regex patterns', async () => {
      const [a, b] = await Promise.all([
        invoke(label, [cloneDeep(seriesList), 'beer$1 - $2', '(N)(egative)']),
        invoke(label, [cloneDeep(seriesList), 'beer$1_$2', '(N)(eg.*)']),
      ]);
      assert.equal(a.output.list[0].label, 'beerN - egative');
      assert.equal(b.output.list[0].label, 'beerN_egative');
    });
  });

  describe('legend', () => {
    it('should create the _global object if it does not exist', async () => {
      assert.equal((seriesList.list[0] as Any)._global, undefined);
      const r = await invoke(legend, [seriesList, 'nw', 3, true, 'YYYY']);
      assert.deepEqual((r.output.list[0] as Any)._global, {
        legend: { noColumns: 3, position: 'nw', showTime: true, timeFormat: 'YYYY' },
      });
    });

    it('should provide default values for time axis display', async () => {
      const r = await invoke(legend, [seriesList, 'nw', 3]);
      const global = (r.output.list[0] as Any)._global;
      assert.equal(global.legend.showTime, true);
      assert.equal(global.legend.timeFormat, 'MMMM Do YYYY, HH:mm:ss.SSS');
      assert.equal(DEFAULT_TIME_FORMAT, 'MMMM Do YYYY, HH:mm:ss.SSS');
    });

    it('should hide the legend is position is false', async () => {
      const r = await invoke(legend, [seriesList, false]);
      const global = (r.output.list[0] as Any)._global;
      assert.equal(global.legend.show, false);
      assert.equal(global.legend.showTime, false);
    });

    it('should set legend.showTime to false when showTime parameter is false', async () => {
      const r = await invoke(legend, [seriesList, 'nw', 3, false]);
      assert.equal((r.output.list[0] as Any)._global.legend.showTime, false);
    });
  });

  describe('lines', () => {
    it('should simply set show, steps, stack and lineWidth', async () => {
      const r = await invoke(lines, [seriesList, 1, 2, true, true, false]);
      const series = r.output.list[0] as Any;
      assert.equal(series.lines.lineWidth, 1);
      assert.equal(series.lines.show, true);
      assert.equal(series.stack, true);
      assert.equal(series.lines.steps, false);
    });

    it('should set lineWidth to 3 by default, and nothing else', async () => {
      const r = await invoke(lines, [seriesList]);
      const series = r.output.list[0] as Any;
      assert.equal(series.lines.lineWidth, 3);
      assert.equal(series.lines.fill, undefined);
      assert.equal(series.lines.show, undefined);
      assert.equal(series.stack, undefined);
      assert.equal(series.lines.steps, undefined);
    });
  });

  it('log should return the log10 value of every value', async () => {
    const r = await invoke(log, [seriesList]);
    assert.deepEqual(values(r.output.list[4]), [1, 2, 1, 0]);
  });

  it('max keeps the max of a series vs a number', async () => {
    const r = await invoke(max, [seriesList, 20]);
    assert.deepEqual(values(r.output.list[0]), [20, 20, 82, 20]);
  });

  it('min keeps the min of a series vs a number', async () => {
    const r = await invoke(min, [seriesList, 20]);
    assert.deepEqual(values(r.output.list[0]), [-51, 17, 20, 20]);
  });

  describe('movingaverage', () => {
    // As upstream: `[].concat(buckets).push(...)` is a number, so the points have no timestamps
    const fivePoints = () =>
      getSeriesList([getSeries('Five', 5, [10, 20, 30, 40, 50])]);

    it('centers the averaged series by default', async () => {
      const r = await invoke(movingaverage, [fivePoints(), 3]);
      assert.deepEqual(values(r.output.list[0]), [null, 20, 30, 40, null]);
    });

    it('aligns the moving average to the left', async () => {
      const r = await invoke(movingaverage, [fivePoints(), 3, 'left']);
      assert.deepEqual(values(r.output.list[0]), [null, null, 20, 30, 40]);
    });

    it('aligns the moving average to the right', async () => {
      const r = await invoke(movingaverage, [fivePoints(), 3, 'right']);
      assert.deepEqual(values(r.output.list[0]), [20, 30, 40, null, null]);
    });

    it('accepts 2 years', async () => {
      const r = await invoke(movingaverage, [fivePoints(), '2y', 'left']);
      assert.deepEqual(values(r.output.list[0]), [null, 15, 25, 35, 45]);
    });

    it('accepts 3 years', async () => {
      const r = await invoke(movingaverage, [fivePoints(), '3y', 'left']);
      assert.deepEqual(values(r.output.list[0]), [null, null, 20, 30, 40]);
    });
  });

  it('movingstd computes the moving standard deviation of a list', async () => {
    const data = [
      108.48, 111.56, 112.13, 113.75, 114.25, 110.79, 111.21, 116.82, 117.16, 120.38, 116.96,
      119.56, 118.97, 117.54, 114.42, 111.01, 114.2, 116.43, 117.74, 119.9, 124.65, 124.98, 124.7,
      123.6, 124.5, 126.85,
    ];
    // Upstream adds to one moment object, so every bucket ends up at the last hour
    const last = Date.parse('2018-01-01T00:00:00.000Z') + (data.length - 1) * 3600000;
    const buckets = data.map(() => last);
    const list = getSeriesList([getSeries('test data', buckets, data)]);
    const numWindows = 5;
    const r = await invoke(movingstd, [list, numWindows, 'left']);
    const result = values(r.output.list[0]).slice(numWindows) as number[];
    const expected = [
      2.28, 1.46, 1.53, 2.46, 3.0, 4.14, 3.31, 1.67, 1.5, 1.41, 2.01, 3.56, 3.12, 2.5, 2.56, 3.41,
      3.97, 3.92, 3.35, 2.12, 0.52,
    ];
    expected.forEach((value, index) => {
      assert.ok(Math.abs(result[index] - value) <= 0.01, `${result[index]} is about ${value}`);
    });
  });

  it('multiply multiplies by a number', async () => {
    const r = await invoke(multiply, [seriesList, 2]);
    assert.deepEqual(values(r.output.list[1]), [200, 100, 100, 40]);
  });

  describe('points', () => {
    it('should set the point radius', async () => {
      const r = await invoke(points, [seriesList, 1]);
      assert.equal((r.output.list[0] as Any).points.radius, 1);
    });

    it('should set the point lineWidth', async () => {
      const r = await invoke(points, [seriesList, null, 3]);
      assert.equal((r.output.list[0] as Any).points.lineWidth, 3);
    });

    it('should set the point fill', async () => {
      const r = await invoke(points, [seriesList, null, null, 3]);
      assert.equal((r.output.list[0] as Any).points.fill, 3 / 10);
    });

    it('should not set the fill color if fill is not specified', async () => {
      const r = await invoke(points, [seriesList, null, null, null, '#333']);
      assert.equal((r.output.list[0] as Any).points.fillColor, undefined);
    });

    it('should set the fill color', async () => {
      const r = await invoke(points, [seriesList, null, null, 10, '#333']);
      assert.equal((r.output.list[0] as Any).points.fillColor, '#333');
    });

    for (const symbol of ['triangle', 'cross', 'square', 'diamond', 'circle']) {
      it(`symbol is ${symbol}`, async () => {
        const r = await invoke(points, [seriesList, null, null, null, null, symbol]);
        assert.equal((r.output.list[0] as Any).points.symbol, symbol);
      });
    }

    it('does not allow undefined symbols', async () => {
      await assert.rejects(invoke(points, [seriesList, null, null, null, null, 'beer']), Error);
    });
  });

  describe('precision', () => {
    it('keeps the min of a series vs a number', async () => {
      const r = await invoke(precision, [seriesList, 2]);
      assert.deepEqual(values(r.output.list[3]), [3.14, 2, 1.43, 0.34]);
    });

    it('Adds a _meta to describe the precision to display', async () => {
      const r = await invoke(precision, [seriesList, 2]);
      assert.deepEqual((r.output.list[3] as Any)._meta.precision, 2);
    });
  });

  it('range keeps the min of a series vs a number', async () => {
    seriesList.list[0].data = [
      [1000, 20],
      [2000, 10],
      [3000, 30],
      [4000, 40],
    ];
    const r = await invoke(range, [seriesList, 1, 4]);
    assert.deepEqual(values(r.output.list[0]), [2, 1, 3, 4]);
  });

  it('scale_interval can multiply to transform one interval to another', async () => {
    const r = await invoke(scaleInterval, [seriesList, '5y']);
    assert.deepEqual(values(r.output.list[1]), [500, 250, 250, 100]);
  });

  describe('static', () => {
    it('returns a series in which all numbers are the same', async () => {
      const r = await invoke(staticFn, [5]);
      assert.deepEqual([...new Set(values(r.output.list[0]))], [5]);
    });

    it('plots a provided series', async () => {
      const r = await invoke(staticFn, ['4:3:2:1']);
      assert.deepEqual(values(r.output.list[0]), [4, 3, 2, 1]);
    });

    it('leaves interpolation up to the data source wrapper', async () => {
      const r = await invoke(staticFn, ['1:4']);
      assert.deepEqual(values(r.output.list[0]), [1, 4]);
    });
  });

  describe('subtract', () => {
    it('it throws an error if first argument is not seriesList', async () => {
      await assert.rejects(invoke(subtract, [[1, 2, 3, 4]]), {
        message: 'input must be a seriesList',
      });
    });

    it('subtracts all series in seriesList to single series when only one argument is supplied', async () => {
      const r = await invoke(subtract, [seriesList]);
      assert.equal(r.output.list.length, 1);
      assert.deepEqual(values(r.output.list[0]), [
        -165.1415926535, -136, 19.561, -2.3424234999999998,
      ]);
    });

    it('it subtracts a number', async () => {
      const r = await invoke(subtract, [seriesList, 2]);
      assert.deepEqual(values(r.output.list[1]), [98, 48, 48, 18]);
    });

    it('it subtracts an array of numbers', async () => {
      const r = await invoke(subtract, [seriesList, [5, 10, 15]]);
      assert.deepEqual(values(r.output.list[1]), [70, 20, 20, -10]);
    });

    it('it subtracts a seriesList with one series', async () => {
      const one = { type: 'seriesList', list: [cloneDeep(seriesList.list[1])] };
      const r = await invoke(subtract, [seriesList, one]);
      assert.deepEqual(values(r.output.list[1]), [0, 0, 0, 0]);
    });

    it('it subtracts a seriesList with multiple series', async () => {
      const r = await invoke(subtract, [seriesList, seriesList]);
      for (let i = 0; i < 5; i += 1) assert.deepEqual(values(r.output.list[i]), [0, 0, 0, 0]);
    });
  });

  it('sum adds a number', async () => {
    const r = await invoke(sum, [seriesList, 2]);
    assert.deepEqual(values(r.output.list[1]), [102, 52, 52, 22]);
  });

  it('title sets the title property', async () => {
    const r = await invoke(title, [seriesList, 'beer']);
    for (const series of r.output.list as Any[]) assert.equal(series._title, 'beer');
  });

  describe('trim', () => {
    const cases: Array<[string, unknown[], unknown[]]> = [
      ['Sets the first and last values to null by default', [], [null, 50, 50, null]],
      ['Trims more from the beginning', [2], [null, null, 50, null]],
      ['Trims more from the end', [null, 2], [null, 50, null, null]],
      ['Trims nothing from the end', [1, 0], [null, 50, 50, 20]],
      ['Trims nothing from the beginning', [0, 2], [100, 50, null, null]],
    ];
    for (const [name, args, expected] of cases) {
      it(name, async () => {
        const r = await invoke(trim, [seriesList, ...args]);
        assert.deepEqual(values(r.output.list[1]), expected);
      });
    }
  });

  describe('yaxis', () => {
    const yaxes = (r: { output: SeriesList }) => (r.output.list[0] as Any)._global.yaxes;

    it('creates the yaxes array', async () => {
      assert.equal((seriesList as Any)._global, undefined);
      const r = await invoke(yaxis, [seriesList, 2]);
      assert.ok(Array.isArray(yaxes(r)));
    });

    it('puts odd numbers of the left, even on the right, by default', async () => {
      assert.equal(yaxes(await invoke(yaxis, [seriesListFixture(), 1]))[0].position, 'left');
      assert.equal(yaxes(await invoke(yaxis, [seriesListFixture(), 2]))[1].position, 'right');
      assert.equal(yaxes(await invoke(yaxis, [seriesListFixture(), 3]))[2].position, 'left');
    });

    it('it lets you override default positions', async () => {
      const a = await invoke(yaxis, [seriesListFixture(), 1, null, null, 'right']);
      const b = await invoke(yaxis, [seriesListFixture(), 2, null, null, 'right']);
      assert.equal(yaxes(a)[0].position, 'right');
      assert.equal(yaxes(b)[1].position, 'right');
    });

    it('sets the minimum (default: no min)', async () => {
      assert.equal(yaxes(await invoke(yaxis, [seriesListFixture(), 1, null]))[0].min, null);
      assert.equal(yaxes(await invoke(yaxis, [seriesListFixture(), 2, 10]))[1].min, 10);
    });

    it('sets the max (default: no max)', async () => {
      const a = await invoke(yaxis, [seriesListFixture(), 1, null]);
      const b = await invoke(yaxis, [seriesListFixture(), 2, null, 10]);
      assert.equal(yaxes(a)[0].max, undefined);
      assert.equal(yaxes(b)[1].max, 10);
    });

    it('sets the units (default: no unit)', async () => {
      const none = [seriesListFixture(), 1, null, null, null, null, null, null];
      const bits = [seriesListFixture(), 2, null, null, null, null, null, 'bits'];
      assert.equal(yaxes(await invoke(yaxis, none))[0].units, undefined);
      assert.equal(typeof yaxes(await invoke(yaxis, bits))[1].units, 'object');
    });

    it('throws an error if currency is not three letter code', async () => {
      for (const units of ['currency:abcde', 'currency:12', 'currency:$#', 'currency:ab']) {
        const args = [seriesListFixture(), 1, null, null, null, null, null, units];
        await assert.rejects(invoke(yaxis, args), Error);
      }
    });
  });
});
