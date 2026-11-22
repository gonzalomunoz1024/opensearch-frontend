/* SPDX-License-Identifier: Apache-2.0 */

/* The files of the browser side, and the one page that loads them. */

import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
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
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // React writes styles on elements; nothing here writes style sheets at run time
  "style-src 'self' 'unsafe-inline'",
  // A markdown panel may show a picture from elsewhere
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function renderPage({ basePath, build, title, dark, bootData }: PageOptions): string {
  const data = JSON.stringify(bootData).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en" class="${dark ? 'themeDark' : 'themeLight'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="${basePath}/favicon.svg">
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
