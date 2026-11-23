/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Input controls run as OpenSearch Dashboards 3.9.0's input_control_vis runs them: the order the
 * controls depend on each other, what a list asks OpenSearch, the filter a choice becomes and how
 * it is read back, what "Apply changes" leaves on the page, and the checks of a typed range.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Filter, IndexPattern } from '../../web/lib/types';
import {
  ancestorsOf,
  caseInsensitivePattern,
  ceilWithPrecision,
  controlLabel,
  controlSearchBody,
  filterOf,
  floorWithPrecision,
  hasValue,
  minMaxAggs,
  rangeError,
  rangeInputWidth,
  rangeValueOf,
  sameValue,
  submitFilters,
  termsAggs,
  usableControls,
  valueFromFilters,
  type ControlParam,
} from '../../web/vis/controls';

const IP = 'logs';
const list = (id: string, fieldName: string, extra: Partial<ControlParam> = {}): ControlParam => ({
  id,
  indexPattern: IP,
  fieldName,
  type: 'list',
  label: '',
  parent: '',
  options: { multiselect: true, dynamicOptions: false, size: 5, order: 'desc', type: 'terms' },
  ...extra,
});
const range = (id: string, fieldName: string, extra: Partial<ControlParam> = {}): ControlParam => ({
  id,
  indexPattern: IP,
  fieldName,
  type: 'range',
  label: '',
  parent: '',
  options: { decimalPlaces: 0, step: 1 },
  ...extra,
});

describe('the controls a panel draws, and which depend on which', () => {
  it('leaves out a control without an index pattern or a field', () => {
    const controls = usableControls({ controls: [list('1', 'geo.src'), list('2', ''), { id: '3', type: 'range', fieldName: 'bytes' }] });
    assert.deepEqual(
      controls.map((control) => control.id),
      ['1']
    );
  });

  it('calls a control by its label, or else its field', () => {
    assert.equal(controlLabel(list('1', 'geo.src', { label: 'Source Country' })), 'Source Country');
    assert.equal(controlLabel(list('1', 'geo.src')), 'geo.src');
  });

  it('lists each control\'s parent first, then the parent\'s parent, and stops at a loop', () => {
    const controls = [list('1', 'a'), list('2', 'b', { parent: '1' }), list('3', 'c', { parent: '2' }), list('4', 'd', { parent: '5' }), list('5', 'e', { parent: '4' })];
    const ancestry = ancestorsOf(controls);
    assert.deepEqual(ancestry.get('1'), []);
    assert.deepEqual(ancestry.get('3')?.map((control) => control.id), ['2', '1']);
    assert.deepEqual(ancestry.get('4')?.map((control) => control.id), ['5']);
  });

  it('leaves out a parent the panel does not draw', () => {
    const ancestry = ancestorsOf([list('2', 'b', { parent: '9' })]);
    assert.deepEqual(ancestry.get('2'), []);
  });
});

describe('what a control asks OpenSearch', () => {
  it('asks a list for its most frequent values, whatever order the editor kept', () => {
    const field = { name: 'geo.src', type: 'string', searchable: true, aggregatable: true };
    assert.deepEqual(termsAggs(list('1', 'geo.src', { options: { size: 7, order: 'asc' } }), field), {
      termsAgg: { terms: { order: { _count: 'desc' }, size: 7, field: 'geo.src' } },
    });
  });

  it('asks a list that searches as one types for OpenSearch\'s number of values, matching the text in any case', () => {
    const field = { name: 'geo.src', type: 'string', searchable: true, aggregatable: true };
    assert.deepEqual(termsAggs(list('1', 'geo.src', { options: { dynamicOptions: true, size: 5 } }), field, 'Us.a'), {
      termsAgg: { terms: { order: { _count: 'desc' }, field: 'geo.src', include: '.*[uU][sS]\\.[aA].*' } },
    });
    assert.equal(caseInsensitivePattern('a+1'), '[aA]\\+1');
  });

  it('asks for one value at least', () => {
    const field = { name: 'geo.src', type: 'string', searchable: true, aggregatable: true };
    const terms = (termsAggs(list('1', 'geo.src', { options: { size: -3 } }), field).termsAgg as { terms: { size: number } }).terms;
    assert.equal(terms.size, 1);
  });

  it('asks for a scripted field by its script', () => {
    const field = { name: 'hour', type: 'number', searchable: true, aggregatable: true, scripted: true, script: "doc['h'].value", lang: 'painless' };
    assert.deepEqual(termsAggs(list('1', 'hour'), field), {
      termsAgg: { terms: { order: { _count: 'desc' }, size: 5, script: { source: "doc['h'].value", lang: 'painless' }, value_type: 'float' } },
    });
    assert.deepEqual(minMaxAggs(field), {
      maxAgg: { max: { script: { source: "doc['h'].value", lang: 'painless' } } },
      minAgg: { min: { script: { source: "doc['h'].value", lang: 'painless' } } },
    });
  });

  it('asks for no documents, under the filters of the controls it depends on and the time range', () => {
    const indexPattern = { id: IP, title: 'logs-*', fields: [] } as unknown as IndexPattern;
    const parent = filterOf(list('1', 'geo.src'), ['US']) as Filter;
    const time = { range: { timestamp: { gte: 'a', lte: 'b', format: 'strict_date_optional_time' } } };
    assert.deepEqual(controlSearchBody(indexPattern, { x: 1 }, [parent], time, { timeout: '1000ms' }), {
      timeout: '1000ms',
      size: 0,
      aggs: { x: 1 },
      query: { bool: { must: [], filter: [{ match_phrase: { 'geo.src': 'US' } }, time], should: [], must_not: [] } },
    });
  });
});

describe('the filters a control makes and reads back', () => {
  it('makes one phrase of one choice and a list of phrases of several, marked with the control', () => {
    const one = filterOf(list('1', 'geo.src'), ['US']) as Filter;
    assert.deepEqual(one.query, { match_phrase: { 'geo.src': 'US' } });
    assert.equal(one.meta.controlledBy, '1');
    assert.equal(one.meta.index, IP);
    const several = filterOf(list('1', 'geo.src'), ['US', 'CN']) as Filter;
    assert.deepEqual(several.query, {
      bool: { should: [{ match_phrase: { 'geo.src': 'US' } }, { match_phrase: { 'geo.src': 'CN' } }], minimum_should_match: 1 },
    });
    assert.equal(filterOf(list('1', 'geo.src'), []), undefined);
  });

  it('makes a range from its two ends', () => {
    const made = filterOf(range('2', 'bytes'), { min: 10, max: 20 }) as Filter;
    assert.deepEqual(made.range, { bytes: { gte: 10, lte: 20 } });
    assert.equal(made.meta.controlledBy, '2');
  });

  it('reads back every choice of its filters, a 0 and false too, and the filters of other controls not at all', () => {
    const control = list('1', 'geo.src');
    const filters = [
      filterOf(control, ['US', 'CN']) as Filter,
      filterOf(list('1', 'geo.src'), [0]) as Filter,
      filterOf(list('9', 'geo.src'), ['IN']) as Filter,
    ];
    assert.deepEqual(valueFromFilters(control, filters), ['US', 'CN', 0]);
    assert.equal(valueFromFilters(list('7', 'geo.src'), filters), undefined);
  });

  it('reads a filter that is switched off too, as the original', () => {
    const control = list('1', 'geo.src');
    const off = filterOf(control, ['US']) as Filter;
    off.meta.disabled = true;
    assert.deepEqual(valueFromFilters(control, [off]), ['US']);
  });

  it('reads a phrase written the old way, and a range written with gt and lt', () => {
    const control = list('1', 'geo.src');
    const old: Filter = { meta: { controlledBy: '1' } as Filter['meta'], query: { match: { 'geo.src': { query: 'US', type: 'phrase' } } } };
    assert.deepEqual(valueFromFilters(control, [old]), ['US']);
    const bounds: Filter = { meta: { controlledBy: '2' } as Filter['meta'], range: { bytes: { gt: 5, lt: '9' } } };
    assert.deepEqual(valueFromFilters(range('2', 'bytes'), [bounds]), { min: 5, max: 9 });
  });

  it('counts an empty list as no value', () => {
    const control = list('1', 'geo.src');
    assert.equal(hasValue(control, []), false);
    assert.equal(sameValue(control, [], undefined), true);
    assert.equal(sameValue(control, ['US'], ['US']), true);
    assert.equal(sameValue(range('2', 'bytes'), { max: 2, min: 1 }, { min: 1, max: 2 }), true);
  });
});

describe('what "Apply changes" leaves on the page', () => {
  const country = list('1', 'geo.src');
  const os = list('2', 'machine.os', { parent: '1' });
  const bytes = range('3', 'bytes');
  const other: Filter = { meta: { key: 'agent', index: IP } as Filter['meta'], query: { match_phrase: { agent: 'x' } } };

  it('replaces the filters of the controls that changed, and adds the new ones last', () => {
    const before = [filterOf(country, ['US']) as Filter, other];
    const after = submitFilters([country, os, bytes], { '1': ['CN'], '2': ['ios'], '3': { min: 1, max: 2 } }, before, false);
    assert.deepEqual(
      after.map((filter) => [filter.meta.controlledBy ?? filter.meta.key, filter.$state?.store]),
      [
        ['agent', undefined],
        ['1', 'appState'],
        ['2', 'appState'],
        ['3', 'appState'],
      ]
    );
  });

  it('pins the new filters when the panel says so', () => {
    const after = submitFilters([country], { '1': ['CN'] }, [], true);
    assert.equal(after[0].$state?.store, 'globalState');
  });

  it('takes away the filter of a control whose parent has no value', () => {
    const before = [filterOf(os, ['ios']) as Filter];
    const after = submitFilters([country, os], { '1': undefined, '2': ['ios'] }, before, false);
    assert.equal(after.length, 0);
  });

  it('takes a control\'s filter away once its value is cleared', () => {
    const before = [filterOf(bytes, { min: 1, max: 2 }) as Filter, other];
    assert.deepEqual(submitFilters([bytes], {}, before, false), [other]);
  });
});

describe('a range typed by hand, as the original checks it', () => {
  it('needs both ends, or neither', () => {
    assert.equal(rangeError(['5', ''], 1, 8), 'Both lower and upper values must be set');
    assert.equal(rangeError(['', '5'], 1, 8), 'Both lower and upper values must be set');
    assert.equal(rangeError(['', ''], 1, 8), '');
  });

  it('keeps the ends within the bounds, the lower no higher than the upper', () => {
    assert.equal(rangeError(['5', '30'], 1, 8), 'Values must be on or between 1 and 8');
    assert.equal(rangeError(['0', '3'], 1, 8), 'Values must be on or between 1 and 8');
    assert.equal(rangeError(['5', '3'], 1, 8), 'Upper value must be greater or equal to lower value');
    assert.equal(rangeError(['5', '6'], 1, 8), '');
  });

  it('keeps a valid range as numbers, and both ends empty as none', () => {
    assert.deepEqual(rangeValueOf(['5', '6.5']), { min: 5, max: 6.5 });
    assert.equal(rangeValueOf(['', '']), undefined);
  });

  it('rounds the bounds outwards to the control\'s decimal places', () => {
    assert.equal(floorWithPrecision(100.4167, 0), 100);
    assert.equal(ceilWithPrecision(1199.729, 0), 1200);
    assert.equal(floorWithPrecision(1.256, 2), 1.25);
    assert.equal(ceilWithPrecision(1.251, 2), 1.26);
  });

  it('sizes the number fields by the longest bound, as the original', () => {
    assert.equal(rangeInputWidth(0, 19742), 6);
    assert.equal(rangeInputWidth(1, 8), 2.8);
    assert.equal(rangeInputWidth(101, 1200), 5.2);
  });
});
