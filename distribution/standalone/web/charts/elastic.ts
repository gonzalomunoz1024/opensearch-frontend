/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The rules elastic-charts lays a chart out by, which TSVB's time series follows in OpenSearch
 * Dashboards: the ticks it counts on an axis, the labels it leaves out when they would run into
 * each other, the room an axis takes and the width of a legend beside the chart. Written again
 * here so that such a chart is drawn where the product draws it.
 */

/** A tick of an axis, where it falls along it and its label; an empty label is not drawn */
export interface ElasticTick {
  value: number;
  position: number;
  label: string;
}

const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);

/** The step between ticks: 1, 2 or 5 times a power of ten, negative for the inverse of one below 1 */
function tickIncrement(start: number, stop: number, count: number): number {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log(step) / Math.log(10) + Number.EPSILON);
  const error = step / 10 ** power;
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  return power >= 0 ? factor * 10 ** power : -(10 ** -power) / factor;
}

function tickStep(start: number, stop: number, count: number): number {
  const reverse = stop < start;
  const increment = reverse ? tickIncrement(stop, start, count) : tickIncrement(start, stop, count);
  return (reverse ? -1 : 1) * (increment < 0 ? 1 / -increment : increment);
}

/** About so many round values from start to stop, as d3 and elastic-charts count them */
export function linearTicks(start: number, stop: number, count: number): number[] {
  if (start === stop && count > 0) return [start];
  const reverse = stop < start;
  const [low, high] = reverse ? [stop, start] : [start, stop];
  const step = tickIncrement(low, high, count);
  if (step === 0 || !Number.isFinite(step)) return [];
  const ticks: number[] = [];
  if (step > 0) {
    let first = Math.round(low / step);
    let last = Math.round(high / step);
    if (first * step < low) first += 1;
    if (last * step > high) last -= 1;
    for (let at = first; at <= last; at += 1) ticks.push(at * step);
  } else {
    const inverse = -step;
    let first = Math.round(low * inverse);
    let last = Math.round(high * inverse);
    if (first / inverse < low) first += 1;
    if (last / inverse > high) last -= 1;
    for (let at = first; at <= last; at += 1) ticks.push(at / inverse);
  }
  return reverse ? ticks.reverse() : ticks;
}

/** The ticks of a value axis: fewer than asked for while they would come closer than the data's step */
export function valueTicks(domain: [number, number], count: number, minInterval = 0): number[] {
  let current = count;
  let ticks = linearTicks(domain[0], domain[1], current);
  while (ticks.length > 2 && current > 0 && ticks[1] - ticks[0] < minInterval) {
    current -= 1;
    ticks = linearTicks(domain[0], domain[1], current);
  }
  return ticks;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

// The steps a time axis chooses from, and how long d3 takes each to be
const TIME_INTERVALS: Array<[TimeUnit, number, number]> = [
  ['second', 1, SECOND],
  ['second', 5, 5 * SECOND],
  ['second', 15, 15 * SECOND],
  ['second', 30, 30 * SECOND],
  ['minute', 1, MINUTE],
  ['minute', 5, 5 * MINUTE],
  ['minute', 15, 15 * MINUTE],
  ['minute', 30, 30 * MINUTE],
  ['hour', 1, HOUR],
  ['hour', 3, 3 * HOUR],
  ['hour', 6, 6 * HOUR],
  ['hour', 12, 12 * HOUR],
  ['day', 1, DAY],
  ['day', 2, 2 * DAY],
  ['week', 1, WEEK],
  ['month', 1, MONTH],
  ['month', 3, 3 * MONTH],
  ['year', 1, YEAR],
];

/** Every multiple of a size from start up to, not including, end */
function multiples(size: number, start: number, end: number): number[] {
  const ticks: number[] = [];
  for (let tick = Math.ceil(start / size) * size; tick < end; tick += size) ticks.push(tick);
  return ticks;
}

/** The moments of a calendar unit from start up to, not including, end, in UTC, that a test keeps */
function calendar(unit: 'day' | 'week' | 'month' | 'year', start: number, end: number, keep: (date: Date) => boolean): number[] {
  const first = new Date(start);
  const at =
    unit === 'year'
      ? Date.UTC(first.getUTCFullYear(), 0, 1)
      : unit === 'month'
        ? Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)
        : Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  const ticks: number[] = [];
  for (let date = new Date(at); date.getTime() < end; ) {
    if (date.getTime() >= start && keep(date)) ticks.push(date.getTime());
    if (unit === 'year') date = new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
    else if (unit === 'month') date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    else date = new Date(date.getTime() + DAY);
  }
  return ticks;
}

/** About so many round moments from start to stop, in UTC, as d3's UTC time scale chooses them */
export function utcTicks(start: number, stop: number, count: number): number[] {
  const reverse = stop < start;
  const [low, high] = reverse ? [stop, start] : [start, stop];
  const target = (high - low) / count;
  const found = TIME_INTERVALS.findIndex(([, , size]) => size > target);
  const index = found < 0 ? TIME_INTERVALS.length : found;
  const end = high + 1;
  let ticks: number[];
  if (index === TIME_INTERVALS.length) {
    const every = Math.floor(tickStep(low / YEAR, high / YEAR, count));
    ticks = Number.isFinite(every) && every > 0 ? calendar('year', low, end, (date) => date.getUTCFullYear() % every === 0) : [];
  } else if (index === 0) {
    const every = Math.floor(Math.max(tickStep(low, high, count), 1));
    ticks = Number.isFinite(every) ? multiples(every, low, end) : [];
  } else {
    const [unit, step] = TIME_INTERVALS[target / TIME_INTERVALS[index - 1][2] < TIME_INTERVALS[index][2] / target ? index - 1 : index];
    if (unit === 'second') ticks = multiples(step * SECOND, low, end);
    else if (unit === 'minute') ticks = multiples(step * MINUTE, low, end);
    else if (unit === 'hour') ticks = multiples(step * HOUR, low, end);
    else if (unit === 'day') ticks = calendar('day', low, end, (date) => (date.getUTCDate() - 1) % step === 0);
    else if (unit === 'week') ticks = calendar('week', low, end, (date) => date.getUTCDay() === 0);
    else if (unit === 'month') ticks = calendar('month', low, end, (date) => date.getUTCMonth() % step === 0);
    else ticks = calendar('year', low, end, () => true);
  }
  return reverse ? ticks.reverse() : ticks;
}

/**
 * The ticks of a time axis where the reader is: the round moments of the time in their zone,
 * fewer while they would come closer than the step of the data
 */
export function timeTicks(
  domain: [number, number],
  count: number,
  /** Minutes east of UTC at a moment */
  offset: (time: number) => number,
  minInterval = 0
): number[] {
  const shift = offset(domain[0]) * MINUTE;
  const low = domain[0] + shift;
  const high = domain[1] + shift;
  let current = count;
  let ticks = utcTicks(low, high, current);
  while (ticks.length > 2 && current > 0 && ticks[1] - ticks[0] < minInterval) {
    current -= 1;
    ticks = utcTicks(low, high, current);
  }
  const hourly = (high - low) / ticks.length < 12 * HOUR;
  return ticks.map((tick) => tick - (hourly ? shift : offset(tick) * MINUTE));
}

/** The box the widest and the tallest of some labels take, in whole pixels */
export function labelBox(labels: string[], measure: (label: string) => number, fontSize: number): { width: number; height: number } {
  return labels.reduce(
    (box, label) => ({ width: Math.max(box.width, Math.ceil(measure(label))), height: Math.max(box.height, Math.ceil(fontSize)) }),
    { width: 0, height: 0 }
  );
}

export interface AxisTickOptions {
  /** The ticks the axis's scale gives when asked for about so many */
  ticks: (count: number) => number[];
  /** How many to ask for at most */
  count: number;
  /** Where a value falls along the axis, in pixels from its start (from the top for a vertical axis) */
  position: (value: number) => number;
  format: (value: number) => string;
  measure: (label: string) => number;
  fontSize: number;
  vertical: boolean;
  time: boolean;
}

/** The ticks with the labels that fit: one that would come closer to the last drawn than half a label is left blank */
function measuredTicks(values: number[], options: AxisTickOptions): ElasticTick[] {
  const labels = values.map(options.format);
  const box = labelBox(labels, options.measure, options.fontSize);
  const required = options.vertical ? box.height / 2 : box.width / 2;
  let occupied = -Infinity;
  return values
    .map((value, index) => ({ value, position: options.position(value), label: labels[index] }))
    .sort((a, b) => a.position - b.position)
    .map((tick) => {
      if (tick.position < occupied + required) return { ...tick, label: '' };
      occupied = tick.position + required;
      return tick;
    });
}

/**
 * The ticks an axis shows: the most, up to the count, whose labels all fit and differ from each
 * other (for time, from their neighbours); failing that, those of the count that gave the fewest
 * different labels, with the labels that do not fit left blank
 */
export function axisTicks(options: AxisTickOptions): ElasticTick[] {
  let previous = Number.NaN;
  let fallbackCount = 2;
  let fallbackSize = Infinity;
  for (let tried = options.count; tried >= 1; tried -= 1) {
    const values = options.ticks(tried);
    if (values.length === previous || values.length < 2) continue;
    const ticks = measuredTicks(values, options);
    const labels = ticks.map((tick) => tick.label);
    const unique = new Set(labels);
    const allUnique = ticks.length === unique.size;
    const neighboursDiffer = options.time && (allUnique || labels.every((label, index) => index === 0 || label !== labels[index - 1]));
    const compliant = (options.time || unique.size >= 2) && !unique.has('') && (options.time ? neighboursDiffer : allUnique);
    previous = values.length;
    if (compliant) return ticks;
    if (unique.size >= 2 && unique.size <= fallbackSize) {
      fallbackSize = unique.size;
      fallbackCount = tried;
    }
  }
  return measuredTicks(options.ticks(fallbackCount), options);
}

/** The font elastic-charts measures the names in a legend with */
export const LEGEND_MEASURE_FONT = 'Inter, BlinkMacSystemFont, Helvetica, Arial, sans-serif';

/**
 * The width of a legend beside a chart: its widest name with its value, its mark and margins, a
 * scroll bar's room when its rows are taller than the chart, and room to spare; at most 200 pixels
 */
export function legendWidth(entries: string[], hasValues: boolean, chartHeight: number, measure: (text: string) => number): number {
  const widest = Math.max(0, ...entries.map(measure));
  const itemWidth = 16 + 4 + widest + (hasValues ? 4 : 0);
  const rows = 26 * entries.length + 2;
  const scrollBar = rows > chartHeight ? 16 : 0;
  return Math.floor(Math.min(itemWidth + 10 + scrollBar, 200));
}

/**
 * The height of a legend above or below a chart: one row of names when they all fit in rows of
 * 200 pixels across it, two rows when they fit in two, and two and a half to scroll through
 * otherwise
 */
export function legendHeight(count: number, chartWidth: number): number {
  const perRow = (chartWidth - 20) / 200;
  if (perRow > count) return 18 + 16;
  return perRow * 2 < count ? 18 * 2.5 + 24 : 18 * 2 + 24;
}
