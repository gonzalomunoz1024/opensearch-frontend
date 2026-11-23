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

/** The directives a page's nonce is added to: the default of csp.nonceDirectives */
const NONCE_DIRECTIVES = ['style-src-elem'];

const BASE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // React writes styles on elements; nothing here writes style sheets at run time
  "style-src 'self' 'unsafe-inline'",
  // A markdown panel may show a picture from elsewhere
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  'CONNECT',
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
];

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

/** What `csp.allowedConnectSources`, `csp.allowedFrameAncestorSources` and `csp.allowedImgSources` add */
export interface AllowedSources {
  allowedConnectSources?: string[];
  allowedFrameAncestorSources?: string[];
  allowedImgSources?: string[];
}

/**
 * The page's policy: the browser may fetch from the server and from the map services of map.*,
 * and each csp.allowed*Sources setting adds its sources to its rule, as in OpenSearch Dashboards.
 * The page's nonce, when there is one, is added to the rules of the directives that take it.
 */
export function contentSecurityPolicy(map?: MapConfig, allowed: AllowedSources = {}, nonce?: string): string {
  const connect = ["'self'", ...(map ? mapOrigins(map) : []), ...(allowed.allowedConnectSources ?? [])];
  const add = (rule: string, sources?: string[]) => (sources?.length ? `${rule} ${sources.join(' ')}` : rule);
  return BASE_POLICY.map((rule) => {
    if (rule === 'CONNECT') return `connect-src ${connect.join(' ')}`;
    if (rule.startsWith('frame-ancestors ')) return add(rule, allowed.allowedFrameAncestorSources);
    if (rule.startsWith('img-src ')) return add(rule, allowed.allowedImgSources);
    return rule;
  })
    .map((rule) => (nonce && NONCE_DIRECTIVES.includes(rule.split(' ')[0]) ? `${rule} 'nonce-${nonce}'` : rule))
    .join('; ');
}

export const CONTENT_SECURITY_POLICY = contentSecurityPolicy();

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
