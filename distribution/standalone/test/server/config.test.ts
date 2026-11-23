/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../../server/config';

const opensearch = (env: Record<string, string>) => loadConfig({ env }).config.opensearch;

/** The settings of a file with these lines, read as the server reads them at start */
function fromFile(source: string, env: Record<string, string | undefined> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'zz-agent-srv-config-'));
  const file = join(directory, 'opensearch_dashboards.yml');
  writeFileSync(file, source);
  try {
    return loadConfig({ file, env });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('a setting given in the environment', () => {
  it('that is text made of digits stays as it is written', () => {
    for (const written of ['1.50', '12345678901234567890', '007', '-0', '1.0', '123456', 'true']) {
      const { username, password } = opensearch({
        OPENSEARCH_USERNAME: written,
        OPENSEARCH_PASSWORD: written,
      });
      assert.equal(username, written);
      assert.equal(password, written);
    }
  });

  it('that is a number, a switch or a list is read as one', () => {
    const { config } = loadConfig({
      env: {
        SERVER_PORT: '5602',
        OPENSEARCH_REQUESTTIMEOUT: ' 1500 ',
        MAP_TILEMAP_OPTIONS_MAXZOOM: '12.0',
        LOGGING_QUIET: 'true',
        OPENSEARCH_HOSTS: '["http://a.local:9200/", "http://b.local:9200"]',
      },
    });
    assert.equal(config.server.port, 5602);
    assert.equal(config.opensearch.requestTimeout, 1500);
    assert.equal(config.map.tilemap.options.maxZoom, 12);
    assert.equal(config.logging.quiet, true);
    assert.deepEqual(config.opensearch.hosts, ['http://a.local:9200', 'http://b.local:9200']);
  });
});

describe('a user name and a password inside an address of opensearch.hosts', () => {
  it('are what is sent, and are not kept in the address, which is logged and shown', () => {
    const read = opensearch({
      OPENSEARCH_HOSTS: '["http://reader:p%40ss%3Aword@search.local:9200/", "https://other.local/behind"]',
    });
    assert.deepEqual(read.hosts, ['http://search.local:9200', 'https://other.local/behind']);
    assert.equal(read.username, 'reader');
    assert.equal(read.password, 'p@ss:word');
  });

  it('give way to opensearch.username and opensearch.password', () => {
    const read = opensearch({
      OPENSEARCH_HOSTS: 'https://reader:secret@search.local:9200',
      OPENSEARCH_USERNAME: 'writer',
      OPENSEARCH_PASSWORD: 'other',
    });
    assert.deepEqual(read.hosts, ['https://search.local:9200']);
    assert.equal(read.username, 'writer');
    assert.equal(read.password, 'other');
  });

  it('an address without them is kept as it is written', () => {
    const read = opensearch({ OPENSEARCH_HOSTS: 'http://Search.local:9200/a@b/' });
    assert.deepEqual(read.hosts, ['http://Search.local:9200/a@b']);
    assert.equal(read.username, undefined);
    assert.equal(read.password, undefined);
  });
});

describe('a setting the original does not know', () => {
  it('stops the start with the words of the original, wherever it is', () => {
    assert.throws(() => fromFile('servr.port: 1\nopensearch.hosts: [http://a:9200]\nfoo:\n  bar: 1\ntoString: 2'), {
      message:
        'Unknown configuration key(s): "servr.port", "foo.bar", "toString". Check for spelling errors and ensure that expected plugins are installed.',
    });
    // A file that is a list has the keys 0, 1, ... and none of them is a setting
    assert.throws(() => fromFile('- server.port: 5601'), {
      message:
        'Unknown configuration key(s): "0.server.port". Check for spelling errors and ensure that expected plugins are installed.',
    });
    // server and logging are still checked by the old platform's schema, which names the first part it does not know
    assert.throws(() => fromFile('server.prot: 5601'), { message: '"server.prot" is not allowed' });
    assert.throws(() => fromFile('server.requestId.allowFromAnyIp: true'), { message: '"server.requestId" is not allowed' });
    assert.throws(() => fromFile('logging.levle: 1'), { message: '"logging.levle" is not allowed' });
    // what the new platform checks, in its words
    assert.throws(() => fromFile('server.ssl.enabeld: true'), {
      message: '[config validation of [server].ssl.enabeld]: definition for this key is missing',
    });
    assert.throws(() => fromFile('opensearch.requestTimout: 1'), {
      message: '[config validation of [opensearch].requestTimout]: definition for this key is missing',
    });
    assert.throws(() => fromFile('uiSettings.defaults:\n  defaultRoute: /app/x'), {
      message: '[config validation of [uiSettings].defaults.defaultRoute]: definition for this key is missing',
    });
  });

  it('of a plugin of the original, or of its core that this server does not read, is reported and read no further', () => {
    const { ignored, config } = fromFile(
      [
        'data.search.aggs.shardDelay.enabled: true',
        'vis_type_vega.enabled: true',
        'opensearchDashboards.branding.useExpandedHeader: false',
        'opensearch.sniffOnStart: false',
        'logging.dest: stdout',
        'server.port: 5602',
      ].join('\n')
    );
    assert.deepEqual(ignored, [
      'data.search.aggs.shardDelay.enabled',
      'vis_type_vega.enabled',
      'opensearchDashboards.branding.useExpandedHeader',
      'opensearch.sniffOnStart',
      'logging.dest',
    ]);
    assert.equal(config.server.port, 5602);
  });

  it('that this server cannot honour where leaving it out would be less safe, or elsewhere, stops the start', () => {
    assert.throws(() => fromFile('server.ssl.keystore.path: /x.p12'), /^Error: server\.ssl\.keystore\.path: InfraDashboard reads no PKCS#12 keystore/);
    assert.throws(() => fromFile('opensearch.ssl.truststore.path: /x.p12'), /^Error: opensearch\.ssl\.truststore\.path: InfraDashboard reads no PKCS#12 truststore/);
    assert.throws(() => fromFile('server.cors: true'), /^Error: server\.cors: InfraDashboard answers no request of another origin/);
    assert.throws(() => fromFile('server.autoListen: false'), /^Error: server\.autoListen: /);
    assert.throws(() => fromFile('savedObjects.permission.enabled: true'), /^Error: savedObjects\.permission\.enabled: /);
    assert.throws(() => fromFile('savedObjects.storage.backend: sqlite'), /^Error: savedObjects\.storage\.backend: /);
    assert.throws(() => loadConfig({ env: { SERVER_SSL_KEYSTORE_PATH: '/x.p12' } }), /^Error: SERVER_SSL_KEYSTORE_PATH: /);
    // The same settings at the values that ask for nothing this server does not do
    const { config, ignored } = fromFile('server.cors: false\nserver.autoListen: true\nsavedObjects.permission.enabled: false');
    assert.equal(config.server.port, 5601);
    assert.deepEqual(ignored, []);
  });
});

describe("the settings of Dev Tools' console", () => {
  it('console.enabled and console.proxyFilter are read, with the defaults of the original', () => {
    assert.deepEqual(fromFile('server.port: 5601').config.console, { enabled: true, proxyFilter: ['.*'] });
    const { config, ignored } = fromFile(
      "console.enabled: false\nconsole.proxyFilter: ['^_cat/', '^/?logs-[0-9]{4},?']\nconsole.ssl.verify: true"
    );
    assert.deepEqual(config.console, { enabled: false, proxyFilter: ['^_cat/', '^/?logs-[0-9]{4},?'] });
    // what the original's plugin reads and does nothing with is reported
    assert.deepEqual(ignored, ['console.ssl.verify']);
    assert.deepEqual(loadConfig({ env: { CONSOLE_PROXYFILTER: '["^_search$"]' } }).config.console.proxyFilter, ['^_search$']);
    // a list written as JSON text, as config-schema reads one
    assert.deepEqual(fromFile(`console.proxyFilter: '["^_cat"]'`).config.console.proxyFilter, ['^_cat']);
  });

  it('console.proxyFilter is refused as the original refuses it', () => {
    assert.throws(() => fromFile("console.proxyFilter: '.*'"), {
      message: '[config validation of [console].proxyFilter]: could not parse array value from json input',
    });
    assert.throws(() => fromFile('console.proxyFilter: [1]'), {
      message: '[config validation of [console].proxyFilter.0]: expected value of type [string] but got [number]',
    });
    // where the plugin makes the expression
    assert.throws(() => fromFile("console.proxyFilter: ['(']"), {
      message: '[config validation of [console].proxyFilter.0]: Invalid regular expression: /(/: Unterminated group',
    });
  });
});

describe('a value of a setting', () => {
  it('of another type is refused as the original refuses it', () => {
    assert.throws(() => fromFile('server.name: 1.50'), {
      message: '[config validation of [server].name]: expected value of type [string] but got [number]',
    });
    assert.throws(() => fromFile('opensearch.username: true'), {
      message: '[config validation of [opensearch].username]: expected value of type [string] but got [boolean]',
    });
    assert.throws(() => fromFile('server.port: abc'), {
      message: '[config validation of [server].port]: expected value of type [number] but got [string]',
    });
    assert.throws(() => fromFile('opensearch: 5'), {
      message: '[config validation of [opensearch]]: expected a plain object value, but found [number] instead.',
    });
    assert.throws(() => fromFile('opensearch.customHeaders:\n  X-A:\n    b: one'), {
      message: '[config validation of [opensearch].customHeaders.X-A]: expected value of type [string] but got [Object]',
    });
  });

  it('of a size or a time is read as the original reads it', () => {
    assert.throws(() => fromFile('server.maxPayloadBytes: -1'), {
      message: '[config validation of [server].maxPayload]: Value in bytes is expected to be a safe positive integer.',
    });
    assert.equal(fromFile('server.maxPayloadBytes: 2mb').config.server.maxPayloadBytes, 2097152);
    assert.equal(fromFile('savedObjects.maxImportPayloadBytes: "10kb"').config.savedObjects.maxImportPayloadBytes, 10240);
    assert.equal(fromFile('opensearch.requestTimeout: 2m').config.opensearch.requestTimeout, 120000);
    assert.equal(fromFile('opensearch.shardTimeout: 0').config.opensearch.shardTimeout, 0);
    assert.throws(() => fromFile('opensearch.pingTimeout: soon'), {
      message:
        "[config validation of [opensearch].pingTimeout]: Failed to parse value as time value. Value must be a duration in milliseconds, or follow the format <count>[ms|s|m|h|d|w|M|Y] (e.g. '70ms', '5s', '3d', '1Y'), where the duration is a safe positive integer.",
    });
  });

  it('may name a variable of the environment as ${NAME}', () => {
    assert.equal(fromFile('opensearch.password: ${ZZ_SECRET}', { ZZ_SECRET: 'p@ss' }).config.opensearch.password, 'p@ss');
    assert.throws(() => fromFile('opensearch.password: ${ZZ_MISSING}'), {
      message: 'Unknown environment variable referenced in config : ZZ_MISSING',
    });
  });

  it('of a renamed setting moves to its new name, with the warning of the original', () => {
    const { config, deprecations } = fromFile('elasticsearch.hosts: [http://a:9200]\nkibana.index: .other\nserver.xsrf.whitelist: [/api/x]');
    assert.deepEqual(config.opensearch.hosts, ['http://a:9200']);
    assert.equal(config.index, '.other');
    assert.deepEqual(config.server.xsrf.allowlist, ['/api/x']);
    assert.deepEqual(deprecations, [
      '"elasticsearch.hosts" is deprecated and has been replaced by "opensearch.hosts"',
      '"kibana.index" is deprecated and has been replaced by "opensearchDashboards.index"',
      '"server.xsrf.whitelist" is deprecated and has been replaced by "server.xsrf.allowlist"',
      'It is not recommended to disable xsrf protections for API endpoints via [server.xsrf.whitelist]. Instead, supply the "osd-xsrf" header.',
    ]);
    assert.deepEqual(fromFile('server.xsrf.allowlist: [/api/y]').config.server.xsrf.allowlist, ['/api/y']);
  });
});

describe('the settings of the server and of its connection to OpenSearch', () => {
  it("default to the original's", () => {
    const { server, opensearch: client } = loadConfig({ env: {} }).config;
    assert.equal(server.host, 'localhost');
    assert.equal(server.name, hostname());
    assert.equal(server.keepaliveTimeout, 120000);
    assert.equal(server.socketTimeout, 120000);
    assert.equal(server.rewriteBasePath, false);
    assert.deepEqual(server.xsrf, { disableProtection: false, allowlist: [] });
    assert.deepEqual(server.compression, { enabled: true, referrerAllowlist: undefined });
    assert.equal(server.ssl.enabled, false);
    assert.deepEqual(server.ssl.supportedProtocols, ['TLSv1.1', 'TLSv1.2', 'TLSv1.3']);
    assert.equal(server.ssl.clientAuthentication, 'none');
    assert.deepEqual(client.requestHeadersAllowlist, ['authorization']);
    assert.equal(client.shardTimeout, 30000);
    assert.equal(client.pingTimeout, undefined);
    assert.deepEqual(client.memoryCircuitBreaker, { enabled: false, maxPercentage: 1 });
  });

  it('are checked as the original checks them', () => {
    assert.throws(() => fromFile('server.basePath: /a/'), {
      message: "[config validation of [server].basePath]: must start with a slash, don't end with one",
    });
    assert.throws(() => fromFile('server.rewriteBasePath: true'), {
      message: '[config validation of [server]]: cannot use [rewriteBasePath] when [basePath] is not specified',
    });
    assert.throws(() => fromFile('server.xsrf.whitelist: [api/x]'), {
      message: '[config validation of [server].xsrf.whitelist.0]: must start with a slash',
    });
    assert.throws(() => fromFile('server.ssl.enabled: true'), {
      message: '[config validation of [server].ssl]: must specify [certificate] and [key] -- or [keystore.path] -- when ssl is enabled',
    });
    assert.throws(() => fromFile('server.ssl.clientAuthentication: required'), {
      message: '[config validation of [server].ssl]: must enable ssl to use [clientAuthentication]',
    });
    assert.throws(
      () => fromFile('server.ssl.supportedProtocols: [SSLv3]'),
      /^Error: \[config validation of \[server\]\.ssl\.supportedProtocols\.0\]: types that failed validation:/
    );
    assert.throws(() => fromFile('server.compression.enabled: false\nserver.compression.referrerWhitelist: [a.local]'), {
      message: '[config validation of [server]]: cannot use [compression.referrerWhitelist] when [compression.enabled] is set to false',
    });
    assert.match(fromFile('server.basePath: /a').deprecations[0], /^You should set server\.basePath along with server\.rewriteBasePath/);
  });

  it('server.basePath is checked with the pattern of the original, in its words', () => {
    const refusal = { message: "[config validation of [server].basePath]: must start with a slash, don't end with one" };
    // As the original's schema answers each (http_config.ts, run on the reference's own code): a
    // line break is refused except as the last character
    for (const written of ["''", '/', '/a/', 'a', '"/a\\nb"', '"/a\\rb"', '"/a\\n\\n"', '"/a\\u2028b"', '1', 'true', '~', '{}', '[a]']) {
      assert.throws(() => fromFile(`server.basePath: ${written}`), refusal, written);
    }
    for (const [written, read] of [
      ['/a', '/a'],
      ['//a', '//a'],
      ['"/a b"', '/a b'],
      ['/a"b', '/a"b'],
      ['"/a\\n"', '/a\n'],
    ]) {
      assert.equal(fromFile(`server.basePath: ${written}`).config.server.basePath, read, written);
    }
    // The original takes a list whose items, joined, would pass, and its base path is then a list
    assert.throws(() => fromFile('server.basePath: [/a]'), refusal);
    // From the environment as from the file; an empty variable is not there, as the original's image reads it
    assert.throws(() => loadConfig({ env: { SERVER_BASEPATH: '/' } }), refusal);
    assert.equal(loadConfig({ env: { SERVER_BASEPATH: '' } }).config.server.basePath, '');
    assert.equal(loadConfig({ env: { SERVER_BASEPATH: '/a' } }).config.server.basePath, '/a');
  });

  it('give the headers of every answer as the original writes them', () => {
    const { config } = fromFile(
      'server.customResponseHeaders:\n  X-Count: 1\n  X-List: [a, 2]\n  X-Map: { a: 1 }\n  X-Empty: {}\n  x-none: null'
    );
    assert.deepEqual(
      { ...config.server.customResponseHeaders },
      { 'X-Count': '1', 'X-List': ['a', '2'], 'X-Map': '{"a":1}', 'X-Empty': '{}', 'x-none': 'null' }
    );
  });
});
