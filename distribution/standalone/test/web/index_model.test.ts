/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addedFields,
  aliasIndexesError,
  aliasNameError,
  changedSettings,
  comparableComponent,
  componentUsers,
  countChanges,
  countFields,
  dataStreamNameErrors,
  defaultIndex,
  fieldAt,
  fieldErrors,
  fieldsArePlain,
  fieldsHaveErrors,
  fieldsOf,
  flatten,
  includedComponent,
  indexAliasActions,
  inheritedBody,
  localComponent,
  localMappings,
  localTemplate,
  mappingErrorMessage,
  matchingTemplate,
  mergedWithTemplate,
  nameForTemplate,
  newTemplate,
  ordered,
  parsedObject,
  pluginOrder,
  presetTemplate,
  priorityError,
  propertiesOf,
  remoteComponent,
  remoteMappings,
  remoteTemplate,
  replicasError,
  shardsError,
  simulatedIndex,
  simulatedTemplateBody,
  suggestedTemplates,
  templateSettingsErrors,
  valueAt,
  withFields,
  withType,
  type MappingField,
  type StreamTemplate,
} from '../../web/apps/index_management/index_model';
import { tableCaption } from '../../web/apps/index_management/model';

describe('the caption of a table, which a screen reader reads', () => {
  it('says how many rows a page shows of how many there are, and which page it is', () => {
    assert.equal(tableCaption(9, 9, 20, 0, true), 'This table contains 9 rows out of 9 rows; Page 1 of 1.');
    assert.equal(tableCaption(4, 9, 5, 5, true), 'This table contains 4 rows out of 9 rows; Page 2 of 2.');
  });

  it('counts no page when there is no row, as the theme does', () => {
    assert.equal(tableCaption(0, 0, 20, 0, true), 'This table contains 0 rows; Page 1 of 0.');
  });

  it('says only how many rows a table without pages shows', () => {
    assert.equal(tableCaption(1, 1, Number.MAX_SAFE_INTEGER, 0, false), 'This table contains 1 rows.');
  });
});

describe('the fields of mappings', () => {
  const properties = {
    message: { type: 'text' },
    host: { properties: { name: { type: 'keyword' }, ip: { type: 'ip' } } },
    count: { type: 'token_count', analyzer: 'standard' },
  };

  it('are a list in the editor and an object in OpenSearch', () => {
    const fields = fieldsOf(properties);
    assert.deepEqual(
      fields.map((field) => [field.fieldName, field.type]),
      [
        ['message', 'text'],
        ['host', 'object'],
        ['count', 'token_count'],
      ]
    );
    assert.deepEqual(fields[1].properties?.map((field) => field.fieldName), ['name', 'ip']);
    assert.deepEqual(propertiesOf(fields), {
      message: { type: 'text' },
      host: { type: 'object', properties: { name: { type: 'keyword' }, ip: { type: 'ip' } } },
      count: { type: 'token_count', analyzer: 'standard' },
    });
    assert.deepEqual(fieldsOf(undefined), []);
    assert.deepEqual(fieldsOf('text'), []);
  });

  it('keep what else the mappings say', () => {
    const local = localMappings({ dynamic: 'strict', properties });
    assert.equal(local.dynamic, 'strict');
    assert.equal(local.properties?.length, 3);
    assert.deepEqual(remoteMappings(local), {
      dynamic: 'strict',
      properties: propertiesOf(fieldsOf(properties)),
    });
    assert.deepEqual(localMappings(undefined), { properties: [] });
    assert.deepEqual(remoteMappings(undefined), { properties: {} });
  });

  it('are counted with the fields inside them', () => {
    assert.equal(countFields(fieldsOf(properties)), 5);
    assert.equal(countFields([]), 0);
  });

  it('are plain when the visual editor shows all there is to them', () => {
    assert.equal(fieldsArePlain(fieldsOf(properties)), true);
    assert.equal(fieldsArePlain(fieldsOf({ message: { type: 'text', analyzer: 'english' } })), false);
    assert.equal(fieldsArePlain(fieldsOf({ shape: { type: 'no_such_kind' } })), false);
    assert.equal(fieldsArePlain(fieldsOf({ host: { properties: { name: { type: 'keyword', boost: 2 } } } })), false);
    assert.equal(fieldsArePlain(fieldsOf({ count: { type: 'token_count', analyzer: 3 } })), false);
  });

  it('are changed at a place of the list', () => {
    const fields = fieldsOf(properties);
    const more = withFields(fields, [1], (inner) => [...inner, { fieldName: 'os', type: 'keyword' }]);
    assert.deepEqual(more[1].properties?.map((field) => field.fieldName), ['name', 'ip', 'os']);
    assert.equal(fields[1].properties?.length, 2);
    assert.equal(fieldAt(more, [1, 2])?.fieldName, 'os');
    assert.equal(fieldAt(more, [0])?.fieldName, 'message');
    assert.equal(fieldAt(more, [5, 0]), undefined);
    assert.equal(withFields(fields, [], () => []).length, 0);
  });

  it('start again when their kind changes', () => {
    assert.deepEqual(withType({ fieldName: 'count', type: 'text', analyzer: 'english' }, 'token_count'), {
      fieldName: 'count',
      type: 'token_count',
      analyzer: 'standard',
    });
    assert.deepEqual(withType({ fieldName: 'count', type: 'token_count', analyzer: 'standard' }, 'long'), {
      fieldName: 'count',
      type: 'long',
    });
  });

  it('need a name of their own and what their kind needs', () => {
    const before: MappingField[] = [{ fieldName: 'message', type: 'text' }];
    assert.deepEqual(fieldErrors({ fieldName: '', type: 'text' }, before), {
      fieldName: 'Field name is required, please input',
    });
    assert.deepEqual(fieldErrors({ fieldName: 'message', type: 'keyword' }, before), {
      fieldName: 'Duplicate field name [message], please change your field name',
    });
    assert.deepEqual(fieldErrors({ fieldName: 'other', type: 'alias' }, before), { path: 'Path is required.' });
    assert.deepEqual(fieldErrors({ fieldName: 'other', type: 'alias', path: 'message' }, before), {});
  });

  it('are only judged where they can still be edited', () => {
    const old: MappingField[] = [{ fieldName: '', type: 'text' }];
    assert.equal(fieldsHaveErrors(old, undefined, false), true);
    // A field the index already has is left as it is
    assert.equal(fieldsHaveErrors(old, old, true), false);
    assert.equal(fieldsHaveErrors([...old, { fieldName: '', type: 'text' }], old, true), true);
    assert.equal(
      fieldsHaveErrors([{ fieldName: 'host', type: 'object', properties: [{ fieldName: '', type: 'ip' }] }], undefined, false),
      true
    );
  });

  it('can only be added at the end', () => {
    const before: MappingField[] = [{ fieldName: 'message', type: 'text' }];
    const now: MappingField[] = [...before, { fieldName: 'level', type: 'keyword' }, { fieldName: 'message', type: 'text' }];
    assert.deepEqual(addedFields(now, before), [{ fieldName: 'level', type: 'keyword' }]);
  });
});

describe('the settings of an index', () => {
  it('are written flat', () => {
    assert.deepEqual(flatten({ index: { number_of_shards: 1, analysis: { analyzer: { mine: { type: 'custom' } } } } }), {
      'index.number_of_shards': 1,
      'index.analysis.analyzer.mine.type': 'custom',
    });
    assert.deepEqual(flatten({ index: { routing: {}, sort: ['a', 'b'] } }), { 'index.routing': {}, 'index.sort': ['a', 'b'] });
    assert.deepEqual(flatten(undefined), {});
  });

  it('are put in the order of the alphabet', () => {
    assert.deepEqual(Object.keys(ordered({ b: 1, a: 2, c: 3 })), ['a', 'b', 'c']);
  });

  it('are taken from their editor only when it holds a JSON object', () => {
    assert.deepEqual(parsedObject('{ "index.number_of_replicas": "2" }'), { 'index.number_of_replicas': '2' });
    assert.deepEqual(parsedObject('{}'), {});
    assert.equal(parsedObject('{ "index": '), undefined);
    assert.equal(parsedObject(''), undefined);
    assert.equal(parsedObject('[]'), undefined);
    assert.equal(parsedObject('2'), undefined);
    assert.equal(parsedObject('null'), undefined);
  });

  it('are sent only where they changed', () => {
    assert.deepEqual(
      changedSettings(
        { 'index.number_of_replicas': '2', 'index.refresh_interval': '1s', 'index.codec': undefined, 'index.priority': 3 },
        { 'index.number_of_replicas': '1', 'index.refresh_interval': '1s' }
      ),
      { 'index.number_of_replicas': '2', 'index.priority': 3 }
    );
  });

  it('say what is wrong with the numbers', () => {
    assert.equal(shardsError(undefined), undefined);
    assert.equal(shardsError('3'), undefined);
    assert.equal(shardsError(0), 'Number of primary shards cannot be smaller than 1.');
    assert.equal(shardsError('1.5'), 'Number of primary shards must be an integer.');
    assert.equal(replicasError(''), undefined);
    assert.equal(replicasError(0), undefined);
    assert.equal(replicasError(-1), 'Number of replicas cannot be smaller than 0.');
    assert.equal(replicasError('0.5'), 'Number of replicas must be an integer.');
  });
});

describe('an index in its form', () => {
  it('starts with one shard, one replica and a refresh every second', () => {
    assert.deepEqual(defaultIndex(), {
      index: '',
      settings: { 'index.number_of_shards': 1, 'index.number_of_replicas': 1, 'index.refresh_interval': '1s' },
      mappings: {},
    });
  });

  it('counts what is not saved yet', () => {
    assert.equal(countChanges({ a: 1 }, { a: 1 }), 0);
    assert.equal(countChanges({ a: 1 }, { a: 2 }), 1);
    assert.equal(countChanges({ a: 1 }, { a: 1, b: 2 }), 1);
    assert.equal(countChanges({ a: 1, b: 2 }, { a: 1 }), 1);
    assert.equal(countChanges({ a: { b: 1, c: 2 } }, { a: { b: 2 } }), 2);
    // Something where there was nothing is one change, however little it holds
    assert.equal(countChanges(undefined, {}), 1);
    assert.equal(countChanges({ a: [1, 2] }, { a: [1, 2] }), 0);
    assert.equal(countChanges({ a: [1, 2] }, { a: [2, 1] }), 1);
  });

  it('turns the aliases it had into the ones it is to have', () => {
    assert.deepEqual(indexAliasActions(['a', 'b'], ['b', 'c'], 'logs'), [
      { remove: { index: 'logs', alias: 'a' } },
      { add: { index: 'logs', alias: 'c' } },
    ]);
    assert.deepEqual(indexAliasActions(['a'], ['a'], 'logs'), []);
  });

  it('names the line of the mappings OpenSearch refuses', () => {
    const text = JSON.stringify({ properties: { message: { type: 'text', boots: 2 }, level: { type: 'keywords' } } }, null, 2);
    assert.equal(
      mappingErrorMessage('[mapper_parsing_exception] unknown parameter [boots] on mapper [message] of type [text]', text),
      'There is a problem with the index mapping syntax. Unknown parameter "boots" on line 5.'
    );
    assert.equal(
      mappingErrorMessage('[mapper_parsing_exception] No handler for type [keywords] declared on field [level]', text),
      'There is a problem with the index mapping syntax. Unsupported type "keywords" on line 8.'
    );
    assert.equal(mappingErrorMessage('[illegal_argument_exception] no', text), '[illegal_argument_exception] no');
    // What the editor does not show is said as OpenSearch says it
    const error = '[mapper_parsing_exception] unknown parameter [boots] on mapper [message] of type [text]';
    assert.equal(mappingErrorMessage(error, ''), error);
  });

  it('takes what the matching templates give', () => {
    const simulated = simulatedIndex(
      {
        aliases: { all: {} },
        settings: { index: { number_of_replicas: '0' } },
        mappings: { properties: { message: { type: 'text' } } },
      },
      'logs-1'
    );
    assert.equal(simulated.index, 'logs-1');
    assert.deepEqual(simulated.settings, { 'index.number_of_replicas': '0' });
    assert.deepEqual(simulated.mappings?.properties, [{ type: 'text', fieldName: 'message' }]);

    const mine = {
      index: 'logs-1',
      aliases: { mine: {} },
      settings: { 'index.number_of_replicas': 2, 'index.number_of_shards': 1 },
      mappings: { properties: [{ fieldName: 'message', type: 'keyword' }, { fieldName: 'level', type: 'keyword' }] },
    };
    const both = mergedWithTemplate(simulated, mine);
    assert.deepEqual(Object.keys(both.aliases ?? {}), ['all', 'mine']);
    assert.deepEqual(both.settings, { 'index.number_of_replicas': 2, 'index.number_of_shards': 1 });
    assert.deepEqual(both.mappings?.properties, [
      { type: 'keyword', fieldName: 'message' },
      { fieldName: 'level', type: 'keyword' },
    ]);
  });
});

describe('an index template', () => {
  const remote = {
    index_patterns: ['logs-*'],
    priority: 3,
    template: {
      settings: { index: { number_of_replicas: '0' } },
      mappings: { properties: { message: { type: 'text' } } },
    },
    composed_of: [],
    _meta: { flow: 'simple' },
  };

  it('starts simple, with no priority over others', () => {
    assert.deepEqual(newTemplate(), { priority: 0, template: {}, _meta: { flow: 'simple' } });
  });

  it('starts with what the address of its page asks for', () => {
    assert.deepEqual(presetTemplate('{"data_stream":{}}'), {
      priority: 0,
      template: {},
      _meta: { flow: 'simple' },
      data_stream: {},
    });
    assert.deepEqual(presetTemplate('{"_meta":{"owner":"me"},"priority":4}'), {
      priority: 4,
      template: {},
      _meta: { flow: 'simple', owner: 'me' },
    });
    assert.deepEqual(presetTemplate(undefined), newTemplate());
    assert.deepEqual(presetTemplate('{not json'), newTemplate());
    assert.deepEqual(presetTemplate('[1]'), newTemplate());
  });

  it('is held with flat settings, a list of fields and its priority as text', () => {
    const local = localTemplate(remote, 'logs');
    assert.equal(local.name, 'logs');
    assert.equal(local.priority, '3');
    assert.deepEqual(local.template.settings, { 'index.number_of_replicas': '0' });
    assert.deepEqual(local.template.mappings?.properties, [{ type: 'text', fieldName: 'message' }]);
    assert.equal(local._meta?.flow, 'simple');
  });

  it('is defined by components when it is composed of some', () => {
    assert.equal(localTemplate({ ...remote, composed_of: ['base'] }, 'logs')._meta?.flow, 'components');
    assert.equal(localTemplate({ ...remote, _meta: undefined }, 'logs')._meta?.flow, 'simple');
    assert.equal(localTemplate({ ...remote, _meta: { flow: 'components' } }, 'logs')._meta?.flow, 'components');
  });

  it('is sent without its name, and composed of nothing when it is simple', () => {
    const local = localTemplate({ ...remote, composed_of: ['base'], _meta: { flow: 'simple' } }, 'logs');
    assert.deepEqual(remoteTemplate({ ...local, _meta: { flow: 'simple' } }), {
      index_patterns: ['logs-*'],
      priority: '3',
      template: {
        settings: { 'index.number_of_replicas': '0' },
        mappings: { properties: { message: { type: 'text' } } },
      },
      composed_of: [],
      _meta: { flow: 'simple' },
    });
    assert.deepEqual(remoteTemplate(local).composed_of, ['base']);
  });

  it('is sent without mappings when it has none', () => {
    const sent = remoteTemplate({ ...newTemplate(), name: 'logs', index_patterns: ['logs-*'] });
    assert.deepEqual(sent, { priority: 0, index_patterns: ['logs-*'], composed_of: [], _meta: { flow: 'simple' }, template: {} });
    const local = localTemplate({ index_patterns: ['logs-*'], template: { settings: { index: { codec: 'best' } } } }, 'logs');
    assert.deepEqual(remoteTemplate(local).template, { settings: { 'index.codec': 'best' } });
    // Mappings that say something else than fields are sent as they are
    const dynamic = localTemplate({ template: { mappings: { dynamic: false } } }, 'logs');
    assert.deepEqual(remoteTemplate(dynamic).template, { mappings: { dynamic: false } });
  });

  it('is tried on a pattern no index has', () => {
    const body = simulatedTemplateBody(localTemplate(remote, 'logs'), 42);
    assert.deepEqual(body.index_patterns, ['a_pattern_that_will_never_be_matched_for_simulate_template_42']);
    assert.equal(body.priority, 500);
    assert.equal('name' in body, false);
  });

  it('says what is wrong with its numbers', () => {
    assert.equal(priorityError(undefined), undefined);
    assert.equal(priorityError('3'), undefined);
    assert.equal(priorityError(-1), 'Priority cannot be smaller than 0.');
    assert.equal(priorityError('1.5'), 'Priority must be an integer.');
    assert.deepEqual(templateSettingsErrors(undefined), {});
    assert.deepEqual(templateSettingsErrors({ 'index.number_of_shards': 0, 'index.number_of_replicas': -1 }), {
      'index.number_of_shards': 'Number of shards cannot be smaller than 1.',
      'index.number_of_replicas': 'Number of replicas cannot be smaller than 0.',
    });
    assert.deepEqual(templateSettingsErrors({ 'index.number_of_shards': '1.5', 'index.number_of_replicas': '0.5' }), {
      'index.number_of_shards': 'Number of primary shards must be an integer.',
      'index.number_of_replicas': 'Number of replicas must be an integer',
    });
  });
});

describe('a component template', () => {
  const remote = {
    template: { settings: { index: { number_of_shards: '2' } }, mappings: { properties: {} } },
    _meta: { description: 'two shards' },
  };

  it('includes the parts it says something about', () => {
    const local = localComponent(remote, 'base');
    assert.equal(local.name, 'base');
    assert.deepEqual(local.includes, { aliases: false, settings: true, mappings: true });
    assert.deepEqual(local.template.settings, { 'index.number_of_shards': '2' });
  });

  it('is sent with only the parts that are switched on', () => {
    const local = localComponent(remote, 'base');
    assert.deepEqual(remoteComponent({ ...local, includes: { settings: true } }), {
      template: { settings: { 'index.number_of_shards': '2' } },
      _meta: { description: 'two shards' },
    });
    assert.deepEqual(remoteComponent({ ...local, includes: {} }), { template: {}, _meta: { description: 'two shards' } });
    assert.deepEqual(includedComponent({ ...local, includes: { aliases: true } }).template, { aliases: undefined });
  });

  it('sends the fields it was given, and no mappings when it was given none', () => {
    const item = {
      name: 'base',
      template: { settings: { 'index.number_of_shards': '2' }, mappings: { properties: [{ fieldName: 'message', type: 'text' }] } },
      includes: { settings: true, mappings: true },
    };
    assert.deepEqual(remoteComponent(item), {
      template: { settings: { 'index.number_of_shards': '2' }, mappings: { properties: { message: { type: 'text' } } } },
    });
    assert.deepEqual(remoteComponent({ name: 'base', template: { settings: { 'index.number_of_shards': '2' } }, includes: { settings: true, mappings: true } }), {
      template: { settings: { 'index.number_of_shards': '2' }, mappings: undefined },
    });
  });

  it('is compared without its name', () => {
    const local = localComponent(remote, 'base');
    assert.deepEqual(comparableComponent(local), comparableComponent({ ...local, name: 'other' }));
    assert.deepEqual(comparableComponent(undefined), {});
  });
});

describe('the template of a data stream', () => {
  const template = (name: string, patterns: string[], priority?: number): StreamTemplate => ({
    name,
    index_template: { index_patterns: patterns, priority, data_stream: {} },
  });
  const logs = template('logs', ['logs-*'], 1);
  const audit = template('audit', ['logs-audit-*', 'audit'], 5);
  const metrics = template('metrics', ['metrics-*-raw'], 3);
  const all = [logs, audit, metrics];

  it('is suggested while the name may still come to match it', () => {
    assert.deepEqual(suggestedTemplates('', all).map((item) => item.name), ['audit', 'metrics', 'logs']);
    assert.deepEqual(suggestedTemplates('log', all).map((item) => item.name), ['audit', 'logs']);
    assert.deepEqual(suggestedTemplates('logs-app', all).map((item) => item.name), ['logs']);
    assert.deepEqual(suggestedTemplates('METRICS', all).map((item) => item.name), ['metrics']);
    assert.deepEqual(suggestedTemplates('traces', all), []);
    // A name that is no expression matches nothing but what it fits
    assert.deepEqual(suggestedTemplates('logs-[', all).map((item) => item.name), ['logs']);
  });

  it('is the weightiest one with a pattern for the name', () => {
    assert.equal(matchingTemplate('logs-audit-1', all)?.name, 'audit');
    assert.equal(matchingTemplate('logs-app', all)?.name, 'logs');
    assert.equal(matchingTemplate('audit', all)?.name, 'audit');
    assert.equal(matchingTemplate('metrics-cpu-raw', all)?.name, 'metrics');
    assert.equal(matchingTemplate('metrics-cpu', all), undefined);
    assert.equal(matchingTemplate('', [template('any', ['*'], 1)]), undefined);
  });

  it('completes a name that only reads like its pattern', () => {
    assert.equal(nameForTemplate('logs-app', logs), 'logs-app');
    assert.equal(nameForTemplate('log', logs), 'logs-');
    assert.equal(nameForTemplate('', audit), 'logs-audit-');
    assert.equal(nameForTemplate('met', metrics), 'metrics-');
    assert.equal(nameForTemplate('traces', logs), 'traces');
  });

  it('gives its settings flat and its fields as a list', () => {
    const body = inheritedBody({
      name: 'logs',
      index_template: {
        template: {
          aliases: { all: {} },
          settings: { index: { number_of_replicas: '0' } },
          mappings: { properties: { message: { type: 'text' } } },
        },
      },
    });
    assert.deepEqual(body.aliases, { all: {} });
    assert.deepEqual(body.settings, { 'index.number_of_replicas': '0' });
    assert.deepEqual(body.mappings?.properties, [{ type: 'text', fieldName: 'message' }]);
    assert.deepEqual(inheritedBody(logs), { settings: {}, mappings: { properties: [] } });
  });

  it('is what a name must have, besides being a name an index can have', () => {
    assert.deepEqual(dataStreamNameErrors('logs-app', true), []);
    assert.deepEqual(dataStreamNameErrors('logs-app', false), ['No matching index template found for data stream [logs-app]']);
    assert.deepEqual(dataStreamNameErrors('', false), [
      'Invalid data stream name.',
      'No matching index template found for data stream []',
    ]);
    assert.deepEqual(dataStreamNameErrors('Logs', true), ['Invalid data stream name.']);
  });
});

describe('an alias in its dialog', () => {
  it('has a name an index could have, and one sentence for whatever is wrong with it', () => {
    assert.equal(aliasNameError('logs'), undefined);
    assert.equal(aliasNameError('logs-1_all'), undefined);
    for (const name of ['', undefined, 'Logs', '-logs', '_logs', 'lo*gs', 'logs?', 'a/b']) {
      assert.equal(aliasNameError(name), 'Invalid alias name.');
    }
  });

  it('points to one index at least', () => {
    assert.equal(aliasIndexesError(['logs-1']), undefined);
    assert.equal(aliasIndexesError(['logs-*', 'audit']), undefined);
    assert.equal(aliasIndexesError([]), 'At least one index should be selected.');
    assert.equal(aliasIndexesError(undefined), 'At least one index should be selected.');
  });
});

describe('the list of component templates', () => {
  it('knows the index templates each component is part of', () => {
    const users = componentUsers([
      { name: 'logs', composed_of: ['base', 'mappings'] },
      { name: 'metrics', composed_of: ['base'] },
      { name: 'plain' },
      { name: 'odd', composed_of: ['constructor'] },
    ]);
    assert.deepEqual(users.get('base'), ['logs', 'metrics']);
    assert.deepEqual(users.get('mappings'), ['logs']);
    assert.deepEqual(users.get('constructor'), ['odd']);
    assert.equal(users.get('toString'), undefined);
  });

  it('reads a value at a path as lodash does', () => {
    const item = { a: { b: { c: 'x', n: null } }, zero: 0 };
    assert.equal(valueAt(item, 'a.b.c', 0), 'x');
    assert.equal(valueAt(item, 'a.b.n', 0), null);
    assert.equal(valueAt(item, 'a.b.n.d', 0), 0);
    assert.equal(valueAt(item, 'a.missing.c', 7), 7);
    assert.equal(valueAt(item, 'zero', 1), 0);
  });

  it('orders the rows as the plugin, whose comparator says no two are equal', () => {
    const row = (name: string, description: string | undefined, count: number) => ({
      name,
      component_template: description === undefined ? {} : { _meta: { description } },
      associatedCount: count,
    });
    // As the server sends them
    const rows = [
      row('comp-alias', undefined, 0),
      row('comp-none', 'nothing', 0),
      row('comp', 'test component', 1),
      row('comp-all', 'all three', 2),
    ];
    const names = (field: string, direction: string) => pluginOrder(rows, field, direction).map((item) => item.name);
    assert.deepEqual(names('name', 'desc'), ['comp-none', 'comp-all', 'comp-alias', 'comp']);
    assert.deepEqual(names('name', 'asc'), ['comp', 'comp-alias', 'comp-all', 'comp-none']);
    // A row without a description is never before nor after another: where it ends is the sort's
    const description = 'component_template._meta.description';
    assert.deepEqual(names(description, 'asc'), ['comp-alias', 'comp-all', 'comp-none', 'comp']);
    assert.deepEqual(names(description, 'desc'), ['comp-alias', 'comp', 'comp-none', 'comp-all']);
    assert.deepEqual(names('associatedCount', 'asc'), ['comp-alias', 'comp-none', 'comp', 'comp-all']);
    assert.deepEqual(names('associatedCount', 'desc'), ['comp-all', 'comp', 'comp-alias', 'comp-none']);
    // A field no row has leaves them as they came
    assert.deepEqual(names('templateTypes', 'desc'), ['comp-alias', 'comp-none', 'comp', 'comp-all']);
    assert.deepEqual(rows.map((item) => item.name), ['comp-alias', 'comp-none', 'comp', 'comp-all']);
  });
});
