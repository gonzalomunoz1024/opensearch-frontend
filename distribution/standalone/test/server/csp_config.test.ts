/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../../server/config';
import { contentSecurityPolicy } from '../../server/static';

const fromYaml = (text: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'csp-config-')), 'settings.yml');
  writeFileSync(file, text);
  return loadConfig({ file, env: {} });
};

const rule = (policy: string, name: string) => policy.split('; ').find((entry) => entry.startsWith(`${name} `));

describe('the csp.allowed*Sources settings', () => {
  it('add nothing unless they are set', () => {
    const { config } = loadConfig({ env: {} });
    assert.deepEqual(config.csp, { allowedConnectSources: [], allowedFrameAncestorSources: [], allowedImgSources: [] });
    assert.equal(contentSecurityPolicy(config.map, config.csp), contentSecurityPolicy(config.map));
  });

  it('are read from the settings file and from the environment', () => {
    const { config, ignored } = fromYaml(`
csp.allowedConnectSources: ["https://data.local"]
csp.allowedFrameAncestorSources:
  - https://portal.local
  - https://wiki.local
csp.allowedImgSources: ["https://pictures.local"]
`);
    assert.deepEqual(ignored, []);
    assert.deepEqual(config.csp, {
      allowedConnectSources: ['https://data.local'],
      allowedFrameAncestorSources: ['https://portal.local', 'https://wiki.local'],
      allowedImgSources: ['https://pictures.local'],
    });
    const env = loadConfig({ env: { CSP_ALLOWEDFRAMEANCESTORSOURCES: '["https://portal.local"]' } });
    assert.deepEqual(env.config.csp.allowedFrameAncestorSources, ['https://portal.local']);
  });

  it('add their sources to the rule each names, as OpenSearch Dashboards does', () => {
    const policy = contentSecurityPolicy(undefined, {
      allowedConnectSources: ['https://data.local'],
      allowedFrameAncestorSources: ['https://portal.local', 'https://wiki.local'],
      allowedImgSources: ['https://pictures.local'],
    });
    assert.equal(rule(policy, 'connect-src'), "connect-src 'self' https://data.local");
    assert.equal(rule(policy, 'frame-ancestors'), "frame-ancestors 'self' https://portal.local https://wiki.local");
    assert.equal(rule(policy, 'img-src'), "img-src 'self' data: blob: https: http: https://pictures.local");
    assert.equal(rule(policy, 'script-src'), "script-src 'self'");
  });

  it('come after the map services in connect-src', () => {
    const { config } = loadConfig({ env: { CSP_ALLOWEDCONNECTSOURCES: '["https://data.local"]' } });
    const connect = rule(contentSecurityPolicy(config.map, config.csp), 'connect-src') ?? '';
    assert.match(connect, /^connect-src 'self' https:\/\/maps\.opensearch\.org .* https:\/\/data\.local$/);
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
