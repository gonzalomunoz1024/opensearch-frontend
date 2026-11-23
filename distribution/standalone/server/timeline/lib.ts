/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What Timeline's runner and functions share (`server/lib/` and `server/handlers/lib/` of
 * OpenSearch Dashboards): applying a function to each series or pairwise to two lists, offsets,
 * the buckets of the chart, the arguments of a call put in order, checked and named, the time a
 * request asks for, and the settings' defaults.
 */

import { addTime, startOf, toMS, toTimestamp } from './dates';
import { i18n } from './i18n';
import { parse, type Series as ExpressionSeries } from './parser';
import type { ArgDefinition, Point, Series, SeriesList, TimelineFunctionLike, TlConfig } from './types';
import { defaults, isObject, isObjectLike, type Dict } from './util';

// --- alter and reduce ---------------------------------------------------------------------------

/** Calls `fn` on each series of the first argument with the other arguments after it */
export async function alter(
  args: unknown[],
  fn: (series: Series, ...rest: never[]) => Series | Series[]
): Promise<SeriesList> {
  // In theory none of the args should ever be promises. This is probably a waste.
  const resolved = await Promise.all(Array.from(args));
  const seriesList = resolved.shift() as SeriesList;

  if (seriesList.type !== 'seriesList') {
    throw new Error('args[0] must be a seriesList');
  }

  const call = fn as (series: Series, ...rest: unknown[]) => Series | Series[];
  seriesList.list = seriesList.list.flatMap((series) => call(series, ...resolved));
  return seriesList;
}

function allSeriesContainKey(seriesList: SeriesList, key: string) {
  return seriesList.list.reduce(
    (containsKey, series) => containsKey && Object.prototype.hasOwnProperty.call(series, key),
    true
  );
}

type Reducer = (a: number, b: number, i?: number, p?: unknown[]) => number;

async function pairwiseReduce(left: SeriesList, right: SeriesList, fn: Reducer) {
  if (left.list.length !== right.list.length) {
    throw new Error('Unable to pairwise reduce seriesLists, number of series are not the same');
  }

  let pairwiseField = 'label';
  if (allSeriesContainKey(left, 'split') && allSeriesContainKey(right, 'split')) {
    pairwiseField = 'split';
  }
  const indexedList: Record<string, Series> = {};
  for (const series of right.list) indexedList[String(series[pairwiseField])] = series;

  // ensure seriesLists contain same pairwise labels
  left.list.forEach((leftSeries) => {
    if (!indexedList[String(leftSeries[pairwiseField])]) {
      const rightSeriesLabels = right.list
        .map((rightSeries) => {
          return `"${rightSeries[pairwiseField]}"`;
        })
        .join(',');
      throw new Error(
        `Matching series could not be found for "${leftSeries[pairwiseField]}" in [${rightSeriesLabels}]`
      );
    }
  });

  // pairwise reduce seriesLists
  const pairwiseSeriesList: SeriesList = { type: 'seriesList', list: [] };
  // As upstream: each pair is reduced without waiting, which is done before anything awaits it
  left.list.forEach(async (leftSeries) => {
    const first: SeriesList = { type: 'seriesList', list: [leftSeries] };
    const second: SeriesList = {
      type: 'seriesList',
      list: [indexedList[String(leftSeries[pairwiseField])]],
    };
    const reducedSeriesList = await reduce([first, second], fn);
    const reducedSeries = reducedSeriesList.list[0];
    reducedSeries.label = leftSeries[pairwiseField] as string;
    pairwiseSeriesList.list.push(reducedSeries);
  });
  return pairwiseSeriesList;
}

/**
 * Reduces the first argument's series with a number, with a series list of one series, or
 * label by label with a list of several; without a second argument, the series of the first
 * one with each other.
 */
export async function reduce(argsPromises: unknown[], fn: Reducer): Promise<SeriesList> {
  const args = await Promise.all(Array.from(argsPromises));

  const seriesList = args.shift() as SeriesList;
  let argument = args.shift();

  if (seriesList.type !== 'seriesList') {
    throw new Error('input must be a seriesList');
  }

  if (isObject(argument) && argument.type === 'seriesList') {
    const list = (argument as SeriesList).list;
    if (list.length > 1) {
      return await pairwiseReduce(seriesList, argument as SeriesList, fn);
    } else {
      argument = list[0];
    }
  }

  function reduceSeries(series: unknown[]): Series {
    // lodash's reduce without a start: the first item is where it starts
    let destinationObject = series[0] as Series;
    for (let i = 1; i < series.length; i += 1) {
      const item = series[i];
      const data = destinationObject.data.map(function (point, index): Point {
        const value = point[1];

        if (value == null) {
          return [point[0], null];
        }

        if (typeof item === 'number') {
          return [point[0], fn(value, item, i, series)];
        }

        const other = (item as Series).data[index];
        if (other == null || other[1] == null) {
          return [point[0], null];
        }
        return [point[0], fn(value, other[1], i, series)];
      });

      // Output = single series
      destinationObject = defaults({ data } as Series, destinationObject);
    }
    return destinationObject;
  }

  let reduced: Series[];

  if (argument != null) {
    reduced = seriesList.list.map(function (series) {
      return reduceSeries([series].concat(argument as Series));
    });
  } else {
    reduced = [reduceSeries(seriesList.list)];
  }

  seriesList.list = reduced;
  return seriesList;
}

// --- Offsets ------------------------------------------------------------------------------------

// usually reverse = false on the request, true on the response
export function offsetTime(milliseconds: number, offset: string, reverse?: boolean) {
  if (!offset.match(/[-+][0-9]+[mshdwMy]/g)) {
    throw new Error('Malformed `offset` at ' + offset);
  }
  const parts = offset.match(/[-+]|[0-9]+|[mshdwMy]/g) as string[];

  let add = parts[0] === '+';
  add = reverse ? !add : add;

  return addTime(milliseconds, parts[1], parts[2], add ? 1 : -1);
}

function timeRangeErrorMsg(offset: string) {
  return `Malformed timerange offset, expecting "timerange:<number>", received: ${offset}`;
}

export function preprocessOffset(offset: string, from: number, to: number) {
  if (!offset.startsWith('timerange')) {
    return offset;
  }

  const parts = offset.split(':');
  if (parts.length === 1) {
    throw new Error(timeRangeErrorMsg(offset));
  }

  const factor = parseFloat(parts[1]);
  if (isNaN(factor)) {
    throw new Error(timeRangeErrorMsg(offset));
  }
  if (factor >= 0) {
    throw new Error('Malformed timerange offset, factor must be negative number.');
  }

  const deltaSeconds = (to - from) / 1000;
  const processedOffset = Math.round(deltaSeconds * factor);
  return `${processedOffset}s`;
}

// --- The chart's buckets ------------------------------------------------------------------------

export function splitInterval(interval: string) {
  if (!interval.match(/[0-9]+[mshdwMy]+/g)) {
    throw new Error('Malformed `interval`: ' + interval);
  }
  const parts = interval.match(/[0-9]+|[mshdwMy]+/g) as string[];

  return {
    count: parts[0],
    unit: parts[1],
  };
}

/** The start of each bucket from the start of the time span to its end */
export function buildTarget(tlConfig: { time: { from: number; to: number; interval: string } }) {
  const max = toTimestamp(tlConfig.time.to);
  const intervalParts = splitInterval(tlConfig.time.interval);

  let current = startOf(toTimestamp(tlConfig.time.from), intervalParts.unit);

  const targetSeries: number[] = [];

  while (current < max) {
    targetSeries.push(current);
    const next = addTime(current, intervalParts.count, intervalParts.unit);
    // Where moment knows no such unit it stays where it is, and OpenSearch Dashboards never stops
    if (!(next > current)) throw new Error('Malformed `interval`: ' + tlConfig.time.interval);
    current = next;
  }

  return targetSeries;
}

export function createTlConfig<T extends Dict>(setup: T) {
  let targetSeries: number[] = [];

  const tlConfig = {
    getTargetSeries: function (): Point[] {
      return targetSeries.map(function (bucket) {
        return [bucket, null];
      });
    },
    setTargetSeries: function (this: { time: { from: number; to: number; interval: string } }) {
      targetSeries = buildTarget(this);
    },
    writeTargetSeries: function (series: Point[]) {
      targetSeries = series.map(function (p) {
        return p[0];
      });
    },
  };

  return Object.assign(tlConfig, setup) as unknown as TlConfig;
}

// --- Arguments ----------------------------------------------------------------------------------

/** The type of an argument, or of each item of a list of them */
export function argType(arg: unknown): string | string[] {
  if (Array.isArray(arg)) {
    return arg.flatMap((item) => argType(item));
  }

  if (isObject(arg) && arg) {
    return arg.type as string;
  }
  if (arg == null) {
    return 'null';
  }
  return typeof arg;
}

export function validateArgFn(_functionDef: TimelineFunctionLike) {
  return function validateArg(value: unknown, _name: string, argDef: { types: string[]; multi?: boolean }) {
    const type = argType(value);
    const required = argDef.types;
    const multi = argDef.multi;
    const isCorrectType = (function () {
      // If argument is not allow to be specified multiple times, we're dealing with a plain value for type
      if (!multi) return required.includes(type as string);
      // If it is, we'll get an array for type (lodash's difference of anything else is empty)
      const types = Array.isArray(type) ? type : [];
      return types.filter((item) => !required.includes(item)).length === 0;
    })();

    // As upstream, which never gets to the error it has for a wrong type: the answer is unused
    return isCorrectType;
  };
}

// Only applies to already resolved arguments
export function indexArguments(functionDef: TimelineFunctionLike, orderedArgs: unknown[]) {
  const validateArg = validateArgFn(functionDef);

  // This almost certainly is not required
  const allowedLength = functionDef.extended
    ? functionDef.args.length + 2
    : functionDef.args.length;
  if (orderedArgs.length > allowedLength) {
    throw new Error(
      i18n.translate('timeline.serverSideErrors.argumentsOverflowErrorMessage', {
        defaultMessage: 'Too many arguments passed to: {functionName}',
        values: {
          functionName: functionDef.name,
        },
      })
    );
  }

  const indexedArgs: Record<string, unknown> = {};
  // Check and index each known argument
  functionDef.args.forEach(function (argDef, i) {
    const value = orderedArgs[i];
    validateArg(value, argDef.name, argDef);
    indexedArgs[argDef.name] = value;
  });

  // Also check and index the extended arguments if enabled
  if (functionDef.extended) {
    const extended = functionDef.extended;
    const values = orderedArgs[orderedArgs.length - 1];
    const names = orderedArgs[orderedArgs.length - 2] as string[];
    if (isObjectLike(values)) {
      Object.keys(values).forEach(function (i) {
        const value = (values as Dict)[i];
        validateArg(value, names[Number(i)], extended);
        indexedArgs[names[Number(i)]] = value;
      });
    }
  }

  return indexedArgs;
}

interface UnorderedArg {
  type?: string;
  name?: string;
  value?: unknown;
}

// Applies to unresolved arguments in the AST
export function repositionArguments(functionDef: TimelineFunctionLike, unorderedArgs: unknown[]) {
  const args: unknown[] = [];

  Array.from(unorderedArgs).forEach(function (unorderedArg, i) {
    let argDef: ArgDefinition | { types: string[]; multi?: boolean } | undefined;
    let targetIndex = 0;
    let value;
    let storeAsArray;

    if (isObject(unorderedArg) && (unorderedArg as UnorderedArg).type === 'namedArg') {
      const named = unorderedArg as UnorderedArg;
      argDef = Object.prototype.hasOwnProperty.call(functionDef.argsByName, named.name as string)
        ? functionDef.argsByName[named.name as string]
        : undefined;

      if (!argDef) {
        if (functionDef.extended) {
          const namesIndex = functionDef.args.length;
          targetIndex = functionDef.args.length + 1;

          args[namesIndex] = args[namesIndex] || [];
          (args[namesIndex] as unknown[]).push(named.name);

          argDef = functionDef.extended;
          storeAsArray = true;
        }
      } else {
        targetIndex = functionDef.args.findIndex(function (orderedArg) {
          return named.name === orderedArg.name;
        });
        storeAsArray = argDef.multi;
      }
      value = named.value;
    } else {
      argDef = functionDef.args[i];
      storeAsArray = argDef?.multi;
      targetIndex = i;
      value = unorderedArg;
      if (!argDef) {
        // upstream reads `argDef.multi` first, and fails there
        throw new TypeError("Cannot read properties of undefined (reading 'multi')");
      }
    }

    if (!argDef) {
      throw new Error(
        i18n.translate('timeline.serverSideErrors.unknownArgumentErrorMessage', {
          defaultMessage: 'Unknown argument to {functionName}: {argumentName}',
          values: {
            functionName: functionDef.name,
            argumentName: (unorderedArg as UnorderedArg).name || '#' + i,
          },
        })
      );
    }

    if (storeAsArray) {
      args[targetIndex] = args[targetIndex] || [];
      (args[targetIndex] as unknown[]).push(value);
    } else {
      args[targetIndex] = value;
    }
  });

  return args;
}

// --- The data sources of a sheet ----------------------------------------------------------------

export interface FunctionItem {
  type: 'function';
  function: string;
  arguments: unknown[];
  text: string;
  cell?: number;
}

/** Every call of a data source in a chain, by what it caches under */
export function preProcessChainFn(tlConfig: Pick<TlConfig, 'getFunction'>) {
  return function preProcessChain(
    chain: unknown,
    queries?: Record<string, FunctionItem>
  ): Record<string, FunctionItem> | undefined {
    const found: Record<string, FunctionItem> = queries || {};
    function validateAndStore(item: unknown) {
      if (isObject(item) && item.type === 'function') {
        const functionDef = tlConfig.getFunction((item as unknown as FunctionItem).function);

        if (functionDef.datasource && functionDef.cacheKey) {
          found[functionDef.cacheKey(item as unknown as FunctionItem)] = item as unknown as FunctionItem;
          return true;
        }
        return false;
      }
      return undefined;
    }

    // Is this thing a function?
    if (validateAndStore(chain)) {
      return undefined;
    }

    if (!Array.isArray(chain)) return undefined;

    Array.from(chain).forEach(function (operator) {
      if (!isObject(operator)) {
        return;
      }
      switch (operator.type) {
        case 'chain':
          preProcessChain(operator.chain, found);
          break;
        case 'chainList':
          preProcessChain(operator.list, found);
          break;
        case 'function':
          if (validateAndStore(operator)) {
            break;
          } else {
            preProcessChain(operator.arguments, found);
          }
          break;
      }
    });

    return found;
  };
}

// --- The request --------------------------------------------------------------------------------

export function validateTime(
  time: { from?: unknown; to?: unknown; interval: string },
  tlConfig: { settings: Record<string, unknown> }
) {
  const span = toTimestamp(time.to) - toTimestamp(time.from);
  const interval = toMS(time.interval) as number;
  const bucketCount = span / interval;
  const maxBuckets = tlConfig.settings['timeline:max_buckets'] as number;
  if (bucketCount > maxBuckets) {
    throw new Error(
      i18n.translate('timeline.serverSideErrors.bucketsOverflowErrorMessage', {
        defaultMessage:
          'Max buckets exceeded: {bucketCount} of {maxBuckets} allowed. ' +
          'Choose a larger interval or a shorter time span',
        values: {
          bucketCount: Math.round(bucketCount),
          maxBuckets,
        },
      })
    );
  }
  return true;
}

/** The tree of each expression of a sheet */
export function parseSheet(sheet: string[]): ExpressionSeries[][] {
  return Array.from(sheet, function (plot) {
    try {
      return parse(plot).tree;
    } catch (e) {
      const error = e as { expected?: Array<{ description?: string }> | null; column?: number };
      if (error.expected) {
        throw new Error(
          i18n.translate('timeline.serverSideErrors.sheetParseErrorMessage', {
            defaultMessage: 'Expected: {expectedDescription} at character {column}',
            description: 'This would be for example: "Expected: a quote at character 5"',
            values: {
              expectedDescription: error.expected[0].description,
              // As upstream, which reads a `column` the parser's error does not have
              column: error.column,
            },
          })
        );
      } else {
        throw e;
      }
    }
  });
}

// --- Settings -----------------------------------------------------------------------------------

/** `server/timeline.json` */
export const TIMELINE_JSON = {
  quandl: {
    key: 'someKeyHere',
  },
  es: {
    timefield: '@timestamp',
    default_index: '_all',
  },
  graphite: {
    url: 'https://www.hostedgraphite.com/UID/ACCESS_KEY/graphite',
  },
  default_rows: 2,
  default_columns: 2,
  max_buckets: 2000,
  target_buckets: 200,
  min_interval: '1ms',
};

/** The settings of timeline.json under their `timeline:` names */
export function getNamespacedSettings(): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const stack: string[] = [];
  (function flattenObj(obj: Dict) {
    Object.keys(obj).forEach(function (key) {
      stack.push(key);
      if (Array.isArray(obj[key])) flat[stack.join('.')] = obj[key];
      else if (isObject(obj[key])) flattenObj(obj[key] as Dict);
      else flat[stack.join('.')] = obj[key];
      stack.pop();
    });
  })(TIMELINE_JSON);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) result['timeline:' + key] = value;
  return result;
}
