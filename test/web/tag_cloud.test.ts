/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The tag cloud as OpenSearch Dashboards 3.9.0 lays out, sizes, turns and colours its words
 * (vis_type_tagcloud with d3-cloud 1.2.5 and d3 3.5.17). fixtures/tag_cloud_cases.json holds what
 * the original's own code gives: d3-cloud's index.js run on the fake canvas below, d3's scales as
 * the tag cloud makes them and its interpolation of a text, and the tag cloud's hashWithinRange.
 */

process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { SERIES_COLORS } from '../../web/charts/core';
import { tabify, type AggConfig, type AggContext } from '../../web/lib/aggs';
import type { Field, IndexPattern } from '../../web/lib/types';
import { cloudLayout, type CloudBounds, type CloudCanvas, type CloudContext, type CloudWord } from '../../web/vis/cloud_layout';
import { formatValue } from '../../web/vis/table_data';
import {
  MAX_TAG_COUNT,
  ORIENTATIONS,
  cloudTags,
  hashWithinRange,
  positionWord,
  textSizeMapper,
  type CloudTag,
} from '../../web/vis/tag_cloud';
import {
  cubicInOut,
  decomposeMatrix,
  extent,
  interpolateString,
  interpolateTransform,
  ordinalScale,
  type TransformMatrix,
} from '../../web/vis/tag_cloud_d3';

interface LayoutCase {
  name: string;
  size: [number, number];
  orientation: string;
  words: Array<{ displayText: string; px: number }>;
  expected: Array<Record<string, unknown>>;
  placed: string[];
  bounds: CloudBounds | null;
}

const fixture = JSON.parse(readFileSync('test/web/fixtures/tag_cloud_cases.json', 'utf8')) as {
  layouts: LayoutCase[];
  scales: Array<{ kind: string; values: Array<number | null>; sizes: Array<number | string>; truncated: number[] }>;
  strings: Array<{ a: string; b: string; at: string[] }>;
  hashes: Array<{ text: string; two: number; twelve: number }>;
};

/**
 * A canvas that draws each character of a text as a box, tall or short and with or without a
 * descender by its code, so that words have shapes of their own to collide by
 */
function fakeCanvas(): CloudCanvas {
  let width = 300;
  let height = 150;
  let context: CloudContext | null = null;
  const canvas: CloudCanvas = {
    get width() {
      return width;
    },
    set width(value) {
      width = value;
      context = null;
    },
    get height() {
      return height;
    },
    set height(value) {
      height = value;
      context = null;
    },
    getContext() {
      context ??= fakeContext(width, height);
      return context;
    },
  };
  return canvas;
}

function fakeContext(w: number, h: number): CloudContext {
  let data = new Uint8ClampedArray(w * h * 4);
  let m = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const px = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]);
  const fill = (text: string, grow: number) => {
    const size = px(context.font);
    const advance = 0.6 * size;
    const total = [...text].length * advance;
    const boxes = [...text].map((char, index) => {
      const code = char.codePointAt(0) ?? 0;
      const left = -total / 2 + index * advance + 0.05 * size;
      return {
        x0: left - grow,
        x1: left + 0.5 * size + grow,
        y0: (code % 3 === 0 ? -0.8 : -0.5) * size - grow,
        y1: (code % 2 === 0 ? 0.2 : 0) * size + grow,
      };
    });
    const corners: number[][] = [];
    for (const box of boxes) {
      for (const [x, y] of [
        [box.x0, box.y0],
        [box.x1, box.y0],
        [box.x0, box.y1],
        [box.x1, box.y1],
      ]) {
        corners.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      }
    }
    if (!corners.length) return;
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
    const det = m[0] * m[3] - m[1] * m[2];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - m[4];
        const dy = y + 0.5 - m[5];
        const u = (m[3] * dx - m[2] * dy) / det;
        const v = (-m[1] * dx + m[0] * dy) / det;
        if (boxes.some((box) => u >= box.x0 && u < box.x1 && v >= box.y0 && v < box.y1)) data[(y * w + x) * 4] = 255;
      }
    }
  };
  const context: CloudContext = {
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    textAlign: 'start',
    lineWidth: 1,
    clearRect() {
      data = new Uint8ClampedArray(w * h * 4);
    },
    save() {
      stack.push(m.slice());
    },
    restore() {
      m = stack.pop() ?? m;
    },
    translate(x, y) {
      m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    },
    rotate(angle) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[0] * -s + m[2] * c, m[1] * -s + m[3] * c, m[4], m[5]];
    },
    measureText(text) {
      return { width: [...text].length * 0.6 * px(context.font) };
    },
    fillText(text) {
      fill(text, 0);
    },
    strokeText(text) {
      fill(text, context.lineWidth / 2);
    },
    getImageData(_x, _y, width) {
      return { data: width === 1 ? new Uint8ClampedArray(4) : data };
    },
  };
  return context;
}

type Word = CloudWord & { displayText: string; px: number };

function layOut(one: LayoutCase): { words: Word[]; placed: string[]; bounds: CloudBounds | null } {
  const words: Word[] = one.words.map((word) => ({ ...word }));
  let placed: string[] = [];
  let bounds: CloudBounds | null = null;
  cloudLayout<Word>()
    .canvas(fakeCanvas)
    .size(one.size)
    .padding(5)
    .rotate(ORIENTATIONS[one.orientation])
    .font('Inter UI, sans-serif')
    .fontStyle('normal')
    .fontWeight('normal')
    .fontSize((word) => word.px)
    .random(() => 0.5)
    .spiral('archimedean')
    .words(words)
    .text((word) => word.displayText)
    .timeInterval(null)
    .on('end', (tags, box) => {
      placed = tags.map((tag) => tag.text as string);
      bounds = box;
    })
    .start();
  return { words, placed, bounds };
}

/** What the layout set on a word, as the fixture has it */
function laidOut(word: Word): Record<string, unknown> {
  const { text, size, rotate, x, y, width, height, xoff, yoff, x0, x1, y0, y1 } = word;
  const fields: Record<string, unknown> = { text, size, rotate, x, y, width, height, xoff, yoff, x0, x1, y0, y1 };
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key];
  fields.hasText = word.hasText === true;
  return fields;
}

describe('the layout of a tag cloud', () => {
  for (const one of fixture.layouts) {
    it(`places the words where d3-cloud places them: ${one.name}`, () => {
      const { words, placed, bounds } = layOut(one);
      assert.deepEqual(words.map(laidOut), one.expected);
      assert.deepEqual(placed, one.placed);
      assert.deepEqual(bounds, one.bounds);
    });
  }

  it('tells the end once, after the last word', () => {
    const one = fixture.layouts[2];
    const told: string[][] = [];
    cloudLayout<Word>()
      .canvas(fakeCanvas)
      .size(one.size)
      .fontSize((word) => word.px)
      .random(() => 0.5)
      .rotate(0)
      .words(one.words.map((word) => ({ ...word })))
      .text((word) => word.displayText)
      .on('end', (tags) => told.push(tags.map((tag) => tag.text as string)))
      .start();
    assert.equal(told.length, 1);
  });
});

describe('the size, angle and colour of a word', () => {
  const asJson = (value: number) => (Number.isFinite(value) ? value : String(value));

  for (const one of fixture.scales) {
    it(`sizes ${JSON.stringify(one.values)} on the ${one.kind} scale as d3 does`, () => {
      const words = one.values.map((value) => ({ value }));
      const scale = textSizeMapper(one.kind, words, 18, 72);
      assert.deepEqual(
        one.values.map((value) => asJson(scale(value))),
        one.sizes
      );
      // The layout takes the whole pixels below
      assert.deepEqual(
        one.values.map((value) => ~~scale(value)),
        one.truncated
      );
    });
  }

  it('turns a word by the hash of its text, the same for the same text', () => {
    for (const one of fixture.hashes) {
      assert.equal(hashWithinRange(one.text, 2), one.two, one.text);
      assert.equal(hashWithinRange(one.text, 12), one.twelve, one.text);
      assert.equal(ORIENTATIONS['right angled']({ text: one.text }), one.two * 90);
      assert.equal(ORIENTATIONS.multiple({ text: one.text }), one.twelve * 15 - 90);
      assert.equal(ORIENTATIONS.single({ text: one.text }), 0);
    }
  });

  it('gives each word the next colour of the palette, the first time it asks for one', () => {
    const color = ordinalScale(SERIES_COLORS);
    assert.equal(color('/apm'), '#54B399');
    assert.equal(color('/'), '#6092C0');
    assert.equal(color('/apm'), '#54B399');
    for (let index = 0; index < 8; index += 1) color(`word ${index}`);
    // The eleventh word starts the palette again
    assert.equal(color('eleventh'), '#54B399');
    // A word without a text has a colour too, as d3's map keys it by "undefined"
    assert.equal(color(undefined), '#6092C0');
  });

  it('finds the least and the greatest value, passing over missing ones', () => {
    assert.deepEqual(
      extent([null, Number.NaN, 3, 1, null, 7], (value) => value),
      [1, 7]
    );
    assert.deepEqual(
      extent([null, undefined], (value) => value),
      [undefined, undefined]
    );
  });
});

describe('the drawing of a tag cloud', () => {
  it('draws a word around the middle of its box, or far out of it without a place', () => {
    assert.equal(positionWord(476, 373, { x: 0, y: 0, rotate: 0 }), 'translate(476, 373)rotate(0)');
    assert.equal(positionWord(476.5, 373, { x: 25, y: -50, rotate: -30 }), 'translate(501.5, 323)rotate(-30)');
    assert.equal(positionWord(161, 176.5, {}), 'translate(483, 529.5)rotate(0)');
  });

  it('interpolates the numbers of a text as d3 does', () => {
    for (const one of fixture.strings) {
      assert.deepEqual(
        [0, 0.25, 0.5, 0.75, 1].map((t) => interpolateString(one.a, one.b)(t)),
        one.at,
        `${one.a} to ${one.b}`
      );
    }
  });

  it('eases a transition in and out', () => {
    assert.deepEqual(
      [-1, 0, 0.25, 0.5, 0.75, 1, 2].map(cubicInOut),
      [0, 0, 0.0625, 0.5, 0.9375, 1, 1]
    );
  });

  // The matrices of translations and rotations, as the page works them out
  const matrixOf = (value: string | null): TransformMatrix => {
    let m: TransformMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    for (const [, kind, args] of (value ?? '').matchAll(/(translate|rotate)\(([^)]*)\)/g)) {
      const [x = 0, y = 0] = (args ?? '').split(/[\s,]+/).map(Number);
      const next =
        kind === 'translate'
          ? { a: 1, b: 0, c: 0, d: 1, e: x, f: y }
          : { a: Math.cos((x * Math.PI) / 180), b: Math.sin((x * Math.PI) / 180), c: -Math.sin((x * Math.PI) / 180), d: Math.cos((x * Math.PI) / 180), e: 0, f: 0 };
      m = {
        a: m.a * next.a + m.c * next.b,
        b: m.b * next.a + m.d * next.b,
        c: m.a * next.c + m.c * next.d,
        d: m.b * next.c + m.d * next.d,
        e: m.a * next.e + m.c * next.f + m.e,
        f: m.b * next.e + m.d * next.f + m.f,
      };
    }
    return m;
  };

  it('moves a word from one place to another as d3 writes the transform', () => {
    const move = interpolateTransform('translate(476, 373)rotate(0)', 'translate(175, 120)rotate(0)', matrixOf);
    assert.equal(move(0), 'translate(476,373)');
    assert.equal(move(0.5), 'translate(325.5,246.5)');
    assert.equal(move(1), 'translate(175,120)');
    // A turn is written after the place it turns at
    const turn = interpolateTransform('translate(10, 20)rotate(0)', 'translate(10, 20)rotate(90)', matrixOf);
    const rotate = decomposeMatrix(matrixOf('rotate(90)')).rotate;
    assert.equal(turn(1), `translate(10,20),rotate(${rotate})`);
    assert.deepEqual(decomposeMatrix({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), { rotate: 0, translate: [0, 0], scale: [1, 1], skew: 0 });
  });
});

describe('the words of a table', () => {
  const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: true });
  const logs: IndexPattern = {
    id: 'logs',
    title: 'logs-*',
    timeFieldName: 'timestamp',
    fields: [field('timestamp', 'date'), field('bytes', 'number'), field('request', 'string')],
    fieldFormatMap: {},
  };
  const context: AggContext = { indexPattern: logs };
  const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
  const requests: AggConfig = {
    id: '2',
    enabled: true,
    type: 'terms',
    schema: 'segment',
    params: { field: 'request', size: 300, order: 'desc', orderBy: '1' },
  };
  const table = (keys: unknown[]) =>
    tabify([count, requests], { aggregations: { '2': { buckets: keys.map((key, index) => ({ key, doc_count: 1000 - index })) } } }, context);

  it('makes a word of each row: its term as its column writes it, and its count', () => {
    const whole = table(['/apm', '', 'css']);
    const made = cloudTags(whole, whole.columns[0], whole.columns[1], formatValue);
    if (!made) throw new Error('No words');
    assert.equal(made.truncated, false);
    assert.deepEqual(
      made.tags.map((tag: CloudTag) => [tag.displayText, tag.rawText, tag.value, tag.meta.rowIndex]),
      [
        ['/apm', '/apm', 1000, 0],
        ['', '', 999, 1],
        ['css', 'css', 998, 2],
      ]
    );
  });

  it('writes an empty term by the format of its field, as a static lookup writes its value for unknown keys', () => {
    const lookup = { id: 'static_lookup', params: { lookupEntries: [{ key: 'css', value: 'Style sheet' }], unknownKeyValue: 'other' } };
    const known: AggContext = { indexPattern: { ...logs, fieldFormatMap: { request: lookup } } };
    const whole = tabify([count, requests], { aggregations: { '2': { buckets: [{ key: '', doc_count: 9 }, { key: 'css', doc_count: 8 }] } } }, known);
    const made = cloudTags(whole, whole.columns[0], whole.columns[1], formatValue);
    assert.deepEqual(
      made?.tags.map((tag) => [tag.displayText, tag.rawText]),
      [
        ['other', ''],
        ['Style sheet', 'css'],
      ]
    );
  });

  it('keeps the first 200 words and says that it left the others out', () => {
    const keys = Array.from({ length: 250 }, (_, index) => `word ${index}`);
    const whole = table(keys);
    const made = cloudTags(whole, whole.columns[0], whole.columns[1], formatValue);
    if (!made) throw new Error('No words');
    assert.equal(made.tags.length, MAX_TAG_COUNT);
    assert.equal(made.truncated, true);
    assert.equal(made.tags[199].displayText, 'word 199');
  });

  it('calls the one word of a table without terms "all", and has no words without rows', () => {
    const counted = tabify([count], { hits: { total: 42 }, aggregations: {} }, context);
    const made = cloudTags(counted, undefined, counted.columns[0], formatValue);
    assert.deepEqual(
      made?.tags.map((tag) => [tag.displayText, tag.rawText, tag.value]),
      [['all', 'all', 42]]
    );
    const none = table([]);
    assert.equal(cloudTags(none, none.columns[0], none.columns[1], formatValue), undefined);
  });
});
