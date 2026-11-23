/* SPDX-License-Identifier: Apache-2.0 */

/* The files of the browser side, and the one page that loads them. */

import type { MapConfig } from '../common/map_config';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fontFaceRules } from './fonts';
import type { Reply } from './http';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  // The web fonts under /ui/fonts, and their licences, as the original sends them
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export interface Build {
  version: string;
  builtAt: string;
  /** The app's script and style sheet, and the browser builds of Vega and Vega-Lite */
  assets: { script: string; styles: string; vega?: string; vegaLite?: string };
}

export function readBuild(distDirectory: string): Build {
  return JSON.parse(readFileSync(join(distDirectory, 'build.json'), 'utf8')) as Build;
}

/** A file under the public directory, in the compressed form the browser accepts if there is one */
export function serveStatic(
  publicDirectory: string,
  req: IncomingMessage,
  path: string
): Reply | undefined {
  const file = normalize(join(publicDirectory, path));
  if (!file.startsWith(publicDirectory + sep)) return undefined;
  const type = TYPES[extname(file)];
  if (!type || !existsSync(file) || !statSync(file).isFile()) return undefined;

  const headers: Record<string, string> = {
    'content-type': type,
    // A file under assets/ carries the hash of its content in its name
    'cache-control': path.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600',
  };
  const accepts = String(req.headers['accept-encoding'] ?? '');
  for (const [encoding, suffix] of [
    ['br', '.br'],
    ['gzip', '.gz'],
  ]) {
    if (new RegExp(`\\b${encoding}\\b`).test(accepts) && existsSync(file + suffix)) {
      return {
        headers: { ...headers, 'content-encoding': encoding, vary: 'accept-encoding' },
        body: readFileSync(file + suffix),
      };
    }
  }
  return { headers, body: readFileSync(file) };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface PageOptions {
  basePath: string;
  build: Build;
  title: string;
  dark: boolean;
  /** What the browser side needs before its first request; it is data, never run as script */
  bootData: unknown;
  /**
   * The nonce of this page's policy, from cspNonce(): its own <style> carries it, and so does every
   * style element the browser side makes, which reads it from <meta name="csp-nonce">
   */
  nonce?: string;
}

/**
 * A nonce for one page, as OpenSearch Dashboards makes one for each page it sends
 * (src/core/server/http_resources/http_resources_service.ts): 16 random bytes in base64
 */
export function cspNonce(): string {
  return randomBytes(16).toString('base64');
}

/*
 * The policy of OpenSearch Dashboards 3.9.0 (src/core/server/constants.ts, src/core/server/csp/):
 * its strict rules, which it sends unless csp.enable and csp.strict are both false, and the loose
 * ones, the default of csp.rules, which it sends then. The page needs nothing they do not allow: its
 * script and style sheet are its own files, its inline <style> elements carry the page's nonce, the
 * style attributes it writes are allowed, and it makes no worker, frame, plugin or sound.
 */

/** The sites of OpenSearch the original always lets a page fetch from and show pictures of */
export const CSP_TRUSTED_ENDPOINTS: readonly string[] = [
  'https://opensearch.org',
  'https://docs.opensearch.org',
  'https://maps.opensearch.org',
  'https://vectors.maps.opensearch.org',
  'https://tiles.maps.opensearch.org',
];

/** The strict rules, in the original's order (STRICT_CSP_RULES_DEFAULT_VALUE) */
export const STRICT_CSP_RULES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'self' 'unsafe-inline'",
  "child-src 'none'",
  "worker-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "manifest-src 'self'",
  "media-src 'none'",
  "font-src 'self'",
  `connect-src 'self' ${CSP_TRUSTED_ENDPOINTS.join(' ')}`,
  `img-src 'self' data: ${CSP_TRUSTED_ENDPOINTS.join(' ')}`,
  "form-action 'self'",
  "frame-ancestors 'self'",
];

/** The loose rules, the default of csp.rules (LOOSE_CSP_RULES_DEFAULT_VALUE) */
export const LOOSE_CSP_RULES: readonly string[] = [
  "script-src 'unsafe-eval' 'self'",
  "worker-src blob: 'self'",
  "style-src 'unsafe-inline' 'self'",
];

/** The csp.* settings of OpenSearch Dashboards 3.9.0 (src/core/server/csp/config.ts) */
export interface CspSettings {
  /** csp.rules: the loose rules */
  rules: string[];
  /** csp.enable: the strict rules (the default); false, with csp.strict false too, sends csp.rules */
  enable: boolean;
  /** csp.strict, which the original deprecates for csp.enable: the strict rules as well */
  strict: boolean;
  /** csp.warnLegacyBrowsers: read, and as in 3.9.0 used for nothing on the page */
  warnLegacyBrowsers: boolean;
  /** csp.nonceDirectives: the strict rules the page's nonce is added to */
  nonceDirectives: string[];
  /** csp.allowedFrameAncestorSources: added to the strict rule frame-ancestors */
  allowedFrameAncestorSources: string[];
  /** csp.allowedConnectSources: added to the strict rule connect-src */
  allowedConnectSources: string[];
  /** csp.allowedImgSources: added to the strict rule img-src */
  allowedImgSources: string[];
  /** csp.loosenCspDirectives: strict rules that take the rule of csp.rules for their directive, or are left out */
  loosenCspDirectives: string[];
}

/** The defaults of the csp.* settings, as in the original */
export const DEFAULT_CSP: Readonly<CspSettings> = Object.freeze({
  rules: [...LOOSE_CSP_RULES],
  enable: true,
  strict: false,
  warnLegacyBrowsers: true,
  nonceDirectives: ['style-src-elem'],
  allowedFrameAncestorSources: [],
  allowedConnectSources: [],
  allowedImgSources: [],
  loosenCspDirectives: [],
});

/** The origins of URLs a page fetches from outside the server: the maps service and the shapes of region maps */
export function mapOrigins(map: MapConfig): string[] {
  const urls = [
    map.opensearchManifestServiceUrl,
    map.manifestServiceUrl,
    map.emsFileApiUrl,
    map.emsTileApiUrl,
    ...map.regionmap.layers.map((layer) => layer.url),
  ];
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      if (url) origins.add(new URL(url).origin);
    } catch {
      // Not an absolute URL: the browser resolves it against the page, which 'self' covers
    }
  }
  return [...origins].filter((origin) => origin !== 'null');
}

const directiveOf = (rule: string) => rule.split(' ')[0];

/**
 * The page's policy, built from the csp.* settings as OpenSearch Dashboards 3.9.0 builds it
 * (src/core/server/csp/csp_config.ts, src/core/server/http_resources/http_resources_service.ts).
 * With csp.enable and csp.strict both false it is csp.rules as they are. Otherwise it is the strict
 * rules, to which each csp.allowed*Sources setting adds its sources (connect-src first the origins
 * of the maps service and of the region layers of map.* that the trusted sites leave out); then each
 * directive of csp.loosenCspDirectives takes the rule of csp.rules for it, or is left out; then the
 * page's nonce is added to the rules of csp.nonceDirectives.
 */
export function contentSecurityPolicy(map?: MapConfig, settings: Partial<CspSettings> = {}, nonce?: string): string {
  const csp = <K extends keyof CspSettings>(key: K): CspSettings[K] => settings[key] ?? DEFAULT_CSP[key];
  if (!csp('enable') && !csp('strict')) return csp('rules').join('; ');

  const add = (rule: string, sources: readonly string[]) => (sources.length ? `${rule} ${sources.join(' ')}` : rule);
  const withSources = STRICT_CSP_RULES.map((rule) => {
    switch (directiveOf(rule)) {
      case 'frame-ancestors':
        return add(rule, csp('allowedFrameAncestorSources'));
      case 'connect-src': {
        const listed = rule.split(' ');
        const maps = (map ? mapOrigins(map) : []).filter((origin) => !listed.includes(origin));
        return add(rule, [...maps, ...csp('allowedConnectSources')]);
      }
      case 'img-src':
        return add(rule, csp('allowedImgSources'));
      default:
        return rule;
    }
  });
  // A directive is matched by its whole name, where the original takes the first rule that starts
  // with it, so that loosening style-src could pick a rule of style-src-elem
  const loosened = withSources.flatMap((rule) => {
    const directive = directiveOf(rule);
    if (!csp('loosenCspDirectives').includes(directive)) return [rule];
    const loose = csp('rules').find((candidate) => directiveOf(candidate) === directive);
    return loose === undefined ? [] : [loose];
  });
  // The nonce goes with the strict rules whichever setting chose them; the original leaves it out when
  // only the deprecated csp.strict is set, which blocks its own inline style elements
  return loosened
    .map((rule) => (nonce && csp('nonceDirectives').includes(directiveOf(rule)) ? `${rule} 'nonce-${nonce}'` : rule))
    .join('; ');
}

export function renderPage({ basePath, build, title, dark, bootData, nonce }: PageOptions): string {
  const data = JSON.stringify(bootData).replace(/</g, '\\u003c');
  // Where the original writes them: the nonce after the viewport, and on its own <style> elements
  const nonceMeta = nonce === undefined ? '' : `\n<meta name="csp-nonce" content="${escapeHtml(nonce)}">`;
  const nonceAttribute = nonce === undefined ? '' : ` nonce="${escapeHtml(nonce)}"`;
  return `<!doctype html>
<html lang="en" class="${dark ? 'themeDark' : 'themeLight'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${nonceMeta}
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="${basePath}/favicon.svg">
<style${nonceAttribute}>
${fontFaceRules(`${basePath}/ui`)}
</style>
<link rel="stylesheet" href="${basePath}/${build.assets.styles}">
</head>
<body>
<div id="root"><div class="bootScreen"><img src="${basePath}/logo.svg" alt="" width="64" height="64"><p>Loading ${escapeHtml(title)}</p></div></div>
<script id="boot-data" type="application/json">${data}</script>
<script src="${basePath}/${build.assets.script}" defer></script>
</body>
</html>
`;
}
