/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INDEX_PATTERN_QUERY,
  WELCOME_KEY,
  isNewInstance,
  putWelcomeAside,
  welcomeEnabled,
  type WelcomeStorage,
} from '../../web/apps/home_welcome';

const memoryStorage = (initial: Record<string, string> = {}): WelcomeStorage & { items: Record<string, string> } => {
  const items = { ...initial };
  return {
    items,
    getItem: (key) => (key in items ? items[key] : null),
    setItem: (key, value) => {
      items[key] = value;
    },
  };
};

const failingStorage: WelcomeStorage = {
  getItem: () => {
    throw new Error('storage is off');
  },
  setItem: () => {
    throw new Error('storage is off');
  },
};

describe('the welcome screen of the first page', () => {
  it('may show unless the settings turn it off or the user put it aside', () => {
    assert.equal(welcomeEnabled(false, memoryStorage()), true);
    assert.equal(welcomeEnabled(true, memoryStorage()), false);
    assert.equal(welcomeEnabled(false, memoryStorage({ [WELCOME_KEY]: 'false' })), false);
    // Only the word the original writes puts it aside
    assert.equal(welcomeEnabled(false, memoryStorage({ [WELCOME_KEY]: 'true' })), true);
    assert.equal(welcomeEnabled(false, failingStorage), true);
    assert.equal(welcomeEnabled(false, undefined), true);
  });

  it('is put aside under the key the original uses', () => {
    const storage = memoryStorage();
    putWelcomeAside(storage);
    assert.deepEqual(storage.items, { 'home:welcome:show': 'false' });
    assert.equal(welcomeEnabled(false, storage), false);
    // A browser that keeps nothing is no error: the screen shows again next time
    putWelcomeAside(failingStorage);
    putWelcomeAside(undefined);
  });

  it('asks for one index pattern of any title, as the original does', () => {
    assert.deepEqual(INDEX_PATTERN_QUERY, {
      type: 'index-pattern',
      fields: ['title'],
      search: '*',
      searchFields: ['title'],
      perPage: 1,
    });
  });

  it('tells a new instance by its having no index pattern', async () => {
    assert.equal(await isNewInstance(() => Promise.resolve({ total: 0 })), true);
    assert.equal(await isNewInstance(() => Promise.resolve({ total: 2 })), false);
  });

  it('counts a failed or late answer as not new, so that the page shows itself', async () => {
    assert.equal(await isNewInstance(() => Promise.reject(new Error('Bad Gateway'))), false);
    const late = () => new Promise<{ total: number }>((resolve) => setTimeout(() => resolve({ total: 0 }), 60));
    assert.equal(await isNewInstance(late, 10), false);
  });
});
