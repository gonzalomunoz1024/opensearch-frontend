/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The arithmetic of Discover's histogram, done the way OpenSearch Dashboards' chart library
 * (elastic-charts, on d3's scales) does it, so that a search draws the same chart here as there:
 * the ticks of each axis and which of them get a label, the room the axes take, where each bar
 * stands, what is shaded, and which bucket the pointer is on. The drawing is in histogram.tsx.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

// --- Round steps ----------------------------------------------------------------------------------

const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);

/** A round step that cuts a range into about `count` parts (d3's tickStep) */
export function tickStep(start: number, stop: number, count: number): number {
  const step0 = Math.abs(stop - start) / Math.max(0, count);
  let step1 = Math.pow(10, Math.floor(Math.log(step0) / Math.LN10));
  const error = step0 / step1;
  if (error >= E10) step1 *= 10;
  else if (error >= E5) step1 *= 5;
  else if (error >= E2) step1 *= 2;
  return stop < start ? -step1 : step1;
}

// The chart library's step for a value axis; a negative step stands for its inverse
function tickIncrement(start: number, stop: number, count: number): number {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log(step) / Math.log(10) + Number.EPSILON);
  const error = step / Math.pow(10, power);
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  return power >= 0 ? factor * Math.pow(10, power) : -Math.pow(10, -power) / factor;
}

/** The round numbers from `start` to `stop`, about `count` of them, as the value axis has them */
export function linearTicks(start: number, stop: number, count: number): number[] {
  if (start === stop && count > 0) return [start];
  const reverse = stop < start;
  const low = reverse ? stop : start;
  const high = reverse ? start : stop;
  const step = tickIncrement(low, high, count);
  if (step === 0 || !Number.isFinite(step)) return [];
  const ticks: number[] = [];
  if (step > 0) {
    let first = Math.round(low / step);
    let last = Math.round(high / step);
    if (first * step < low) first += 1;
    if (last * step > high) last -= 1;
    for (let index = first; index <= last; index += 1) ticks.push(index * step);
  } else {
    const inverse = -step;
    let first = Math.round(low * inverse);
    let last = Math.round(high * inverse);
    if (first / inverse < low) first += 1;
    if (last / inverse > high) last -= 1;
    for (let index = first; index <= last; index += 1) ticks.push(index / inverse);
  }
  return reverse ? ticks.reverse() : ticks;
}

// --- Moments on a clock (d3-time, in UTC) ---------------------------------------------------------

interface TimeInterval {
  floor: (time: number) => number;
  offset: (time: number, step: number) => number;
  /** The number a multiple of the interval is picked by: the second, the hour, the month… */
  field?: (time: number) => number;
}

const changed = (time: number, change: (date: Date) => void): number => {
  const date = new Date(time);
  change(date);
  return date.getTime();
};

const millisecond: TimeInterval = { floor: (time) => time, offset: (time, step) => time + step };

const second: TimeInterval = {
  floor: (time) => time - new Date(time).getUTCMilliseconds(),
  offset: (time, step) => time + step * SECOND,
  field: (time) => new Date(time).getUTCSeconds(),
};

const minute: TimeInterval = {
  floor: (time) => changed(time, (date) => date.setUTCSeconds(0, 0)),
  offset: (time, step) => time + step * MINUTE,
  field: (time) => new Date(time).getUTCMinutes(),
};

const hour: TimeInterval = {
  floor: (time) => changed(time, (date) => date.setUTCMinutes(0, 0, 0)),
  offset: (time, step) => time + step * HOUR,
  field: (time) => new Date(time).getUTCHours(),
};

const day: TimeInterval = {
  floor: (time) => changed(time, (date) => date.setUTCHours(0, 0, 0, 0)),
  offset: (time, step) => changed(time, (date) => date.setUTCDate(date.getUTCDate() + step)),
  field: (time) => new Date(time).getUTCDate() - 1,
};

// Weeks start on Sunday on this clock, whatever the setting dateFormat:dow says
const week: TimeInterval = {
  floor: (time) =>
    changed(time, (date) => {
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() % 7));
      date.setUTCHours(0, 0, 0, 0);
    }),
  offset: (time, step) => changed(time, (date) => date.setUTCDate(date.getUTCDate() + step * 7)),
};

const month: TimeInterval = {
  floor: (time) =>
    changed(time, (date) => {
      date.setUTCDate(1);
      date.setUTCHours(0, 0, 0, 0);
    }),
  offset: (time, step) => changed(time, (date) => date.setUTCMonth(date.getUTCMonth() + step)),
  field: (time) => new Date(time).getUTCMonth(),
};

// Only the moments of an interval that pass a test: every third hour, every other day
function filtered(base: TimeInterval, test: (time: number) => boolean): TimeInterval {
  return {
    floor: (time) => {
      let floored = base.floor(time);
      while (!test(floored)) floored = base.floor(floored - 1);
      return floored;
    },
    offset: (time, step) => {
      let moved = time;
      for (let left = step; left > 0; left -= 1) {
        do moved = base.offset(moved, 1);
        while (!test(moved));
      }
      return moved;
    },
  };
}

function every(interval: TimeInterval, step: number): TimeInterval | undefined {
  const k = Math.floor(step);
  if (!Number.isFinite(k) || !(k > 0)) return undefined;
  const { field } = interval;
  // Weeks are only ever taken one at a time, so every interval taken by more has a field
  if (!(k > 1) || !field) return interval;
  return filtered(interval, (time) => field(time) % k === 0);
}

function everyMillisecond(step: number): TimeInterval | undefined {
  const k = Math.floor(step);
  if (!Number.isFinite(k) || !(k > 0)) return undefined;
  if (!(k > 1)) return millisecond;
  return { floor: (time) => Math.floor(time / k) * k, offset: (time, by) => time + by * k };
}

function everyYear(step: number): TimeInterval | undefined {
  const k = Math.floor(step);
  if (!Number.isFinite(k) || !(k > 0)) return undefined;
  return {
    floor: (time) =>
      changed(time, (date) => {
        date.setUTCFullYear(Math.floor(date.getUTCFullYear() / k) * k);
        date.setUTCMonth(0, 1);
        date.setUTCHours(0, 0, 0, 0);
      }),
    offset: (time, by) => changed(time, (date) => date.setUTCFullYear(date.getUTCFullYear() + by * k)),
  };
}

function range(interval: TimeInterval, start: number, stop: number): number[] {
  const moments: number[] = [];
  let next = interval.floor(interval.offset(interval.floor(start - 1), 1));
  if (!(next < stop)) return moments;
  let previous: number;
  do {
    previous = next;
    moments.push(next);
    next = interval.floor(interval.offset(next, 1));
  } while (previous < next && next < stop);
  return moments;
}

const TICK_INTERVALS: Array<{ every: (step: number) => TimeInterval | undefined; step: number; duration: number }> = [
  { every: (step) => every(second, step), step: 1, duration: SECOND },
  { every: (step) => every(second, step), step: 5, duration: 5 * SECOND },
  { every: (step) => every(second, step), step: 15, duration: 15 * SECOND },
  { every: (step) => every(second, step), step: 30, duration: 30 * SECOND },
  { every: (step) => every(minute, step), step: 1, duration: MINUTE },
  { every: (step) => every(minute, step), step: 5, duration: 5 * MINUTE },
  { every: (step) => every(minute, step), step: 15, duration: 15 * MINUTE },
  { every: (step) => every(minute, step), step: 30, duration: 30 * MINUTE },
  { every: (step) => every(hour, step), step: 1, duration: HOUR },
  { every: (step) => every(hour, step), step: 3, duration: 3 * HOUR },
  { every: (step) => every(hour, step), step: 6, duration: 6 * HOUR },
  { every: (step) => every(hour, step), step: 12, duration: 12 * HOUR },
  { every: (step) => every(day, step), step: 1, duration: DAY },
  { every: (step) => every(day, step), step: 2, duration: 2 * DAY },
  { every: (step) => every(week, step), step: 1, duration: WEEK },
  { every: (step) => every(month, step), step: 1, duration: MONTH },
  { every: (step) => every(month, step), step: 3, duration: 3 * MONTH },
  { every: everyYear, step: 1, duration: YEAR },
];

function tickInterval(start: number, stop: number, count: number): TimeInterval | undefined {
  const target = Math.abs(stop - start) / count;
  let index = 0;
  while (index < TICK_INTERVALS.length && TICK_INTERVALS[index].duration <= target) index += 1;
  if (index === TICK_INTERVALS.length) return everyYear(tickStep(start / YEAR, stop / YEAR, count));
  if (index === 0) return everyMillisecond(Math.max(tickStep(start, stop, count), 1));
  const before = TICK_INTERVALS[index - 1];
  const after = TICK_INTERVALS[index];
  const chosen = target / before.duration < after.duration / target ? before : after;
  return chosen.every(chosen.step);
}

/** Round moments from `start` to `stop` on a UTC clock, about `count` of them (d3's utcTicks) */
export function utcTicks(start: number, stop: number, count: number): number[] {
  const reverse = stop < start;
  const low = reverse ? stop : start;
  const high = reverse ? start : stop;
  const interval = tickInterval(low, high, count);
  const ticks = interval ? range(interval, low, high + 1) : [];
  return reverse ? ticks.reverse() : ticks;
}

/** Minutes east of UTC of the zone the chart is drawn in, at a moment */
export type OffsetAt = (time: number) => number;

/**
 * The ticks of a time axis: round moments of the zone the chart is drawn in, counted on a clock
 * moved by the zone's offset at the start, and never closer than the shortest bucket.
 */
export function timeTicks(domain: [number, number], count: number, offsetAt: OffsetAt, minInterval: number): number[] {
  const [start, end] = domain;
  const offset = offsetAt(start);
  const shiftedStart = start + offset * MINUTE;
  const shiftedEnd = end + offset * MINUTE;
  let current = count;
  let ticks = utcTicks(shiftedStart, shiftedEnd, current);
  while (ticks.length > 2 && current > 0 && ticks[1] - ticks[0] < minInterval) {
    current -= 1;
    ticks = utcTicks(shiftedStart, shiftedEnd, current);
  }
  // Ticks hours apart keep the offset of the start; days apart each take their own
  const hourTicks = (shiftedEnd - shiftedStart) / ticks.length < 12 * HOUR;
  return ticks.map((tick) => tick - (hourTicks ? offset : offsetAt(tick)) * MINUTE);
}

// --- The buckets ----------------------------------------------------------------------------------

export type BucketUnit = 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

/** The interval of the buckets as OpenSearch takes it: 12 hours, 1 week, 1 month */
export interface BucketInterval {
  amount: number;
  unit: BucketUnit;
}

export function parseBucketInterval(expression: string): BucketInterval | undefined {
  const match = /^(\d+(?:\.\d+)?)(ms|[smhdwMy])$/.exec(expression);
  return match ? { amount: Number(match[1]), unit: match[2] as BucketUnit } : undefined;
}

// A wall-clock time of the zone as a UTC time, and back
const toWall = (time: number, offsetAt: OffsetAt) => time + offsetAt(time) * MINUTE;
const fromWall = (wall: number, offsetAt: OffsetAt) => wall - offsetAt(wall - offsetAt(wall) * MINUTE) * MINUTE;

/**
 * How long the bucket that holds a moment lasts: from the start of its unit, the interval later,
 * on the calendar of the zone for days and longer (a day across a change of the clocks is 23 or
 * 25 hours, a month 28 to 31 days)
 */
export function bucketSpan(time: number, interval: BucketInterval, offsetAt: OffsetAt, weekStart = 0): number {
  const { amount, unit } = interval;
  if (unit === 'ms') return amount;
  if (unit === 's') return amount * SECOND;
  if (unit === 'm') return amount * MINUTE;
  if (unit === 'h') return amount * HOUR;
  const wall = new Date(toWall(time, offsetAt));
  wall.setUTCHours(0, 0, 0, 0);
  if (unit === 'w') wall.setUTCDate(wall.getUTCDate() - ((wall.getUTCDay() - weekStart + 7) % 7));
  if (unit === 'M') wall.setUTCDate(1);
  if (unit === 'y') wall.setUTCMonth(0, 1);
  const start = wall.getTime();
  if (unit === 'd') wall.setUTCDate(wall.getUTCDate() + amount);
  if (unit === 'w') wall.setUTCDate(wall.getUTCDate() + amount * 7);
  if (unit === 'M') wall.setUTCMonth(wall.getUTCMonth() + amount);
  if (unit === 'y') wall.setUTCFullYear(wall.getUTCFullYear() + amount);
  return fromWall(wall.getTime(), offsetAt) - fromWall(start, offsetAt);
}

/**
 * The shortest bucket, which sets the width of every bar: the shortest span of a bucket's unit, or
 * of the gap between two buckets next to each other, as Discover finds it
 */
export function shortestBucket(xs: readonly number[], span: (time: number) => number): number {
  const chosen = xs.reduce(
    (shortest, x, index) => Math.min(shortest, span(x), index > 0 ? Math.abs(xs[index - 1] - x) : shortest),
    Number.MAX_SAFE_INTEGER
  );
  // The chart library keeps it unless it is longer than the gap it finds between the buckets
  const sorted = [...xs].sort((a, b) => a - b);
  const gap = sorted.length < 2 ? sorted.length : sorted.reduce((least, x, index) => (index > 0 ? Math.min(least, x - sorted[index - 1]) : least), Infinity);
  return (xs.length > 1 && chosen > gap) || chosen < 0 ? gap : chosen;
}

// --- The chart ------------------------------------------------------------------------------------

/** The size of the face of the tick labels, and of the axis titles */
export const LABEL_SIZE = 11;
export const TITLE_SIZE = 12;
/** The room between the plot and its tick labels */
export const LABEL_GAP = 10;
/** The room around the tick labels (toward the plot, then outside), then before a title and its own */
export const LABEL_PADDING = LABEL_GAP + 8;
export const TITLE_GAP = 10;
const TITLE_ROOM = TITLE_GAP + TITLE_SIZE;
// The share of a bucket left free on its two sides, and the least height of a bar
const BAR_PADDING = 0.05;
const MIN_BAR_HEIGHT = 2;
// How many ticks each axis asks for at most
const X_TICKS = 10;
const Y_TICKS = 5;

export interface Tick {
  value: number;
  /** Blank when there was no room for it */
  label: string;
  /** Across the plot from its start (x), or down from its top (y) */
  position: number;
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The bucket */
  key: number;
  count: number;
}

export interface HistogramInput {
  /** The size of the place the chart is drawn in */
  width: number;
  height: number;
  /** Each bucket and how many documents fell in it, in time order */
  points: ReadonlyArray<{ x: number; y: number }>;
  /** The time range searched */
  from: number;
  to: number;
  /** The length of a bucket as its interval says (a month is 30 days) */
  intervalMs: number;
  /** The shortest bucket */
  minInterval: number;
  offsetAt: OffsetAt;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  /** The width a tick label takes */
  measure: (text: string) => number;
  hasXTitle: boolean;
  hasYTitle: boolean;
}

export interface HistogramGeometry {
  plot: { left: number; top: number; width: number; height: number };
  /** Where the box of the value axis starts, at the left; its title sits at its start */
  yAxisLeft: number;
  /** The width of the place of a bucket, its bar and the gaps beside it */
  band: number;
  /** The time axis: from a moment to a place across the plot, and back */
  project: (value: number) => number;
  invert: (position: number) => number;
  /** The first moment the axis shows, and the last bucket's start */
  domain: [number, number];
  minInterval: number;
  xTicks: Tick[];
  yTicks: Tick[];
  /** Where a grid line crosses the plot */
  xGrid: number[];
  yGrid: number[];
  bars: Bar[];
  /** The parts of the plot outside the time range searched, shaded */
  shades: Array<{ x: number; width: number }>;
  /** The line at the moment the search ran, when it falls on the chart */
  nowAt: (now: number) => number | undefined;
}

function labelBox(labels: string[], measure: (text: string) => number) {
  let width = 0;
  for (const label of labels) width = Math.max(width, Math.ceil(measure(label)));
  return { width, height: labels.length ? LABEL_SIZE : 0 };
}

// The labels that fit, from the start of the axis on: a label too close to the last one is blanked
function fitLabels(ticks: Tick[], room: number): Tick[] {
  let occupied = -Infinity;
  return [...ticks]
    .sort((a, b) => a.position - b.position)
    .map((tick) => {
      if (tick.position >= occupied + room) {
        occupied = tick.position + room;
        return tick;
      }
      return { ...tick, label: '' };
    });
}

/**
 * The ticks an axis keeps: of the counts from the most it asks for down to one, the first whose
 * labels all fit and do not repeat; failing that, the count that left the fewest labels.
 */
function adaptiveTicks(maxCount: number, kind: 'time' | 'linear', valuesFor: (count: number) => number[], place: (values: number[]) => Tick[]): Tick[] {
  let fallbackCount = 2;
  let fallbackLabels = Infinity;
  let previousLength = NaN;
  for (let count = maxCount; count >= 1; count -= 1) {
    const values = valuesFor(count);
    if (values.length === previousLength || values.length < 2) continue;
    const ticks = place(values);
    const labels = new Set(ticks.map((tick) => tick.label));
    const unique = ticks.length === labels.size;
    const atLeastTwo = labels.size >= 2;
    const allFit = !labels.has('');
    const compliant =
      kind === 'time'
        ? allFit && (unique || ticks.every((tick, index) => index === 0 || tick.label !== ticks[index - 1].label))
        : atLeastTwo && allFit && unique;
    previousLength = values.length;
    if (compliant) return ticks.filter((tick) => tick.label.length > 0);
    if (atLeastTwo && labels.size <= fallbackLabels) {
      fallbackLabels = labels.size;
      fallbackCount = count;
    }
  }
  return place(valuesFor(fallbackCount));
}

export function histogramGeometry(input: HistogramInput): HistogramGeometry {
  const { points, from, to, intervalMs, minInterval, offsetAt, formatX, formatY, measure } = input;
  const xs = points.map((point) => point.x);
  const first = xs.length ? xs[0] : from;
  const last = xs.length ? xs[xs.length - 1] : from;
  // The axis starts with the range or with the first bucket, if it starts earlier; it ends with
  // the last bucket, or with the last whole interval of the range
  const domainMin = first > from ? from : first;
  const domainMax = to - intervalMs > last ? to - intervalMs : last;
  const single = domainMax - domainMin === 0;
  const domain: [number, number] = [domainMin, single ? domainMin + minInterval : domainMax];
  const yMax = points.reduce((max, point) => Math.max(max, point.y), 0);

  // The room of the axes, from the labels the axes would have with all the ticks they ask for
  const xBox = labelBox(timeTicks(domain, X_TICKS, offsetAt, minInterval).map(formatX), measure);
  const yBox = labelBox(linearTicks(0, yMax, Y_TICKS).map(formatY), measure);
  const yGirth = LABEL_PADDING + yBox.width + (input.hasYTitle ? TITLE_ROOM : 0);
  const xGirth = LABEL_PADDING + xBox.height + (input.hasXTitle ? TITLE_ROOM : 0);
  const left = Math.max(xBox.width / 2, yGirth);
  const right = xBox.width / 2;
  const top = yBox.height / 2;
  const bottom = Math.max(yBox.height / 2, xGirth);
  const plot = { left, top, width: Math.max(0, input.width - left - right), height: Math.max(0, input.height - top - bottom) };

  // Each bucket has the same room; the last one ends where the plot does
  const intervalCount = (domain[1] - domain[0]) / minInterval;
  const band = plot.width / (intervalCount + (single ? 0 : 1));
  const span = plot.width - (single ? 0 : band);
  const extent = domain[1] - domain[0];
  const project = (value: number) => (extent === 0 ? span / 2 : ((value - domain[0]) / extent) * span);
  const invert = (position: number) => (span === 0 ? domain[0] : domain[0] + (position / span) * extent);
  const yScale = (value: number) => (yMax === 0 ? plot.height / 2 : plot.height - (value / yMax) * plot.height);

  const xTicks = adaptiveTicks(
    X_TICKS,
    'time',
    (count) => timeTicks(domain, count, offsetAt, minInterval),
    (values) => {
      const box = labelBox(values.map(formatX), measure);
      const all = [...values];
      // When there is a tick at every bucket, one more marks where the last bucket ends
      if (values.length >= 2) {
        const ultimate = values[values.length - 1];
        const distance = ultimate - values[values.length - 2];
        const more = minInterval / (distance || minInterval);
        for (let index = 1; index <= more; index += 1) all.push(index * distance + ultimate);
      }
      const ticks = all
        .map((value) => ({ value, label: formatX(value), position: project(value) }))
        .filter((tick) => Number.isFinite(tick.position));
      return fitLabels(ticks, box.width / 2);
    }
  );
  const yTicks = adaptiveTicks(
    Y_TICKS,
    'linear',
    (count) => linearTicks(0, yMax, count),
    (values) => {
      const box = labelBox(values.map(formatY), measure);
      return fitLabels(
        values.map((value) => ({ value, label: formatY(value), position: yScale(value) })),
        box.height / 2
      );
    }
  );

  const bars: Bar[] = [];
  for (const point of points) {
    if (point.x < domain[0] || point.x > domain[1]) continue;
    const y1 = yScale(point.y);
    const y0 = yScale(0);
    const difference = Math.abs(y1 - y0);
    const added = difference === 0 || difference >= MIN_BAR_HEIGHT ? 0 : MIN_BAR_HEIGHT - difference;
    bars.push({
      x: project(point.x) + (band * BAR_PADDING) / 2,
      y: Math.min(y1, y0) - (point.y >= 0 ? added : 0),
      width: band * (1 - BAR_PADDING),
      height: difference + added,
      key: point.x,
      count: point.y,
    });
  }

  // Shaded: the part of the first bucket before the range, the part of the last one after it
  const shades: Array<{ x: number; width: number }> = [];
  const shade = (start: number | undefined, end: number | undefined) => {
    const low = Math.max(domain[0], start ?? -Infinity);
    const high = Math.min(domain[1] + minInterval, end ?? Infinity);
    if (low > high) return;
    shades.push({ x: project(low), width: Math.abs(project(high) - project(low)) });
  };
  if (from !== domainMin) shade(undefined, from);
  if (to !== domainMax) shade(to, undefined);

  return {
    plot,
    yAxisLeft: left - yGirth,
    band,
    project,
    invert,
    domain,
    minInterval,
    xTicks,
    yTicks,
    xGrid: xTicks.filter((tick) => tick.value >= domain[0]).map((tick) => tick.position),
    yGrid: yTicks.map((tick) => tick.position),
    bars,
    shades,
    // The search's own end when it ran less than a minute ago, the moment itself otherwise
    nowAt: (now: number) => {
      const value = now > to && now < to + MINUTE ? to : now;
      return value >= domain[0] && value <= domain[1] + minInterval ? project(value) : undefined;
    },
  };
}

/**
 * The bucket under a place on the plot: the one whose room holds it, counted from the nearest
 * bucket with documents before it (or after it, before the first one)
 */
export function bucketAt(geometry: Pick<HistogramGeometry, 'invert' | 'minInterval'>, position: number, keys: readonly number[]): number | undefined {
  if (keys.length === 0) return undefined;
  const value = geometry.invert(position);
  const { minInterval } = geometry;
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle] < value) low = middle + 1;
    else high = middle;
  }
  if (low === 0) {
    const firstKey = keys[0];
    return value >= firstKey ? firstKey : firstKey - minInterval * Math.ceil((firstKey - value) / minInterval);
  }
  const before = keys[low - 1];
  return value - before <= minInterval ? before : before + minInterval * Math.floor((value - before) / minInterval);
}
