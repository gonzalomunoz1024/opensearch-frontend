/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leadingDebounce } from '../../web/apps/index_management/jobs';

/** A clock whose time goes on only when told, with the timers set on it */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimeout: (run: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (handle: unknown) => {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
  };
}

describe('asking for the rows of a list as the plugin does', () => {
  it('asks at once the first time', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const debounced = leadingDebounce((what: string) => calls.push(what), 500, clock);
    debounced.call('first');
    assert.deepEqual(calls, ['first']);
    clock.advance(500);
    assert.deepEqual(calls, ['first']);
  });

  it('asks once more, with the last arguments, half a second after the last of the changes that follow', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const debounced = leadingDebounce((what: string) => calls.push(what), 500, clock);
    debounced.call('a');
    clock.advance(100);
    debounced.call('b');
    clock.advance(300);
    debounced.call('c');
    clock.advance(499);
    assert.deepEqual(calls, ['a']);
    clock.advance(1);
    assert.deepEqual(calls, ['a', 'c']);
  });

  it('asks at once again once half a second has passed without a change', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const debounced = leadingDebounce((what: string) => calls.push(what), 500, clock);
    debounced.call('a');
    clock.advance(600);
    debounced.call('b');
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('forgets what was waiting when cancelled', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const debounced = leadingDebounce((what: string) => calls.push(what), 500, clock);
    debounced.call('a');
    debounced.call('b');
    debounced.cancel();
    assert.equal(clock.pending(), 0);
    clock.advance(1000);
    assert.deepEqual(calls, ['a']);
    debounced.call('c');
    assert.deepEqual(calls, ['a', 'c']);
  });
});
