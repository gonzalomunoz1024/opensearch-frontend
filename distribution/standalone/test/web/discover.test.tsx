/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pager } from '../../web/apps/discover/doc_table';
import {
  bucketAt,
  bucketSpan,
  histogramGeometry,
  linearTicks,
  parseBucketInterval,
  shortestBucket,
  tickStep,
  timeTicks,
  utcTicks,
  type HistogramInput,
} from '../../web/apps/discover/histogram_scale';
import { pageCountOf, pagerArrows, pagerItems, pagerSummary, rowsOfPage } from '../../web/apps/discover/pager';
import { timeZoneOffset } from '../../web/lib/dates';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const utc = (text: string) => Date.parse(`${text}Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 16).replace('T', ' ');

describe('the pager of a saved search on a dashboard', () => {
  it('counts pages of 50 rows', () => {
    assert.equal(pageCountOf(500), 10);
    assert.equal(pageCountOf(1616), 33);
    assert.equal(pageCountOf(0), 0);
    assert.deepEqual(rowsOfPage(0, 500), { startRow: 0, endRow: 50 });
    assert.deepEqual(rowsOfPage(9, 480), { startRow: 450, endRow: 480 });
  });

  it('lays its pages out as the component library does', () => {
    const labels = (active: number, count: number) =>
      pagerItems(active, count).map((item) => (item.kind === 'page' ? item.page + 1 : item.label));
    assert.deepEqual(labels(0, 10), [1, 2, 3, 4, 5, 'Skipping pages 6 to 9', 10]);
    assert.deepEqual(labels(5, 10), [1, 'Skipping pages 2 to 3', 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(labels(9, 10), [1, 'Skipping pages 2 to 5', 6, 7, 8, 9, 10]);
    // A run of one page left out shows that page
    assert.deepEqual(labels(4, 7), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(labels(0, 3), [1, 2, 3]);
    assert.deepEqual(labels(0, 0), []);
  });

  it('names its arrows by the page they lead to', () => {
    assert.deepEqual(pagerArrows(0, 10), {
      previous: { label: 'Previous page', disabled: true },
      next: { label: 'Next page, 2', disabled: false },
    });
    assert.deepEqual(pagerArrows(9, 10), {
      previous: { label: 'Previous page, 9', disabled: false },
      next: { label: 'Next page', disabled: true },
    });
  });

  it('counts the rows of the page, and says when the sample size cut the search short', () => {
    assert.deepEqual(pagerSummary(0, 50, 1616, 500), { text: '1–50 of 1616', limited: false });
    assert.deepEqual(pagerSummary(450, 500, 1616, 500), { text: '451–500 of 1616', limited: true });
    // A first search that failed: no rows, and no count
    assert.deepEqual(pagerSummary(0, 0, undefined, 500), { text: '1–0 of 0', limited: false });
  });

  it('draws the original pagination', () => {
    const html = renderToStaticMarkup(
      <Pager page={0} pageCount={10} startRow={0} endRow={50} hits={1616} sampleSize={500} onPage={() => undefined} />
    );
    assert.match(html, /data-test-subj="osdDocTablePagination"/);
    assert.match(html, />1–50 of 1616</);
    assert.match(html, /aria-label="Previous page"[^>]*disabled=""[^>]*data-test-subj="pagination-button-previous"/);
    assert.match(html, /aria-label="Page 1 of 10" aria-current="true"/);
    assert.match(html, /aria-label="Skipping pages 6 to 9"/);
    assert.match(html, /data-test-subj="pagination-button-9">10</);
    assert.match(html, /aria-label="Next page, 2"/);
    assert.ok(!html.includes('Limited to'));
    const last = renderToStaticMarkup(
      <Pager page={9} pageCount={10} startRow={450} endRow={500} hits={1616} sampleSize={500} onPage={() => undefined} />
    );
    assert.match(last, /Limited to 500 results\. Refine your search\./);
  });
});

describe('the ticks of the histogram', () => {
  it('steps by 1, 2 or 5 times a power of ten, as d3 does', () => {
    assert.equal(tickStep(0, 83, 5), 20);
    assert.equal(tickStep(0, 1, 10), 0.1);
    assert.deepEqual(linearTicks(0, 83, 5), [0, 20, 40, 60, 80]);
    assert.deepEqual(linearTicks(0, 3, 5), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
    assert.deepEqual(linearTicks(0, 0, 5), [0]);
  });

  it('falls on round moments of the clock', () => {
    assert.deepEqual(utcTicks(utc('2026-11-01T00:00'), utc('2026-11-01T12:00'), 4).map(iso), [
      '2026-11-01 00:00',
      '2026-11-01 03:00',
      '2026-11-01 06:00',
      '2026-11-01 09:00',
      '2026-11-01 12:00',
    ]);
    // Every other day counts from the first of the month
    assert.deepEqual(utcTicks(utc('2026-10-28T00:00'), utc('2026-11-04T00:00'), 4).map(iso), [
      '2026-10-29 00:00',
      '2026-10-31 00:00',
      '2026-11-01 00:00',
      '2026-11-03 00:00',
    ]);
  });

  it('puts the weeks of 30 days of 12 hour buckets on Sundays, as the original', () => {
    const domain: [number, number] = [utc('2026-10-23T00:00'), utc('2026-11-22T00:00')];
    assert.deepEqual(timeTicks(domain, 8, () => 0, 12 * HOUR).map(iso), [
      '2026-10-25 00:00',
      '2026-11-01 00:00',
      '2026-11-08 00:00',
      '2026-11-15 00:00',
      '2026-11-22 00:00',
    ]);
    // In a zone an hour east of UTC the days start an hour earlier
    assert.deepEqual(timeTicks(domain, 8, () => 60, 12 * HOUR).map(iso).slice(0, 2), ['2026-10-24 23:00', '2026-10-31 23:00']);
  });

  it('keeps only the labels that fit, fewer ticks before cut labels', () => {
    const points = Array.from({ length: 20 }, (_, index) => ({ x: utc('2026-11-12T00:00') + index * 12 * HOUR, y: 60 + (index % 5) * 5 }));
    const input: HistogramInput = {
      width: 1053,
      height: 184,
      points,
      from: utc('2026-10-23T00:00'),
      to: utc('2026-11-22T12:00'),
      intervalMs: 12 * HOUR,
      minInterval: 12 * HOUR,
      offsetAt: () => 0,
      formatX: iso,
      formatY: (value) => `${value}`,
      measure: (text) => text.length * 6,
      hasXTitle: true,
      hasYTitle: true,
    };
    const geometry = histogramGeometry(input);
    assert.deepEqual(
      geometry.xTicks.map((tick) => tick.label),
      ['2026-10-25 00:00', '2026-11-01 00:00', '2026-11-08 00:00', '2026-11-15 00:00', '2026-11-22 00:00']
    );
    // From the top of the plot down
    assert.deepEqual(
      geometry.yTicks.map((tick) => tick.label),
      ['80', '60', '40', '20', '0']
    );
    // The y axis: 18px around its labels, their 12px, 22px for the title; the x axis half a label
    assert.equal(geometry.plot.left, 18 + 12 + 22);
    assert.equal(geometry.plot.width, 1053 - 52 - 48);
    // Sixty buckets and one, each as wide; the bars touch but for 5% of their room
    assert.equal(geometry.band, geometry.plot.width / 61);
    assert.ok(Math.abs(geometry.bars[0].width - geometry.band * 0.95) < 1e-9);
    assert.ok(Math.abs(geometry.bars[1].x - geometry.bars[0].x - geometry.band) < 1e-9);
    // The range ends after the last whole bucket: its last half day is shaded
    assert.equal(geometry.shades.length, 1);
  });
});

describe('the buckets of the histogram', () => {
  it('reads the interval OpenSearch was asked for', () => {
    assert.deepEqual(parseBucketInterval('12h'), { amount: 12, unit: 'h' });
    assert.deepEqual(parseBucketInterval('1M'), { amount: 1, unit: 'M' });
    assert.deepEqual(parseBucketInterval('30ms'), { amount: 30, unit: 'ms' });
    assert.equal(parseBucketInterval('auto'), undefined);
  });

  it('measures a bucket on the calendar of the zone', () => {
    const utcZone = () => 0;
    assert.equal(bucketSpan(utc('2026-11-10T05:00'), { amount: 1, unit: 'd' }, utcZone), DAY);
    assert.equal(bucketSpan(utc('2026-02-10T05:00'), { amount: 1, unit: 'M' }, utcZone), 28 * DAY);
    assert.equal(bucketSpan(utc('2026-11-10T05:00'), { amount: 1, unit: 'w' }, utcZone, 1), 7 * DAY);
    assert.equal(bucketSpan(utc('2026-11-10T05:00'), { amount: 12, unit: 'h' }, utcZone), 12 * HOUR);
    // A day on which the clocks went back an hour is 25 hours long
    const change = utc('2026-10-25T01:00');
    const zone = (time: number) => (time < change ? 120 : 60);
    assert.equal(bucketSpan(utc('2026-10-25T10:00'), { amount: 1, unit: 'd' }, zone), 25 * HOUR);
  });

  it('takes the shortest bucket, or the closest two buckets when they are closer', () => {
    assert.equal(shortestBucket([0, 12 * HOUR, 24 * HOUR], () => 12 * HOUR), 12 * HOUR);
    assert.equal(shortestBucket([0, 5], () => 10), 5);
    assert.equal(shortestBucket([0], () => DAY), DAY);
  });

  it('finds the bucket under the pointer, counted from the nearest bucket with documents', () => {
    const geometry = { invert: (position: number) => position, minInterval: 10 };
    const keys = [0, 10, 40];
    assert.equal(bucketAt(geometry, 15, keys), 10);
    assert.equal(bucketAt(geometry, 25, keys), 20);
    assert.equal(bucketAt(geometry, 40, keys), 40);
    assert.equal(bucketAt(geometry, -5, keys), -10);
    assert.equal(bucketAt(geometry, 5, []), undefined);
  });

  it('knows the offset of UTC', () => {
    assert.equal(timeZoneOffset(utc('2026-11-22T00:00'), 'UTC'), 0);
  });
});
