/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The functions that smooth or predict series: holt (exponential smoothing), movingaverage,
 * movingstd and trend. Names, arguments and help are OpenSearch Dashboards' own.
 */

import { Chainable } from '../classes';
import { toMS } from '../dates';
import { i18n } from '../i18n';
import { alter } from '../lib';
import type { Args, Point, Series, SeriesList, TlConfig } from '../types';
import { cloneDeep } from '../util';

type Value = number | null;

// --- holt ---------------------------------------------------------------------------------------

/* Single exponential smoothing. Assuming even interval */
function ses(points: Value[], alpha: number): Value[] {
  let origin: Value = null;
  let level: Value = null;

  return points.reduce<Value[]>((result, point, i) => {
    if (i === 0) {
      origin = point;
      level = point;
    } else {
      // In the case that point[1] is null, we keep origin the same
      // and forecast the point based on the previous smoothed point
      if (point != null) {
        origin = point;
      }
      if (origin == null) {
        level = null;
      } else {
        const prevSmoothed = result[i - 1] as number;
        level = alpha * origin + (1 - alpha) * prevSmoothed;
      }
    }

    result.push(level);
    return result;
  }, []);
}

/* Double exponential smoothing */
function des(points: Value[], alpha: number, beta: number): Value[] {
  let level = 0;
  let prevLevel;
  let trend = 0;
  let prevTrend;
  let unknownCount = 0;

  if (points.length < 2) {
    throw new Error(
      i18n.translate('timeline.serverSideErrors.holtFunction.notEnoughPointsErrorMessage', {
        defaultMessage: 'You need at least 2 points to use double exponential smoothing',
      })
    );
  }

  return points.map((point, i) => {
    if (i === 0) {
      return point;
    }

    if (i === 1) {
      // Establish initial values for level and trend;
      level = points[0] as number;
      trend = (points[1] as number) - (points[0] as number); // This is sort of a lame way to do this
    }

    if (point == null) {
      unknownCount++;
    } else {
      unknownCount = 0;
      // These 2 variables are not required, but are used for clarity.
      prevLevel = level;
      prevTrend = trend;
      level = alpha * point + (1 - alpha) * (prevLevel + prevTrend);
      trend = beta * (level - prevLevel) + (1 - beta) * prevTrend;
    }

    return level + unknownCount * trend;
  });
}

/* Triple exponential smoothing */

// Uh, I don't think this will work when you have nulls in the initial seasonal components
function initSeasonalComponents(samplePoints: Value[], seasonLength: number) {
  const sampledSeasonCount = samplePoints.length / seasonLength;
  let currentSeason: Value[] = [];
  const seasonalAverages = samplePoints.reduce<number[]>((result, point, i) => {
    currentSeason.push(point);
    // If this is the end of the season, add it to the result;
    if (i % seasonLength === seasonLength - 1) {
      result.push(lodashSum(currentSeason) / seasonLength);
      currentSeason = [];
    }

    return result;
  }, []);

  return times(seasonLength, (i) => {
    let sumOfValsOverAvg = 0;
    times(sampledSeasonCount, (j) => {
      sumOfValsOverAvg += (samplePoints[seasonLength * j + i] as number) - seasonalAverages[j];
    });

    return sumOfValsOverAvg / sampledSeasonCount;
  });
}

// This is different from the DES method of establishing trend because it looks for
// the difference in points between seasons
function initTrend(samplePoints: Value[], seasonLength: number) {
  let sum = 0;
  times(seasonLength, (i) => {
    sum += ((samplePoints[i + seasonLength] as number) - (samplePoints[i] as number)) / seasonLength;
  });
  return sum / seasonLength;
}

function tes(
  points: Value[],
  alpha: number,
  beta: number,
  gamma: number,
  seasonLength: number,
  seasonsToSample: number
): Value[] {
  const samplePoints = points.slice(0, seasonLength * seasonsToSample);
  const seasonals = initSeasonalComponents(samplePoints, seasonLength);
  let level = 0;
  let prevLevel;
  let trend = 0;
  let prevTrend;
  let unknownCount = 0;

  return points.map((point, i) => {
    const seasonalPosition = i % seasonLength;
    // For the first samplePoints.length we use the actual points
    // After that we switch to the forecast
    if (i === 0) {
      trend = initTrend(points, seasonLength);
      level = points[0] as number;
      return points[0];
    }

    // Beta isn't actually used once we're forecasting?
    if (point == null || i >= samplePoints.length) {
      unknownCount++;
      // Don't know this point, make it up!
      return level + unknownCount * trend + seasonals[seasonalPosition];
    } else {
      unknownCount = 0;
      // These 2 variables are not required, but are used for clarity.
      prevLevel = level;
      prevTrend = trend;
      level = alpha * (point - seasonals[seasonalPosition]) + (1 - alpha) * (prevLevel + prevTrend);
      trend = beta * (level - prevLevel) + (1 - beta) * prevTrend;
      seasonals[seasonalPosition] =
        gamma * (point - level) + (1 - gamma) * seasonals[seasonalPosition];
      return level + trend + seasonals[seasonalPosition];
    }
  });
}

/** lodash's `_.times`: a whole number of calls, none for what is not a positive number */
function times<T>(n: number, fn: (i: number) => T): T[] {
  const count = Math.trunc(n);
  const result: T[] = [];
  if (!Number.isFinite(count) || count < 1) return result;
  for (let i = 0; i < count; i++) result.push(fn(i));
  return result;
}

/** lodash's `_.sum` */
function lodashSum(values: Value[]): number {
  if (!values.length) return 0;
  let result: number | undefined;
  for (const value of values as number[]) {
    if (value !== undefined) result = result === undefined ? value : result + value;
  }
  return result as number;
}

export const holt = new Chainable('holt', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'alpha',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.holt.args.alphaHelpText', {
        defaultMessage: `
        Smoothing weight from 0 to 1.
        Increasing alpha will make the new series more closely follow the original.
        Lowering it will make the series smoother`,
      }),
    },
    {
      name: 'beta',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.holt.args.betaHelpText', {
        defaultMessage: `
        Trending weight from 0 to 1.
        Increasing beta will make rising/falling lines continue to rise/fall longer.
        Lowering it will make the function learn the new trend faster`,
      }),
    },
    {
      name: 'gamma',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.holt.args.gammaHelpText', {
        defaultMessage: `
        Seasonal weight from 0 to 1. Does your data look like a wave?
        Increasing this will give recent seasons more importance, thus changing the wave form faster.
        Lowering it will reduce the importance of new seasons, making history more important.
        `,
      }),
    },
    {
      name: 'season',
      types: ['string'],
      help: i18n.translate('timeline.help.functions.holt.args.seasonHelpText', {
        defaultMessage:
          'How long is the season, e.g., 1w if your pattern repeats weekly. (Only useful with gamma)',
        description:
          '"1w" is an expression value and should not be translated. "gamma" is a parameter name and should not be translated.',
      }),
    },
    {
      name: 'sample',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.holt.args.sampleHelpText', {
        defaultMessage: `
      The number of seasons to sample before starting to "predict" in a seasonal series.
      (Only useful with gamma, Default: all)`,
        description: '"gamma" and "all" are parameter names and values and must not be translated.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.holtHelpText', {
    defaultMessage: `
    Sample the beginning of a series and use it to forecast what should happen
    via several optional parameters. In general, this doesn't really predict the
    future, but predicts what should be happening right now according to past data,
    which can be useful for anomaly detection. Note that nulls will be filled with forecasted values.`,
    description: '"null" is a data value here and must not be translated.',
  }),
  fn: function expsmoothFn(args: Args, tlConfig: TlConfig) {
    const newSeries = cloneDeep(args.byName.inputSeries) as SeriesList;

    const alpha = args.byName.alpha as number | undefined;
    const beta = args.byName.beta as number | undefined;
    const gamma = args.byName.gamma as number | undefined;

    newSeries.list.forEach(function (series) {
      const sample = (args.byName.sample as number) || series.data.length; // If we use length it should simply never predict

      // Single exponential smoothing
      // This is basically a weighted moving average in which the older
      // points exponentially degrade relative to the alpha, e.g.:
      // 0.8^1, 0.8^2, 0.8^3, etc

      const pointTimes = series.data.map((point) => point[0]);
      let pointValues = series.data.map((point) => point[1]);

      if (alpha != null && beta == null && gamma == null) {
        pointValues = ses(pointValues, alpha);
      }

      if (alpha != null && beta != null && gamma == null) {
        pointValues = des(pointValues, alpha, beta);
      }

      if (alpha != null && beta != null && gamma != null) {
        if (!sample || !args.byName.season || sample < 2) {
          throw new Error(
            i18n.translate('timeline.serverSideErrors.holtFunction.missingParamsErrorMessage', {
              defaultMessage: 'Must specify a season length and a sample size >= 2',
            })
          );
        }
        const season = Math.round(
          (toMS(args.byName.season as string) as number) / (toMS(tlConfig.time.interval) as number)
        );
        pointValues = tes(pointValues, alpha, beta, gamma, season, sample);
      }

      // lodash's assign of the pairs onto the list of points, index by index
      pointTimes.forEach((time, i) => {
        series.data[i] = [time, pointValues[i]];
      });
    });

    return newSeries;
  },
});

// --- movingaverage ------------------------------------------------------------------------------

const validPositions = ['left', 'right', 'center'];
const defaultPosition = 'center';

/** lodash's reduce without a start over the values of a slice, as both moving functions sum */
function sumOfValues(pairSlice: Point[]): number {
  if (pairSlice.length === 0) return undefined as unknown as number;
  return pairSlice
    .map((point) => point[1])
    .reduce((memo, num) => (memo as number) + (num as number)) as number;
}

export const movingaverage = new Chainable('movingaverage', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'window',
      types: ['number', 'string'],
      help: i18n.translate('timeline.help.functions.movingaverage.args.windowHelpText', {
        defaultMessage:
          'Number of points, or a date math expression (eg 1d, 1M) to average over. If a date math expression ' +
          'is specified, the function will get as close as possible given the currently select interval. ' +
          'If the date math expression is not evenly divisible by the interval the results may appear abnormal.',
      }),
    },
    {
      name: 'position',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.movingaverage.args.positionHelpText', {
        defaultMessage:
          'Position of the averaged points relative to the result time. One of: {validPositions}',
        values: {
          validPositions: validPositions.join(', '),
        },
      }),
      suggestions: validPositions.map((position) => {
        const suggestion: { name: string; help?: string } = { name: position };
        if (position === defaultPosition) {
          suggestion.help = 'default';
        }
        return suggestion;
      }),
    },
  ],
  aliases: ['mvavg'],
  help: i18n.translate('timeline.help.functions.movingaverageHelpText', {
    defaultMessage:
      'Calculate the moving average over a given window. Nice for smoothing noisy series',
  }),
  fn: function movingaverageFn(args: Args, tlConfig: TlConfig) {
    return alter(
      args,
      function (eachSeries: Series, _window: number | string, _position: string | null) {
        // _window always needs to be a number, if isn't we have to make it into one.
        if (typeof _window !== 'number') {
          // Ok, I guess its a datemath expression
          const windowMilliseconds = toMS(_window) as number;

          // calculate how many buckets that _window represents
          const intervalMilliseconds = toMS(tlConfig.time.interval) as number;

          // Round, floor, ceil? We're going with round because it splits the difference.
          _window = Math.round(windowMilliseconds / intervalMilliseconds) || 1;
        }
        const windowSize = _window;

        _position = _position || defaultPosition;
        if (!validPositions.includes(_position)) {
          throw new Error(
            i18n.translate(
              'timeline.serverSideErrors.movingaverageFunction.notValidPositionErrorMessage',
              {
                defaultMessage: 'Valid positions are: {validPositions}',
                values: {
                  validPositions: validPositions.join(', '),
                },
              }
            )
          );
        }

        const pairs = eachSeries.data;
        const pairsLen = pairs.length;
        eachSeries.label = eachSeries.label + ' mvavg=' + windowSize;

        function toPoint(point: Point, pairSlice: Point[]): Point {
          const average = sumOfValues(pairSlice) / windowSize;
          return [point[0], average];
        }

        if (_position === 'center') {
          const windowLeft = Math.floor(windowSize / 2);
          const windowRight = windowSize - windowLeft;
          eachSeries.data = pairs.map(function (point, i): Point {
            if (i < windowLeft || i > pairsLen - windowRight) return [point[0], null];
            return toPoint(point, pairs.slice(i - windowLeft, i + windowRight));
          });
        } else if (_position === 'left') {
          eachSeries.data = pairs.map(function (point, i): Point {
            const cursor = i + 1;
            if (cursor < windowSize) return [point[0], null];
            return toPoint(point, pairs.slice(cursor - windowSize, cursor));
          });
        } else if (_position === 'right') {
          eachSeries.data = pairs.map(function (point, i): Point {
            if (i > pairsLen - windowSize) return [point[0], null];
            return toPoint(point, pairs.slice(i, i + windowSize));
          });
        }

        return eachSeries;
      }
    );
  },
});

// --- movingstd ----------------------------------------------------------------------------------

const positions = ['left', 'right', 'center'];
const defaultStdPosition = positions[0];

export const movingstd = new Chainable('movingstd', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'window',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.movingstd.args.windowHelpText', {
        defaultMessage: 'Number of points to compute the standard deviation over.',
      }),
    },
    {
      name: 'position',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.movingstd.args.positionHelpText', {
        defaultMessage:
          'Position of the window slice relative to the result time. Options are {positions}. Default: {defaultPosition}',
        values: {
          positions: positions.join(', '),
          defaultPosition: defaultStdPosition,
        },
      }),
    },
  ],
  aliases: ['mvstd'],
  help: i18n.translate('timeline.help.functions.movingstdHelpText', {
    defaultMessage:
      'Calculate the moving standard deviation over a given window. Uses naive two-pass algorithm. ' +
      'Rounding errors may become more noticeable with very long series, or series with very large numbers.',
  }),
  fn: function movingstdFn(args: Args) {
    return alter(args, function (eachSeries: Series, _window: number, _position: string | null) {
      _position = _position || defaultStdPosition;

      if (!positions.includes(_position)) {
        throw new Error(
          i18n.translate(
            'timeline.serverSideErrors.movingstdFunction.notValidPositionErrorMessage',
            {
              defaultMessage: 'Valid positions are: {validPositions}',
              values: {
                validPositions: positions.join(', '),
              },
            }
          )
        );
      }

      const pairs = eachSeries.data;
      const pairsLen = pairs.length;
      eachSeries.label = eachSeries.label + ' mvstd=' + _window;

      function toPoint(point: Point, pairSlice: Point[]): Point {
        const average = sumOfValues(pairSlice) / _window;

        const deviations = pairSlice.map(function (slicePoint) {
          return Math.pow((slicePoint[1] as number) - average, 2);
        });
        const variance =
          (deviations.length
            ? deviations.reduce(function (memo, num) {
                return memo + num;
              })
            : (undefined as unknown as number)) /
          (_window - 1);

        return [point[0], Math.sqrt(variance)];
      }

      if (_position === 'center') {
        const windowLeft = Math.floor(_window / 2);
        const windowRight = _window - windowLeft;
        eachSeries.data = pairs.map(function (point, i): Point {
          if (i < windowLeft || i >= pairsLen - windowRight) return [point[0], null];
          return toPoint(point, pairs.slice(i - windowLeft, i + windowRight));
        });
      } else if (_position === 'left') {
        eachSeries.data = pairs.map(function (point, i): Point {
          if (i < _window) return [point[0], null];
          return toPoint(point, pairs.slice(i - _window, i));
        });
      } else if (_position === 'right') {
        eachSeries.data = pairs.map(function (point, i): Point {
          if (i >= pairsLen - _window) return [point[0], null];
          return toPoint(point, pairs.slice(i, i + _window));
        });
      }

      return eachSeries;
    });
  },
});

// --- trend --------------------------------------------------------------------------------------

function sumOf(data: Point[], fn: (d: Point) => number) {
  return data.reduce(function (total, d) {
    return total + (d[1] == null ? 0 : fn(d));
  }, 0);
}

function count(data: Point[]) {
  return data.filter(function (d) {
    return d[1] == null ? false : true;
  }).length;
}

function mapTuples(data: Point[], fn: (d: Point) => number): Point[] {
  return data.map(function (d) {
    return [d[0], fn(d)];
  });
}

function linear(data: Point[]) {
  const xSum = sumOf(data, (d) => d[0]);
  const ySum = sumOf(data, (d) => d[1] as number);
  const xSqSum = sumOf(data, (d) => d[0] * d[0]);
  const xySum = sumOf(data, (d) => d[0] * (d[1] as number));
  const observations = count(data);

  const gradient = (observations * xySum - xSum * ySum) / (observations * xSqSum - xSum * xSum);

  const intercept = ySum / observations - (gradient * xSum) / observations;

  return mapTuples(data, (d) => d[0] * gradient + intercept);
}

function log(data: Point[]) {
  const logXSum = sumOf(data, (d) => Math.log(d[0]));
  const yLogXSum = sumOf(data, (d) => (d[1] as number) * Math.log(d[0]));
  const ySum = sumOf(data, (d) => d[1] as number);
  const logXsqSum = sumOf(data, (d) => Math.pow(Math.log(d[0]), 2));
  const observations = count(data);

  const b =
    (observations * yLogXSum - ySum * logXSum) / (observations * logXsqSum - logXSum * logXSum);

  const a = (ySum - b * logXSum) / observations;

  return mapTuples(data, (d) => a + b * Math.log(d[0]));
}

const validRegressions: Record<string, string> = {
  linear: 'linear',
  log: 'logarithmic',
};

export const trend = new Chainable('trend', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'mode',
      types: ['string'],
      help: i18n.translate('timeline.help.functions.trend.args.modeHelpText', {
        defaultMessage:
          'The algorithm to use for generating the trend line. One of: {validRegressions}',
        values: {
          validRegressions: Object.keys(validRegressions).join(', '),
        },
      }),
      suggestions: Object.keys(validRegressions).map((key) => {
        return { name: key, help: validRegressions[key] };
      }),
    },
    {
      name: 'start',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.trend.args.startHelpText', {
        defaultMessage:
          'Where to start calculating from the beginning or end. For example -10 would start ' +
          'calculating 10 points from the end, +15 would start 15 points from the beginning. Default: 0',
      }),
    },
    {
      name: 'end',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.trend.args.endHelpText', {
        defaultMessage:
          'Where to stop calculating from the beginning or end. For example -10 would stop ' +
          'calculating 10 points from the end, +15 would stop 15 points from the beginning. Default: 0',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.trendHelpText', {
    defaultMessage: 'Draws a trend line using a specified regression algorithm',
  }),
  fn: function absFn(args: Args) {
    const newSeries = cloneDeep(args.byName.inputSeries) as SeriesList;

    newSeries.list.forEach(function (series) {
      const length = series.data.length;
      let start = args.byName.start == null ? 0 : (args.byName.start as number);
      let end = args.byName.end == null ? length : (args.byName.end as number);
      start = start >= 0 ? start : length + start;
      end = end > 0 ? end : length + end;

      const subset = series.data.slice(start, end);

      const result = args.byName.mode === 'log' ? log(subset) : linear(subset);

      series.data.forEach(function (point) {
        point[1] = null;
      });

      result.forEach(function (point, i) {
        series.data[start + i] = point;
      });
    });
    return newSeries;
  },
});
