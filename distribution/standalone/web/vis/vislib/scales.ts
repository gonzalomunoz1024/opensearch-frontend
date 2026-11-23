/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The scales the classic charts of OpenSearch Dashboards (vislib) draw with: those of d3's third
 * version, which vislib is written on. Their arithmetic is kept as d3 does it, floating point
 * included, so that an axis of a saved visualization has the same ticks, at the same places, as
 * there: how many ticks a length takes, the "nice" ends of a value axis, the ticks of a time axis
 * counted in UTC and moved to the time zone of the dates, and the bands of names.
 */

/** d3.bisect: where a value goes in a sorted list, after any equal to it */
export function bisectRight(list: readonly number[], value: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (value < list[middle]) high = middle;
    else low = middle + 1;
  }
  return low;
}

function integerScale(value: number): number {
  let k = 1;
  while ((value * k) % 1) k *= 10;
  return k;
}

/** d3.range: numbers from a start, by a step, short of a stop, counted on whole numbers */
export function range(start: number, stop: number, step = 1): number[] {
  if ((stop - start) / step === Infinity) return [];
  const values: number[] = [];
  const k = integerScale(Math.abs(step));
  const from = start * k;
  const to = stop * k;
  const by = step * k;
  let index = -1;
  let value: number;
  if (by < 0) {
    while ((value = from + by * ++index) > to) values.push(value / k);
  } else {
    while ((value = from + by * ++index) < to) values.push(value / k);
  }
  return values;
}

const extentOf = (domain: readonly number[]): [number, number] => {
  const first = domain[0];
  const last = domain[domain.length - 1];
  return first < last ? [first, last] : [last, first];
};

/** The first tick, a bound past the last, and the step of about `count` round ticks over a domain */
export function tickRange(domain: readonly number[], count = 10): [number, number, number] {
  const extent = extentOf(domain);
  const span = extent[1] - extent[0];
  let step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
  const error = (count / span) * step;
  if (error <= 0.15) step *= 10;
  else if (error <= 0.35) step *= 5;
  else if (error <= 0.75) step *= 2;
  return [Math.ceil(extent[0] / step) * step, Math.floor(extent[1] / step) * step + step * 0.5, step];
}

/** About `count` round values across a domain, as a linear scale's ticks */
export function linearTicks(domain: readonly number[], count = 10): number[] {
  const [start, stop, step] = tickRange(domain, count);
  return range(start, stop, step);
}

function niceBy(domain: [number, number], step: number): [number, number] {
  if (!step) return domain;
  const result: [number, number] = [domain[0], domain[1]];
  let low = 0;
  let high = 1;
  if (result[1] < result[0]) {
    low = 1;
    high = 0;
  }
  result[low] = Math.floor(result[low] / step) * step;
  result[high] = Math.ceil(result[high] / step) * step;
  return result;
}

/** A domain widened to round ends, twice over as d3 does it */
export function linearNice(domain: [number, number], count = 10): [number, number] {
  let result = niceBy(domain, tickRange(domain, count)[2]);
  result = niceBy(result, tickRange(result, count)[2]);
  return result;
}

/** A value of a domain where it falls on a range: d3's interpolation, clamped when asked */
export function interpolator(domain: [number, number], target: [number, number], clamp: boolean): (value: number) => number {
  const [a, bRaw] = domain;
  const b = bRaw - a || 1 / (bRaw - a);
  const [r0, r1] = target;
  return (value: number) => {
    let t = (value - a) / b;
    if (clamp) t = Math.max(0, Math.min(1, t));
    return r0 * (1 - t) + r1 * t;
  };
}

export type ValueScaleType = 'linear' | 'log' | 'square root';

/** A scale of values onto pixels, with what an axis asks of it */
export interface ValueScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  ticks(count?: number): number[];
}

const logOf = (positive: boolean) => (value: number) =>
  (positive ? Math.log(value < 0 ? 0 : value) : -Math.log(value > 0 ? 0 : -value)) / Math.log(10);
const powOf = (positive: boolean) => (value: number) => (positive ? Math.pow(10, value) : -Math.pow(10, -value));

/**
 * The scale of a value axis: linear, logarithmic or square root, onto a range, made round at its
 * ends when `nice` and held inside its range when `clamp`, as vislib makes it
 */
export function valueScale(
  type: ValueScaleType,
  domain: [number, number],
  target: [number, number],
  options: { nice: boolean; clamp: boolean }
): ValueScale {
  if (type === 'log') {
    const positive = domain[0] >= 0;
    const log = logOf(positive);
    const pow = powOf(positive);
    let logDomain: [number, number] = [log(domain[0]), log(domain[1])];
    if (options.nice) {
      logDomain = positive
        ? niceWith(logDomain, Math.floor, Math.ceil)
        : niceWith(logDomain, (value) => -Math.ceil(-value), (value) => -Math.floor(-value));
    }
    const actual: [number, number] = [pow(logDomain[0]), pow(logDomain[1])];
    const map = interpolator(logDomain, target, options.clamp);
    const scale = ((value: number) => map(log(value))) as ValueScale;
    scale.domain = actual;
    scale.range = target;
    scale.ticks = () => logTicks(actual, positive);
    return scale;
  }
  if (type === 'square root') {
    const root = (value: number) => (value < 0 ? -Math.pow(-value, 0.5) : Math.pow(value, 0.5));
    const actual = options.nice ? linearNice(domain) : domain;
    const map = interpolator([root(actual[0]), root(actual[1])], target, options.clamp);
    const scale = ((value: number) => map(root(value))) as ValueScale;
    scale.domain = actual;
    scale.range = target;
    scale.ticks = (count = 10) => linearTicks(actual, count);
    return scale;
  }
  const actual = options.nice ? linearNice(domain) : domain;
  const scale = interpolator(actual, target, options.clamp) as ValueScale;
  scale.domain = actual;
  scale.range = target;
  scale.ticks = (count = 10) => linearTicks(actual, count);
  return scale;
}

function niceWith(domain: [number, number], floor: (value: number) => number, ceil: (value: number) => number): [number, number] {
  const result: [number, number] = [domain[0], domain[1]];
  let low = 0;
  let high = 1;
  if (result[1] < result[0]) {
    low = 1;
    high = 0;
  }
  result[low] = floor(result[low]);
  result[high] = ceil(result[high]);
  return result;
}

/** The ticks of a logarithmic scale: every whole multiple of each power of ten in its domain */
function logTicks(domain: [number, number], positive: boolean): number[] {
  const [u, v] = extentOf(domain);
  const log = logOf(positive);
  const pow = powOf(positive);
  let i = Math.floor(log(u));
  const j = Math.ceil(log(v));
  let ticks: number[] = [];
  if (!Number.isFinite(j - i)) return ticks;
  if (positive) {
    for (; i < j; i += 1) for (let k = 1; k < 10; k += 1) ticks.push(pow(i) * k);
    ticks.push(pow(i));
  } else {
    ticks.push(pow(i));
    while (i++ < j) for (let k = 9; k > 0; k -= 1) ticks.push(pow(i) * k);
  }
  let start = 0;
  while (ticks[start] < u) start += 1;
  let end = ticks.length;
  while (ticks[end - 1] > v) end -= 1;
  ticks = ticks.slice(start, end);
  return ticks;
}

/** How many ticks vislib asks of an axis of a length: 0 at 20 pixels, 3 at 40, 11 at 1000 */
export function tickCount(length: number): number {
  const stops = [20, 40, 1000];
  const values = [0, 3, 11];
  const at = Math.max(stops[0], Math.min(stops[2], length));
  const segment = Math.max(0, Math.min(1, bisectRight(stops, at) - 1));
  const from = stops[segment];
  const to = stops[segment + 1];
  const t = (at - from) / (to - from);
  return Math.ceil(values[segment] * (1 - t) + values[segment + 1] * t);
}

// --- Time -----------------------------------------------------------------------------------------

type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const TIME_STEPS = [
  1e3, 5e3, 15e3, 3e4, 6e4, 3e5, 9e5, 18e5, 36e5, 108e5, 216e5, 432e5, 864e5, 1728e5, 6048e5, 2592e6, 7776e6, 31536e6,
];

const TIME_METHODS: Array<[TimeUnit, number]> = [
  ['second', 1],
  ['second', 5],
  ['second', 15],
  ['second', 30],
  ['minute', 1],
  ['minute', 5],
  ['minute', 15],
  ['minute', 30],
  ['hour', 1],
  ['hour', 3],
  ['hour', 6],
  ['hour', 12],
  ['day', 1],
  ['day', 2],
  ['week', 1],
  ['month', 1],
  ['month', 3],
  ['year', 1],
];

function floorUtc(time: number, unit: TimeUnit): number {
  const date = new Date(time);
  switch (unit) {
    case 'second':
      return Math.floor(time / 1e3) * 1e3;
    case 'minute':
      return Math.floor(time / 6e4) * 6e4;
    case 'hour':
      return Math.floor(time / 36e5) * 36e5;
    case 'day':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    case 'week':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - date.getUTCDay());
    case 'month':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    default:
      return Date.UTC(date.getUTCFullYear(), 0, 1);
  }
}

function stepUtc(time: number, unit: TimeUnit, by: number): number {
  const date = new Date(time);
  switch (unit) {
    case 'second':
      return time + by * 1e3;
    case 'minute':
      return time + by * 6e4;
    case 'hour':
      return time + by * 36e5;
    case 'day':
      date.setUTCDate(date.getUTCDate() + by);
      return date.getTime();
    case 'week':
      date.setUTCDate(date.getUTCDate() + by * 7);
      return date.getTime();
    case 'month':
      date.setUTCMonth(date.getUTCMonth() + by);
      return date.getTime();
    default:
      date.setUTCFullYear(date.getUTCFullYear() + by);
      return date.getTime();
  }
}

function numberUtc(time: number, unit: TimeUnit): number {
  const date = new Date(time);
  switch (unit) {
    case 'second':
      return date.getUTCSeconds();
    case 'minute':
      return date.getUTCMinutes();
    case 'hour':
      return date.getUTCHours();
    case 'day':
      return date.getUTCDate() - 1;
    case 'month':
      return date.getUTCMonth();
    case 'year':
      return date.getUTCFullYear();
    default:
      return 0;
  }
}

/** The boundaries of a unit from `start` (inclusive) to before `stop`, every `every` of them */
function intervalRange(unit: TimeUnit, start: number, stop: number, every: number): number[] {
  const times: number[] = [];
  let time = stepUtc(floorUtc(start - 1, unit), unit, 1);
  for (let guard = 0; time < stop && guard < 100000; guard += 1) {
    if (every <= 1 || !(numberUtc(time, unit) % every)) times.push(time);
    time = stepUtc(time, unit, 1);
  }
  return times;
}

/** About `count` round moments across a span of time, counted in UTC: d3's UTC time scale's ticks */
export function utcTicks(domain: [number, number], count: number): number[] {
  const [start, end] = extentOf(domain);
  const span = end - start;
  const target = span / count;
  const index = bisectRight(TIME_STEPS, target);
  const stop = end + 1;
  if (index === TIME_STEPS.length) {
    const step = tickRange([start / 31536e6, end / 31536e6], count)[2];
    return intervalRange('year', start, stop, step < 1 ? 1 : step);
  }
  if (index === 0) {
    const step = tickRange([start, end], count)[2];
    return range(Math.ceil(start / step) * step, stop, step);
  }
  const [unit, every] = TIME_METHODS[target / TIME_STEPS[index - 1] < TIME_STEPS[index] / target ? index - 1 : index];
  return intervalRange(unit, start, stop, every);
}

/** Minutes east of UTC that a zone is at a moment */
export type ZoneOffset = (time: number) => number;

/**
 * The ticks of a time axis as vislib places them (its timeTicks): counted in UTC over the domain
 * moved by the offset of its start, so that they fall on round moments of the zone the dates are
 * shown in, and moved back, by the offset at each tick when there is at most one tick in half a
 * day, else by that of the start, so that ticks within a day keep their spacing across a change
 * of summer time
 */
export function zonedTimeTicks(domain: [number, number], count: number, offsetAt: ZoneOffset): number[] {
  const startOffset = offsetAt(domain[0]) * 60000;
  const ticks = utcTicks([domain[0] + startOffset, domain[1] + startOffset], count);
  const timePerTick = (domain[1] - domain[0]) / ticks.length;
  const hourTicks = timePerTick < 1000 * 60 * 60 * 12;
  return ticks.map((tick) => tick - (hourTicks ? startOffset : offsetAt(tick) * 60000));
}

// --- Names ----------------------------------------------------------------------------------------

/** A band scale of names: where each band starts, and how wide the bands are (d3's rangeBands) */
export interface BandScale {
  (value: string): number;
  domain: string[];
  band: number;
  extent: [number, number];
}

export function bandScale(values: readonly string[], target: [number, number], padding: number, outerPadding: number): BandScale {
  const domain: string[] = [];
  const index = new Map<string, number>();
  for (const value of values) {
    if (!index.has(value)) {
      index.set(value, domain.length);
      domain.push(value);
    }
  }
  const reverse = target[1] < target[0];
  const start = reverse ? target[1] : target[0];
  const stop = reverse ? target[0] : target[1];
  const step = (stop - start) / (domain.length - padding + 2 * outerPadding);
  let starts = range(0, domain.length).map((at) => start + step * outerPadding + step * at);
  if (reverse) starts = starts.reverse();
  const scale = ((value: string) => {
    const at = index.get(value);
    return at === undefined ? NaN : starts[at];
  }) as BandScale;
  scale.domain = domain;
  scale.band = step * (1 - padding);
  scale.extent = [start, stop];
  return scale;
}
