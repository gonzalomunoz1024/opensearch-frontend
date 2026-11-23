/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The save dialog every page shares, as the original's `SavedObjectSaveModal`: what it asks while
 * a save runs is ignored, as the original ignores extra clicks while it is loading.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saveOnce } from '../../web/shell/saved_objects_ui';

describe('the save modal', () => {
  it('saves once when it is asked again while it saves, as Enter pressed twice in the title asks', async () => {
    const running = { current: false };
    const pending: Array<() => void> = [];
    const finish = () => pending.splice(0).forEach((resolve) => resolve());
    const save = () => new Promise<void>((resolve) => pending.push(() => resolve()));
    let saves = 0;
    const counted = () => {
      saves += 1;
      return save();
    };
    const first = saveOnce(running, counted);
    const second = saveOnce(running, counted);
    finish();
    await Promise.all([first, second]);
    assert.equal(saves, 1);
    // Once it is done, the next save runs
    const third = saveOnce(running, counted);
    finish();
    await third;
    assert.equal(saves, 2);
  });

  it('can save again after a save failed', async () => {
    const running = { current: false };
    let failed = false;
    await saveOnce(running, async () => {
      throw new Error('refused');
    }).catch(() => {
      failed = true;
    });
    assert.equal(failed, true);
    assert.equal(running.current, false);
  });
});
