/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The `.es()` data source (also `.opensearch()` and `.elasticsearch()`): one search per call,
 * with a filter for each query string, a terms aggregation for each split and a date histogram
 * over the chart's time span, built as OpenSearch Dashboards builds it
 * (`server/series_functions/opensearch/`), and its answer turned into series.
 */

import { Datasource } from '../classes';
import { dateHistogramInterval, toTimestamp } from '../dates';
import { i18n } from '../i18n';
import type { Args, Point, Series, TlConfig, SearchRequest } from '../types';
import { defaults, isPlainObject, listOf, zip, type Dict } from '../util';

interface ScriptedField {
  name: string;
  script?: string;
  lang?: string;
  scripted?: boolean;
}

export interface OpenSearchFunctionConfig {
  q: unknown;
  metric: unknown;
  split: unknown;
  index: string;
  timefield: string;
  kibana: boolean | null;
  opensearchDashboards: boolean | null;
  interval: string;
  fit: string;
  data_source_name?: string | null;
  [key: string]: unknown;
}

export function buildAggBody(fieldName: string, scriptedFields: ScriptedField[]): Dict {
  const scriptedField = scriptedFields.find((field) => {
    return field.name === fieldName;
  });

  if (scriptedField) {
    return {
      script: {
        source: scriptedField.script,
        lang: scriptedField.lang,
      },
    };
  }

  return {
    field: fieldName,
  };
}

export function createDateAgg(
  config: OpenSearchFunctionConfig,
  tlConfig: TlConfig,
  scriptedFields: ScriptedField[]
) {
  const aggs: Dict = {};
  const dateAgg = {
    time_buckets: {
      meta: { type: 'time_buckets' },
      date_histogram: {
        field: config.timefield,
        time_zone: tlConfig.time.timezone,
        extended_bounds: {
          min: tlConfig.time.from,
          max: tlConfig.time.to,
        },
        min_doc_count: 0,
        ...dateHistogramInterval(config.interval),
      },
      aggs,
    },
  };

  listOf(config.metric).forEach(function (text) {
    const metric = String(text).split(':');
    if (metric[0] === 'count') {
      // This is pretty lame, but its how the "doc_count" metric has to be implemented at the moment
      // It simplifies the aggregation tree walking code considerably
      aggs[String(metric)] = {
        bucket_script: {
          buckets_path: '_count',
          script: { source: '_value', lang: 'expression' },
        },
      };
    } else if (metric[0] && metric[1]) {
      const metricName = metric[0] + '(' + metric[1] + ')';
      const metricAgg: Dict = {};
      aggs[metricName] = metricAgg;
      const body = buildAggBody(metric[1], scriptedFields);
      metricAgg[metric[0]] = body;
      if (metric[0] === 'percentiles' && metric[2]) {
        body.percents = metric[2].split(',').map((x) => parseFloat(x));
      }
    } else {
      throw new Error('`metric` requires metric:field or simply count');
    }
  });

  return dateAgg;
}

export function buildRequest(
  config: OpenSearchFunctionConfig,
  tlConfig: TlConfig,
  scriptedFields: ScriptedField[],
  timeout?: number,
  dataSourceId?: string
): SearchRequest {
  const bool: Dict = { must: [] };

  const timeFilter = {
    range: {
      [config.timefield]: {
        gte: new Date(toTimestamp(tlConfig.time.from)).toISOString(),
        lte: new Date(toTimestamp(tlConfig.time.to)).toISOString(),
        format: 'strict_date_optional_time',
      },
    },
  };
  (bool.must as unknown[]).push(timeFilter);

  // Use the opensearchDashboards and kibana filter bar filters
  if (config.opensearchDashboards && config.kibana) {
    const body = tlConfig.request?.body as { extended?: { es?: { filter?: unknown } } } | undefined;
    bool.filter = body?.extended?.es?.filter;
  }

  const filters: Dict = {};
  for (const q of listOf(config.q)) filters[String(q)] = { query_string: { query: q } };

  const aggs = {
    q: {
      meta: { type: 'split' },
      filters: {
        filters,
      },
      aggs: {} as Dict,
    },
  };

  let aggCursor = aggs.q.aggs;

  listOf(config.split).forEach(function (text) {
    const clause = String(text).split(':');
    if (clause[0] && clause[1]) {
      const termsAgg = buildAggBody(clause[0], scriptedFields);
      termsAgg.size = parseInt(clause[1], 10);
      const splitAgg = {
        meta: { type: 'split' },
        terms: termsAgg,
        aggs: {} as Dict,
      };
      aggCursor[clause[0]] = splitAgg;
      aggCursor = splitAgg.aggs;
    } else {
      throw new Error('`split` requires field:limit');
    }
  });

  Object.assign(aggCursor, createDateAgg(config, tlConfig, scriptedFields));

  const request: SearchRequest['params'] = {
    index: config.index,
    ignore_throttled: !tlConfig.settings['search:includeFrozen'],
    body: {
      query: {
        bool: bool,
      },
      aggs: aggs,
      size: 0,
    },
  };

  if (timeout) {
    request.timeout = `${timeout}ms`;
  }

  return {
    ...(!!dataSourceId && { dataSourceId }),
    params: request,
  };
}

// --- The answer ---------------------------------------------------------------------------------

export function timeBucketsToPairs(buckets: unknown) {
  const list = listOf(buckets) as Dict[];
  const timestamps = list.map((bucket) => bucket?.key);
  const series: Record<string, unknown[]> = {};
  list.forEach(function (bucket) {
    if (!bucket || typeof bucket !== 'object') return;
    Object.keys(bucket).forEach(function (key) {
      const val = bucket[key];
      if (isPlainObject(val)) {
        if (val.values) {
          const metricValues = val.values as Dict;
          Object.keys(metricValues).forEach(function (bucketKey) {
            const bucketValue = metricValues[bucketKey];
            const k = key + ':' + bucketKey;
            const v = isNaN(bucketValue as number) ? NaN : bucketValue;
            series[k] = series[k] || [];
            series[k].push(v);
          });
        } else {
          series[key] = series[key] || [];
          series[key].push(val.value);
        }
      }
    });
  });

  const pairs: Record<string, Point[]> = {};
  for (const key of Object.keys(series)) {
    pairs[key] = zip(timestamps, series[key]) as Point[];
  }
  return pairs;
}

const metaType = (value: Dict) =>
  isObjectWithMeta(value) ? (value.meta as { type?: unknown }).type : undefined;
const isObjectWithMeta = (value: Dict) =>
  value.meta !== null && typeof value.meta === 'object';

export function flattenBucket(
  bucket: unknown,
  splitKey?: unknown,
  path?: string[],
  result?: Record<string, { data: Point[]; splitKey: unknown }>
) {
  result = result || {};
  path = path || [];
  if (!bucket || typeof bucket !== 'object') return result;
  const found = result;
  const where = path;
  Object.keys(bucket).forEach(function (key) {
    const val = (bucket as Dict)[key];
    if (!isPlainObject(val)) return;
    if (metaType(val) === 'split') {
      const buckets = val.buckets;
      if (!buckets || typeof buckets !== 'object') return;
      Object.keys(buckets).forEach(function (bucketKey) {
        const inner = (buckets as Dict)[bucketKey] as Dict;
        const index = Array.isArray(buckets) ? Number(bucketKey) : bucketKey;
        if (inner.key == null) inner.key = index; // For handling "keyed" response formats, e.g., filters agg
        flattenBucket(inner, inner.key, where.concat([key + ':' + inner.key]), found);
      });
    } else if (metaType(val) === 'time_buckets') {
      const metrics = timeBucketsToPairs(val.buckets);
      Object.keys(metrics).forEach(function (metricName) {
        found[where.concat([metricName]).join(' > ')] = {
          data: metrics[metricName],
          splitKey: splitKey,
        };
      });
    }
  });

  return found;
}

export function toSeriesList(aggs: unknown, config: { fit: string }): Series[] {
  const flattened = flattenBucket(aggs);
  return Object.keys(flattened).map(function (name) {
    const metrics = flattened[name];
    return {
      data: metrics.data,
      type: 'series',
      fit: config.fit,
      label: name,
      split: metrics.splitKey,
    };
  });
}

// --- The function -------------------------------------------------------------------------------

async function fetchDataSourceIdByName(config: OpenSearchFunctionConfig) {
  if (!config.data_source_name) {
    return undefined;
  }
  // Multiple data sources are never enabled here, as in a product without the data source plugin
  throw new Error(
    'data_source_name is not supported. Contact your administrator to start using multiple data sources'
  );
}

export const opensearch = new Datasource('es', {
  args: [
    {
      name: 'q',
      types: ['string', 'null'],
      multi: true,
      help: i18n.translate('timeline.help.functions.opensearch.args.qHelpText', {
        defaultMessage: 'Query in lucene query string syntax',
      }),
    },
    {
      name: 'metric',
      types: ['string', 'null'],
      multi: true,
      help: i18n.translate('timeline.help.functions.opensearch.args.metricHelpText', {
        defaultMessage:
          'An opensearch metric agg: avg, sum, min, max, percentiles or cardinality, followed by a field. ' +
          'E.g., "sum:bytes", "percentiles:bytes:95,99,99.9" or just "count"',
        description:
          `avg, sum, min, max, percentiles and cardinality are keywords in the expression ` +
          `and must not be translated. Also don't translate the examples.`,
      }),
    },
    {
      name: 'split',
      types: ['string', 'null'],
      multi: true,
      help: i18n.translate('timeline.help.functions.opensearch.args.splitHelpText', {
        defaultMessage:
          'An opensearch field to split the series on and a limit. E.g., "{hostnameSplitArg}" to get the top 10 hostnames',
        values: {
          hostnameSplitArg: 'hostname:10',
        },
      }),
    },
    {
      name: 'index',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.opensearch.args.indexHelpText', {
        defaultMessage:
          'Index to query, wildcards accepted. Provide Index Pattern name for scripted fields and ' +
          'field name type ahead suggestions for metrics, split, and timefield arguments.',
        description:
          '"metrics", "split" and "timefield" are referring to parameter names and should not be translated.',
      }),
    },
    {
      name: 'timefield',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.opensearch.args.timefieldHelpText', {
        defaultMessage: 'Field of type "date" to use for x-axis',
        description: '"date" is a field type and should not be translated.',
      }),
    },
    {
      name: 'kibana',
      types: ['boolean', 'null'],
      help: i18n.translate('timeline.help.functions.opensearch.args.opensearchDashboardsHelpText', {
        defaultMessage:
          'Respect filters on OpenSearch Dashboards dashboards. Only has an effect when using on OpenSearch Dashboards dashboards',
      }),
    },
    {
      name: 'opensearchDashboards',
      types: ['boolean', 'null'],
      help: i18n.translate('timeline.help.functions.opensearch.args.opensearchDashboardsHelpText', {
        defaultMessage:
          'Respect filters on OpenSearch Dashboards dashboards. Only has an effect when using on OpenSearch Dashboards dashboards',
      }),
    },
    {
      name: 'interval', // You really shouldn't use this, use the interval picker instead
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.opensearch.args.intervalHelpText', {
        defaultMessage: `**DO NOT USE THIS**. It's fun for debugging fit functions, but you really should use the interval picker`,
      }),
    },
    {
      name: 'data_source_name',
      types: ['string', 'null'], // If null, the query will proceed with local cluster
      help: i18n.translate('timeline.help.functions.opensearch.args.dataSourceNameHelpText', {
        defaultMessage:
          'Specify a data source to query from. This will only work if multiple data sources is enabled',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.opensearchHelpText', {
    defaultMessage: 'Pull data from an opensearch instance',
  }),
  aliases: ['elasticsearch', 'opensearch'],
  fn: async function opensearchFn(args: Args, tlConfig: TlConfig) {
    const config = defaults({ ...args.byName }, {
      q: '*',
      metric: ['count'],
      index: tlConfig.settings['timeline:es.default_index'],
      timefield: tlConfig.settings['timeline:es.timefield'],
      interval: tlConfig.time.interval,
      kibana: true,
      opensearchDashboards: true,
      fit: 'nearest',
    }) as OpenSearchFunctionConfig;

    const findResp = await tlConfig.savedObjectsClient.find({
      type: ['index-pattern'],
      fields: ['title', 'fields'],
      search: `"${config.index}"`,
    });
    const indexPatternSavedObject = findResp.saved_objects.find((savedObject) => {
      return savedObject.attributes.title === config.index;
    });
    let scriptedFields: ScriptedField[] = [];
    if (indexPatternSavedObject) {
      const fields = JSON.parse(String(indexPatternSavedObject.attributes.fields)) as ScriptedField[];
      scriptedFields = fields.filter((field) => {
        return field.scripted;
      });
    }

    const opensearchShardTimeout = tlConfig.opensearchShardTimeout;
    const dataSourceId = await fetchDataSourceIdByName(config);

    const body = buildRequest(config, tlConfig, scriptedFields, opensearchShardTimeout, dataSourceId);

    const resp = await tlConfig.search(body);

    if (!resp._shards.total) {
      throw new Error(
        i18n.translate('timeline.serverSideErrors.opensearchFunction.indexNotFoundErrorMessage', {
          defaultMessage: 'OpenSearch index not found: {index}',
          values: {
            index: config.index,
          },
        })
      );
    }
    return {
      type: 'seriesList',
      list: toSeriesList(resp.aggregations, config),
    };
  },
});
