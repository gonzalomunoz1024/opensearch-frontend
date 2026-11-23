/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The fit functions: how a series is brought onto the buckets of the chart's time span and
 * interval (`server/fit_functions/` of OpenSearch Dashboards).
 */

import { i18n } from './i18n';
import type { Point } from './types';
import { zip } from './util';

// Upsampling and down sampling of non-cumulative sets
// Good: min, max, average
// Bad: sum, count
function average(dataTuples: Point[], targetTuples: Point[]): Point[] {
  // Phase 1: Downsample
  // We necessarily won't well match the dataSource here as we don't know how much data
  // they had when creating their own average
  const resultTimes = targetTuples.map((bucket) => bucket[0]);
  const dataTuplesQueue = dataTuples.slice();
  const resultValues = targetTuples.map(function (bucket) {
    const time = bucket[0];
    let i = 0;
    const avgSet: Array<number | null> = [];

    // This is naive, it doesn't consider where the line is going next,
    // It simply writes the point and moves on once it hits <= time.
    // Thus this algorithm will tend to lag the trend.
    while (i < dataTuplesQueue.length && dataTuplesQueue[i][0] <= time) {
      avgSet.push(dataTuplesQueue[i][1]);
      i++;
    }

    dataTuplesQueue.splice(0, i);

    const sum = avgSet.reduce<number>((total, num) => total + (num as number), 0);

    return avgSet.length ? sum / avgSet.length : NaN;
  });

  // Phase 2: Upsample if needed
  // If we have any NaNs we are probably resampling from a big interval to a small one (eg, 1M as 1d)
  // So look for the missing stuff in the array, and smooth it out
  const naNIndex = resultValues.findIndex((val) => isNaN(val));

  if (naNIndex > -1) {
    let i = 0;
    let naNCount = 0;
    let previousRealNumber = 0;
    let stepSize;
    while (i < resultValues.length) {
      if (isNaN(resultValues[i])) {
        if (i === 0) {
          // If our first number is NaN, initialize from dataTuples;
          previousRealNumber = dataTuples[0][1] as number;
        }
        naNCount++;
      } else {
        // Otherwise, backfill the NaNs with averaged out data
        if (naNCount > 0) {
          stepSize = (resultValues[i] - previousRealNumber) / (naNCount + 1);
          while (naNCount > 0) {
            resultValues[i - naNCount] = previousRealNumber + stepSize;
            previousRealNumber = resultValues[i - naNCount];
            naNCount--;
          }
        }
        previousRealNumber = resultValues[i];
      }
      i++;
    }
  }

  return zip(resultTimes, resultValues);
}

// Upsampling of non-cumulative sets
// Good: average, min, max
// Bad: sum, count

// Don't use this to down sample, it simply won't do the right thing.
function carry(dataTuples: Point[], targetTuples: Point[]): Point[] {
  if (dataTuples.length > targetTuples.length) {
    throw new Error(
      i18n.translate('timeline.fitFunctions.carry.downSampleErrorMessage', {
        defaultMessage: `Don't use the 'carry' fit method to down sample, use 'scale' or 'average'`,
        description:
          '"carry", "scale" and "average" are parameter values that must not be translated.',
      })
    );
  }

  let currentCarry = dataTuples[0][1];
  return targetTuples.map(function (bucket) {
    const targetTime = bucket[0];
    const dataTime = dataTuples[0][0];

    if (dataTuples[0] && targetTime >= dataTime) {
      currentCarry = dataTuples[0][1];
      if (dataTuples.length > 1) {
        dataTuples.shift();
      }
    }

    return [bucket[0], currentCarry];
  });
}

// Upsampling and downsampling of non-cumulative sets
// Good: average, min, max
// Bad: sum, count
function nearest(dataTuples: Point[], targetTuples: Point[]): Point[] {
  return targetTuples.map(function (bucket) {
    const time = bucket[0];
    let i = 0;
    while (
      i < dataTuples.length - 1 &&
      (Math.abs(dataTuples[i + 1][0] - time) < Math.abs(dataTuples[i][0] - time) ||
        // TODO: Certain offset= args can cause buckets with duplicate times, e.g., offset=-1M
        // check for that, and only use the last of the duplicates. The reason this happens?
        // What is 1M before Mar 30th? What about 1M before Mar 31st? Both are the last day
        // in Feb. Something has to be chucked. If offsetting by M user might want to use
        // fit=average
        Math.abs(dataTuples[i + 1][0] - time) === Math.abs(dataTuples[i][0] - time))
    ) {
      i++;
    }

    const closest = dataTuples[i];
    dataTuples.splice(0, i);

    return [bucket[0], closest[1]];
  });
}

// **DON'T USE THIS**
// Performing joins/math with other sets that don't match perfectly will be wrong
// Does not resample at all.
function none(dataTuples: Point[]): Point[] {
  return dataTuples;
}

// Downsampling of cumulative metrics
// Good: count, sum
// Bad: avg, min, max

// For upsampling cumulative metrics (eg sum from 1M to 1d), could rename this scale.
// Really only the 0s that screws this up, need to distribute contents of spikes to empty buckets
// Empty is currently 0, which is not right
function scale(dataTuples: Point[], targetTuples: Point[]): Point[] {
  let i = 0;
  let j = 0;
  let spreadCount = 0;
  const result: Point[] = [];
  let bucket;
  let time;
  let scaleSet: Array<number | null>;
  let step;
  let nextRealNumber;

  while (i < targetTuples.length) {
    scaleSet = [];
    bucket = targetTuples[i];
    time = bucket[0];

    // Find stuff to sum
    j = 0;
    while (j < dataTuples.length && Math.abs(Number(dataTuples[j][0] <= time))) {
      scaleSet.push(dataTuples[j][1]);
      j++;
    }
    dataTuples.splice(0, j);

    // We hit a real number, or the end
    if (scaleSet.length > 0 || i === targetTuples.length - 1) {
      nextRealNumber = scaleSet.reduce<number>((sum, num) => sum + (num as number), 0);

      step = nextRealNumber;
      // Backfill null buckets
      if (spreadCount > 0) {
        // Naively distribute the nextRealNumber amongst the buckets
        // Without considering where it is headed next
        // We do spreadCount + 1 so that we include nextRealNumber when we smooth things out,
        // since we'll overwrite it anyway.
        // Thus [5, null, null, 30] becomes [5, 10, 10, 10]
        step = nextRealNumber / (spreadCount + 1);
        while (spreadCount > 0) {
          result[i - spreadCount][1] = step;
          spreadCount--;
        }
      }
      result.push([time, step]);
    } else {
      result.push([time, null]);
      spreadCount++;
    }

    i++;
  }

  return result;
}

export type FitFunction = (dataTuples: Point[], targetTuples: Point[]) => Point[];

/** In the order OpenSearch Dashboards lists them, the order of their file names */
export const fitFunctions: Record<string, FitFunction> = { average, carry, nearest, none, scale };
