/* SPDX-License-Identifier: Apache-2.0 */

/*
 * DQL against OpenSearch Dashboards 3.9.0 itself: fixtures/dql_cases.json holds what its own parser
 * and query functions give for 508 queries (written ones that reach every rule of its grammar, and
 * a sample of random ones): the tree, the OpenSearch query with and without an index pattern, the
 * error with its message, whether the search bar warns of Lucene syntax, and what changes when
 * leading wildcards are not allowed. The values were taken by running the original's
 * fromKueryExpression, toOpenSearchQuery and doesKueryExpressionHaveLuceneSyntaxError; a BigInt is
 * written there as { bigint: "…" }, an undefined value as { undefined: true }.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { hasLuceneSyntax, kueryToDsl, KuerySyntaxError, parseKuery } from '../../web/lib/kuery';
import { buildQuery } from '../../web/lib/query';
import { stringifyJson } from '../../web/services/http';
import type { Filter, IndexPattern } from '../../web/lib/types';

interface Case {
  q: string;
  ast?: unknown;
  dsl?: unknown;
  noPattern?: unknown;
  error?: string;
  lucene: boolean;
  withoutLeadingWildcards?: string;
}

const fixture = JSON.parse(readFileSync('test/web/fixtures/dql_cases.json', 'utf8')) as {
  pattern: IndexPattern;
  dateFormatTZ: string;
  cases: Case[];
};
const { pattern, dateFormatTZ, cases } = fixture;

// The values as the fixture writes them
const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') return { bigint: item.toString() };
      if (item === undefined) return { undefined: true };
      if (typeof item === 'number' && !Number.isFinite(item)) return { number: String(item) };
      return item;
    })
  ) as unknown;

const dslOf = (node: ReturnType<typeof parseKuery>, indexPattern?: IndexPattern): unknown => {
  try {
    return kueryToDsl(node, indexPattern, { dateFormatTZ });
  } catch (error) {
    return { error: (error as Error).message, name: (error as Error).name };
  }
};

const errorOf = (run: () => unknown): string | undefined => {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

describe('DQL, as OpenSearch Dashboards reads it', () => {
  it('reads every query of the fixture into the same tree, or fails with the same message', () => {
    for (const item of cases) {
      const message = errorOf(() => parseKuery(item.q));
      assert.equal(message, item.error, item.q);
      if (item.ast !== undefined) assert.deepEqual(plain(parseKuery(item.q)), item.ast, item.q);
    }
  });

  it('turns each tree into the same OpenSearch query, with and without an index pattern', () => {
    for (const item of cases) {
      if (item.error !== undefined) continue;
      const node = parseKuery(item.q);
      assert.deepEqual(plain(dslOf(node, pattern)), item.dsl, item.q);
      assert.deepEqual(plain(dslOf(node)), item.noPattern ?? item.dsl, item.q);
    }
  });

  it('warns of Lucene syntax where the original does', () => {
    for (const item of cases) assert.equal(hasLuceneSyntax(item.q), item.lucene, item.q);
  });

  it('refuses a leading wildcard when query:allowLeadingWildcards is off', () => {
    const refused = cases.filter((item) => item.withoutLeadingWildcards !== undefined);
    assert.ok(refused.length > 0);
    for (const item of cases) {
      const message = errorOf(() => parseKuery(item.q, { allowLeadingWildcards: false }));
      const expected = item.withoutLeadingWildcards === undefined || item.withoutLeadingWildcards === 'same' ? item.error : item.withoutLeadingWildcards;
      assert.equal(message, expected, item.q);
    }
  });

  it('reads words without quotes as one value, spaces included', () => {
    assert.deepEqual(kueryToDsl(parseKuery('zz-agent short')), {
      multi_match: { type: 'best_fields', query: 'zz-agent short', lenient: true },
    });
    assert.deepEqual(kueryToDsl(parseKuery('machine.os:win 8 or response:200'), pattern), {
      bool: {
        should: [
          { bool: { should: [{ match: { 'machine.os': 'win 8' } }], minimum_should_match: 1 } },
          { bool: { should: [{ match: { response: 200 } }], minimum_should_match: 1 } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('gives a syntax error the message, the query and the mark of the original', () => {
    const error = errorOf(() => parseKuery('foo:('));
    assert.equal(error, 'Expected whitespace, NOT, "(", value but end of input found.\nfoo:(\n-----^');
    let failure: unknown;
    try {
      parseKuery('response:(200');
    } catch (caught) {
      failure = caught;
    }
    assert.ok(failure instanceof KuerySyntaxError);
    assert.equal((failure as KuerySyntaxError).name, 'DQLSyntaxError');
    assert.equal((failure as KuerySyntaxError).shortMessage, 'Expected AND, OR, whitespace, ")" but end of input found.');
  });

  it('writes a whole number too long for JavaScript in full', () => {
    const query = kueryToDsl(parseKuery('id:12345678901234567890'));
    assert.equal(stringifyJson(query), '{"bool":{"should":[{"match":{"id":12345678901234567890}}],"minimum_should_match":1}}');
  });
});

describe('the query of a page, with DQL', () => {
  it('asks for everything with an empty query, as the original', () => {
    assert.deepEqual(buildQuery(pattern, { query: '', language: 'kuery' }).bool.filter, [{ match_all: {} }]);
    assert.deepEqual(buildQuery(pattern, { query: '  ', language: 'kuery' }).bool.filter, [{ match_all: {} }]);
  });

  it('leaves out queries of other languages', () => {
    assert.deepEqual(buildQuery(pattern, { query: 'source = logs', language: 'PPL' }).bool, {
      must: [],
      filter: [],
      should: [],
      must_not: [],
    });
  });

  it('takes query:allowLeadingWildcards', () => {
    assert.throws(
      () => buildQuery(pattern, { query: 'machine.os:*win', language: 'kuery' }, [], { allowLeadingWildcards: false }),
      /^DQLSyntaxError: Leading wildcards are disabled\. See query:allowLeadingWildcards in Advanced Settings\./
    );
  });

  it('sends Lucene as typed, with the time zone unless the options name one', () => {
    assert.deepEqual(buildQuery(pattern, { query: ' a:b ', language: 'lucene' }, [], { dateFormatTZ: 'UTC' }).bool.must, [
      { query_string: { query: ' a:b ', analyze_wildcard: true, time_zone: 'UTC' } },
    ]);
    assert.deepEqual(
      buildQuery(pattern, { query: 'a:b', language: 'lucene' }, [], {
        dateFormatTZ: 'UTC',
        queryStringOptions: { analyze_wildcard: false, time_zone: 'Asia/Tokyo' },
      }).bool.must,
      [{ query_string: { query: 'a:b', analyze_wildcard: false, time_zone: 'Asia/Tokyo' } }]
    );
  });

  it('names the zone of the browser when dateFormat:tz says "Browser", as the original does', () => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.deepEqual(buildQuery(pattern, { query: 'a:b', language: 'lucene' }, [], { dateFormatTZ: 'Browser' }).bool.must, [
      { query_string: { query: 'a:b', analyze_wildcard: true, time_zone: browser } },
    ]);
  });

  it('gives a Lucene query written as a query_string the options and the zone too', () => {
    const config = { dateFormatTZ: 'Europe/Paris', queryStringOptions: { analyze_wildcard: true } };
    assert.deepEqual(buildQuery(pattern, { query: { query_string: { query: 'a:b' } }, language: 'lucene' }, [], config).bool.must, [
      { query_string: { query: 'a:b', analyze_wildcard: true, time_zone: 'Europe/Paris' } },
    ]);
    // The options go over the query's own; the zone it names stays
    const own = { query_string: { query: 'a:b', analyze_wildcard: false, time_zone: 'Asia/Tokyo' } };
    assert.deepEqual(buildQuery(pattern, { query: own, language: 'lucene' }, [], config).bool.must, [
      { query_string: { query: 'a:b', analyze_wildcard: true, time_zone: 'Asia/Tokyo' } },
    ]);
    assert.equal(own.query_string.analyze_wildcard, false, 'the query handed in is not changed');
    // Any other DSL is used as it is
    assert.deepEqual(buildQuery(pattern, { query: { match_all: {} }, language: 'lucene' }, [], config).bool.must, [{ match_all: {} }]);
  });

  it('takes a filter that says nothing about itself, as the original does', () => {
    const bare = { query: { match_phrase: { response: '200' } } } as unknown as Filter;
    assert.deepEqual(buildQuery(pattern, undefined, [bare]).bool.filter, [{ match_phrase: { response: '200' } }]);
  });
});
