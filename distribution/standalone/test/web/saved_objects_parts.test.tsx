/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BasicTable, IMPORT_ICON, RowAction, tableCaption, TypeIcon, type Column } from '../../web/apps/management/saved_objects_parts';
import { iconDrawing } from '../../web/components/icon';

const pathData = (name: string) => (iconDrawing(name)?.paths ?? []).map((shape) => (typeof shape === 'string' ? shape : shape.d));

describe('the icons of the saved objects page', () => {
  it("draws an application's icon in its two colours, as the original gives it none", () => {
    for (const icon of ['dashboardApp', 'visualizeApp', 'discoverApp', 'indexPatternApp']) {
      const out = renderToStaticMarkup(<TypeIcon type="dashboard" icon={icon} />);
      // Small, as the original's tables draw it
      assert.ok(out.includes('class="atlIcon atlIcon--s atlIcon--app"'), icon);
      assert.ok(out.includes('class="atlIcon__secondary"'), icon);
    }
  });

  it('draws the other icons of a type, and the one of a type without an icon, in one colour', () => {
    for (const icon of ['gear', 'link', 'search', 'home', undefined]) {
      const out = renderToStaticMarkup(<TypeIcon type="config" icon={icon} />);
      assert.ok(out.includes('class="atlIcon atlIcon--s"'), String(icon));
      assert.ok(!out.includes('atlIcon--app'), String(icon));
    }
    assert.ok(renderToStaticMarkup(<TypeIcon type="x" />).includes(pathData('apps')[0]));
  });

  it("draws the relationships of an object with the original's `kqlSelector`, filled as its other icons", () => {
    const out = renderToStaticMarkup(
      <RowAction label="Relationships" description="View the relationships" icon="kqlSelector" onClick={() => undefined} testId="relationships" />
    );
    // The original's empty icon button of a table's row: 24 px, round, in the primary colour
    assert.match(out, /class="atlButton atlButton--empty atlButton--xs atlButton--icon atlButton--round"/);
    assert.match(out, /aria-label="Relationships"/);
    assert.equal(iconDrawing('kqlSelector')?.drawn, 'kqlSelector');
    assert.ok(pathData('kqlSelector').length > 0);
    for (const d of pathData('kqlSelector')) assert.ok(out.includes(`d="${d}"`));
    // An icon of the set says it is an image, which the stylesheet fills; a drawing without that is stroked
    assert.match(out, /role="img"/);
  });

  it("draws the import with the original's `importAction`, not the download arrow", () => {
    assert.equal(iconDrawing(IMPORT_ICON)?.drawn, 'importAction');
    assert.notEqual(pathData(IMPORT_ICON).join(' '), pathData('download').join(' '));
  });
});

describe("the table's pages, as the original's EuiBasicTable and EuiPagination", () => {
  const columns: Array<Column<{ id: string }>> = [{ key: 'id', name: 'ID', render: (item) => item.id }];
  const table = (pageIndex: number, totalItemCount = 5) =>
    renderToStaticMarkup(
      <BasicTable
        items={[{ id: 'a' }, { id: 'b' }]}
        columns={columns}
        itemId={(item) => item.id}
        pagination={{ pageIndex, pageSize: 2, totalItemCount, pageSizeOptions: [2, 10] }}
        onChange={() => undefined}
      />
    );
  const tag = (markup: string, subj: string) => new RegExp(`<button[^>]*data-test-subj="${subj}"[^>]*>`).exec(markup)?.[0] ?? '';

  it('gives the table an id its page buttons control, lets it take the focus, and tells what it holds', () => {
    const markup = table(1);
    const id = /<table class="sobTable__table" id="([^"]+)" tabindex="-1">/.exec(markup)?.[1];
    assert.ok(id, 'the table has an id and can take the focus');
    assert.match(markup, /<caption class="sobHidden">This table contains 2 rows out of 5 rows; Page 2 of 3\.<\/caption><colgroup>/);
    for (const subj of ['pagination-button-previous', 'pagination-button-0', 'pagination-button-1', 'pagination-button-2', 'pagination-button-next']) {
      assert.ok(tag(markup, subj).includes(`aria-controls="${id}"`), subj);
    }
  });

  it('cannot turn to the page it shows, nor past the first or the last', () => {
    const disabled = (markup: string, subj: string) => / disabled=""/.test(tag(markup, subj));
    const controls = (markup: string, subj: string) => /aria-controls=/.test(tag(markup, subj));
    const second = table(1);
    assert.equal(disabled(second, 'pagination-button-1'), true);
    assert.match(tag(second, 'pagination-button-1'), /aria-current="true"/);
    assert.equal(disabled(second, 'pagination-button-0'), false);
    assert.equal(disabled(second, 'pagination-button-2'), false);
    const first = table(0);
    // A button that cannot be used controls nothing, as in the original, but the current page does
    assert.equal(disabled(first, 'pagination-button-previous'), true);
    assert.equal(controls(first, 'pagination-button-previous'), false);
    assert.equal(disabled(first, 'pagination-button-0'), true);
    assert.equal(controls(first, 'pagination-button-0'), true);
    const last = table(2);
    assert.equal(disabled(last, 'pagination-button-next'), true);
    assert.equal(controls(last, 'pagination-button-next'), false);
  });

  it("says what the table holds in EuiBasicTable's words", () => {
    assert.equal(tableCaption(3), 'This table contains 3 rows.');
    assert.equal(tableCaption(0, { pageIndex: 0, pageSize: 20, totalItemCount: 0, pageSizeOptions: [20] }), 'This table contains 0 rows; Page 1 of 0.');
    assert.equal(
      tableCaption(50, { pageIndex: 1, pageSize: 50, totalItemCount: 268, pageSizeOptions: [20, 50, 100] }),
      'This table contains 50 rows out of 268 rows; Page 2 of 6.'
    );
  });
});
