/* SPDX-License-Identifier: Apache-2.0 */

// Builds dist/: the server as plain JavaScript files, and the browser side as one script and one
// style sheet under dist/public. The only tools it uses are Node and the TypeScript compiler.
//
//   node scripts/build.mjs            the product
//   node scripts/build.mjs --tests    the product and the tests (dist/test, dist/web)
//   node scripts/build.mjs --dev      React's development build, for its warnings

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { bundle, transpile } from './bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = new Set(process.argv.slice(2));
const dev = args.has('--dev');
const started = Date.now();

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// Every TypeScript file of a source directory, as a CommonJS file at the same place under dist/
function transpileTree(name) {
  let count = 0;
  for (const file of walk(join(root, name))) {
    const extension = extname(file);
    const target = join(dist, relative(root, file));
    if (file.endsWith('.d.ts')) continue;
    if (extension === '.ts' || extension === '.tsx') {
      write(target.slice(0, -extension.length) + '.js', transpile(readFileSync(file, 'utf8'), file));
      count += 1;
    } else if (extension === '.json') {
      write(target, readFileSync(file));
    }
  }
  return count;
}

rmSync(dist, { recursive: true, force: true });

// The server: run by Node as it is, with no packages of its own
const serverFiles = transpileTree('server') + transpileTree('common');
write(
  join(dist, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'commonjs' }, null, 2)
);

// The browser side
const flavour = dev ? 'development' : 'production.min';
const { script, styles, modules } = bundle({
  entry: join(root, 'web', 'main.tsx'),
  root,
  alias: {
    react: `react/cjs/react.${flavour}.js`,
    'react/jsx-runtime': `react/cjs/react-jsx-runtime.${flavour}.js`,
    'react-dom': `react-dom/cjs/react-dom.${flavour}.js`,
    scheduler: `scheduler/cjs/scheduler.${flavour}.js`,
  },
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
});

const hashed = (content) => createHash('sha256').update(content).digest('hex').slice(0, 12);
const publicDir = join(dist, 'public');
const assets = {
  script: `assets/app.${hashed(script)}.js`,
  styles: `assets/app.${hashed(styles)}.css`,
};
write(join(publicDir, assets.script), script);
write(join(publicDir, assets.styles), styles);

for (const file of walk(join(root, 'web', 'static'))) {
  const target = join(publicDir, relative(join(root, 'web', 'static'), file));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
}

// What the server needs to know about the build: the names of the two files, and the version
write(
  join(dist, 'build.json'),
  JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString(), assets }, null, 2)
);

// Text files are compressed once, here, so that the server never spends time on it
const COMPRESSIBLE = new Set(['.js', '.css', '.svg', '.json', '.html', '.txt']);
for (const file of walk(publicDir)) {
  if (!COMPRESSIBLE.has(extname(file))) continue;
  const content = readFileSync(file);
  if (content.length < 1024) continue;
  writeFileSync(`${file}.gz`, gzipSync(content, { level: 9 }));
  writeFileSync(
    `${file}.br`,
    brotliCompressSync(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
      },
    })
  );
}

let testFiles = 0;
if (args.has('--tests')) {
  testFiles = transpileTree('test');
  transpileTree('web');
}

const size = (path) => `${(statSync(path).size / 1024).toFixed(0)} kB`;
console.log(
  `built in ${((Date.now() - started) / 1000).toFixed(1)}s: ${serverFiles} server files, ` +
    `${modules.length} browser modules (${size(join(publicDir, assets.script))}, ` +
    `${size(join(publicDir, assets.script) + '.br')} compressed), ` +
    `styles ${size(join(publicDir, assets.styles))}` +
    (testFiles ? `, ${testFiles} test files` : '')
);
