/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Http, HttpFetchError, type FetchOptions } from '../../web/services/http';
import { UiSettingsClient } from '../../web/services/ui_settings';

/**
 * The settings route of the server, which stores what it is sent; while `holding`, it answers
 * only once it is let go, so that a request can be on its way while the page goes on. It can also
 * refuse a request, as the server refuses one with a value its schema does not take: all of it.
 */
class SettingsRoute extends Http {
  readonly posted: Array<Record<string, unknown>> = [];
  /** The message a request is refused with, if it is */
  refuse?: (changes: Record<string, unknown>) => string | undefined;
  holding = false;
  private waiting: Array<() => void> = [];

  constructor(private readonly stored: Record<string, unknown> = {}) {
    super('');
  }

  /** Answers the requests on their way */
  release() {
    const waiting = this.waiting;
    this.waiting = [];
    for (const answer of waiting) answer();
  }

  override async fetch<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
    assert.equal(path, '/api/opensearch-dashboards/settings');
    if (options.method === 'POST') {
      const { changes } = options.body as { changes: Record<string, unknown> };
      this.posted.push(changes);
      if (this.holding) await new Promise<void>((resolve) => this.waiting.push(resolve));
      const refused = this.refuse?.(changes);
      if (refused !== undefined) throw new HttpFetchError(400, refused, undefined, 'Bad Request');
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete this.stored[key];
        else this.stored[key] = value;
      }
    }
    const settings: Record<string, { userValue: unknown }> = {};
    for (const [key, value] of Object.entries(this.stored)) settings[key] = { userValue: value };
    return { settings } as T;
  }
}

/** Lets the promises that are ready run, as the page's next moment would */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The message a promise is refused with, or `undefined` when it is not refused */
async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('a setting set in the browser, as the original sets one', () => {
  it('asks the server once when the same value is set twice before it answers', async () => {
    const route = new SettingsRoute({ defaultRoute: '/app/home' });
    const client = new UiSettingsClient(route, { defaultRoute: '/app/home' }, {}, {});
    route.holding = true;
    // Two clicks on "Make this my landing page": the second comes while the first is on its way
    const first = client.set('defaultRoute', '/app/dashboards');
    const second = client.set('defaultRoute', '/app/dashboards');
    await settle();
    assert.deepEqual(route.posted, [{ defaultRoute: '/app/dashboards' }]);
    route.release();
    await Promise.all([first, second]);
    assert.deepEqual(route.posted, [{ defaultRoute: '/app/dashboards' }]);
    assert.equal(client.get('defaultRoute'), '/app/dashboards');
  });

  it('sends nothing for the value a setting already has', async () => {
    const route = new SettingsRoute({ defaultIndex: 'logs' });
    const client = new UiSettingsClient(route, { defaultIndex: 'logs' }, {}, {});
    await client.set('defaultIndex', 'logs');
    assert.deepEqual(route.posted, []);
  });

  it('holds the value at once, for the page to show while the server is asked', async () => {
    const route = new SettingsRoute();
    const client = new UiSettingsClient(route, {}, {}, {});
    route.holding = true;
    let notified = 0;
    client.subscribe(() => (notified += 1));
    const saving = client.set('defaultRoute', '/app/discover');
    assert.equal(client.get('defaultRoute'), '/app/discover');
    assert.equal(notified, 1);
    // A JSON setting is held as its text, as the original holds it
    const mapping = client.set('visualization:colorMapping', { error: '#ff0000' });
    assert.equal(client.storedValue('visualization:colorMapping'), '{"error":"#ff0000"}');
    assert.deepEqual(client.get('visualization:colorMapping'), { error: '#ff0000' });
    const again = client.set('visualization:colorMapping', '{"error":"#ff0000"}');
    await settle();
    // The second waits for the first to be answered, as the original's queue has it wait
    assert.deepEqual(route.posted, [{ defaultRoute: '/app/discover' }]);
    route.release();
    await settle();
    route.release();
    await Promise.all([saving, mapping, again]);
    assert.deepEqual(route.posted, [
      { defaultRoute: '/app/discover' },
      { 'visualization:colorMapping': { error: '#ff0000' } },
    ]);
  });

  it('puts the value back as it was when the server refuses it, and says why', async () => {
    const route = new SettingsRoute({ 'csv:separator': ';' });
    const client = new UiSettingsClient(route, { 'csv:separator': ';' }, {}, {});
    route.holding = true;
    route.refuse = () => '[validation [defaultRoute]]: Must be a relative URL.';
    const saving = client.set('defaultRoute', 'app/home');
    assert.equal(client.get('defaultRoute'), 'app/home');
    await settle();
    route.release();
    assert.equal(await refusal(saving), '[validation [defaultRoute]]: Must be a relative URL.');
    assert.equal(client.storedValue('defaultRoute'), undefined);
    assert.equal(client.get('defaultRoute'), '/app/home');
    assert.deepEqual(client.storedKeys(), ['csv:separator']);

    // A setting that had a value gets that value back
    const changing = client.set('csv:separator', '|');
    await settle();
    route.release();
    assert.notEqual(await refusal(changing), undefined);
    assert.equal(client.get('csv:separator'), ';');
  });

  it('asks the server to take a setting back to its default even when it has none set', async () => {
    const route = new SettingsRoute();
    const client = new UiSettingsClient(route, {}, {}, {});
    await client.remove('defaultIndex');
    assert.deepEqual(route.posted, [{ defaultIndex: null }]);
  });

  it('refuses a setting the server overrides before it compares or asks anything', async () => {
    const route = new SettingsRoute();
    const client = new UiSettingsClient(route, {}, {}, { defaultRoute: '/app/home' });
    const refused = await refusal(client.set('defaultRoute', '/app/home'));
    assert.match(refused ?? '', /overridden by the OpenSearch Dashboards server/);
    assert.deepEqual(route.posted, []);
  });
});

describe('settings saved by the advanced settings page, as the original saves them', () => {
  const RELATIVE = '[validation [defaultRoute]]: Must be a relative URL.';

  it('sends the first alone and the others together, so only the request refused fails', async () => {
    const route = new SettingsRoute();
    route.holding = true;
    route.refuse = (changes) => ('defaultRoute' in changes ? RELATIVE : undefined);
    const client = new UiSettingsClient(route, {}, {}, {});
    // The page saves each change at once, in the order they were made
    const saves = [
      client.save('csv:separator', ';'),
      client.save('defaultRoute', 'app/home'),
      client.save('csv:quoteValues', false),
    ].map((save) => refusal(save));
    await settle();
    assert.deepEqual(route.posted, [{ 'csv:separator': ';' }]);
    route.release();
    await settle();
    assert.deepEqual(route.posted, [
      { 'csv:separator': ';' },
      { defaultRoute: 'app/home', 'csv:quoteValues': false },
    ]);
    route.release();
    assert.deepEqual(await Promise.all(saves), [undefined, RELATIVE, RELATIVE]);
    // What the server took is saved; what it refused is put back
    assert.equal(client.get('csv:separator'), ';');
    assert.equal(client.storedValue('defaultRoute'), undefined);
    assert.equal(client.get('csv:quoteValues'), true);
    assert.deepEqual(client.storedKeys(), ['csv:separator']);
  });

  it('sends a value even when it is the one held, as the page names a scope', async () => {
    const route = new SettingsRoute({ 'csv:separator': ';' });
    const client = new UiSettingsClient(route, { 'csv:separator': ';' }, {}, {});
    await client.save('csv:separator', ';');
    assert.deepEqual(route.posted, [{ 'csv:separator': ';' }]);
  });

  it('writes a setting of the administrators in a queue of its own', async () => {
    const route = new SettingsRoute();
    route.holding = true;
    const client = new UiSettingsClient(route, {}, {}, {});
    const saves = [
      client.save('csv:separator', ';'),
      client.save('enableAIFeatures', false),
      client.save('dateFormat', 'YYYY'),
    ];
    await settle();
    assert.deepEqual(route.posted, [{ 'csv:separator': ';' }, { enableAIFeatures: false }]);
    route.release();
    await settle();
    route.release();
    await Promise.all(saves);
    assert.deepEqual(route.posted, [
      { 'csv:separator': ';' },
      { enableAIFeatures: false },
      { dateFormat: 'YYYY' },
    ]);
  });

  it('keeps the writes of the page and those of other pages in queues of their own', async () => {
    const route = new SettingsRoute();
    route.holding = true;
    const client = new UiSettingsClient(route, {}, {}, {});
    const writes = [client.set('defaultRoute', '/app/discover'), client.save('csv:separator', ';')];
    await settle();
    assert.deepEqual(route.posted, [{ defaultRoute: '/app/discover' }, { 'csv:separator': ';' }]);
    route.release();
    await Promise.all(writes);
  });
});
