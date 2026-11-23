/* SPDX-License-Identifier: Apache-2.0 */

/* The kit's shared pieces, drawn as the original's component library draws them. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton } from '../../web/components/basic';
import { ComboBox } from '../../web/components/combo_box';
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
