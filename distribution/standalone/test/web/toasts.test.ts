/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The toast service's plain message, as OpenSearch Dashboards 3.9.0's toasts.add of a text: no
 * colour and no icon, kept as long as a message for information (notifications:lifetime:info).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Toasts } from '../../web/services/toasts';

// The waits the service asks the browser for, which these tests only record
const withTimers = (run: (timers: number[]) => void) => {
  const timers: number[] = [];
  const globals = globalThis as { window?: unknown };
  globals.window = { setTimeout: (_run: () => void, wait: number) => timers.push(wait) };
  try {
    run(timers);
  } finally {
    delete globals.window;
  }
};

describe('the toast service\'s plain message, as the original\'s toasts.add of a text', () => {
  it('is of its own kind, with the title alone, and stays as long as one for information', () =>
    withTimers((timers) => {
      const toasts = new Toasts();
      toasts.lifetimes.info = 7000;
      toasts.plain('Request copied as cURL');
      const [shown] = toasts.get();
      assert.equal(shown.kind, 'plain');
      assert.equal(shown.title, 'Request copied as cURL');
      assert.equal(shown.text, undefined);
      assert.deepEqual(timers, [7000]);
    }));

  it('stays as long as it is told to, when told', () =>
    withTimers((timers) => {
      const toasts = new Toasts();
      toasts.plain('No request selected. Select a request by placing the cursor inside it.', undefined, 60000);
      assert.deepEqual(timers, [60000]);
    }));

  it('replaces the same message still showing, as the other kinds do', () =>
    withTimers(() => {
      const toasts = new Toasts();
      const first = toasts.plain('Request copied as cURL');
      const second = toasts.plain('Request copied as cURL');
      assert.notEqual(second, first);
      assert.deepEqual(
        toasts.get().map((toast) => toast.id),
        [second]
      );
    }));
});
