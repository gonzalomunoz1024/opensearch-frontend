/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Runs a sheet (`server/handlers/chain_runner.js`): parses each expression, fetches every data
 * source of the sheet once, then resolves each expression's chains, arguments and references
 * into series lists, one per expression, in the order of the sheet.
 */

import { calculateInterval, toTimestamp } from './dates';
import { i18n } from './i18n';
import {
  indexArguments,
  parseSheet,
  preProcessChainFn,
  repositionArguments,
  validateTime,
  type FunctionItem,
} from './lib';
import type { Args, SeriesList, TimeRange, TlConfig } from './types';
import { cloneDeep, isObject, merge, type Dict } from './util';

export interface RunRequest {
  sheet: string[];
  extended?: unknown;
  time?: { from?: string; to?: string; interval: string; timezone: string };
}

export interface RunStats {
  invokeTime?: number;
  queryCount?: number;
  queryTime?: number;
  cacheCount?: number;
  sheetTime?: number;
}

type Item = Dict & { type?: string };

export function chainRunner(tlConfig: TlConfig) {
  const preprocessChain = preProcessChainFn(tlConfig);

  let queryCache: Record<string, unknown> = {};
  const stats: RunStats = {};
  let sheet: unknown[][];

  function throwWithCell(cell: number, exception: unknown): never {
    const error = exception as Error;
    // Preserve AnalyticEngineError to ensure it's handled correctly on the client
    if (error.name === 'AnalyticEngineError') {
      throw exception;
    }
    const e = new Error(error.message);
    e.name = `Expression parse error in cell #${cell + 1}`;
    throw e;
  }

  // Invokes a modifier function, resolving arguments into series as needed
  function invoke(fnName: string, args: unknown[]): Promise<SeriesList> {
    const functionDef = tlConfig.getFunction(fnName);

    function resolveArgument(item: unknown): unknown {
      if (Array.isArray(item)) {
        return Promise.all(Array.from(item, resolveArgument));
      }

      if (isObject(item)) {
        const node = item as Item;
        switch (node.type) {
          case 'function': {
            const itemFunctionDef = tlConfig.getFunction(node.function as string);
            const key = itemFunctionDef.cacheKey?.(node as unknown as FunctionItem);
            if (itemFunctionDef.cacheKey && queryCache[key as string]) {
              stats.queryCount = (stats.queryCount as number) + 1;
              return Promise.resolve(cloneDeep(queryCache[key as string]));
            }
            return invoke(node.function as string, node.arguments as unknown[]);
          }
          case 'reference': {
            let reference;
            if (node.series) {
              reference = sheet[(node.plot as number) - 1][(node.series as number) - 1];
            } else {
              reference = {
                type: 'chainList',
                list: sheet[(node.plot as number) - 1],
              };
            }
            return invoke('first', [reference]);
          }
          case 'chain':
            return invokeChain(node as { chain: Item[] });
          case 'chainList':
            return resolveChainList(node.list as unknown[]);
          case 'literal':
            return node.value;
          case 'requestList':
          case 'seriesList':
            return item;
        }
        throw new Error(
          i18n.translate('timeline.serverSideErrors.unknownArgumentTypeErrorMessage', {
            defaultMessage: 'Argument type not supported: {argument}',
            values: {
              argument: JSON.stringify(item),
            },
          })
        );
      } else {
        return item;
      }
    }

    const ordered = repositionArguments(functionDef, args);
    const resolving = Array.from(ordered, resolveArgument);

    return Promise.all(resolving).then(function (resolved) {
      const fnArgs = resolved as Args;
      fnArgs.byName = indexArguments(functionDef, fnArgs);
      return functionDef.fn(fnArgs, tlConfig);
    });
  }

  function invokeChain(chainObj: { chain: Item[] }, result?: unknown[]): Promise<SeriesList> {
    if (chainObj.chain.length === 0) return Promise.resolve(result?.[0] as SeriesList);

    const chain = chainObj.chain.slice();
    const link = chain.shift() as Item;

    let promise: Promise<SeriesList>;
    if (link.type === 'chain') {
      promise = invokeChain(link as { chain: Item[] });
    } else if (!result) {
      promise = invoke('first', [link]);
    } else {
      const functionDef = tlConfig.getFunction(link.function as string);
      if (functionDef.datasource) {
        promise = invoke('first', [link]);
      } else {
        const args = link.arguments ? result.concat(link.arguments) : result;
        promise = invoke(link.function as string, args);
      }
    }

    return promise.then(function (next) {
      return invokeChain({ chain: chain }, [next]);
    });
  }

  function resolveChainList(chainList: unknown): Promise<SeriesList> {
    const seriesList = Array.from(
      Array.isArray(chainList) ? chainList : Object.values((chainList as Dict) ?? {}),
      function (chain) {
        return invoke('first', [chain]);
      }
    );
    return Promise.all(seriesList).then(function (args) {
      const list = args.flatMap((arg) => {
        const items = (arg as SeriesList | undefined)?.list;
        return items === undefined ? [undefined] : items;
      });
      const merged = merge({}, ...args) as SeriesList;
      merged.list = list as SeriesList['list'];
      return merged;
    });
  }

  function preProcessSheet(parsed: unknown[][]) {
    let queries: Record<string, FunctionItem> = {};
    parsed.forEach(function (chainList, i) {
      try {
        const queriesInCell = preprocessChain(chainList) ?? {};
        for (const val of Object.values(queriesInCell)) val.cell = i;
        queries = Object.assign(queries, queriesInCell);
      } catch (e) {
        throwWithCell(i, e);
      }
    });
    const queryList = Object.values(queries);

    const promises = queryList.map(function (query) {
      return invoke(query.function, query.arguments);
    });

    return Promise.allSettled(promises).then(function (resolvedDatasources) {
      stats.queryTime = new Date().getTime();

      queryList.forEach(function (query, i) {
        const functionDef = tlConfig.getFunction(query.function);
        const resolvedDatasource = resolvedDatasources[i];

        if (resolvedDatasource.status === 'rejected') {
          if ((resolvedDatasource.reason as { isBoom?: boolean })?.isBoom) {
            throw resolvedDatasource.reason;
          } else {
            throwWithCell(query.cell as number, resolvedDatasource.reason);
          }
        }

        const key = (functionDef.cacheKey as (item: FunctionItem) => string)(query);
        queryCache[key] = resolvedDatasource.value;
      });

      stats.cacheCount = Object.keys(queryCache).length;
      return parsed;
    });
  }

  function processRequest(request: RunRequest | undefined) {
    if (!request) throw new Error('Empty request body');

    validateTime(request.time as RunRequest['time'] & object, tlConfig);

    const time = request.time as unknown as TimeRange & { from?: unknown; to?: unknown };
    tlConfig.time = time;
    tlConfig.time.to = toTimestamp(time.to);
    tlConfig.time.from = toTimestamp(time.from);
    tlConfig.time.interval = calculateInterval(
      tlConfig.time.from,
      tlConfig.time.to,
      (tlConfig.settings['timeline:target_buckets'] as number) || 200,
      tlConfig.time.interval,
      (tlConfig.settings['timeline:min_interval'] as string) || '1ms'
    );

    tlConfig.setTargetSeries();

    stats.invokeTime = new Date().getTime();
    stats.queryCount = 0;
    queryCache = {};

    // This is setting the "global" sheet, required for resolving references
    sheet = parseSheet(request.sheet) as unknown[][];
    return preProcessSheet(sheet).then(function () {
      return sheet.map(function (chainList, i) {
        return resolveChainList(chainList)
          .then(function (seriesList) {
            stats.sheetTime = new Date().getTime();
            return seriesList;
          })
          .catch(function (e) {
            throwWithCell(i, e);
          });
      });
    });
  }

  return {
    processRequest: processRequest,
    getStats: function () {
      return stats;
    },
  };
}
