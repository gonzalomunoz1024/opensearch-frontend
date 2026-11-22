/* SPDX-License-Identifier: Apache-2.0 */

/*
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Fetches the plugins that ship (`plugins` in distribution/plugins.json) into plugins/<name>, each
 * at the commit it is pinned to. A tag that no longer points at the pinned commit fails the fetch
 * rather than building something else. A plugin the manifest leaves out is not fetched: move its
 * entry from `leftOut` to `plugins` first.
 *
 *   node distribution/scripts/fetch_plugins.js                           # all of them
 *   node distribution/scripts/fetch_plugins.js indexManagementDashboards # some of them
 *   node distribution/scripts/fetch_plugins.js --list                    # print the names
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST = require('../plugins.json');

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const headOf = (dir) => {
  try {
    return git(dir, 'rev-parse', 'HEAD');
  } catch {
    return undefined;
  }
};

const fetchPlugin = ({ name, repository, tag, commit }) => {
  const dir = path.join(ROOT, 'plugins', name);

  if (fs.existsSync(path.join(dir, '.git')) && headOf(dir) === commit) {
    console.log(`${name}: already at ${tag} (${commit.slice(0, 10)})`);
    return;
  }
  if (fs.existsSync(dir)) {
    throw new Error(
      `${path.relative(ROOT, dir)} exists and is not at ${commit}. Remove it, or keep working in it.`
    );
  }

  // a fetch that fails must not leave a half-made directory for the next run to trip over
  fs.mkdirSync(dir, { recursive: true });
  try {
    git(dir, 'init', '--quiet');
    git(dir, 'remote', 'add', 'origin', repository);
    git(dir, 'fetch', '--quiet', '--depth', '1', 'origin', `refs/tags/${tag}`);
    const fetched = git(dir, 'rev-parse', 'FETCH_HEAD^{commit}');
    if (fetched !== commit) {
      throw new Error(
        `${name}: tag ${tag} is at ${fetched}, but distribution/plugins.json pins ${commit}.`
      );
    }
    git(dir, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', fetched);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  console.log(`${name}: fetched ${tag} (${commit.slice(0, 10)})`);
};

const main = () => {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log(MANIFEST.plugins.map((p) => p.name).join('\n'));
    return;
  }

  const unknown = args.filter((name) => !MANIFEST.plugins.some((p) => p.name === name));
  const leftOut = unknown
    .map((name) => MANIFEST.leftOut.find((p) => p.name === name))
    .filter(Boolean);
  if (leftOut.length) {
    throw new Error(
      leftOut
        .map(
          (p) =>
            `${p.name} is left out of the distribution: its pages need ${p.backend} on the ` +
            'backend. To ship it, move its entry from `leftOut` to `plugins` in ' +
            'distribution/plugins.json.'
        )
        .join('\n')
    );
  }
  if (unknown.length) {
    throw new Error(`Not in distribution/plugins.json: ${unknown.join(', ')}`);
  }

  const wanted = args.length
    ? MANIFEST.plugins.filter((p) => args.includes(p.name))
    : MANIFEST.plugins;
  wanted.forEach(fetchPlugin);
};

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
