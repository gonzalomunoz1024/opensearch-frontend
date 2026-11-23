/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OpenSearchClient, OpenSearchRequest } from '../../server/opensearch';
import { UiSettings } from '../../server/ui_settings';

/** A client that answers with one stored settings document and keeps what it is sent */
function fakeClient(config: Record<string, unknown>) {
  const sent: OpenSearchRequest[] = [];
  const client = {
    raw: async () => ({
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify({ _source: { type: 'config', config } })),
    }),
    request: async (request: OpenSearchRequest) => {
      sent.push(request);
      return {};
    },
  };
  return { client: client as unknown as OpenSearchClient, sent };
}

describe('the advanced settings as stored', () => {
  it('gives back the Timeline settings stored under their old names under the new ones', async () => {
    const { client } = fakeClient({ 'timelion:es.timefield': 'timestamp', 'csv:separator': ';' });
    const settings = new UiSettings(client, '.kibana', '3.9.0', { overrides: {}, defaults: {} });
    assert.deepEqual(await settings.getUserProvided(), {
      'timeline:es.timefield': 'timestamp',
      'csv:separator': ';',
    });
  });

  it('stores the Timeline settings under their old names, as the original does', async () => {
    const { client, sent } = fakeClient({});
    const settings = new UiSettings(client, '.kibana', '3.9.0', { overrides: {}, defaults: {} });
    await settings.setMany({ 'timeline:max_buckets': 100, 'csv:separator': ';' });
    const body = sent[0].body as { doc: { config: Record<string, unknown> } };
    assert.deepEqual(body.doc.config, { 'timelion:max_buckets': 100, 'csv:separator': ';' });
  });
});
