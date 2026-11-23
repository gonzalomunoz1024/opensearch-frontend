/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The functions that compute with the values of series: abs, aggregate, condition, cusum,
 * derivative, divide, first, fit, log, max, min, multiply, precision, range, scale_interval,
 * subtract, sum and trim. Names, arguments and help are OpenSearch Dashboards' own.
 */

import { Chainable } from '../classes';
import { toMS } from '../dates';
import { fitFunctions } from '../fit_functions';
import { i18n } from '../i18n';
import { alter, argType, reduce } from '../lib';
import type { Args, Point, Series, SeriesList, TlConfig } from '../types';
import { zip } from '../util';

const values = (data: Point[]) => data.map((point) => point[1]);
const times = (data: Point[]) => data.map((point) => point[0]);

export const abs = new Chainable('abs', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
  ],
  help: i18n.translate('timeline.help.functions.absHelpText', {
    defaultMessage: 'Return the absolute value of each value in the series list',
  }),
  fn: function absFn(args: Args) {
    return alter(args, function (eachSeries: Series) {
      const data = eachSeries.data.map(function (point): Point {
        return [point[0], Math.abs(point[1] as number)];
      });
      eachSeries.data = data;
      return eachSeries;
    });
  },
});

type Aggregator = (points: Array<number | null>) => unknown;

const numbers = (points: Array<number | null>) => points as number[];

const aggregateFunctions: Record<string, Aggregator> = {
  // lodash's sum and mean skip what is undefined, its max and min compare what is not
  avg: (points) => sumOf(points) / points.length,
  cardinality: (points) => new Set(points).size,
  min: (points) => extreme(points, (a, b) => a < b),
  max: (points) => extreme(points, (a, b) => a > b),
  last: (points) => points[points.length - 1],
  first: (points) => points[0],
  sum: (points) => sumOf(points),
};

/** lodash's `_.sum`: 0 for nothing, and the first value it does not skip to start from */
function sumOf(points: Array<number | null>): number {
  if (!points.length) return 0;
  let result: number | undefined;
  for (const point of numbers(points)) {
    if (point !== undefined) result = result === undefined ? point : result + point;
  }
  return result as number;
}

/** lodash's `_.max` and `_.min`: the extreme of the values that are not null or NaN */
function extreme(points: Array<number | null>, better: (a: number, b: number) => boolean) {
  let result: number | undefined;
  let computed: number | undefined;
  for (const value of numbers(points)) {
    const current = value;
    if (
      current != null &&
      (computed === undefined ? current === current : better(current, computed))
    ) {
      computed = current;
      result = value;
    }
  }
  return result;
}

export const aggregate = new Chainable('aggregate', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'function',
      types: ['string'],
      help: i18n.translate('timeline.help.functions.aggregate.args.functionHelpText', {
        defaultMessage: 'One of {functions}',
        values: {
          functions: Object.keys(aggregateFunctions).join(', '),
        },
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.aggregateHelpText', {
    defaultMessage:
      'Creates a static line based on result of processing all points in the series. Available functions: {functions}',
    values: {
      functions: Object.keys(aggregateFunctions).join(', '),
    },
  }),
  fn: function aggregateFn(args: Args) {
    const name = args.byName.function as string;
    const fn = Object.prototype.hasOwnProperty.call(aggregateFunctions, name)
      ? aggregateFunctions[name]
      : undefined;
    if (!fn)
      throw new Error(
        '.aggregate() function must be one of: ' + Object.keys(aggregateFunctions).join(', ')
      );

    return alter(args, function (eachSeries: Series) {
      const pointTimes = times(eachSeries.data);
      const pointValues = values(eachSeries.data);
      const result = fn(pointValues) as number | null;
      eachSeries.data = zip(pointTimes, pointValues.fill(result));
      return eachSeries;
    });
  },
});

export const condition = new Chainable('condition', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'operator', // <, <=, >, >=, ==, !=
      types: ['string'],
      help: i18n.translate('timeline.help.functions.condition.args.operatorHelpText', {
        defaultMessage:
          'comparison operator to use for comparison, valid operators are eq (equal), ' +
          'ne (not equal), lt (less than), lte (less than equal), gt (greater than), gte (greater than equal)',
      }),
      suggestions: [
        {
          name: 'eq',
          help: i18n.translate(
            'timeline.help.functions.condition.args.operator.suggestions.eqHelpText',
            {
              defaultMessage: 'equal',
            }
          ),
        },
        {
          name: 'ne',
          help: i18n.translate(
            'timeline.help.functions.condition.args.operator.suggestions.neHelpText',
            {
              defaultMessage: 'not equal',
            }
          ),
        },
        {
          name: 'lt',
          help: i18n.translate(
            'timeline.help.functions.condition.args.operator.suggestions.ltHelpText',
            {
              defaultMessage: 'less than',
            }
          ),
        },
        {
          name: 'lte',
          help: i18n.translate(
            'timeline.help.functions.condition.args.operator.suggestions.lteHelpText',
            {
              defaultMessage: 'less than equal',
            }
          ),
        },
        {
          name: 'gt',
          help: i18n.translate(
            'timeline.help.functions.condition.args.operator.suggestions.gtHelpText',
            {
              defaultMessage: 'greater than',
            }
          ),
        },
        {
          name: 'gte',
          help: i18n.translate(
            'timeline.help.functions.condition.args.operator.suggestions.gteHelpText',
            {
              defaultMessage: 'greater than equal',
            }
          ),
        },
      ],
    },
    {
      name: 'if',
      types: ['number', 'seriesList', 'null'],
      help: i18n.translate('timeline.help.functions.condition.args.ifHelpText', {
        defaultMessage:
          'The value to which the point will be compared. If you pass a seriesList here the first series will be used',
      }),
    },
    {
      name: 'then',
      types: ['number', 'seriesList', 'null'],
      help: i18n.translate('timeline.help.functions.condition.args.thenHelpText', {
        defaultMessage:
          'The value the point will be set to if the comparison is true. If you pass a seriesList here the first series will be used',
      }),
    },
    {
      name: 'else',
      types: ['number', 'seriesList', 'null'],
      help: i18n.translate('timeline.help.functions.condition.args.elseHelpText', {
        defaultMessage:
          'The value the point will be set to if the comparison is false. If you pass a seriesList here the first series will be used',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.conditionHelpText', {
    defaultMessage:
      'Compares each point to a number, or the same point in another series using an operator, ' +
      'then sets its value to the result if the condition proves true, with an optional else.',
  }),
  aliases: ['if'],
  fn: function conditionFn(args: Args) {
    const config = args.byName;
    return alter(args, function (eachSeries: Series) {
      const data = eachSeries.data.map(function (point, i): Point {
        function getNumber(source: unknown) {
          if (argType(source) === 'number') return source as number;
          if (argType(source) === 'null') return null;
          if (argType(source) === 'seriesList') return (source as SeriesList).list[0].data[i][1];
          throw new Error(
            i18n.translate('timeline.serverSideErrors.conditionFunction.wrongArgTypeErrorMessage', {
              defaultMessage: 'must be a number or a seriesList',
            })
          );
        }

        const ifVal = getNumber(config.if) as number;
        const thenVal = getNumber(config.then);
        const elseVal = config.else === undefined ? point[1] : getNumber(config.else);
        const value = point[1] as number;

        const newValue = (function () {
          switch (config.operator) {
            case 'lt':
              return value < ifVal ? thenVal : elseVal;
            case 'lte':
              return value <= ifVal ? thenVal : elseVal;
            case 'gt':
              return value > ifVal ? thenVal : elseVal;
            case 'gte':
              return value >= ifVal ? thenVal : elseVal;
            case 'eq':
              return value === ifVal ? thenVal : elseVal;
            case 'ne':
              return value !== ifVal ? thenVal : elseVal;
            default:
              throw new Error(
                i18n.translate(
                  'timeline.serverSideErrors.conditionFunction.unknownOperatorErrorMessage',
                  {
                    defaultMessage: 'Unknown operator',
                  }
                )
              );
          }
        })();
        return [point[0], newValue];
      });
      eachSeries.data = data;
      return eachSeries;
    });
  },
});

export const cusum = new Chainable('cusum', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'base',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.cusum.args.baseHelpText', {
        defaultMessage:
          'Number to start at. Basically just adds this to the beginning of the series',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.cusumHelpText', {
    defaultMessage: 'Return the cumulative sum of a series, starting at a base.',
  }),
  fn: function cusumFn(args: Args) {
    return alter(args, function (eachSeries: Series, base: number) {
      const pairs = eachSeries.data;
      let total = base || 0;
      eachSeries.data = pairs.map(function (point): Point {
        total += point[1] as number;
        return [point[0], total];
      });
      return eachSeries;
    });
  },
});

export const derivative = new Chainable('derivative', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
  ],
  help: i18n.translate('timeline.help.functions.derivativeHelpText', {
    defaultMessage: 'Plot the change in values over time.',
  }),
  fn: function derivativeFn(args: Args) {
    return alter(args, function (eachSeries: Series) {
      const pairs = eachSeries.data;
      eachSeries.data = pairs.map(function (point, i): Point {
        if (i === 0 || pairs[i - 1][1] == null || point[1] == null) {
          return [point[0], null];
        }
        return [point[0], point[1] - (pairs[i - 1][1] as number)];
      });
      return eachSeries;
    });
  },
});

export const divide = new Chainable('divide', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'divisor',
      types: ['seriesList', 'number'],
      help: i18n.translate('timeline.help.functions.divide.args.divisorHelpText', {
        defaultMessage:
          'Number or series to divide by. SeriesList with multiple series will be applied label-wise.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.divideHelpText', {
    defaultMessage:
      'Divides the values of one or more series in a seriesList to each position, in each series, of the input seriesList',
  }),
  fn: function divideFn(args: Args) {
    return reduce(args, function (a, b) {
      return a / b;
    });
  },
});

export const first = new Chainable('first', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
  ],
  help: i18n.translate('timeline.help.functions.firstHelpText', {
    defaultMessage: `This is an internal function that simply returns the input seriesList. Don't use this`,
  }),
  fn: function firstFn(args: Args) {
    return alter(args, function (eachSeries: Series) {
      return eachSeries;
    });
  },
});

export const fit = new Chainable('fit', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'mode',
      types: ['string'],
      help: i18n.translate('timeline.help.functions.fit.args.modeHelpText', {
        defaultMessage:
          'The algorithm to use for fitting the series to the target. One of: {fitFunctions}',
        values: {
          fitFunctions: Object.keys(fitFunctions).join(', '),
        },
      }),
      suggestions: Object.keys(fitFunctions).map((key) => {
        return { name: key };
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.fitHelpText', {
    defaultMessage: 'Fills null values using a defined fit function',
  }),
  fn: function absFn(args: Args) {
    return alter(args, function (eachSeries: Series, mode: string) {
      const noNulls = eachSeries.data.filter((item) => item[1] === 0 || item[1]);

      if (noNulls.length === 0) {
        return eachSeries;
      }

      eachSeries.data = fitFunctions[mode](noNulls, eachSeries.data);
      return eachSeries;
    });
  },
});

export const log = new Chainable('log', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'base',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.log.args.baseHelpText', {
        defaultMessage: 'Set logarithmic base, 10 by default',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.logHelpText', {
    defaultMessage:
      'Return the logarithm value of each value in the series list (default base: 10)',
  }),
  fn: function logFn(args: Args) {
    const config = args.byName;
    return alter(args, function (eachSeries: Series) {
      const data = eachSeries.data.map(function (point): Point {
        return [
          point[0],
          Math.log(point[1] as number) / Math.log((config.base as number) || 10),
        ];
      });
      eachSeries.data = data;
      return eachSeries;
    });
  },
});

export const max = new Chainable('max', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'value',
      types: ['seriesList', 'number'],
      help: i18n.translate('timeline.help.functions.max.args.valueHelpText', {
        defaultMessage:
          'Sets the point to whichever is higher, the existing value, or the one passed. ' +
          'If passing a seriesList it must contain exactly 1 series.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.maxHelpText', {
    defaultMessage:
      'Maximum values of one or more series in a seriesList to each position, in each series, of the input seriesList',
  }),
  fn: function maxFn(args: Args) {
    return reduce(args, function (a, b) {
      return Math.max(a, b);
    });
  },
});

export const min = new Chainable('min', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'value',
      types: ['seriesList', 'number'],
      help: i18n.translate('timeline.help.functions.min.args.valueHelpText', {
        defaultMessage:
          'Sets the point to whichever is lower, the existing value, or the one passed. ' +
          'If passing a seriesList it must contain exactly 1 series.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.minHelpText', {
    defaultMessage:
      'Minimum values of one or more series in a seriesList to each position, in each series, of the input seriesList',
  }),
  fn: function minFn(args: Args) {
    return reduce(args, function (a, b) {
      return Math.min(a, b);
    });
  },
});

export const multiply = new Chainable('multiply', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'multiplier',
      types: ['seriesList', 'number'],
      help: i18n.translate('timeline.help.functions.multiply.args.multiplierHelpText', {
        defaultMessage:
          'Number or series by which to multiply. SeriesList with multiple series will be applied label-wise.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.multiplyHelpText', {
    defaultMessage:
      'Multiply the values of one or more series in a seriesList to each position, in each series, of the input seriesList',
  }),
  fn: function multiplyFn(args: Args) {
    return reduce(args, function (a, b) {
      return a * b;
    });
  },
});

export const precision = new Chainable('precision', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'precision',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.precision.args.precisionHelpText', {
        defaultMessage: 'The number of digits to truncate each value to',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.precisionHelpText', {
    defaultMessage: 'The number of digits to truncate the decimal portion of the value to',
  }),
  fn: async function precisionFn(args: Args) {
    await alter(args, function (eachSeries: Series, precision: number) {
      eachSeries._meta = (eachSeries._meta as Record<string, unknown>) || {};
      (eachSeries._meta as Record<string, unknown>).precision = precision;
      return eachSeries;
    });

    return reduce(args, function (a, b) {
      return parseInt(String(a * Math.pow(10, b)), 10) / Math.pow(10, b);
    });
  },
});

export const range = new Chainable('range', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'min',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.range.args.minHelpText', {
        defaultMessage: 'New minimum value',
      }),
    },
    {
      name: 'max',
      types: ['number'],
      help: i18n.translate('timeline.help.functions.range.args.maxHelpText', {
        defaultMessage: 'New maximum value',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.rangeHelpText', {
    defaultMessage: 'Changes the max and min of a series while keeping the same shape',
  }),
  fn: function range(args: Args) {
    return alter(args, function (eachSeries: Series) {
      const pointValues = values(eachSeries.data);
      const lowest = aggregateFunctions.min(pointValues) as number;
      const highest = aggregateFunctions.max(pointValues) as number;
      const newMin = args.byName.min as number;
      const newMax = args.byName.max as number;

      // newvalue= (max'-min')/(max-min)*(value-min)+min'.
      const data = eachSeries.data.map(function (point): Point {
        const val =
          ((newMax - newMin) / (highest - lowest)) * ((point[1] as number) - lowest) + newMin;
        return [point[0], val];
      });
      eachSeries.data = data;
      return eachSeries;
    });
  },
});

export const scaleInterval = new Chainable('scale_interval', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'interval',
      types: ['string'],
      help: i18n.translate('timeline.help.functions.scaleInterval.args.intervalHelpText', {
        defaultMessage:
          'The new interval in date math notation, e.g., 1s for 1 second. 1m, 5m, 1M, 1w, 1y, etc.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.scaleIntervalHelpText', {
    defaultMessage:
      'Changes scales a value (usually a sum or a count) to a new interval. For example, as a per-second rate',
  }),
  fn: function scaleIntervalFn(args: Args, tlConfig: TlConfig) {
    const currentInterval = toMS(tlConfig.time.interval) as number;
    const scaleInterval = toMS(args.byName.interval as string) as number;

    return alter(args, function (eachSeries: Series) {
      const data = eachSeries.data.map(function (point): Point {
        return [point[0], ((point[1] as number) / currentInterval) * scaleInterval];
      });
      eachSeries.data = data;
      return eachSeries;
    });
  },
});

export const subtract = new Chainable('subtract', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'term',
      types: ['seriesList', 'number'],
      help: i18n.translate('timeline.help.functions.subtract.args.termHelpText', {
        defaultMessage:
          'Number or series to subtract from input. SeriesList with multiple series will be applied label-wise.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.subtractHelpText', {
    defaultMessage:
      'Subtract the values of one or more series in a seriesList to each position, in each series, of the input seriesList',
  }),
  fn: function subtractFn(args: Args) {
    return reduce(args, function (a, b) {
      return a - b;
    });
  },
});

export const sum = new Chainable('sum', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'term',
      types: ['seriesList', 'number'],
      help: i18n.translate('timeline.help.functions.sum.args.termHelpText', {
        defaultMessage:
          'Number or series to sum with the input series. SeriesList with multiple series will be applied label-wise.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.sumHelpText', {
    defaultMessage:
      'Adds the values of one or more series in a seriesList to each position, in each series, of the input seriesList',
  }),
  aliases: ['add', 'plus'],
  fn: function sumFn(args: Args) {
    return reduce(args, function (a, b) {
      return a + b;
    });
  },
});

export const trim = new Chainable('trim', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'start',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.trim.args.startHelpText', {
        defaultMessage: 'Buckets to trim from the beginning of the series. Default: 1',
      }),
    },
    {
      name: 'end',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.trim.args.endHelpText', {
        defaultMessage: 'Buckets to trim from the end of the series. Default: 1',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.trimHelpText', {
    defaultMessage:
      'Set N buckets at the start or end of a series to null to fit the "partial bucket issue"',
  }),
  fn: function conditionFn(args: Args) {
    const config = args.byName;
    if (config.start == null) config.start = 1;
    if (config.end == null) config.end = 1;

    return alter(args, function (eachSeries: Series) {
      // lodash's times: a whole number of times, none for what is not a positive number
      const count = (value: unknown) => {
        const n = Math.trunc(Number(value));
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      for (let i = 0; i < count(config.start); i++) {
        eachSeries.data[i][1] = null;
      }

      for (let i = 0; i < count(config.end); i++) {
        eachSeries.data[eachSeries.data.length - 1 - i][1] = null;
      }

      return eachSeries;
    });
  },
});
