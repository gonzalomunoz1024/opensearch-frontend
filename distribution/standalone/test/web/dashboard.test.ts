/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compact, findPlace, nextPanelIndex, placeItem, type GridItem, type PanelState } from '../../web/apps/dashboard/model';
import { makeTurns, waitTurn } from '../../web/vis/turns';

const at = (items: GridItem[], id: string) => {
  const item = items.find((candidate) => candidate.i === id);
  return item ? [item.x, item.y, item.w, item.h] : undefined;
};

describe('the grid of a dashboard', () => {
  it('lets panels rise as far as those above allow', () => {
    const layout = compact([
      { i: 'a', x: 0, y: 5, w: 24, h: 10 },
      { i: 'b', x: 0, y: 40, w: 24, h: 10 },
      { i: 'c', x: 24, y: 3, w: 24, h: 6 },
    ]);
    assert.deepEqual(at(layout, 'a'), [0, 0, 24, 10]);
    assert.deepEqual(at(layout, 'b'), [0, 10, 24, 10]);
    assert.deepEqual(at(layout, 'c'), [24, 0, 24, 6]);
  });

  it('keeps a panel inside its 48 columns', () => {
    assert.deepEqual(at(compact([{ i: 'a', x: 40, y: 0, w: 24, h: 10 }]), 'a'), [24, 0, 24, 10]);
  });

  it('moves the others out of the way of a panel that is dropped on them', () => {
    const layout = placeItem(
      [
        { i: 'a', x: 0, y: 0, w: 24, h: 10 },
        { i: 'b', x: 24, y: 0, w: 24, h: 10 },
      ],
      { i: 'b', x: 0, y: 0, w: 24, h: 10 }
    );
    assert.deepEqual(at(layout, 'b'), [0, 0, 24, 10]);
    assert.deepEqual(at(layout, 'a'), [0, 10, 24, 10]);
  });

  it('holds a panel to its smallest size', () => {
    const layout = placeItem([{ i: 'a', x: 0, y: 0, w: 24, h: 10 }], { i: 'a', x: 0, y: 0, w: 1, h: 1 });
    assert.deepEqual(at(layout, 'a'), [0, 0, 4, 4]);
  });

  it('finds a new panel the first free place, reading like a page', () => {
    assert.deepEqual(findPlace([]), { x: 0, y: 0 });
    assert.deepEqual(findPlace([{ i: 'a', x: 0, y: 0, w: 24, h: 15 }]), { x: 24, y: 0 });
    assert.deepEqual(
      findPlace([
        { i: 'a', x: 0, y: 0, w: 24, h: 15 },
        { i: 'b', x: 24, y: 0, w: 24, h: 10 },
      ]),
      { x: 24, y: 10 }
    );
    assert.deepEqual(
      findPlace([
        { i: 'a', x: 0, y: 0, w: 24, h: 15 },
        { i: 'b', x: 24, y: 0, w: 24, h: 15 },
      ]),
      { x: 0, y: 15 }
    );
  });

  it('numbers a new panel after the highest', () => {
    assert.equal(nextPanelIndex([]), '1');
    assert.equal(nextPanelIndex([{ panelIndex: '3' }, { panelIndex: '12' }, { panelIndex: 'abc' }] as PanelState[]), '13');
  });
});

describe('the turns charts take to draw', () => {
  it('make a chart wait for those before it', async () => {
    const turns = makeTurns(['a', 'b', 'c']);
    const drawn: string[] = [];
    const wait = (id: string) =>
      waitTurn(turns.get(id), 5000).then(() => {
        drawn.push(id);
        turns.get(id)?.done();
      });
    // Their data arrives in the opposite order
    const all = [wait('c'), wait('b')];
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(drawn, []);
    all.push(wait('a'));
    await Promise.all(all);
    assert.deepEqual(drawn, ['a', 'b', 'c']);
  });

  it('do not hold a chart for long', async () => {
    const turns = makeTurns(['slow', 'next']);
    const started = Date.now();
    await waitTurn(turns.get('next'), 30);
    assert.ok(Date.now() - started >= 25);
    await waitTurn(undefined);
  });
});
