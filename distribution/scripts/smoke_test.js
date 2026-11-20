/* SPDX-License-Identifier: Apache-2.0 */

/**
 * Checks a running InfraDashboard the way a person would meet it: the server is up and green,
 * every plugin of distribution/plugins.json is loaded (one that ships switched off may be off),
 * the sign-in page carries our name, and a user can sign in and read saved objects.
 *
 *   node distribution/scripts/smoke_test.js [--url http://localhost:5601] [--user admin]
 *                                           [--no-security] [--core-only] [--timeout 300]
 *
 * The password comes from SMOKE_TEST_PASSWORD, else OPENSEARCH_INITIAL_ADMIN_PASSWORD.
 * --no-security is for a cluster without the security plugin (docker/dev/docker-compose.yml);
 * --core-only skips the plugin list, for the Dashboards source run without plugins.
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
const user = option('user', 'admin');
const password = process.env.SMOKE_TEST_PASSWORD || process.env.OPENSEARCH_INITIAL_ADMIN_PASSWORD;
const secured = !flag('no-security');
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

const basicAuth = () =>
  secured
    ? { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
    : {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The status document once the server answers with one, or the last failure after the timeout. */
async function waitForStatus() {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/status`, { headers: basicAuth() });
      if (response.ok) {
        const body = await response.json();
        if (body.status.overall.state === 'green') return body;
        last = `overall state ${body.status.overall.state}`;
      } else {
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
  if (secured && !password) {
    throw new Error(
      'Set SMOKE_TEST_PASSWORD (or OPENSEARCH_INITIAL_ADMIN_PASSWORD), or pass --no-security'
    );
  }

  const status = await waitForStatus();
  check(true, `server is green at ${url}`);
  check(
    status.version.number === manifest.dashboardsVersion,
    `version is ${manifest.dashboardsVersion}`,
    `got ${status.version.number}`
  );

  if (!flag('core-only')) {
    const states = new Map(
      status.status.statuses.map(({ id, state }) => [id.replace(/^plugin:|@.*$/g, ''), state])
    );
    for (const { name, enabledBy } of manifest.plugins) {
      if (!secured && name === 'securityDashboards') continue;
      // the server reports only the plugins that are on
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

  const page = await fetch(`${url}${secured ? '/app/login' : '/app/home'}`, {
    headers: basicAuth(),
  });
  const html = await page.text();
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  check(
    page.ok && title === brand.name,
    `page title is "${brand.name}"`,
    `HTTP ${page.status}, "${title}"`
  );

  const favicon = await fetch(`${url}/ui/favicons/favicon.ico`);
  check(favicon.ok, 'favicon is served', `HTTP ${favicon.status}`);

  let session = {};
  if (secured) {
    const signIn = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'osd-xsrf': 'true' },
      body: JSON.stringify({ username: user, password }),
    });
    const cookies = signIn.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
    check(signIn.ok && cookies.length > 0, `${user} can sign in`, `HTTP ${signIn.status}`);
    session = { cookie: cookies.join('; ') };

    const refused = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'osd-xsrf': 'true' },
      body: JSON.stringify({ username: user, password: `${password}-wrong` }),
    });
    check(refused.status === 401, 'a wrong password is refused', `HTTP ${refused.status}`);
  }

  const savedObjects = await fetch(`${url}/api/saved_objects/_find?type=dashboard&per_page=1`, {
    headers: session,
  });
  check(savedObjects.ok, 'saved objects can be read', `HTTP ${savedObjects.status}`);

  if (failures.length) {
    throw new Error(`${failures.length} check(s) failed`);
  }
  console.log('All checks passed.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
