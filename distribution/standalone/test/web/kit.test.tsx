/* SPDX-License-Identifier: Apache-2.0 */

/* The kit's shared pieces, drawn as the original's component library draws them. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
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
