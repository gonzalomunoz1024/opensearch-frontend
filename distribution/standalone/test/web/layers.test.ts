/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLayerStack, isTextField, wrapTab, type EscapeEvent } from '../../web/components/layers';

const element = (tagName: string, type?: string, isContentEditable?: boolean) => ({
  tagName,
  isContentEditable,
  getAttribute: (name: string) => (name === 'type' ? (type ?? null) : null),
});

function key(name: string, prevented = false): EscapeEvent & { prevented: boolean } {
  const event = {
    key: name,
    defaultPrevented: prevented,
    prevented,
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
}

describe('the layers over the page', () => {
  it('closes only the one on top with Escape, as the original focus traps do', () => {
    const layers = createLayerStack();
    const closed: string[] = [];
    layers.push({ escape: () => closed.push('flyout') });
    const popover = layers.push({ escape: () => closed.push('popover') });
    const event = key('Escape');
    layers.onKeyDown(event);
    assert.deepEqual(closed, ['popover']);
    assert.ok(event.prevented);
    // The popover closed and left the stack: the next Escape is the flyout's
    popover();
    layers.onKeyDown(key('Escape'));
    assert.deepEqual(closed, ['popover', 'flyout']);
  });

  it('leaves a key that is not Escape, and an Escape something else has used', () => {
    const layers = createLayerStack();
    const closed: string[] = [];
    layers.push({ escape: () => closed.push('modal') });
    layers.onKeyDown(key('Enter'));
    const used = key('Escape', true);
    layers.onKeyDown(used);
    assert.deepEqual(closed, []);
    layers.onKeyDown(key('Esc'));
    assert.deepEqual(closed, ['modal']);
  });

  it('takes a layer away from the middle, and does nothing with nothing open', () => {
    const layers = createLayerStack();
    const closed: string[] = [];
    const first = layers.push({ escape: () => closed.push('first') });
    const second = layers.push({ escape: () => closed.push('second') });
    layers.push({ escape: () => closed.push('third') });
    second();
    assert.equal(layers.size(), 2);
    layers.onKeyDown(key('Escape'));
    assert.deepEqual(closed, ['third']);
    first();
    // Taking a layer away twice changes nothing
    first();
    assert.equal(layers.size(), 1);
    const empty = createLayerStack();
    const event = key('Escape');
    empty.onKeyDown(event);
    assert.equal(event.prevented, false);
    assert.equal(empty.top(), undefined);
  });
});

describe('Tab in a popover that holds the focus', () => {
  const items = ['search', 'first', 'second'];

  it('goes from the last to the first and back', () => {
    assert.equal(wrapTab(items, 'second', false), 'search');
    assert.equal(wrapTab(items, 'search', true), 'second');
  });

  it('leaves the browser its own step between the ends', () => {
    assert.equal(wrapTab(items, 'search', false), undefined);
    assert.equal(wrapTab(items, 'first', true), undefined);
  });

  it('goes round the panel itself when it is first, as the original focus trap', () => {
    const round = ['panel', ...items];
    assert.equal(wrapTab(round, 'second', false), 'panel');
    assert.equal(wrapTab(round, 'panel', true), 'second');
    assert.equal(wrapTab(round, 'panel', false), undefined);
    // A panel with nothing in it keeps the focus
    assert.equal(wrapTab(['panel'], 'panel', false), 'panel');
  });

  it('goes in from anything that is not among them, at the first or the last', () => {
    assert.equal(wrapTab(items, 'elsewhere', false), 'search');
    assert.equal(wrapTab(items, null, true), 'second');
    assert.equal(wrapTab([], 'elsewhere', false), undefined);
  });
});

describe('a popover opened from a field', () => {
  it('knows the fields text is typed in, which keep the focus', () => {
    assert.ok(isTextField(element('INPUT')));
    assert.ok(isTextField(element('input', 'search')));
    assert.ok(isTextField(element('INPUT', 'Number')));
    assert.ok(isTextField(element('TEXTAREA')));
    assert.ok(isTextField(element('DIV', undefined, true)));
  });

  it('lets the panel take the focus from a button, a box or a switch', () => {
    assert.equal(isTextField(element('BUTTON')), false);
    assert.equal(isTextField(element('INPUT', 'checkbox')), false);
    assert.equal(isTextField(element('INPUT', 'radio')), false);
    assert.equal(isTextField(element('A')), false);
    assert.equal(isTextField(null), false);
  });
});
