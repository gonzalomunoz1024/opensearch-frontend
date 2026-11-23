/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { IMPORT_ICON, RowAction, TypeIcon } from '../../web/apps/management/saved_objects_parts';
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
