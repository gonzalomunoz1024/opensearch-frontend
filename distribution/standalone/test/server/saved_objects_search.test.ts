/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mappings from '../../server/saved_objects_mappings.json';
import {
  filterToKueryNode,
  getQueryParams,
  getSearchDsl,
  getSortingParams,
  includedFields,
  matchPhrasePrefixFields,
  type IndexMapping,
} from '../../server/saved_objects_search';

const MAPPINGS = mappings as IndexMapping;

const singleNamespace = (type: string) => ({
  bool: {
    must: [{ term: { type } }],
    should: [{ bool: { must_not: [{ exists: { field: 'namespace' } }] } }],
    minimum_should_match: 1,
    must_not: [{ exists: { field: 'namespaces' } }],
  },
});

const messageOf = (body: () => unknown): string => {
  try {
    body();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

describe('saved objects search: the query', () => {
  it('keeps each type to the default namespace and asks for nothing more without a search', () => {
    assert.deepEqual(getQueryParams({ types: ['dashboard', 'search'] }), {
      query: {
        bool: {
          filter: [
            { bool: { should: [singleNamespace('dashboard'), singleNamespace('search')], minimum_should_match: 1 } },
          ],
        },
      },
    });
  });

  it('keeps a type of the product itself out of every namespace', () => {
    const { query } = getQueryParams({ types: ['ui-metric'] });
    const [clause] = (query.bool.filter as Array<{ bool: { should: unknown[] } }>)[0].bool.should;
    assert.deepEqual(clause, {
      bool: {
        must: [{ term: { type: 'ui-metric' } }],
        must_not: [{ exists: { field: 'namespace' } }, { exists: { field: 'namespaces' } }],
      },
    });
  });

  it('reads `*` as the default namespace and a named one as a term', () => {
    const { query } = getQueryParams({ types: ['dashboard'], namespaces: ['*', 'default', 'team'] });
    const [clause] = (query.bool.filter as Array<{ bool: { should: Array<{ bool: { should: unknown[] } }> } }>)[0].bool
      .should;
    assert.deepEqual(clause.bool.should, [
      { terms: { namespace: ['team'] } },
      { bool: { must_not: [{ exists: { field: 'namespace' } }] } },
    ]);
  });

  it('must match a search that does not end in a star, in the fields asked for under each type', () => {
    const { query } = getQueryParams({
      types: ['dashboard', 'visualization'],
      search: 'web traffic',
      searchFields: ['title^3', 'description'],
      defaultSearchOperator: 'AND',
    });
    assert.deepEqual(query.bool.must, [
      {
        simple_query_string: {
          query: 'web traffic',
          fields: ['dashboard.title^3', 'visualization.title^3', 'dashboard.description', 'visualization.description'],
          default_operator: 'AND',
        },
      },
    ]);
    assert.equal(query.bool.should, undefined);
  });

  it('also looks for a phrase starting with a search that ends in a star, with each field boosted', () => {
    const { query } = getQueryParams({
      types: ['dashboard'],
      search: 'zz-agent*',
      searchFields: ['title^5', '*'],
      defaultSearchOperator: 'OR',
    });
    assert.deepEqual(query.bool.should, [
      { simple_query_string: { query: 'zz-agent*', fields: ['dashboard.title^5', 'dashboard.*'], default_operator: 'OR' } },
      { match_phrase_prefix: { 'dashboard.title': { query: 'zz-agent', boost: 5 } } },
    ]);
    assert.equal(query.bool.minimum_should_match, 1);
    assert.equal(query.bool.must, undefined);
  });

  it('searches every field leniently when none is asked for, and the phrase in each type’s own field', () => {
    const { query } = getQueryParams({ types: ['config', 'url', 'search'], search: 'logs*' });
    assert.deepEqual(query.bool.should, [
      { simple_query_string: { query: 'logs*', lenient: true, fields: ['*'] } },
      { match_phrase_prefix: { 'url.url': { query: 'logs', boost: 1 } } },
      { match_phrase_prefix: { 'search.title': { query: 'logs', boost: 1 } } },
    ]);
  });

  it('takes a boost that is no number as no boost', () => {
    assert.deepEqual(matchPhrasePrefixFields(['title^x'], ['dashboard']), [{ field: 'dashboard.title', boost: 1 }]);
  });

  it('finds what refers to an object with a nested clause', () => {
    const { query } = getQueryParams({ types: ['dashboard'], hasReference: { type: 'index-pattern', id: 'abc' } });
    const bool = (query.bool.filter as Array<{ bool: { must: unknown[] } }>)[0].bool;
    assert.deepEqual(bool.must, [
      {
        nested: {
          path: 'references',
          query: {
            bool: {
              must: [{ term: { 'references.id': 'abc' } }, { term: { 'references.type': 'index-pattern' } }],
            },
          },
        },
      },
    ]);
  });

  it('finds nothing in no workspace, and only in those named otherwise', () => {
    const none = getQueryParams({ types: ['dashboard'], workspaces: [] });
    assert.deepEqual((none.query.bool.filter as unknown[])[1], { match_none: {} });
    const named = getQueryParams({ types: ['dashboard'], workspaces: ['w1'] });
    assert.deepEqual((named.query.bool.filter as unknown[])[1], {
      bool: { should: [{ bool: { must: [{ term: { workspaces: 'w1' } }] } }], minimum_should_match: 1 },
    });
  });
});

describe('saved objects search: the order', () => {
  it('sorts by the score or the id at the top', () => {
    assert.deepEqual(getSortingParams(MAPPINGS, ['dashboard'], '_score', 'desc'), { sort: [{ _score: { order: 'desc' } }] });
    assert.deepEqual(getSortingParams(MAPPINGS, ['dashboard'], '_id'), { sort: [{ _id: {} }] });
  });

  it('sorts one type by its own field, or by a field every object has', () => {
    assert.deepEqual(getSortingParams(MAPPINGS, ['dashboard'], 'title', 'asc'), {
      sort: [{ 'dashboard.title': { order: 'asc', unmapped_type: 'text' } }],
    });
    assert.deepEqual(getSortingParams(MAPPINGS, ['dashboard'], 'updated_at'), {
      sort: [{ updated_at: { unmapped_type: 'date' } }],
    });
  });

  it('sorts several types only by a field every object has', () => {
    assert.deepEqual(getSortingParams(MAPPINGS, ['dashboard', 'search'], 'type', 'desc'), {
      sort: [{ type: { order: 'desc', unmapped_type: 'keyword' } }],
    });
    assert.equal(
      messageOf(() => getSortingParams(MAPPINGS, ['dashboard', 'search'], 'title')),
      'Unable to sort multiple types by field title, not a root property'
    );
    assert.equal(messageOf(() => getSortingParams(MAPPINGS, ['dashboard'], 'nope')), 'Unknown sort field nope');
  });

  it('refuses an order without a field', () => {
    assert.equal(messageOf(() => getSearchDsl(MAPPINGS, { types: ['dashboard'], sortOrder: 'asc' })), 'sortOrder requires a sortField');
  });

  it('reads the fields asked for under each type, beside those every object has', () => {
    assert.deepEqual(includedFields(['dashboard', 'search'], ['title']), [
      'dashboard.title',
      'search.title',
      'namespace',
      'namespaces',
      'type',
      'references',
      'migrationVersion',
      'updated_at',
      'originId',
      'workspaces',
      'permissions',
      'title',
    ]);
    assert.equal(includedFields(['dashboard'], []), undefined);
  });
});

describe('saved objects search: the filter', () => {
  it('reads `<type>.attributes.<field>` as the field of the index', () => {
    const node = filterToKueryNode(['dashboard'], 'dashboard.attributes.title: logs', MAPPINGS);
    assert.deepEqual(node, {
      type: 'function',
      function: 'is',
      arguments: [
        { type: 'literal', value: 'dashboard.title' },
        { type: 'literal', value: 'logs' },
        { type: 'literal', value: false },
      ],
    });
  });

  it('keeps a field every object has to its type, below the top of the expression', () => {
    const node = filterToKueryNode(
      ['dashboard', 'search'],
      'dashboard.attributes.title: logs and dashboard.updated_at > "2020-01-01"',
      MAPPINGS
    ) as { arguments: Array<{ function: string; arguments: Array<{ arguments?: unknown[] }> }> };
    assert.equal(node.arguments[1].function, 'and');
    assert.deepEqual(node.arguments[1].arguments[0], {
      type: 'function',
      function: 'is',
      arguments: [
        { type: 'literal', value: 'type' },
        { type: 'literal', value: 'dashboard' },
        { type: 'literal', value: false },
      ],
    });
  });

  it('says what is wrong with each key, as the original words it', () => {
    assert.equal(
      messageOf(() => filterToKueryNode(['dashboard'], 'title: logs', MAPPINGS)),
      "This key 'title' need to be wrapped by a saved object type like dashboard: Bad Request"
    );
    assert.equal(
      messageOf(() => filterToKueryNode(['dashboard'], 'search.attributes.title: logs', MAPPINGS)),
      'This type search is not allowed: Bad Request'
    );
    assert.equal(
      messageOf(() => filterToKueryNode(['dashboard'], 'dashboard.title: logs', MAPPINGS)),
      "This key 'dashboard.title' does NOT match the filter proposition SavedObjectType.attributes.key: Bad Request"
    );
    assert.equal(
      messageOf(() => filterToKueryNode(['dashboard'], 'dashboard.attributes.nope: logs', MAPPINGS)),
      "This key 'dashboard.attributes.nope' does NOT exist in dashboard saved object index patterns: Bad Request"
    );
  });

  it('reports a filter that is no DQL', () => {
    assert.match(messageOf(() => filterToKueryNode(['dashboard'], 'dashboard.attributes.title:(', MAPPINGS)), /^DQLSyntaxError: /);
  });
});
