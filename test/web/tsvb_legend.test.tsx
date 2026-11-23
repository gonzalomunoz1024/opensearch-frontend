/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Legend, type LegendItem } from '../../web/charts/core';

const item = (id: string): LegendItem => ({ id, label: id, color: '#54b399' });

describe('a TSVB legend laid out as elastic-charts lays it out', () => {
  it('gives a single item above or below the chart the whole width', () => {
    const html = renderToStaticMarkup(<Legend items={[item('a')]} position="bottom" elasticSize={34} />);
    assert.match(html, /grid-template-columns:1fr/);
    assert.match(renderToStaticMarkup(<Legend items={[item('a')]} position="top" elasticSize={34} />), /grid-template-columns:1fr/);
  });

  it('leaves more items to the columns of its style sheet, and a legend beside the chart alone', () => {
    const columns = /grid-template-columns/;
    assert.equal(columns.test(renderToStaticMarkup(<Legend items={[item('a'), item('b')]} position="bottom" elasticSize={34} />)), false);
    assert.equal(columns.test(renderToStaticMarkup(<Legend items={[item('a')]} position="right" elasticSize={120} />)), false);
    // A legend that is not elastic-charts' keeps no inline style on its list
    assert.equal(/<ul[^>]*style=/.test(renderToStaticMarkup(<Legend items={[item('a')]} position="bottom" />)), false);
  });
});
