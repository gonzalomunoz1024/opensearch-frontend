/* SPDX-License-Identifier: Apache-2.0 */

/* The kit's shared pieces, drawn as the original's component library draws them. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton, Spinner, Tabs } from '../../web/components/basic';
import { CodeEditor, lineStartOf } from '../../web/components/code_editor';
import { ComboBox } from '../../web/components/combo_box';
import { Icon, iconDrawing } from '../../web/components/icon';
import { ContextMenu, describedBy, initialModalFocus, placeTooltip } from '../../web/components/overlay';
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

/**
 * What a rule of the kit's style sheet declares, the rule named by all its selectors as written (not
 * a rule whose list ends with them)
 */
function declarationsOf(selectors: string): string {
  const sheet = readFileSync('web/styles/components.css', 'utf8');
  let start = sheet.indexOf(`\n${selectors} {`);
  while (start > 0 && sheet[start - 1] === ',') start = sheet.indexOf(`\n${selectors} {`, start + 1);
  assert.ok(start >= 0, `${selectors} has a rule`);
  return sheet.slice(start, sheet.indexOf('}', start));
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

  it('is a link to an address outside the product, in a new tab that cannot reach this one', () => {
    assert.equal(
      renderToStaticMarkup(<Button href="https://example.com/docs" target="_blank">Learn more</Button>),
      '<a class="atlButton" href="https://example.com/docs" target="_blank" rel="noopener noreferrer">Learn more</a>'
    );
    assert.equal(
      renderToStaticMarkup(<Button href="https://example.com/docs">Learn more</Button>),
      '<a class="atlButton" href="https://example.com/docs">Learn more</a>'
    );
    // A disabled one is a button, as one with a path of the product
    assert.match(renderToStaticMarkup(<Button href="https://example.com/docs" disabled>Learn more</Button>), /^<button type="button" class="atlButton" disabled="">/);
  });
});

describe('the fields and boxes, as the original draws them', () => {
  it('starts the text of a compressed field 8 px in, as the original, whose edge is drawn inside it', () => {
    // The kit's edge is a 1 px border, the original's a ring inside the field: 7 px and the border
    assert.match(declarationsOf('.atlField--s'), /padding: 0 calc\(var\(--space-2\) - 1px\);/);
    assert.match(declarationsOf('.atlField--s.atlFieldGroup'), /padding: 0 calc\(var\(--space-2\) - 1px\);/);
  });

  it('starts the text of a field of the usual size 12 px in, as the original', () => {
    assert.match(declarationsOf('.atlField'), /padding: 0 calc\(var\(--space-3\) - 1px\);/);
  });

  it('draws the panel of a popover as the theme draws the original\'s: corners of 16 px, opaque', () => {
    const panel = declarationsOf('.atlPopover');
    assert.match(panel, /border-radius: var\(--radius-lg\);/);
    assert.match(panel, /background-color: var\(--color-surface\);/);
    assert.match(panel, /backdrop-filter: none;/);
  });

  it('draws its tick boxes and radios itself, with the original\'s tick and dot', () => {
    const own = declarationsOf('.atlCheckbox input,\n.atlRadio input');
    assert.match(own, /appearance: none;/);
    assert.match(own, /border: 1px solid var\(--color-border\);/);
    assert.match(declarationsOf('.atlCheckbox input:checked'), /M\.375 2\.625L3\.375 5\.625M3\.375 5\.625L8\.625\.375/);
    assert.match(declarationsOf('.atlRadio input:checked'), /circle cx='8' cy='11' r='3'/);
    assert.match(declarationsOf('.atlCheckbox input:focus,\n.atlRadio input:focus'), /box-shadow: 0 0 0 3px var\(--color-focus-ring\);/);
  });

  it("puts a code editor's test id on what holds its text, as the original's", () => {
    for (const readOnly of [false, true]) {
      const html = markupOf(<CodeEditor value="{}" testId="codeEditorContainer" readOnly={readOnly} />);
      assert.match(html, /^<div class="atlCodeEditor[^"]*"[^>]* data-test-subj="codeEditorContainer">/);
      assert.equal(html.split('data-test-subj=').length, 2);
    }
  });

  it("reads the line of a text's first offset as starting there, as the original's editor", () => {
    assert.equal(lineStartOf('\nabc', 0), 0);
    assert.equal(lineStartOf('\nabc', 1), 1);
    assert.equal(lineStartOf('ab\ncd', 4), 3);
    assert.equal(lineStartOf('abc', 2), 0);
  });

  it('draws its tabs as the theme draws the original\'s: pills, the one shown on the secondary surface', () => {
    const tabs = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ];
    assert.match(renderToStaticMarkup(<Tabs tabs={tabs} selected="a" />), /^<div class="atlTabs" role="tablist">/);
    assert.match(renderToStaticMarkup(<Tabs tabs={tabs} selected="a" size="s" />), /^<div class="atlTabs atlTabs--s" role="tablist">/);
    assert.ok(!declarationsOf('.atlTabs').includes('border-bottom'));
    assert.match(declarationsOf('.atlTab'), /border-radius: var\(--radius-sm\);/);
    assert.match(declarationsOf('.atlTab[aria-selected="true"]'), /background: var\(--color-surface-secondary\);/);
    assert.match(declarationsOf('.atlTabs--s .atlTab'), /padding: var\(--space-1\) 10px;/);
  });

  it('spins in the sizes of the original: "l" 24 px, "xl" 32 px', () => {
    assert.equal(renderToStaticMarkup(<Spinner size="xl" />), '<span class="atlSpinner atlSpinner--xl" role="progressbar"></span>');
    assert.match(declarationsOf('.atlSpinner--l,\n.atlSpinner--xl'), /width: 24px;/);
    assert.match(declarationsOf('.atlSpinner--xl'), /width: 32px;/);
  });

  it('lets a dialog be three quarters of the window high inside its border, as the original', () => {
    assert.match(declarationsOf('.atlModal'), /max-height: calc\(75vh \+ 2px\);/);
  });

  it('sets the arrows of its pages in the font of the page buttons, as the original', () => {
    const arrow = declarationsOf('.atlPagination__arrow');
    assert.match(arrow, /font-size: var\(--font-size-s\);/);
    assert.match(arrow, /font-weight: var\(--font-weight-medium\);/);
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

describe('the context menu', () => {
  const panels = [{ id: 'main', items: [{ id: 'one', label: 'One', onClick: () => undefined }] }];

  it('is a panel of items as wide as they are, or, given a width, the original\'s menu of panels', () => {
    assert.match(markupOf(<ContextMenu panels={panels} />), /^<div class="atlContextMenu" role="menu">/);
    assert.match(markupOf(<ContextMenu panels={panels} width={256} />), /^<div class="atlContextMenu atlContextMenu--framed" style="width:256px" role="menu">/);
    // Its rows cut at its round corners, as the original's
    const framed = declarationsOf('.atlContextMenu--framed');
    assert.match(framed, /overflow: hidden;/);
    assert.match(framed, /border-radius: var\(--radius-lg\);/);
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

  it('makes what is typed as wide as its text, so that it never holds the combo box wide, as the original', () => {
    const input = declarationsOf('.atlCombo > input');
    assert.match(input, /field-sizing: content;/);
    assert.match(input, /min-width: 2px;/);
    // Where a browser cannot size it to its text, a letter wide while empty, not twenty
    assert.match(markupOf(<ComboBox options={options} selected={[]} onChange={() => undefined} />), /<input [^>]*size="1"/);
  });
});

describe('the tooltip', () => {
  const view = { width: 1400, height: 900 };
  const at = (left: number, top: number, width = 24, height = 24) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const own = { width: 128, height: 26 };

  it('stands 16 px over its anchor, centred, or under it when there is no room over it', () => {
    // Discover's "Add field as column", where the original draws it
    assert.deepEqual(placeTooltip(at(247.8, 259), own, view), { left: 195.8, top: 217, side: 'top' });
    assert.deepEqual(placeTooltip(at(600, 20), own, view), { left: 548, top: 60, side: 'bottom' });
    assert.deepEqual(placeTooltip(at(600, 400), own, view, 'bottom'), { left: 548, top: 440, side: 'bottom' });
    // Under it only while there is room under it
    assert.deepEqual(placeTooltip(at(600, 850), own, view, 'bottom'), { left: 548, top: 808, side: 'top' });
  });

  it('keeps 16 px from the edges of the window, as the original', () => {
    // There is no room over its anchor when it would come nearer than 16 px to the top
    assert.deepEqual(placeTooltip(at(600, 57), own, view), { left: 548, top: 97, side: 'bottom' });
    assert.deepEqual(placeTooltip(at(600, 58), own, view), { left: 548, top: 16, side: 'top' });
    // Moved along its anchor to keep the room: a wide tooltip near either edge
    assert.deepEqual(placeTooltip(at(200, 400), { width: 1000, height: 26 }, view), { left: 16, top: 358, side: 'top' });
    assert.deepEqual(placeTooltip(at(1300, 400), { width: 1000, height: 26 }, view), { left: 384, top: 358, side: 'top' });
  });

  it("tries the opposite side first, then the other two, as the original's", () => {
    // On the right while it keeps 16 px from that edge, else on the left
    assert.deepEqual(placeTooltip(at(100, 400), own, view, 'right'), { left: 140, top: 399, side: 'right' });
    assert.deepEqual(placeTooltip(at(1240, 400), own, view, 'right'), { left: 1096, top: 399, side: 'left' });
    // Over an anchor at the left edge its arrow could not point at it: it goes on the anchor's right,
    // as the original's tag cloud warning does (at 40 there)
    assert.deepEqual(placeTooltip(at(8, 790, 16, 16), { width: 300, height: 60 }, view), { left: 40, top: 768, side: 'right' });
    assert.deepEqual(placeTooltip(at(0, 400), own, view), { left: 40, top: 399, side: 'right' });
    // And at the right edge on the anchor's left
    assert.deepEqual(placeTooltip(at(1390, 400, 10), own, view), { left: 1246, top: 399, side: 'left' });
  });

  it('keeps its arrow on its anchor before it keeps 16 px from the edge, where no side has room', () => {
    // Too wide for either side: over the anchor, 2 px from the edge, its arrow (6 to 18) on the
    // anchor's middle (12)
    assert.deepEqual(placeTooltip(at(0, 400), { width: 1380, height: 26 }, view), { left: 2, top: 358, side: 'top' });
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
