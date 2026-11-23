/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canAutoApply,
  dragWidths,
  editorHeading,
  initialWidths,
  keyWidths,
  searchBarParts,
  sidebarInitialWidth,
  sidebarTitle,
} from '../../web/apps/visualize/editor_layout';
import { prettyInterval, refreshIntervalMs, refreshIntervalParts } from '../../web/shell/refresh_interval';

describe('the share of the editor the sidebar starts with', () => {
  it('is half for Markdown, whose editor is large, and 30% for every other kind', () => {
    assert.equal(sidebarInitialWidth('markdown'), 50);
    for (const type of ['vega', 'timelion', 'histogram', 'horizontal_bar', 'pie', 'table', 'input_control_vis']) {
      assert.equal(sidebarInitialWidth(type), 30, type);
    }
    assert.deepEqual(initialWidths('line'), { chart: 70, side: 30 });
  });
});

describe('moving the bar between the chart and the sidebar', () => {
  it('starts a drag from the widths the panels are drawn at, as percents of the editor', () => {
    // 1440px wide: the chart is drawn at 996px (its 70% less the 12px bar), the sidebar at 432px
    const widths = dragWidths(996, 432, -100, 1440);
    assert.equal(Math.round(widths.chart * 10000) / 10000, 62.2222);
    assert.equal(Math.round(widths.side * 10000) / 10000, 36.9444);
  });

  it('moves one percent from one panel to the other with the arrow keys', () => {
    assert.deepEqual(keyWidths({ chart: 60, side: 40 }, 'ArrowLeft'), { chart: 59, side: 41 });
    assert.deepEqual(keyWidths({ chart: 60, side: 40 }, 'ArrowRight'), { chart: 61, side: 39 });
    assert.equal(keyWidths({ chart: 60, side: 40 }, 'ArrowUp'), undefined);
  });

  it('does not divide by an editor that has no width', () => {
    assert.deepEqual(dragWidths(0, 0, 10, 0), { chart: 100, side: 0 });
  });
});

describe('the bar above the editor', () => {
  it('has the query, the filters and the dates for a chart of an index pattern with a time field', () => {
    assert.deepEqual(searchBarParts('histogram', { timeFieldName: 'timestamp' }), { query: true, filters: true, datePicker: true });
  });

  it('keeps only the refresh interval for an index pattern without a time field', () => {
    assert.deepEqual(searchBarParts('pie', {}), { query: true, filters: true, datePicker: false });
  });

  it('follows the options of the kinds that are not drawn from an index pattern', () => {
    assert.deepEqual(searchBarParts('markdown'), { query: false, filters: false, datePicker: false });
    assert.deepEqual(searchBarParts('input_control_vis'), { query: false, filters: true, datePicker: true });
    assert.deepEqual(searchBarParts('vega'), { query: true, filters: true, datePicker: true });
    assert.deepEqual(searchBarParts('metrics'), { query: false, filters: false, datePicker: true });
    assert.deepEqual(searchBarParts('timelion'), { query: false, filters: false, datePicker: true });
  });
});

describe('the top of the sidebar', () => {
  it('names the index pattern, or the saved search when the visualization is linked to one', () => {
    assert.equal(sidebarTitle('histogram', false), 'indexPattern');
    assert.equal(sidebarTitle('histogram', true), 'linked');
  });

  it('is an empty band for a kind that searches without an index pattern, and nothing for one that does not search', () => {
    assert.equal(sidebarTitle('vega', false), 'placeholder');
    assert.equal(sidebarTitle('markdown', false), 'none');
    assert.equal(sidebarTitle('input_control_vis', false), 'none');
  });

  it('offers auto apply only where the original does', () => {
    assert.deepEqual(['markdown', 'vega', 'histogram', 'input_control_vis'].map(canAutoApply), [true, true, false, false]);
  });

  it('gives a screen reader the original heading', () => {
    assert.equal(editorHeading('Sales', 'Vertical Bar', true), 'Sales Vertical Bar visualization');
    assert.equal(editorHeading(undefined, 'Markdown', false), 'Visualization of type Markdown embedded into dashboards app');
  });
});

describe('the refresh interval', () => {
  it('is written as the original writes it', () => {
    assert.equal(prettyInterval(true, 10000), 'Off');
    assert.equal(prettyInterval(false, 0), 'Off');
    assert.equal(prettyInterval(false, 1000), '1 second');
    assert.equal(prettyInterval(false, 10000), '10 seconds');
    assert.equal(prettyInterval(false, 60000), '1 minute');
    assert.equal(prettyInterval(false, 90 * 60000), '2 hours');
    assert.equal(prettyInterval(false, 3 * 86400000), '3 days');
  });

  it('shows a whole minute in seconds, and goes back to the same milliseconds', () => {
    assert.deepEqual(refreshIntervalParts(0), { value: 0, units: 's' });
    assert.deepEqual(refreshIntervalParts(60000), { value: 60, units: 's' });
    assert.deepEqual(refreshIntervalParts(120000), { value: 2, units: 'm' });
    assert.deepEqual(refreshIntervalParts(5400000), { value: 1.5, units: 'h' });
    assert.equal(refreshIntervalMs('m', 2), 120000);
    assert.equal(refreshIntervalMs('h', 1.5), 5400000);
  });
});
