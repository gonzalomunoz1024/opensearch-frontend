/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Filters as OpenSearch Dashboards 3.9.0 makes and reads them: on a scripted field by its script
 * (phrase_filter.ts, phrases_filter.ts, range_filter.ts), what its filter manager reads off them
 * and keeps once, what a click on a bucket adds, what the filter editor saves and what a pill says;
 * and what the lists of its combo boxes, and of the vis editor's, offer.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { brushFilter, bucketFilter, buildAggsDsl, filterFieldOf, planOtherBucket, tabify, type AggConfig, type AggContext } from '../../web/lib/aggs';
import { createFormatter } from '../../web/lib/field_formats';
import {
  buildQuery,
  cidrRange,
  convertedValueForField,
  customFilter,
  existsFilter,
  filterMatchesIndex,
  getFilterParams,
  getPhraseScript,
  getRangeScript,
  ipv4Value,
  luceneFields,
  mapFilter,
  phraseFilter,
  phraseScriptSource,
  phrasesFilter,
  rangeFilter,
  uniqueFilters,
  withMappedMeta,
} from '../../web/lib/query';
import type { Field, Filter, IndexPattern } from '../../web/lib/types';
import { filterOf, submitFilters, type ControlParam } from '../../web/vis/controls';
import { emptyFilter, filterLabelConfig, filterLabelParts, filterLabelText } from '../../web/shell/filter_bar';
import {
  buildCustomFilter,
  buildEditedFilter,
  FILTER_OPERATORS,
  formatDateChange,
  getFilterableFields,
  getOperatorFromFilter,
  getOperatorOptions,
  isFilterValid,
  validateParams,
} from '../../web/shell/filter_editor';
import { matchingOptions } from '../../web/components/combo_box';
import { aggTypeOptions } from '../../web/apps/visualize/defaults';

const field = (name: string, type: string, more: Partial<Field> = {}): Field => ({
  name,
  type,
  searchable: true,
  aggregatable: true,
  ...more,
});

const HOUR = "doc['timestamp'].value.getHour()";
const hour = field('hour', 'number', { scripted: true, script: HOUR, lang: 'painless' });
const late = field('late', 'boolean', { scripted: true, script: "doc['bytes'].value > 100", lang: 'painless' });
const day = field('day', 'date', { scripted: true, script: "doc['timestamp'].value", lang: 'painless' });
const doubled = field('doubled', 'number', { scripted: true, script: "doc['bytes'].value * 2", lang: 'expression' });

const logs: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [
    field('timestamp', 'date'),
    field('bytes', 'number'),
    field('ip', 'ip'),
    field('geo.dest', 'string'),
    field('message', 'string', { aggregatable: false }),
    field('ok', 'boolean'),
    field('location', 'geo_point', { searchable: false }),
    hour,
    late,
    day,
  ],
  fieldFormatMap: {},
};
const context: AggContext = { indexPattern: logs };
const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };

describe('the scripts of filters on a scripted field', () => {
  it('compares the value of a painless script in a lambda, and an expression as it is', () => {
    assert.equal(
      phraseScriptSource(hour),
      `boolean compare(Supplier s, def v) {return s.get() == v;}compare(() -> { ${HOUR} }, params.value);`
    );
    assert.equal(phraseScriptSource(doubled), "(doc['bytes'].value * 2) == value");
    assert.deepEqual(getPhraseScript(hour, 5), {
      script: { source: phraseScriptSource(hour), lang: 'painless', params: { value: 5 } },
    });
  });

  it('takes 1, 0, "true" and "false" as a boolean field holds them, and refuses anything else', () => {
    assert.equal(getPhraseScript(late, 1).script.params.value, true);
    assert.equal(convertedValueForField(late, 'false'), false);
    assert.equal(convertedValueForField(hour, '7'), '7');
    assert.throws(() => convertedValueForField(late, 'maybe'), /maybe is not a valid boolean value for boolean field late/);
  });

  it('compares each end of a range, dates as instants', () => {
    assert.deepEqual(getRangeScript(hour, { gte: 9, lt: 17 }), {
      script: {
        source:
          'boolean gte(Supplier s, def v) {return s.get() >= v} boolean lt(Supplier s, def v) {return s.get() < v}' +
          `gte(() -> { ${HOUR} }, params.gte) && lt(() -> { ${HOUR} }, params.lt)`,
        params: { gte: 9, lt: 17 },
        lang: 'painless',
      },
    });
    assert.equal(
      getRangeScript(day, { gt: '2026-01-01T00:00:00.000Z' }).script.source,
      "boolean gt(Supplier s, def v) {return s.get().toInstant().isAfter(Instant.parse(v))}gt(() -> { doc['timestamp'].value }, params.gt)"
    );
    assert.equal(getRangeScript(doubled, { gte: 1, lte: 2, format: 'x' }).script.source, "(doc['bytes'].value * 2)>=gte && (doc['bytes'].value * 2)<=lte");
  });
});

describe('the filters made on a field', () => {
  it('asks a scripted field by its script, and names it in the meta', () => {
    const filter = phraseFilter(hour, 5, 'logs');
    assert.deepEqual(filter.script, getPhraseScript(hour, 5));
    assert.equal(filter.meta.field, 'hour');
    assert.equal(filter.query, undefined);
    const many = phrasesFilter(hour, [5, 6], 'logs');
    assert.deepEqual(many.query, {
      bool: { should: [{ script: getPhraseScript(hour, 5) }, { script: getPhraseScript(hour, 6) }], minimum_should_match: 1 },
    });
    assert.deepEqual(existsFilter(hour, 'logs').exists, { field: 'hour' });
  });

  it('converts the value of a boolean field, and leaves the others as they are', () => {
    assert.deepEqual(phraseFilter(field('ok', 'boolean'), 'true').query, { match_phrase: { ok: true } });
    assert.deepEqual(phraseFilter({ name: 'response' }, '200').query, { match_phrase: { response: '200' } });
  });

  it('reads the ends of a number field as numbers and leaves infinite ends out', () => {
    const filter = rangeFilter(field('bytes', 'number'), { gte: '10', lt: Infinity }, 'logs');
    assert.deepEqual(filter.range, { bytes: { gte: 10 } });
    const all = rangeFilter(field('bytes', 'number'), { gte: -Infinity, lt: Infinity }, 'logs', '≥ -∞ and < +∞');
    assert.deepEqual(all.match_all, {});
    assert.equal(all.range, undefined);
    assert.equal(all.meta.field, 'bytes');
    assert.equal(mapFilter(all).value, '≥ -∞ and < +∞');
    assert.throws(() => rangeFilter({ name: 'bytes' }, { gte: 1, gt: 2 }), /gte and gt are mutually exclusive/);
  });

  it('writes the ends of a scripted range into its script as they are', () => {
    const filter = rangeFilter(hour, { gte: 9, lt: 17 }, 'logs');
    assert.deepEqual((filter.script as { script: { params: unknown } }).script.params, { gte: 9, lt: 17, value: '>=9 <17' });
    assert.equal(filter.meta.field, 'hour');
    const mapped = mapFilter(filter);
    assert.deepEqual([mapped.type, mapped.key, mapped.params], ['range', 'hour', { gte: 9, lt: 17, value: '>=9 <17' }]);
    assert.equal(typeof mapped.value === 'function' ? mapped.value() : mapped.value, '9 to 17');
  });

  it('knows the addresses of a CIDR mask', () => {
    assert.equal(ipv4Value('10.0.0.1'), 167772161);
    assert.equal(ipv4Value('10.0.0'), undefined);
    assert.equal(ipv4Value('256.0.0.1'), undefined);
    assert.deepEqual(cidrRange('10.1.2.3/8'), { from: '10.0.0.0', to: '10.255.255.255' });
    assert.deepEqual(cidrRange('192.168.1.7/32'), { from: '192.168.1.7', to: '192.168.1.7' });
    assert.deepEqual(cidrRange('128.0.0.0/1'), { from: '128.0.0.0', to: '255.255.255.255' });
    assert.equal(cidrRange('10.0.0.0/0'), undefined);
    assert.equal(cidrRange('10.0.0.0'), undefined);
  });
});

describe('what the filter manager reads off a filter', () => {
  it('reads the kind, the field and the params of each kind of filter', () => {
    assert.deepEqual(withMappedMeta(phraseFilter(hour, 5, 'logs')).meta.params, { query: 5 });
    assert.equal(withMappedMeta(phraseFilter(hour, 5, 'logs')).meta.key, 'hour');
    const phrases = withMappedMeta(phrasesFilter({ name: 'geo.dest' }, ['CN', 'IN'], 'logs'));
    assert.equal(phrases.meta.type, 'phrases');
    assert.deepEqual(getFilterParams(phrases), ['CN', 'IN']);
    const range = withMappedMeta(rangeFilter({ name: 'bytes', type: 'number' }, { gte: 1, lt: 5 }, 'logs'));
    assert.deepEqual(getFilterParams(range), { from: 1, to: 5 });
    assert.equal(withMappedMeta(existsFilter({ name: 'bytes' })).meta.value, 'exists');
    const lucene: Filter = { meta: { index: 'logs' }, query: { query_string: { query: 'bytes:1 AND geo.dest:"a:b"' } } };
    assert.deepEqual(mapFilter(lucene), { type: 'query_string', key: 'query', value: 'bytes:1 AND geo.dest:"a:b"' });
    const custom = withMappedMeta(customFilter({ bool: { must: [] } }, 'logs'));
    assert.deepEqual([custom.meta.type, custom.meta.key, custom.meta.value], ['custom', 'query', '{"bool":{"must":[]}}']);
  });

  it('keeps the switches booleans and a label null', () => {
    const mapped = withMappedMeta({ meta: { index: 'logs' }, exists: { field: 'bytes' } });
    assert.deepEqual([mapped.meta.disabled, mapped.meta.negate, mapped.meta.alias], [false, false, null]);
  });

  it('finds the fields a Lucene query names, and whether an index pattern has them', () => {
    assert.deepEqual(luceneFields('bytes:1 AND (geo.dest:CN OR -ok:true) "quoted:text"'), ['bytes', 'geo.dest', 'ok']);
    const lucene = withMappedMeta({ meta: { index: 'other' }, query: { query_string: { query: 'bytes:1' } } });
    assert.equal(filterMatchesIndex(lucene, logs), true);
    const missing = withMappedMeta({ meta: { index: 'logs' }, query: { query_string: { query: 'nothing:1' } } });
    assert.equal(filterMatchesIndex(missing, logs), false);
    assert.equal(filterMatchesIndex(withMappedMeta(customFilter({ match_all: {} }, 'other')), logs), false);
    assert.equal(filterMatchesIndex(withMappedMeta(phraseFilter({ name: 'bytes' }, 1, 'other')), logs), true);
  });

  it('keeps a filter once, the pinned one when the page has it too, the pinned ones first', () => {
    const app = phraseFilter({ name: 'geo.dest' }, 'CN', 'logs');
    const again = { ...phraseFilter({ name: 'geo.dest' }, 'CN', 'logs'), meta: { ...app.meta, negate: true } };
    const pinned: Filter = { ...phraseFilter({ name: 'bytes' }, 1, 'logs'), $state: { store: 'globalState' } };
    const pageCopy: Filter = { ...phraseFilter({ name: 'bytes' }, 1, 'logs'), meta: { ...pinned.meta, disabled: true } };
    const unique = uniqueFilters([app, again, pageCopy, pinned]);
    assert.equal(unique.length, 2);
    assert.equal(unique[0].$state?.store, 'globalState');
    // What the page's copy said of itself is taken over by the pinned filter
    assert.equal(unique[0].meta.disabled, true);
    assert.deepEqual(unique[1].query, app.query);
  });
});

describe('the filter a click on a bucket adds', () => {
  const columnOf = (agg: AggConfig, response: Record<string, unknown>) => {
    const table = tabify([count, agg], { aggregations: response }, context);
    return { column: table.columns[0], keys: table.rows.map((row) => row[table.columns[0].id]) };
  };

  it('asks a scripted field by its script, and a boolean one with true and false', () => {
    const terms: AggConfig = { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: 'hour', size: 5 } };
    const { column, keys } = columnOf(terms, { '2': { buckets: [{ key: 5, doc_count: 3 }] } });
    assert.deepEqual(filterFieldOf(column, context), hour);
    const filter = bucketFilter(column, keys[0], context);
    assert.deepEqual(filter?.script, getPhraseScript(hour, 5));
    const flags: AggConfig = { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: 'ok', size: 5 } };
    const ok = columnOf(flags, { '2': { buckets: [{ key: 1, key_as_string: 'true', doc_count: 3 }] } });
    assert.deepEqual(bucketFilter(ok.column, ok.keys[0], context)?.query, { match_phrase: { ok: true } });
  });

  it('says what a range bucket is called, an open end being infinite', () => {
    const ranges: AggConfig = {
      id: '2',
      enabled: true,
      type: 'range',
      schema: 'segment',
      params: { field: 'bytes', ranges: [{ to: 1000 }, { from: 1000, to: 2000 }] },
    };
    const { column, keys } = columnOf(ranges, {
      '2': { buckets: [{ key: '*-1000.0', to: 1000, doc_count: 1 }, { key: '1000.0-2000.0', from: 1000, to: 2000, doc_count: 2 }] },
    });
    const open = bucketFilter(column, keys[0], context);
    assert.deepEqual(open?.range, { bytes: { lt: 1000 } });
    assert.equal(open?.meta.formattedValue, '≥ -∞ and < 1,000');
    const closed = bucketFilter(column, keys[1], context);
    assert.deepEqual(closed?.range, { bytes: { gte: 1000, lt: 2000 } });
    assert.equal(closed?.meta.formattedValue, '≥ 1,000 and < 2,000');
  });

  it('runs a histogram bar from its key to the next one, and names it by its key', () => {
    const histogram: AggConfig = { id: '2', enabled: true, type: 'histogram', schema: 'segment', params: { field: 'bytes', interval: 100 } };
    const { column } = columnOf(histogram, { '2': { buckets: [{ key: 200, doc_count: 1 }] } });
    const filter = bucketFilter(column, 200, context);
    assert.deepEqual(filter?.range, { bytes: { gte: 200, lt: 300 } });
    assert.equal(filter?.meta.formattedValue, '200');
  });

  it('takes the addresses of a mask with its last one, and a range of addresses as it is', () => {
    const masks: AggConfig = {
      id: '2',
      enabled: true,
      type: 'ip_range',
      schema: 'segment',
      params: { field: 'ip', ipRangeType: 'mask', ranges: { mask: [{ mask: '10.0.0.0/8' }] } },
    };
    const mask = columnOf(masks, { '2': { buckets: [{ key: '10.0.0.0/8', from: '10.0.0.0', to: '11.0.0.0', doc_count: 3 }] } });
    assert.deepEqual(bucketFilter(mask.column, mask.keys[0], context)?.range, { ip: { gte: '10.0.0.0', lte: '10.255.255.255' } });
    const fromTo: AggConfig = { ...masks, params: { field: 'ip', ipRangeType: 'fromTo', ranges: { fromTo: [{ from: '128.0.0.0' }] } } };
    const open = columnOf(fromTo, { '2': { buckets: [{ key: '128.0.0.0-*', from: '128.0.0.0', doc_count: 3 }] } });
    assert.deepEqual(bucketFilter(open.column, open.keys[0], context)?.range, { ip: { gte: '128.0.0.0' } });
  });

  it('gives a date range the format of its dates only when it has both ends', () => {
    const dates: AggConfig = { id: '2', enabled: true, type: 'date_range', schema: 'segment', params: { field: 'timestamp', ranges: [{ from: 'now-1y' }] } };
    const { column, keys } = columnOf(dates, { '2': { buckets: [{ key: 'x', from: 1700000000000, doc_count: 3 }] } });
    assert.deepEqual(bucketFilter(column, keys[0], context)?.range, { timestamp: { gte: '2023-11-14T22:13:20.000Z' } });
  });

  it('makes a brushed stretch a range, and nothing of one without width', () => {
    const histogram: AggConfig = { id: '2', enabled: true, type: 'histogram', schema: 'segment', params: { field: 'hour', interval: 1 } };
    const { column } = columnOf(histogram, { '2': { buckets: [{ key: 2, doc_count: 1 }] } });
    const filter = brushFilter(column, 2, 5, context);
    assert.deepEqual((filter?.script as { script: { params: unknown } }).script.params, { gte: 2, lt: 5, value: '>=2 <5' });
    assert.equal(brushFilter(column, 2, 2, context), undefined);
  });

  it('writes the terms beside "Other" and the ends of a scripted range as they are, whatever the format', () => {
    // buildPhrasesFilter and buildRangeFilter of 3.9.0 write a value with the format the field
    // carries, and the fields of an index pattern carry none: only a bucket's name is formatted
    const formatted: AggContext = {
      indexPattern: {
        ...logs,
        fieldFormatMap: { 'geo.dest': { id: 'string', params: { transform: 'upper' } }, hour: { id: 'number', params: { pattern: '0.00' } } },
      },
    };
    const terms: AggConfig = { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: 'geo.dest', size: 2, otherBucket: true } };
    const buckets = [{ key: 'us', doc_count: 3 }, { key: 'cn', doc_count: 2 }, { key: '__other__', doc_count: 4 }];
    const table = tabify([count, terms], { aggregations: { '2': { buckets } } }, formatted);
    const other = bucketFilter(table.columns[0], '__other__', formatted, { table, row: table.rows[2] });
    assert.deepEqual([other?.meta.value, other?.meta.params], ['us, cn', ['us', 'cn']]);
    const histogram: AggConfig = { id: '2', enabled: true, type: 'histogram', schema: 'segment', params: { field: 'hour', interval: 1 } };
    const hours = tabify([count, histogram], { aggregations: { '2': { buckets: [{ key: 5, doc_count: 1 }] } } }, formatted);
    const bar = bucketFilter(hours.columns[0], 5, formatted);
    assert.equal((bar?.script as { script: { params: Record<string, unknown> } }).script.params.value, '>=5 <6');
    assert.equal(bar?.meta.formattedValue, '5.00');
  });

  it('leaves the rest of a scripted field\'s terms to its script too', () => {
    const terms: AggConfig = { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: 'hour', size: 1, otherBucket: true } };
    const aggs = [count, terms];
    const plan = planOtherBucket(aggs, buildAggsDsl(aggs, context), { aggregations: { '2': { buckets: [{ key: 5, doc_count: 3 }] } } }, context);
    if (!plan) throw new Error('nothing is asked');
    const query = (plan.aggs['other-filter'] as { filters: { filters: Record<string, { bool: { filter: unknown[]; must_not: unknown[] } }> } }).filters.filters[''];
    // As _terms_other_bucket_helper.ts of 3.9.0: a scripted field is not asked whether it exists
    assert.deepEqual(query.bool.filter, []);
    assert.deepEqual(query.bool.must_not, [{ script: getPhraseScript(hour, 5) }]);
  });

  it('asks a scripted field\'s terms for the type of their values, and no other aggregation', () => {
    const weekday = field('weekday', 'string', { scripted: true, script: "doc['day_of_week'].value", lang: 'painless' });
    const withWeekday: AggContext = { indexPattern: { ...logs, fields: [...logs.fields, weekday] } };
    const clauses = (agg: AggConfig) => JSON.stringify(buildAggsDsl([count, agg], withWeekday));
    const terms = (name: string): AggConfig => ({ id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: name, size: 5 } });
    assert.match(clauses(terms('hour')), /"value_type":"float"/);
    assert.match(clauses(terms('weekday')), /"value_type":"string"/);
    assert.match(clauses(terms('day')), /"value_type":"date"/);
    assert.equal(clauses(terms('bytes')).includes('value_type'), false);
    const histogram: AggConfig = { id: '2', enabled: true, type: 'histogram', schema: 'segment', params: { field: 'hour', interval: 2 } };
    const max: AggConfig = { id: '3', enabled: true, type: 'max', schema: 'metric', params: { field: 'hour' } };
    assert.match(clauses(histogram), /"script":\{"source":"doc\['timestamp'\]\.value\.getHour\(\)","lang":"painless"\}/);
    assert.equal(clauses(histogram).includes('value_type'), false);
    assert.equal(clauses(max).includes('value_type'), false);
  });
});

describe('the filters of input controls on a scripted field', () => {
  const control: ControlParam = { id: '1', indexPattern: 'logs', fieldName: 'hour', type: 'list', options: { multiselect: true } };
  const slider: ControlParam = { id: '2', indexPattern: 'logs', fieldName: 'hour', type: 'range' };

  it('asks the script of the field the index pattern has', () => {
    assert.deepEqual(filterOf(control, [5], hour)?.script, getPhraseScript(hour, 5));
    assert.deepEqual(filterOf(control, [5])?.query, { match_phrase: { hour: 5 } });
    // A field of another name is not the control's
    assert.deepEqual(filterOf(control, [5], field('bytes', 'number'))?.query, { match_phrase: { hour: 5 } });
    const range = filterOf(slider, { min: 1, max: 3 }, hour);
    assert.deepEqual((range?.script as { script: { params: unknown } }).script.params, { gte: 1, lte: 3, value: '>=1 <=3' });
  });

  it('applies the values with the fields it is given', () => {
    const filters = submitFilters([control], { '1': [7] }, [], false, () => hour);
    assert.equal(filters.length, 1);
    assert.deepEqual(filters[0].script, getPhraseScript(hour, 7));
    assert.equal(filters[0].meta.controlledBy, '1');
  });
});

describe('the formats of open ends', () => {
  it('writes infinite ends of a number with their sign', () => {
    const number = createFormatter({ id: 'number' });
    assert.equal(number(Infinity).text, '+∞');
    assert.equal(number(-Infinity).text, '-∞');
    assert.equal(createFormatter({ id: 'bytes' })(-Infinity).text, '-∞');
  });
});

describe('the filter editor', () => {
  it('offers the fields a filter can be made on, and the operators of each kind', () => {
    assert.deepEqual(
      getFilterableFields(logs).map((item) => item.name),
      ['timestamp', 'bytes', 'ip', 'geo.dest', 'message', 'ok', 'hour', 'late', 'day']
    );
    const names = (type: string) => getOperatorOptions(field('x', type)).map((operator) => operator.message);
    assert.deepEqual(names('string'), ['is', 'is not', 'is one of', 'is not one of', 'exists', 'does not exist']);
    assert.deepEqual(names('number'), FILTER_OPERATORS.map((operator) => operator.message));
    assert.deepEqual(names('boolean'), ['is', 'is not', 'exists', 'does not exist']);
    const negated = { ...existsFilter({ name: 'x' }), meta: { ...existsFilter({ name: 'x' }).meta, negate: true } };
    assert.equal(getOperatorFromFilter(negated)?.message, 'does not exist');
  });

  it('checks dates and addresses, and lets the other values be', () => {
    assert.equal(validateParams('now-1d', 'date'), true);
    assert.equal(validateParams('2026-11-01', 'date'), true);
    assert.equal(validateParams('yesterday', 'date'), false);
    assert.equal(validateParams('10.0.0.1', 'ip'), true);
    assert.equal(validateParams('10.0.0.0/8', 'ip'), true);
    assert.equal(validateParams('10.0.0', 'ip'), false);
    assert.equal(validateParams('', 'number'), true);
    const between = FILTER_OPERATORS[4];
    assert.equal(isFilterValid(logs, field('ip', 'ip'), between, { from: '10.0.0.1' }), true);
    assert.equal(isFilterValid(logs, field('ip', 'ip'), between, { from: '10.0.0.1', to: 'x' }), false);
    assert.equal(isFilterValid(logs, field('geo.dest', 'string'), FILTER_OPERATORS[2], []), false);
    assert.equal(isFilterValid(logs, undefined, FILTER_OPERATORS[0], 'a'), false);
  });

  it('writes a day typed alone as its midnight, in full, and leaves expressions as they are', () => {
    // Midnight where the browser is, written in the zone of the settings
    assert.equal(formatDateChange('2026-11-01', 'UTC'), new Date(2026, 10, 1).toISOString().replace('Z', '+00:00'));
    assert.equal(formatDateChange('2026-11-01T10:20:30Z', 'UTC'), '2026-11-01T10:20:30.000+00:00');
    assert.equal(formatDateChange('now-1d', 'UTC'), 'now-1d');
    assert.equal(formatDateChange('not a date', 'UTC'), 'not a date');
  });

  it('saves what the operator says, excluded, switched off, labelled and pinned as asked', () => {
    const meta = { disabled: true, alias: 'Big', pinned: true };
    const between = buildEditedFilter(logs, field('bytes', 'number'), FILTER_OPERATORS[5], { from: '1', to: '5' }, meta);
    assert.deepEqual(between.range, { bytes: { gte: 1, lt: 5 } });
    assert.deepEqual([between.meta.negate, between.meta.disabled, between.meta.alias, between.$state?.store], [true, true, 'Big', 'globalState']);
    const scripted = buildEditedFilter(logs, hour, FILTER_OPERATORS[0], 5, { disabled: false, alias: null, pinned: false });
    assert.deepEqual(scripted.script, getPhraseScript(hour, 5));
    assert.equal(scripted.$state?.store, 'appState');
    const dsl = buildCustomFilter('logs', { query: { match_all: {} } }, { disabled: false, negate: true, alias: null, pinned: false });
    assert.deepEqual(dsl, {
      query: { match_all: {} },
      meta: { index: 'logs', type: 'custom', disabled: false, negate: true, alias: null },
      $state: { store: 'appState' },
    });
    assert.deepEqual(buildQuery(logs, [], [dsl]).bool.must_not, [{ match_all: {} }]);
  });

  it('starts a new filter on the first index pattern, pinned when the setting says so', () => {
    assert.deepEqual(emptyFilter(true, 'logs'), {
      meta: { disabled: false, negate: false, alias: null, index: 'logs' },
      $state: { store: 'globalState' },
    });
  });
});

describe('what a pill says', () => {
  const currency = withMappedMeta(phraseFilter({ name: 'currency' }, 'EUR', 'logs'));

  it('says a missing index pattern or field is wrong', () => {
    assert.deepEqual(filterLabelConfig(currency, [logs], false), { status: 'error', title: 'Error', message: 'Index pattern logs not found' });
    assert.deepEqual(filterLabelConfig(currency, [logs], true), {
      status: 'error',
      title: 'Error',
      message: 'Field currency not found in index pattern logs-*',
    });
    const elsewhere = withMappedMeta(phraseFilter({ name: 'currency' }, 'EUR', 'other'));
    assert.deepEqual(filterLabelConfig(elsewhere, [logs], true), {
      status: 'warn',
      title: 'Warning',
      message: 'Field currency does not exist in current view',
    });
    assert.deepEqual(filterLabelConfig(elsewhere, [], true), { status: '', title: 'EUR' });
  });

  it('reads its key and value, its label, NOT before it when it excludes', () => {
    assert.equal(filterLabelText(currency, 'EUR', ''), 'currency: EUR');
    const excluded = { ...currency, meta: { ...currency.meta, negate: true } };
    assert.equal(filterLabelText(excluded, 'EUR', ''), 'NOT currency: EUR');
    const labelled = { ...currency, meta: { ...currency.meta, alias: 'Euros' } };
    assert.deepEqual(filterLabelParts(labelled, 'EUR', ''), { prefix: 'Euros' });
    assert.deepEqual(filterLabelParts(labelled, 'Warning', 'warn'), { prefix: 'Euros: ', value: 'Warning' });
    const phrases = withMappedMeta(phrasesFilter({ name: 'currency' }, ['EUR', 'USD'], 'logs'));
    assert.equal(filterLabelText(phrases, 'EUR, USD', ''), 'currency: is one of EUR, USD');
    assert.equal(filterLabelText(withMappedMeta(existsFilter({ name: 'currency' }, 'logs')), 'exists', ''), 'currency: exists');
    const dsl = withMappedMeta(customFilter({ match_all: {} }, 'logs'));
    assert.equal(filterLabelText(dsl, '', ''), '{"match_all":{}}');
  });
});

describe('the list of a combo box', () => {
  const options = ['Women', 'Men', 'Menswear', 'Shoes for men'].map((label) => ({ label, value: label }));

  it('lists the options that hold the text, those starting with it first when asked', () => {
    const labels = (rows: ReturnType<typeof matchingOptions>) => rows.map((row) => row.option?.label);
    assert.deepEqual(labels(matchingOptions(options, [], 'men')), ['Women', 'Men', 'Menswear', 'Shoes for men']);
    assert.deepEqual(labels(matchingOptions(options, [], 'men', { sortMatchesBy: 'startsWith' })), ['Men', 'Menswear', 'Women', 'Shoes for men']);
    assert.deepEqual(labels(matchingOptions(options, ['Men'], 'men')), ['Women', 'Menswear', 'Shoes for men']);
    assert.deepEqual(labels(matchingOptions(options, ['Men'], 'men', { single: true })), ['Women', 'Men', 'Menswear', 'Shoes for men']);
  });

  it('lists aggregations by title under headings in the same order, as the vis editor does', () => {
    const shown = (types: string[], nested?: boolean) =>
      aggTypeOptions(types, nested).map((option) => (option.group ? `${option.group}: ${option.label}` : option.label));
    assert.deepEqual(shown(['date_histogram', 'histogram', 'range', 'terms', 'filters']), [
      'Date Histogram',
      'Filters',
      'Histogram',
      'Range',
      'Terms',
    ]);
    assert.deepEqual(shown(['count', 'avg', 'max_bucket', 'avg_bucket', 'derivative', 'cumulative_sum']), [
      'Metric Aggregations: Average',
      'Metric Aggregations: Count',
      'Parent Pipeline Aggregations: Cumulative Sum',
      'Parent Pipeline Aggregations: Derivative',
      'Sibling pipeline aggregations: Average Bucket',
      'Sibling pipeline aggregations: Max Bucket',
    ]);
    // All under one heading: none is shown
    assert.deepEqual(shown(['sum', 'count', 'avg']), ['Average', 'Count', 'Sum']);
    assert.deepEqual(shown(['sum', 'derivative'], true), ['Derivative', 'Sum']);
  });
});
