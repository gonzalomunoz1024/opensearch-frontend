/* SPDX-License-Identifier: Apache-2.0 */

/* The kit's shared pieces, drawn as the original's component library draws them. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton } from '../../web/components/basic';
import { ComboBox } from '../../web/components/combo_box';
import { Icon, iconDrawing } from '../../web/components/icon';
import { describedBy, initialModalFocus, placeTooltip } from '../../web/components/overlay';
import { Pagination, pageButtons } from '../../web/components/table';

/**
 * The markup of what holds a popover. React says on every such call that layout effects do not run
 * on the server, which is what is wanted here: nothing is placed, the closed popover is its button.
 */
function markupOf(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  /* eslint-disable no-console */
  const say = console.error;
  console.error = () => undefined;
  try {
    return renderToStaticMarkup(element);
  } finally {
    console.error = say;
  }
  /* eslint-enable no-console */
}

describe('the buttons', () => {
  it('draws the sizes of the original: its small button, the kit\'s own and the smallest', () => {
    assert.match(renderToStaticMarkup(<Button>Save</Button>), /^<button type="button" class="atlButton">Save<\/button>$/);
    assert.match(renderToStaticMarkup(<Button size="s">Save</Button>), /class="atlButton atlButton--s"/);
    assert.match(renderToStaticMarkup(<Button variant="empty" size="xs">Save</Button>), /class="atlButton atlButton--empty atlButton--xs"/);
  });

  it('draws a button of only an icon as the original\'s empty one, and the icon button round', () => {
    const empty = renderToStaticMarkup(<Button variant="empty" icon="refresh" aria-label="Refresh" />);
    assert.match(empty, /class="atlButton atlButton--empty atlButton--icon"/);
    assert.ok(!empty.includes('atlButton--round'));
    const round = renderToStaticMarkup(<IconButton icon="cross" label="Close" className="ownClose" size="xs" />);
    assert.match(round, /class="atlButton atlButton--ghost atlButton--xs atlButton--icon atlButton--round ownClose"/);
    assert.match(round, /aria-label="Close" title="Close"/);
    // A title of its own stays
    const titled = renderToStaticMarkup(<IconButton icon="cross" label="Close" title="Close this" />);
    assert.match(titled, / title="Close this"/);
    assert.match(titled, / aria-label="Close"/);
  });
});

describe('the pages of a table', () => {
  it('offers five pages around the one shown, with the first and the last', () => {
    assert.deepEqual(pageButtons(1, 0), [0]);
    assert.deepEqual(pageButtons(5, 0), [0, 1, 2, 3, 4]);
    assert.deepEqual(pageButtons(10, 0), [0, 1, 2, 3, 4, 'skip', 9]);
    assert.deepEqual(pageButtons(10, 5), [0, 'skip', 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(pageButtons(12, 5), [0, 'skip', 3, 4, 5, 6, 7, 'skip', 11]);
    // A single page left out gets its button, not "…"
    assert.deepEqual(pageButtons(10, 4), [0, 1, 2, 3, 4, 5, 6, 'skip', 9]);
    assert.deepEqual(pageButtons(10, 9), [0, 'skip', 5, 6, 7, 8, 9]);
    assert.deepEqual(pageButtons(0, 0), []);
  });

  it('names its arrows as the original does: the page each leads to, or nothing at an end', () => {
    const first = renderToStaticMarkup(<Pagination page={0} pages={10} onPage={() => undefined} />);
    assert.match(first, /disabled="" aria-label="Previous page" data-test-subj="pagination-button-previous"/);
    assert.match(first, /aria-label="Next page, 2" data-test-subj="pagination-button-next"/);
    const middle = renderToStaticMarkup(<Pagination page={5} pages={12} onPage={() => undefined} />);
    assert.match(middle, /aria-label="Previous page, 5"/);
    assert.match(middle, /aria-label="Next page, 7"/);
    const last = renderToStaticMarkup(<Pagination page={9} pages={10} onPage={() => undefined} />);
    assert.match(last, /aria-label="Previous page, 9"/);
    assert.match(last, /disabled="" aria-label="Next page" data-test-subj="pagination-button-next"/);
  });

  it('names its arrows plainly where the original\'s own translations do, and says what it turns', () => {
    const middle = renderToStaticMarkup(
      <Pagination page={5} pages={12} onPage={() => undefined} arrowNames="plain" controls="theTable" />
    );
    assert.match(middle, /aria-label="Previous page" aria-controls="theTable" data-test-subj="pagination-button-previous"/);
    assert.match(middle, /aria-label="Next page" aria-controls="theTable" data-test-subj="pagination-button-next"/);
    assert.match(middle, /aria-label="Page 5 of 12" aria-controls="theTable" data-test-subj="pagination-button-4"/);
    // An arrow that leads nowhere turns nothing
    const first = renderToStaticMarkup(
      <Pagination page={0} pages={12} onPage={() => undefined} arrowNames="plain" controls="theTable" />
    );
    assert.match(first, /disabled="" aria-label="Previous page" data-test-subj="pagination-button-previous"/);
  });

  it('says which pages "…" skips, and marks the page shown', () => {
    const html = renderToStaticMarkup(<Pagination page={5} pages={12} onPage={() => undefined} />);
    assert.match(html, /aria-label="Skipping pages 2 to 3"/);
    assert.match(html, /aria-label="Skipping pages 9 to 11"/);
    assert.match(html, /disabled="" aria-current="true" aria-label="Page 6 of 12" data-test-subj="pagination-button-5">6</);
    assert.match(html, /aria-label="Page 12 of 12" data-test-subj="pagination-button-11">12</);
  });

  it('offers the sizes of a page only when it is given them, under the class of the page that asks', () => {
    const plain = renderToStaticMarkup(<Pagination page={0} pages={2} onPage={() => undefined} />);
    assert.ok(!plain.includes('tablePaginationPopoverButton'));
    const sized = markupOf(
      <Pagination className="ownPager" page={0} pages={2} onPage={() => undefined} pageSize={20} pageSizes={[10, 20, 50]} onPageSize={() => undefined} />
    );
    assert.match(sized, /^<div class="atlPagination ownPager">/);
    assert.match(sized, /data-test-subj="tablePaginationPopoverButton">Rows per page: (<!-- -->)?20</);
  });
});

describe('the combo box', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];
  /** The classes of the field itself */
  const classOf = (html: string): string => /<div class="(atlField atlCombo[^"]*)"/.exec(html)?.[1] ?? '';

  it('keeps the room of the clear button whenever it can be cleared, and shows the button only with a choice', () => {
    const none = markupOf(<ComboBox options={options} selected={[]} onChange={() => undefined} />);
    assert.match(classOf(none), /\batlCombo--clearable\b/);
    assert.ok(!none.includes('comboBoxClearButton'));
    const chosen = markupOf(<ComboBox options={options} selected={['a']} onChange={() => undefined} />);
    assert.match(classOf(chosen), /\batlCombo--clearable\b/);
    assert.match(chosen, /class="atlCombo__clear" aria-label="Clear input" data-test-subj="comboBoxClearButton"/);
    // Neither when it cannot be cleared, nor when it is disabled
    for (const html of [
      markupOf(<ComboBox options={options} selected={['a']} onChange={() => undefined} clearable={false} />),
      markupOf(<ComboBox options={options} selected={['a']} onChange={() => undefined} disabled />),
    ]) {
      assert.notEqual(classOf(html), '');
      assert.ok(!classOf(html).includes('atlCombo--clearable'));
      assert.ok(!html.includes('comboBoxClearButton'));
    }
  });

  it('draws the spinner of a list on its way before the clear button and the arrow, as the original', () => {
    const html = markupOf(<ComboBox options={options} selected={['a']} onChange={() => undefined} loading />);
    assert.match(classOf(html), /\batlCombo--clearable atlCombo--loading\b/);
    const spinner = html.indexOf('<span class="atlSpinner"></span>');
    const clear = html.indexOf('comboBoxClearButton');
    const caret = html.indexOf('comboBoxToggleListButton');
    assert.ok(spinner > -1 && spinner < clear && clear < caret);
  });

  it('keeps the class of a compact field for a page\'s rules, the field being the same', () => {
    const html = markupOf(<ComboBox options={options} selected={[]} onChange={() => undefined} compact single />);
    assert.equal(classOf(html), 'atlField atlCombo atlCombo--s atlCombo--single atlCombo--clearable');
  });
});

describe('the tooltip', () => {
  const view = { width: 1400, height: 900 };
  const at = (left: number, top: number, width = 24, height = 24) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const own = { width: 128, height: 26 };

  it('stands 16 px over its anchor, centred, or under it when there is no room over it', () => {
    // Discover's "Add field as column", where the original draws it
    assert.deepEqual(placeTooltip(at(247.8, 259), own, view), { left: 195.8, top: 217 });
    assert.deepEqual(placeTooltip(at(600, 20), own, view), { left: 548, top: 60 });
    assert.deepEqual(placeTooltip(at(600, 400), own, view, 'bottom'), { left: 548, top: 440 });
    // Under it only while there is room under it
    assert.deepEqual(placeTooltip(at(600, 850), own, view, 'bottom'), { left: 548, top: 808 });
  });

  it('keeps 16 px from the edges of the window, as the original', () => {
    assert.equal(placeTooltip(at(0, 400), own, view).left, 16);
    assert.equal(placeTooltip(at(1390, 400, 10), own, view).left, 1400 - 128 - 16);
    // There is no room over its anchor when it would come nearer than 16 px to the top
    assert.equal(placeTooltip(at(600, 57), own, view).top, 97);
    assert.equal(placeTooltip(at(600, 58), own, view).top, 16);
    // On the right while it keeps 16 px from that edge, else over its anchor
    assert.deepEqual(placeTooltip(at(100, 400), own, view, 'right'), { left: 140, top: 399 });
    assert.equal(placeTooltip(at(1240, 400), own, view, 'right').top, 400 - 26 - 16);
  });

  it('describes what it is about while it shows, after its own description', () => {
    assert.equal(describedBy(undefined, ':r1:', false), undefined);
    assert.equal(describedBy('help', ':r1:', false), 'help');
    assert.equal(describedBy(undefined, ':r1:', true), ':r1:');
    assert.equal(describedBy('help', ':r1:', true), 'help :r1:');
  });
});

describe('the focus of a dialog when it opens', () => {
  const element = (inside: unknown[] = [], marked?: unknown) => {
    const self = {
      focus: () => undefined,
      contains: (node: unknown) => node === self || inside.includes(node),
      querySelector: (selector: string) => (selector === '[data-autofocus]' ? (marked ?? null) : null),
    };
    return self;
  };

  it('stays where a field of the dialog took it, else goes to what is marked, else to the dialog', () => {
    const field = { name: 'title' } as unknown as Node;
    const button = { focus: () => undefined };
    const opener = { name: 'opener' } as unknown as Node;
    assert.equal(initialModalFocus(element([field]), field), null);
    assert.equal(initialModalFocus(element([button], button), opener), button);
    const plain = element();
    assert.equal(initialModalFocus(plain, opener), plain);
    assert.equal(initialModalFocus(plain, null), plain);
  });
});

describe('the icons the original names', () => {
  it("draws the original's logoGithub on its 32 grid", () => {
    const drawing = iconDrawing('logoGithub');
    assert.equal(drawing?.viewBox, '0 0 32 32');
    assert.equal(drawing?.drawn, 'logoGithub');
    const html = renderToStaticMarkup(<Icon name="logoGithub" size="s" />);
    assert.match(html, /viewBox="0 0 32 32"/);
    assert.match(html, /d="M16 0C7\.164 0 0 7\.343 0 16\.4c0 7\.248/);
  });
});
