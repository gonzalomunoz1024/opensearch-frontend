/* SPDX-License-Identifier: Apache-2.0 */

// Checks that every package in package-lock.json is one the target registry is known to serve.
//
// The registry this product is built against serves only the versions it already holds. What it
// holds is known from two sources: the lockfile of the OpenSearch Dashboards fork (every package
// in it was asked for there), and the three lists in registry/ of the packages it could not
// serve. So a package is known to be served when
//   - its name is in none of the lists and the fork's lockfile has this very version, or
//   - registry/other_versions.txt names this very version as one the registry does hold.
// Anything else is unknown, and an unknown package is a failed build waiting to happen.
//
//   node scripts/check_lockfile.mjs [--fork-lock registry/fork_yarn.lock]

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const forkLockPath = resolve(root, flag('--fork-lock', 'registry/fork_yarn.lock'));

const lines = (file) =>
  readFileSync(resolve(root, 'registry', file), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

const noVersion = new Set(lines('none.txt'));
const otherRepositories = new Set(lines('other_repos.txt'));
const otherVersions = new Map(
  lines('other_versions.txt').map((line) => {
    const [name, versions, complete] = line.split('|');
    return [name, { versions: new Set(versions.split(',')), complete: complete === '1' }];
  })
);

// name -> versions, from a yarn v1 lockfile. The tarball's address names the real package, which
// is what matters for an alias such as "@elastic/eui@npm:@opensearch-project/oui@1.24.2".
function forkVersions(file) {
  const versions = new Map();
  for (const block of readFileSync(file, 'utf8').split(/\n(?=\S)/)) {
    const version = /\n {2}version "?([^"\n]+)"?/.exec(block)?.[1];
    const tarball = /\n {2}resolved "?[^"\n]*?\/((?:@[^/]+\/)?[^/@]+)\/-\//.exec(block)?.[1];
    if (!version || !tarball) continue;
    const name = decodeURIComponent(tarball);
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(version);
  }
  return versions;
}

if (!existsSync(forkLockPath)) {
  console.log(`skipped: the fork's lockfile is not at ${forkLockPath} (pass --fork-lock)`);
  process.exit(0);
}
const fork = forkVersions(forkLockPath);
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));

const problems = [];
let count = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  count += 1;
  const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const { version } = entry;
  if (noVersion.has(name)) {
    problems.push(`${name}@${version}: the registry has no version of this package`);
  } else if (otherRepositories.has(name)) {
    problems.push(`${name}@${version}: the registry has this package only in another repository`);
  } else if (otherVersions.has(name)) {
    if (!otherVersions.get(name).versions.has(version)) {
      const known = [...otherVersions.get(name).versions].join(', ');
      problems.push(`${name}@${version}: the registry is only known to hold ${known}`);
    }
  } else if (!fork.get(name)?.has(version)) {
    const known = fork.has(name) ? [...fork.get(name)].join(', ') : 'no version';
    problems.push(`${name}@${version}: not known to be served (the fork's lockfile has ${known})`);
  }
}

if (problems.length) {
  console.error(`${problems.length} of ${count} packages are not known to be served:`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('Pin them in "overrides" in package.json to a version that is, or do without.');
  process.exit(1);
}
console.log(`ok: all ${count} packages in package-lock.json are known to be served`);
