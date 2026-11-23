/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, CallOut, Health } from '../../web/components/basic';
import { ICON_NAMES, Icon, iconDrawing, type IconName } from '../../web/components/icon';
import { VIS_TYPES, visIcon, visStateIcon } from '../../web/lib/vis';

describe('Icon', () => {
  it('draws every name it knows with a drawing of OUI', () => {
    assert.ok(ICON_NAMES.length > 100);
    for (const name of ICON_NAMES) {
      const drawing = iconDrawing(name);
      if (!drawing) {
        assert.ok(false, `${name} has no drawing`);
        continue;
      }
      // OUI's `empty` is the one icon that draws nothing: it keeps an icon's room
      assert.equal(drawing.paths.length > 0, name !== 'empty', name);
      for (const shape of drawing.paths) {
        const d = typeof shape === 'string' ? shape : shape.d;
        assert.ok(/^[Mm]/.test(d), name);
      }
      assert.ok(/^0 0 \d+ \d+$/.test(drawing.viewBox), name);
    }
  });

  it('keeps the names of the set and draws them as the original draws each spot', () => {
    // The chevrons are OUI's arrows; the arrows of a line are its sort icons
    assert.equal(iconDrawing('chevronDown')?.drawn, 'arrowDown');
    assert.equal(iconDrawing('arrowDown')?.drawn, 'sortDown');
    assert.equal(iconDrawing('help')?.drawn, 'questionInCircle');
    assert.equal(iconDrawing('warning')?.drawn, 'alert');
    assert.equal(iconDrawing('external')?.drawn, 'popout');
    // OUI's own `help`, the ring buoy, under a name that does not collide
    assert.equal(iconDrawing('lifebuoy')?.drawn, 'help');
    assert.equal(iconDrawing('plusInCircleFilled')?.drawn, 'plusInCircleFilled');
    // The share menu's "Embed code" is OUI's prompt; `console` is the Dev Tools application
    assert.equal(iconDrawing('embed')?.drawn, 'console');
    assert.equal(iconDrawing('console')?.drawn, 'consoleApp');
  });

  it('knows nothing of a name it does not have', () => {
    assert.equal(iconDrawing('noSuchIcon'), undefined);
    assert.equal(iconDrawing('toString'), undefined);
    assert.equal(iconDrawing('constructor'), undefined);
  });

  it('draws OUI icons on their grid, filled, hidden from a screen reader unless titled', () => {
    const out = renderToStaticMarkup(<Icon name="search" />);
    assert.match(out, /^<svg class="atlIcon" viewBox="0 0 16 16"/);
    assert.match(out, /focusable="false"/);
    assert.match(out, /role="img"/);
    assert.match(out, /aria-hidden="true"/);
    assert.match(out, /<path d="[Mm]/);
    const titled = renderToStaticMarkup(<Icon name="help" title="Help" />);
    assert.match(titled, /aria-label="Help"/);
    assert.ok(!titled.includes('aria-hidden'));
  });

  it('draws an application icon on its 32 grid, its second colour marked', () => {
    const out = renderToStaticMarkup(<Icon name="dashboardApp" size="l" app />);
    assert.match(out, /class="atlIcon atlIcon--l atlIcon--app"/);
    assert.match(out, /viewBox="0 0 32 32"/);
    assert.match(out, /class="atlIcon__secondary"/);
  });

  it('keeps the even-odd rule of the shapes that have it, and the sizes of OUI', () => {
    const out = renderToStaticMarkup(<Icon name="calendar" />);
    assert.match(out, /fill-rule="evenodd"/);
    assert.match(renderToStaticMarkup(<Icon name="cross" size="s" />), /class="atlIcon atlIcon--s"/);
    assert.match(renderToStaticMarkup(<Icon name="cross" size="xxl" className="x" />), /class="atlIcon atlIcon--xxl x"/);
  });
});

describe('The kit around its icons', () => {
  it('draws a call-out as the original: the icon it names beside the title, none without a title', () => {
    const titled = renderToStaticMarkup(
      <CallOut tone="warning" icon="warning" title="Careful">
        Text
      </CallOut>
    );
    assert.match(titled, /class="atlCallOut atlCallOut--warning"/);
    assert.match(titled, /<div class="atlCallOut__header"><svg class="atlIcon"[^>]*>.*<\/svg><div class="atlCallOut__title">Careful<\/div><\/div>/);
    assert.match(titled, /<div class="atlCallOut__body">Text<\/div>/);
    // No icon unless one is named, and none at all without a title
    assert.ok(!renderToStaticMarkup(<CallOut tone="warning" title="Careful" />).includes('<svg'));
    assert.ok(!renderToStaticMarkup(<CallOut tone="warning" icon="warning">Text</CallOut>).includes('<svg'));
    assert.match(renderToStaticMarkup(<CallOut size="s">Text</CallOut>), /class="atlCallOut atlCallOut--s"/);
  });

  it('draws a health as OUI does: its dot before the word', () => {
    const out = renderToStaticMarkup(<Health tone="healthy">green</Health>);
    assert.match(out, /^<span class="atlHealth atlHealth--healthy"><svg class="atlIcon"[^>]*>.*<\/svg>green<\/span>$/);
    assert.equal(iconDrawing('dot')?.drawn, 'dot');
  });

  it('draws a button icon small when asked', () => {
    assert.match(renderToStaticMarkup(<Button icon="copyClipboard" iconSize="s" aria-label="Copy" />), /class="atlIcon atlIcon--s"/);
    assert.match(renderToStaticMarkup(<Button icon="copyClipboard">Copy</Button>), /class="atlIcon"/);
  });
});

describe('The icons of the kinds of visualization', () => {
  it('names an icon the set draws for every kind, as the original lists them', () => {
    const names = new Set<string>(ICON_NAMES);
    for (const type of VIS_TYPES) assert.ok(names.has(type.icon), `${type.name}: ${type.icon}`);
    const expected: Record<string, IconName> = {
      area: 'visArea',
      input_control_vis: 'controlsHorizontal',
      tile_map: 'visMapCoordinate',
      table: 'visTable',
      gauge: 'visGauge',
      goal: 'visGoal',
      heatmap: 'heatmap',
      horizontal_bar: 'visBarHorizontal',
      line: 'visLine',
      markdown: 'visText',
      metric: 'visMetric',
      pie: 'visPie',
      region_map: 'visMapRegion',
      tagcloud: 'visTagCloud',
      timelion: 'timeline',
      metrics: 'visVisualBuilder',
      vega: 'visVega',
      histogram: 'visBarVertical',
    };
    for (const [name, icon] of Object.entries(expected)) assert.equal(visIcon(name), icon, name);
    assert.equal(visIcon('unknown'), 'visualizeApp');
  });

  it('reads the kind of a saved visualization from its state', () => {
    assert.equal(visStateIcon(JSON.stringify({ type: 'pie', params: {} })), 'visPie');
    assert.equal(visStateIcon(JSON.stringify({ type: 'nothing' })), undefined);
    assert.equal(visStateIcon('{not json'), undefined);
    assert.equal(visStateIcon(JSON.stringify(['pie'])), undefined);
    assert.equal(visStateIcon(undefined), undefined);
  });
});
