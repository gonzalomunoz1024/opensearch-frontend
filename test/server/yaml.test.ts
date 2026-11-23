/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { YamlError, flatten, parseYaml } from '../../server/yaml';

const flat = (source: string) => ({ ...flatten(parseYaml(source)) });

describe('a settings file', () => {
  it('nested or with dotted keys, comes out with dotted keys', () => {
    assert.deepEqual(
      flat(
        [
          '# a comment',
          'server:',
          '  port: 5601',
          '  host: "0.0.0.0"   # where it listens',
          'opensearch.hosts: [http://a:9200, "http://b:9200"]',
          'opensearch.requestHeadersWhitelist:',
          '- authorization',
          '- x-user',
          "server.name: 'it''s'",
          'uiSettings.overrides: { "theme:darkMode": true }',
        ].join('\n')
      ),
      {
        'server.port': 5601,
        'server.host': '0.0.0.0',
        'opensearch.hosts': ['http://a:9200', 'http://b:9200'],
        'opensearch.requestHeadersWhitelist': ['authorization', 'x-user'],
        'server.name': "it's",
        'uiSettings.overrides.theme:darkMode': true,
      }
    );
  });

  it('reads numbers, switches and null as YAML 1.2 does (js-yaml, the reader of the original)', () => {
    assert.deepEqual(
      flat(
        [
          'a: 0x1F',
          'b: -0o17',
          'c: .inf',
          'd: -.Inf',
          'e: True',
          'f: FALSE',
          'g: Null',
          'h: ~',
          'i: 1.50',
          'j: 1e3',
          'k: 0o19',
          'l: yes',
          'm: 0b101',
          'o: 012',
          'p: 1_000',
        ].join('\n')
      ),
      // as js-yaml 4.3.2 in the reference reads each
      {
        a: 31,
        b: -15,
        c: Infinity,
        d: -Infinity,
        e: true,
        f: false,
        g: null,
        h: null,
        i: 1.5,
        j: 1000,
        k: '0o19',
        l: 'yes',
        m: 5,
        o: 12,
        p: '1_000',
      }
    );
    assert.ok(Number.isNaN(flat('n: .NaN').n));
  });

  it('refuses a key written twice in one map, as js-yaml does', () => {
    assert.throws(() => parseYaml('server.port: 1\nserver.port: 2'), /line 2: duplicated mapping key/);
    assert.throws(() => parseYaml('server:\n  port: 1\n  port: 2'), /line 3: duplicated mapping key/);
    assert.throws(() => parseYaml('a: { b: 1, b: 2 }'), YamlError);
    // The same setting written once nested and once dotted is two keys of two maps, as in js-yaml
    assert.deepEqual(flat('server:\n  port: 1\nserver.port: 2'), { 'server.port': 2 });
  });

  it('leaves out a key __proto__, and reads constructor and toString as any other key', () => {
    const read = flat('__proto__:\n  polluted: true\nconstructor: 1\ntoString: 2\nserver:\n  __proto__: { a: 1 }\n  port: 3');
    assert.deepEqual(read, { constructor: 1, toString: 2, 'server.port': 3 });
    assert.equal(({} as { polluted?: unknown }).polluted, undefined);
    const map = parseYaml('constructor: 1') as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(map), null);
  });

  it('that is a list has the keys 0, 1 and so on, as the original reads it', () => {
    assert.deepEqual(flat('- a\n- b: 1'), { 0: 'a', '1.b': 1 });
  });

  it('keeps a map with no keys as the value of its key', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(flat('server: {}\nopensearch:\n  customHeaders: {}'))), {
      server: {},
      'opensearch.customHeaders': {},
    });
  });

  it('ends a list at the indentation of its key at the next key', () => {
    assert.deepEqual(flat('a:\n- x\n- y\nb: 1'), { a: ['x', 'y'], b: 1 });
    assert.throws(() => parseYaml('a:\n  - x\n  b: 1'), YamlError);
  });

  it('says where it cannot read the file, and what it does not read', () => {
    assert.throws(() => parseYaml('a: [1, 2'), /line 1: a list is not closed/);
    assert.throws(() => parseYaml('a:\n\tb: 1'), /line 2: a tab is not allowed as indentation/);
    assert.throws(() => parseYaml('a: &anchor 1'), /starts a kind of YAML this reader does not read/);
    assert.throws(() => parseYaml('a: 1\n  b: 2'), /line 2: this line is indented further/);
    assert.deepEqual(parseYaml(''), {});
    assert.deepEqual(parseYaml('# nothing\n---\n'), {});
  });
});
