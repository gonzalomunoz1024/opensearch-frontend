/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_MAP_CONFIG } from '../../common/map_config';
import { loadConfig } from '../../server/config';
import { contentSecurityPolicy, DEFAULT_CSP, LOOSE_CSP_RULES } from '../../server/static';

const fromYaml = (text: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'csp-config-')), 'settings.yml');
  writeFileSync(file, text);
  return loadConfig({ file, env: {} });
};

const rule = (policy: string, name: string) => policy.split('; ').find((entry) => entry.split(' ')[0] === name);
const directives = (policy: string) => policy.split('; ').map((entry) => entry.split(' ')[0]);

const NONCE = 'AAECAwQFBgcICQoLDA0ODw==';
const TRUSTED =
  'https://opensearch.org https://docs.opensearch.org https://maps.opensearch.org https://vectors.maps.opensearch.org https://tiles.maps.opensearch.org';
// The header the reference (the fork's build, 3.9.0) sends with its default settings, its nonce
// replaced: curl -D - http://localhost:5601/app/home
const REFERENCE =
  "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; " +
  `style-src-elem 'self' 'nonce-${NONCE}'; style-src-attr 'self' 'unsafe-inline'; child-src 'none'; ` +
  "worker-src 'self'; frame-src 'none'; object-src 'none'; manifest-src 'self'; media-src 'none'; " +
  `font-src 'self'; connect-src 'self' ${TRUSTED}; img-src 'self' data: ${TRUSTED}; ` +
  "form-action 'self'; frame-ancestors 'self'";

describe("the page's policy", () => {
  it('is the one OpenSearch Dashboards 3.9.0 sends with its default settings, directive by directive', () => {
    const { config } = loadConfig({ env: {} });
    assert.equal(contentSecurityPolicy(config.map, config.csp, NONCE), REFERENCE);
    assert.equal(contentSecurityPolicy(undefined, {}, NONCE), REFERENCE);
  });

  it('lets a page show pictures only of itself, data and the sites of OpenSearch, and load no frame, plugin or sound', () => {
    const { config } = loadConfig({ env: {} });
    const policy = contentSecurityPolicy(config.map, config.csp, NONCE);
    assert.equal(rule(policy, 'img-src'), `img-src 'self' data: ${TRUSTED}`);
    for (const none of ['script-src-attr', 'child-src', 'frame-src', 'object-src', 'media-src']) {
      assert.equal(rule(policy, none), `${none} 'none'`);
    }
    // An inline style element applies only with the page's nonce; scripts come only from the server
    assert.equal(rule(policy, 'style-src-elem'), `style-src-elem 'self' 'nonce-${NONCE}'`);
    assert.equal(rule(policy, 'script-src'), "script-src 'self'");
    assert.equal(rule(policy, 'font-src'), "font-src 'self'");
    assert.equal(rule(policy, 'worker-src'), "worker-src 'self'");
  });

  it('has no nonce when it is made without one, as the header the original builds at start', () => {
    assert.equal(contentSecurityPolicy(), REFERENCE.replace(` 'nonce-${NONCE}'`, ''));
  });

  it('adds to connect-src the origins of the maps service and of the region layers that the sites of OpenSearch leave out', () => {
    const map = {
      ...DEFAULT_MAP_CONFIG,
      emsTileApiUrl: 'https://tiles.local:8443/v1',
      regionmap: {
        ...DEFAULT_MAP_CONFIG.regionmap,
        layers: [
          { url: 'https://shapes.local/a.json', format: { type: 'geojson' }, meta: { feature_collection_path: 'data' }, attribution: '', name: 'A', fields: [] },
          { url: '/plugins/a.json', format: { type: 'geojson' }, meta: { feature_collection_path: 'data' }, attribution: '', name: 'B', fields: [] },
        ],
      },
    };
    assert.equal(
      rule(contentSecurityPolicy(map, { allowedConnectSources: ['https://data.local'] }), 'connect-src'),
      `connect-src 'self' ${TRUSTED} https://tiles.local:8443 https://shapes.local https://data.local`
    );
    // Only connect-src: the pictures of a tile server elsewhere need csp.allowedImgSources, as in the original
    assert.equal(rule(contentSecurityPolicy(map), 'img-src'), `img-src 'self' data: ${TRUSTED}`);
  });
});

describe('the csp.* settings', () => {
  it('default to those of OpenSearch Dashboards 3.9.0', () => {
    const { config } = loadConfig({ env: {} });
    assert.deepEqual(config.csp, {
      rules: ["script-src 'unsafe-eval' 'self'", "worker-src blob: 'self'", "style-src 'unsafe-inline' 'self'"],
      enable: true,
      strict: false,
      warnLegacyBrowsers: true,
      nonceDirectives: ['style-src-elem'],
      allowedFrameAncestorSources: [],
      allowedConnectSources: [],
      allowedImgSources: [],
      loosenCspDirectives: [],
    });
    assert.deepEqual(config.csp, { ...DEFAULT_CSP });
  });

  it('are read from the settings file and from the environment', () => {
    const { config, ignored } = fromYaml(`
csp.rules: ["script-src 'self'", "style-src 'self'"]
csp.enable: false
csp.strict: true
csp.warnLegacyBrowsers: false
csp.nonceDirectives: [style-src-elem, script-src]
csp.allowedConnectSources: ["https://data.local"]
csp.allowedFrameAncestorSources:
  - https://portal.local
  - https://wiki.local
csp.allowedImgSources: ["https://pictures.local"]
csp:
  loosenCspDirectives: [worker-src]
`);
    assert.deepEqual(ignored, []);
    assert.deepEqual(config.csp, {
      rules: ["script-src 'self'", "style-src 'self'"],
      enable: false,
      strict: true,
      warnLegacyBrowsers: false,
      nonceDirectives: ['style-src-elem', 'script-src'],
      allowedConnectSources: ['https://data.local'],
      allowedFrameAncestorSources: ['https://portal.local', 'https://wiki.local'],
      allowedImgSources: ['https://pictures.local'],
      loosenCspDirectives: ['worker-src'],
    });
    const env = loadConfig({
      env: {
        CSP_RULES: `["script-src 'self'"]`,
        CSP_ENABLE: 'false',
        CSP_STRICT: 'true',
        CSP_WARNLEGACYBROWSERS: 'false',
        CSP_NONCEDIRECTIVES: 'style-src-elem,script-src',
        CSP_ALLOWEDFRAMEANCESTORSOURCES: '["https://portal.local"]',
        CSP_LOOSENCSPDIRECTIVES: '["script-src"]',
      },
    }).config.csp;
    assert.deepEqual(
      [env.rules, env.enable, env.strict, env.warnLegacyBrowsers, env.nonceDirectives, env.allowedFrameAncestorSources, env.loosenCspDirectives],
      [["script-src 'self'"], false, true, false, ['style-src-elem', 'script-src'], ['https://portal.local'], ['script-src']]
    );
  });

  it('csp.allowed*Sources add their sources to the rule each names, as OpenSearch Dashboards does', () => {
    const { config } = fromYaml(`
csp.allowedConnectSources: ["https://data.local"]
csp.allowedFrameAncestorSources: [https://portal.local, https://wiki.local]
csp.allowedImgSources: ["https://pictures.local"]
`);
    const policy = contentSecurityPolicy(config.map, config.csp, NONCE);
    assert.equal(rule(policy, 'connect-src'), `connect-src 'self' ${TRUSTED} https://data.local`);
    assert.equal(rule(policy, 'frame-ancestors'), "frame-ancestors 'self' https://portal.local https://wiki.local");
    assert.equal(rule(policy, 'img-src'), `img-src 'self' data: ${TRUSTED} https://pictures.local`);
    assert.equal(rule(policy, 'script-src'), "script-src 'self'");
  });

  it('csp.enable: false, with csp.strict false, sends csp.rules as they are: no nonce, no sources added', () => {
    const loose = { enable: false, allowedImgSources: ['https://pictures.local'], loosenCspDirectives: ['script-src'] };
    assert.equal(contentSecurityPolicy(DEFAULT_MAP_CONFIG, loose, NONCE), LOOSE_CSP_RULES.join('; '));
    assert.equal(
      contentSecurityPolicy(DEFAULT_MAP_CONFIG, { ...loose, rules: ["script-src 'self'", "worker-src 'self'"] }, NONCE),
      "script-src 'self'; worker-src 'self'"
    );
  });

  it('csp.strict: true sends the strict rules even with csp.enable: false, with the nonce its style elements need', () => {
    assert.equal(contentSecurityPolicy(undefined, { enable: false, strict: true }, NONCE), REFERENCE);
  });

  it('csp.loosenCspDirectives give a strict rule back the rule of csp.rules for its directive, or leave it out', () => {
    // The original's own example (src/core/server/csp/csp_config.test.ts)
    const loosened = contentSecurityPolicy(undefined, { loosenCspDirectives: ['script-src', 'worker-src'] }, NONCE);
    assert.equal(
      loosened,
      REFERENCE.replace("script-src 'self';", "script-src 'unsafe-eval' 'self';").replace(
        "worker-src 'self';",
        "worker-src blob: 'self';"
      )
    );
    // No rule of csp.rules for it: the directive is left out, and the nonce with it
    const dropped = contentSecurityPolicy(undefined, { loosenCspDirectives: ['style-src-elem'] }, NONCE);
    assert.equal(dropped.includes('style-src-elem'), false);
    assert.equal(dropped.includes('nonce-'), false);
    assert.deepEqual(directives(dropped), directives(REFERENCE).filter((name) => name !== 'style-src-elem'));
    // A directive is found by its whole name: style-src does not take the rule of style-src-elem
    const exact = contentSecurityPolicy(
      undefined,
      { rules: ["style-src-elem 'self' 'unsafe-inline'", "style-src 'unsafe-inline' 'self'"], loosenCspDirectives: ['style-src'] },
      NONCE
    );
    assert.equal(rule(exact, 'style-src'), "style-src 'unsafe-inline' 'self'");
    assert.deepEqual(directives(exact), directives(REFERENCE));
  });

  it('csp.nonceDirectives name the rules the nonce is added to', () => {
    const policy = contentSecurityPolicy(undefined, { nonceDirectives: ['style-src-elem', 'script-src'] }, NONCE);
    assert.equal(rule(policy, 'script-src'), `script-src 'self' 'nonce-${NONCE}'`);
    assert.equal(rule(policy, 'style-src-elem'), `style-src-elem 'self' 'nonce-${NONCE}'`);
    assert.equal(contentSecurityPolicy(undefined, { nonceDirectives: [] }, NONCE), REFERENCE.replace(` 'nonce-${NONCE}'`, ''));
  });
});

describe('vis_type_vega.enableExternalUrls', () => {
  it('is off unless it is set, as in OpenSearch Dashboards', () => {
    assert.deepEqual(loadConfig({ env: {} }).config.visTypeVega, { enableExternalUrls: false });
  });

  it('is read from the settings file and from the environment', () => {
    const { config, ignored } = fromYaml('vis_type_vega.enableExternalUrls: true\n');
    assert.deepEqual(ignored, []);
    assert.equal(config.visTypeVega.enableExternalUrls, true);
    const env = loadConfig({ env: { VIS_TYPE_VEGA_ENABLEEXTERNALURLS: 'true' } });
    assert.equal(env.config.visTypeVega.enableExternalUrls, true);
  });
});

describe('home.disableWelcomeScreen', () => {
  it('leaves the welcome screen on unless it is set, as in OpenSearch Dashboards', () => {
    assert.deepEqual(loadConfig({ env: {} }).config.home, { disableWelcomeScreen: false });
  });

  it('is read from the settings file and from the environment', () => {
    const { config, ignored } = fromYaml('home:\n  disableWelcomeScreen: true\n');
    assert.deepEqual(ignored, []);
    assert.equal(config.home.disableWelcomeScreen, true);
    const env = loadConfig({ env: { HOME_DISABLEWELCOMESCREEN: 'true' } });
    assert.equal(env.config.home.disableWelcomeScreen, true);
  });
});
