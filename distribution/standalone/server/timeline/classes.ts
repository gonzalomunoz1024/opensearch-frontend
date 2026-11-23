/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The kinds of Timeline function (`server/lib/classes/`): a function fits what it gives onto the
 * chart's buckets; a chainable one is called on the series before it; a data source starts a
 * chain, takes `offset=` and `fit=` besides its own arguments, and is fetched once per request.
 */

import { fitFunctions } from './fit_functions';
import { i18n } from './i18n';
import { offsetTime, preprocessOffset } from './lib';
import type {
  ArgDefinition,
  Args,
  Point,
  Series,
  SeriesList,
  TimelineFn,
  TimelineFunctionLike,
  TlConfig,
} from './types';
import { cloneDeep, isEqual } from './util';

export interface TimelineFunctionConfig {
  args?: ArgDefinition[];
  help?: string;
  aliases?: string[];
  extended?: { types: string[]; multi?: boolean };
  fn?: TimelineFn;
  [key: string]: unknown;
}

export class TimelineFunction implements TimelineFunctionLike {
  // The order of these is the order of the keys in the answer of /api/timeline/functions
  name: string;
  args: ArgDefinition[];
  argsByName: Record<string, ArgDefinition>;
  help: string;
  aliases: string[];
  extended: false | { types: string[]; multi?: boolean };
  originalFn: TimelineFn;
  fn: (args: Args, tlConfig: TlConfig) => Promise<SeriesList>;

  constructor(name: string, config: TimelineFunctionConfig) {
    this.name = name;
    this.args = config.args || [];
    this.argsByName = {};
    for (const arg of this.args) this.argsByName[arg.name] = arg;
    this.help = config.help || '';
    this.aliases = config.aliases || [];
    this.extended = config.extended || false;

    // WTF is this? How could you not have a fn? Wtf would the thing be used for?
    const originalFunction: TimelineFn = config.fn || ((input) => input);

    // Currently only re-fits the series.
    this.originalFn = originalFunction;

    this.fn = function (args, tlConfig) {
      const config = { ...tlConfig };
      return Promise.resolve(originalFunction(args, config)).then(function (result) {
        const seriesList = result as SeriesList;
        seriesList.list = seriesList.list.map(function (series: Series) {
          const target = tlConfig.getTargetSeries();

          // Don't fit if the series are already the same
          if (isEqual(times(series.data), times(target))) return series;

          let fit;
          if (args.byName.fit) {
            fit = args.byName.fit as string;
          } else if (series.fit) {
            fit = series.fit;
          } else {
            fit = 'nearest';
          }

          series.data = fitFunctions[fit](series.data, tlConfig.getTargetSeries());
          return series;
        });
        return seriesList;
      });
    };
  }
}

/** lodash's `_.map(list, 0)`, which is empty for what is not a list */
function times(data: Point[] | undefined): unknown[] {
  return Array.isArray(data) ? Array.from(data, (point) => point?.[0]) : [];
}

export class Chainable extends TimelineFunction {
  chainable: boolean;

  constructor(name: string, config: TimelineFunctionConfig) {
    super(name, config);
    this.chainable = true;
  }
}

function offsetSeries(response: Point[], offset: string | undefined): Point[] {
  if (offset) {
    response = response.map(function (point) {
      return [offsetTime(point[0], offset, true), point[1]];
    });
  }
  return response;
}

export class Datasource extends TimelineFunction {
  timelineFn: TimelineFn;
  datasource: boolean;
  cacheKey: (item: { text: string }) => string;

  constructor(name: string, config: TimelineFunctionConfig & { args: ArgDefinition[] }) {
    // Additional arguments that every dataSource take
    config.args.push({
      name: 'offset',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.common.args.offsetHelpText', {
        defaultMessage:
          'Offset the series retrieval by a date expression, e.g., -1M to make events from ' +
          'one month ago appear as if they are happening now. Offset the series relative to the charts ' +
          'overall time range, by using the value "timerange", e.g. "timerange:-2" will specify an offset ' +
          'that is twice the overall chart time range to the past.',
      }),
    });

    config.args.push({
      name: 'fit',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.common.args.fitHelpText', {
        defaultMessage:
          'Algorithm to use for fitting series to the target time span and interval. Available: {fitFunctions}',
        values: {
          fitFunctions: Object.keys(fitFunctions).join(', '),
        },
      }),
    });

    // Wrap the original function so we can modify inputs/outputs with offset & fit
    const originalFunction = config.fn as TimelineFn;
    config.fn = function (args, tlConfig) {
      const config = { ...tlConfig };
      let offset = args.byName.offset as string | undefined;
      if (offset) {
        offset = preprocessOffset(offset, tlConfig.time.from, tlConfig.time.to);
        config.time = cloneDeep(tlConfig.time);
        config.time.from = offsetTime(config.time.from, offset);
        config.time.to = offsetTime(config.time.to, offset);
      }

      return Promise.resolve(originalFunction(args, config)).then(function (result) {
        const seriesList = result as SeriesList;
        seriesList.list = seriesList.list.map(function (series) {
          if (series.data.length === 0) throw new Error(name + '() returned no results');
          series.data = offsetSeries(series.data, offset);
          series.fit = (args.byName.fit as string) || series.fit || 'nearest';
          return series;
        });
        return seriesList;
      });
    };

    super(name, config);

    // You  need to call timelineFn if calling up a datasource from another datasource,
    // otherwise teh series will end up being offset twice.
    this.timelineFn = originalFunction;
    this.datasource = true;
    this.cacheKey = function (item) {
      return item.text;
    };
  }
}

/** A function under each of its names; an alias says it is one */
export function withAliases(func: TimelineFunctionLike): Record<string, TimelineFunctionLike> {
  const functions: Record<string, TimelineFunctionLike> = { [func.name]: func };
  for (const alias of func.aliases) {
    const aliasFn = Object.assign(Object.create(Object.getPrototypeOf(func)), func);
    aliasFn.isAlias = true;
    functions[alias] = aliasFn;
  }
  return functions;
}
