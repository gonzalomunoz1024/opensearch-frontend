/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The page's own rules, against the original's: its root element (`.coreSystemRootDomElement`, the
 * body), the Atlas theme's focus ring and page ground, the reset every heading gets, and the rules
 * `accessibility:disableAnimations` adds (`disable_animations.css`).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const sheet = readFileSync('web/styles/base.css', 'utf8');

/** The declarations of the rule whose selector is exactly `selector`, as `property: value` */
function declarationsOf(selector: string): string[] {
  const start = sheet.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} has a rule`);
  const body = sheet.slice(sheet.indexOf('{', start) + 1, sheet.indexOf('}', start));
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

describe('the page', () => {
  it('never scrolls sideways and fills the window, as the original’s root element', () => {
    const body = declarationsOf('body');
    for (const rule of ['overflow-x: hidden', 'min-width: 100%', 'min-height: 100%']) {
      assert.ok(body.includes(rule), rule);
    }
  });

  it('has its ground on the root, and a body that lets it through', () => {
    assert.ok(declarationsOf('html').includes('background-color: var(--color-surface)'));
    assert.equal(declarationsOf('body').filter((rule) => rule.startsWith('background')).length, 0);
  });

  it('rings what has the keyboard’s focus 2 pixels out, as the Atlas theme', () => {
    const ring = declarationsOf(':focus-visible');
    assert.ok(ring.includes('outline: 2px solid var(--color-accent)'));
    assert.ok(ring.includes('outline-offset: 2px'));
  });

  it('gives a heading kept for screen readers the text’s face, as the original’s reset does', () => {
    assert.ok(declarationsOf('.atlScreenReaderOnly').includes('font: inherit'));
  });

  it('kerns its text with the font’s own kerning, as the original’s reset', () => {
    assert.ok(declarationsOf('body').includes('font-kerning: normal'));
  });

  it('draws the scroll bars’ thumb in the subdued text’s colour at half strength, as the Atlas theme', () => {
    assert.deepEqual(declarationsOf('*'), [
      'scrollbar-width: thin',
      'scrollbar-color: color-mix(in srgb, var(--color-text-secondary) 50%, transparent) transparent',
    ]);
  });
});

describe('accessibility:disableAnimations', () => {
  it('cuts every animation and transition to nothing but the essential ones, as the original', () => {
    const selector = [
      '.reduceMotion *:not(.essentialAnimation),',
      '.reduceMotion *:not(.essentialAnimation)::before,',
      '.reduceMotion *:not(.essentialAnimation)::after',
    ].join('\n');
    assert.deepEqual(declarationsOf(selector), [
      'animation-duration: 0s !important',
      'transition-duration: 0s !important',
      'transition-delay: 0s !important',
    ]);
  });
});
