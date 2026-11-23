/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Http, HttpFetchError, type FetchOptions } from '../../web/services/http';
import { UiSettingsClient } from '../../web/services/ui_settings';

/**
 * The settings route of the server, which stores what it is sent; while `holding`, it answers
 * only once it is let go, so that a request can be on its way while the page goes on. It can also
 * refuse a request, as the server refuses a value its schema does not take.
 */
class SettingsRoute extends Http {
  readonly posted: Array<Record<string, unknown>> = [];
  refuse?: string;
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
      if (this.refuse) throw new HttpFetchError(400, this.refuse, undefined, 'Bad Request');
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
    route.refuse = '[validation [defaultRoute]]: Must be a relative URL.';
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
