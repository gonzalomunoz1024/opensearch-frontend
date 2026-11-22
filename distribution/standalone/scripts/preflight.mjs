/* SPDX-License-Identifier: Apache-2.0 */

// Asks the npm registry of this machine for every package the build needs, before the build is
// tried: each package of package-lock.json is fetched (to a temporary directory that is removed
// again) with the registry, the credentials and the proxy that `npm` is set up with here, and
// without the local cache, which would hide a package the registry no longer serves.
//
//   node scripts/preflight.mjs                    with the registry npm uses on this machine
//   node scripts/preflight.mjs --registry <url>   with another one
//
// It ends with status 1 when a package could not be fetched, and names each one.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--registry');
const registry = at === -1 ? undefined : args[at + 1];
if (at !== -1 && !registry) {
  console.error('--registry needs an address');
  process.exit(2);
}

const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const wanted = Object.entries(lock.packages ?? {})
  .filter(([path]) => path.startsWith('node_modules/'))
  .map(([path, entry]) => ({ name: entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 13), version: entry.version }))
  .sort((a, b) => a.name.localeCompare(b.name));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const scratch = mkdtempSync(join(tmpdir(), 'preflight-'));
const shown = spawnSync(npm, ['config', 'get', 'registry', ...(registry ? ['--registry', registry] : [])], { encoding: 'utf8' });
console.log(`Registry: ${(shown.stdout ?? '').trim() || 'unknown'}`);
console.log(`Packages: ${wanted.length}\n`);

const missing = [];
try {
  for (const { name, version } of wanted) {
    const spec = `${name}@${version}`;
    const result = spawnSync(
      npm,
      [
        'pack',
        spec,
        '--pack-destination',
        scratch,
        '--cache',
        join(scratch, 'cache'),
        '--prefer-online',
        '--ignore-scripts',
        '--loglevel',
        'error',
        ...(registry ? ['--registry', registry] : []),
      ],
      { encoding: 'utf8', cwd: scratch }
    );
    if (result.status === 0) console.log(`  served    ${spec}`);
    else {
      const reason =
        `${result.stderr ?? ''}${result.error ? result.error.message : ''}`
          .split('\n')
          .map((line) => line.replace(/^npm (error|ERR!)\s*/, '').trim())
          .find((line) => line && !line.startsWith('A complete log')) ?? 'npm gave no reason';
      console.log(`  MISSING   ${spec}   ${reason}`);
      missing.push(spec);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (missing.length) {
  console.log(`\n${missing.length} of ${wanted.length} packages could not be fetched: ${missing.join(', ')}`);
  console.log('The build will fail here until the registry serves them, or the lockfile asks for versions it does serve.');
  process.exit(1);
}
console.log(`\nAll ${wanted.length} packages can be fetched. \`npm ci\` will find what it needs here.`);
