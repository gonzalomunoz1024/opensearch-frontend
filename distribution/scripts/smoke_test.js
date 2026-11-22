/* SPDX-License-Identifier: Apache-2.0 */

/**
 * Checks a running InfraDashboard the way a person would meet it: the server is up and green,
 * the plugins of distribution/plugins.json are loaded and the ones it leaves out are not, the
 * product opens under our name without a sign-in, and saved objects can be read and written by
 * whoever reaches it.
 *
 *   node distribution/scripts/smoke_test.js [--url http://localhost:5601] [--core-only]
 *                                           [--timeout 300]
 *
 * --core-only skips the plugins that ship, for the Dashboards source run without plugins.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const url = option('url', 'http://localhost:5601').replace(/\/$/, '');
const timeoutSeconds = Number(option('timeout', '300'));

const brand = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../branding/brand.json'), 'utf8')
);
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../plugins.json'), 'utf8'));

const failures = [];
const check = (ok, what, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(what);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The status document once the server answers with one, or the last failure after the timeout. */
async function waitForStatus() {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/status`);
      if (response.ok) {
        const body = await response.json();
        if (body.status.overall.state === 'green') return body;
        last = `overall state ${body.status.overall.state}`;
      } else {
        // 401 here means something asks for a sign-in, which this distribution does not have
        last = `HTTP ${response.status}`;
      }
    } catch (error) {
      last = error.cause ? String(error.cause.code || error.cause) : String(error);
    }
    await sleep(3000);
  }
  throw new Error(`${url}/api/status was not green within ${timeoutSeconds}s (${last})`);
}

async function main() {
  const status = await waitForStatus();
  check(true, `server is green at ${url}, and says so to a caller who has not signed in`);
  check(
    status.version.number === manifest.dashboardsVersion,
    `version is ${manifest.dashboardsVersion}`,
    `got ${status.version.number}`
  );

  // the server reports only the plugins that are on
  const states = new Map(
    status.status.statuses.map(({ id, state }) => [id.replace(/^plugin:|@.*$/g, ''), state])
  );
  if (!flag('core-only')) {
    for (const { name, enabledBy } of manifest.plugins) {
      if (enabledBy && !states.has(name)) {
        check(true, `plugin ${name} is off, as it ships (${enabledBy} turns it on)`);
        continue;
      }
      check(
        states.get(name) === 'green',
        `plugin ${name} is loaded`,
        states.get(name) || 'missing'
      );
    }
  }
  const present = manifest.leftOut.map(({ name }) => name).filter((name) => states.has(name));
  check(
    present.length === 0,
    `none of the ${manifest.leftOut.length} plugins the distribution leaves out is loaded`,
    present.join(', ')
  );

  const page = await fetch(`${url}/app/home`, { redirect: 'manual' });
  const html = await page.text();
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  check(
    page.status === 200 && title === brand.name,
    `the product opens without a sign-in, titled "${brand.name}"`,
    `HTTP ${page.status}${page.headers.get('location') ? ` to ${page.headers.get('location')}` : ''}, "${title}"`
  );

  const favicon = await fetch(`${url}/ui/favicons/favicon.ico`);
  check(favicon.ok, 'favicon is served', `HTTP ${favicon.status}`);

  const signIn = await fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'osd-xsrf': 'true' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  check(signIn.status === 404, 'there is no sign-in to post to', `HTTP ${signIn.status}`);

  const json = { 'content-type': 'application/json', 'osd-xsrf': 'true' };
  const savedObjects = await fetch(`${url}/api/saved_objects/_find?type=dashboard&per_page=1`);
  check(savedObjects.ok, 'saved objects can be read', `HTTP ${savedObjects.status}`);

  // written and removed again, so a check leaves nothing behind
  const object = `${url}/api/saved_objects/query/infradashboard-smoke-test`;
  const written = await fetch(`${object}?overwrite=true`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      attributes: {
        title: 'InfraDashboard smoke test',
        description: 'Written and removed by distribution/scripts/smoke_test.js',
        query: { language: 'kuery', query: '' },
      },
    }),
  });
  check(written.ok, 'saved objects can be written', `HTTP ${written.status}`);
  if (written.ok) {
    const removed = await fetch(object, { method: 'DELETE', headers: json });
    check(removed.ok, 'and removed again', `HTTP ${removed.status}`);
  }

  if (failures.length) {
    throw new Error(`${failures.length} check(s) failed`);
  }
  console.log('All checks passed.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
