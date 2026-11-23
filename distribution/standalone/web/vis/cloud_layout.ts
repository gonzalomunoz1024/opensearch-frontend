/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The layout of a word cloud as OpenSearch Dashboards lays out its tag clouds: d3-cloud 1.2.5 (its
 * index.js), step for step, so that the same words at the same sizes fall where they fall there.
 * d3-cloud is under the BSD 3-Clause License, Copyright (c) 2013, Jason Davies: word cloud layout
 * by Jason Davies, https://www.jasondavies.com/wordcloud/, algorithm due to Jonathan Feinberg,
 * http://static.mrfeinberg.com/bv_ch03.pdf.
 *
 * Each word is drawn on a canvas to find the pixels it covers (its sprite), then moved along a
 * spiral out from where it starts until it overlaps no word placed before it and stays inside the
 * cloud. A word that finds no such place is left where it last tried, and out of the words placed.
 */

const cloudRadians = Math.PI / 180;
const cw = (1 << 11) >> 5;
const ch = 1 << 11;

/** What the layout reads and writes on a word: it sets each of these on the words it is given */
export interface CloudWord {
  text?: string;
  font?: string;
  style?: string;
  weight?: string;
  rotate?: number;
  size?: number;
  padding?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  xoff?: number;
  yoff?: number;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  hasText?: boolean;
  sprite?: number[];
}

/** The part of a canvas's 2D context the layout draws with */
export interface CloudContext {
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  textAlign: unknown;
  lineWidth: number;
  clearRect(x: number, y: number, width: number, height: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> };
}

/** A canvas the layout draws on: the page's, or a test's */
export interface CloudCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): CloudContext | null;
}

type Accessor<W, V> = (word: W, index: number) => V;
type Spiral = (size: [number, number]) => (t: number) => [number, number] | undefined;
export type CloudBounds = [{ x: number; y: number }, { x: number; y: number }];

export interface CloudLayout<W extends CloudWord> {
  start(): CloudLayout<W>;
  stop(): CloudLayout<W>;
  canvas(make: () => CloudCanvas): CloudLayout<W>;
  timeInterval(milliseconds: number | null): CloudLayout<W>;
  words(words: W[]): CloudLayout<W>;
  size(size: [number, number]): CloudLayout<W>;
  font(font: string | Accessor<W, string>): CloudLayout<W>;
  fontStyle(style: string | Accessor<W, string>): CloudLayout<W>;
  fontWeight(weight: string | Accessor<W, string>): CloudLayout<W>;
  rotate(rotate: number | Accessor<W, number | undefined>): CloudLayout<W>;
  text(text: string | Accessor<W, string>): CloudLayout<W>;
  spiral(spiral: 'archimedean' | 'rectangular' | Spiral): CloudLayout<W>;
  fontSize(size: number | Accessor<W, number>): CloudLayout<W>;
  padding(padding: number | Accessor<W, number>): CloudLayout<W>;
  random(random: () => number): CloudLayout<W>;
  /** Told of each word placed */
  on(type: 'word', listener: (word: W) => void): CloudLayout<W>;
  /** Told at the end: the words placed and the box around them */
  on(type: 'end', listener: (tags: W[], bounds: CloudBounds | null) => void): CloudLayout<W>;
}

const functor = <W, V>(value: V | Accessor<W, V>): Accessor<W, V> =>
  typeof value === 'function' ? (value as Accessor<W, V>) : () => value;

const pageCanvas = (): CloudCanvas => document.createElement('canvas') as unknown as CloudCanvas;

const context2d = (canvas: CloudCanvas): CloudContext => {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The tag cloud has no canvas to measure its words on');
  return context;
};

/** One of a word's numbers, which the layout has set by the time it reads it */
const num = (value: number | undefined): number => value as number;

export function cloudLayout<W extends CloudWord>(): CloudLayout<W> {
  let size: [number, number] = [256, 256];
  let text: Accessor<W, string> = (d) => d.text as string;
  let font: Accessor<W, string> = () => 'serif';
  let fontSize: Accessor<W, number> = (d) => Math.sqrt(Number((d as W & { value?: unknown }).value));
  let fontStyle: Accessor<W, string> = () => 'normal';
  let fontWeight: Accessor<W, string> = () => 'normal';
  let rotate: Accessor<W, number | undefined> = () => (~~(Math.random() * 6) - 3) * 30;
  let padding: Accessor<W, number> = () => 1;
  let spiral: Spiral = archimedeanSpiral;
  let words: W[] = [];
  let timeInterval = Infinity;
  let timer: ReturnType<typeof setInterval> | null = null;
  let random: () => number = Math.random;
  let canvas: () => CloudCanvas = pageCanvas;
  let onWord: ((word: W) => void) | undefined;
  let onEnd: ((tags: W[], bounds: CloudBounds | null) => void) | undefined;

  const cloud: CloudLayout<W> = {
    canvas(make) {
      canvas = make;
      return cloud;
    },

    start() {
      const contextAndRatio = getContext(canvas());
      const board = zeroArray((size[0] >> 5) * size[1]);
      let bounds: CloudBounds | null = null;
      const n = words.length;
      let i = -1;
      const tags: W[] = [];
      const data = words
        .map((d, index) => {
          d.text = text(d, index);
          d.font = font(d, index);
          d.style = fontStyle(d, index);
          d.weight = fontWeight(d, index);
          d.rotate = rotate(d, index);
          d.size = ~~fontSize(d, index);
          d.padding = padding(d, index);
          return d;
        })
        .sort((a, b) => num(b.size) - num(a.size));

      const step = () => {
        const begun = Date.now();
        while (Date.now() - begun < timeInterval && ++i < n && timer) {
          const d = data[i];
          d.x = (size[0] * (random() + 0.5)) >> 1;
          d.y = (size[1] * (random() + 0.5)) >> 1;
          cloudSprite(contextAndRatio, d, data, i);
          if (d.hasText && place(board, d, bounds)) {
            tags.push(d);
            onWord?.(d);
            if (bounds) cloudBounds(bounds, d);
            else {
              bounds = [
                { x: d.x + num(d.x0), y: d.y + num(d.y0) },
                { x: d.x + num(d.x1), y: d.y + num(d.y1) },
              ];
            }
            // Temporary hack
            d.x -= size[0] >> 1;
            d.y -= size[1] >> 1;
          }
        }
        if (i >= n) {
          cloud.stop();
          onEnd?.(tags, bounds);
        }
      };

      if (timer) clearInterval(timer);
      timer = setInterval(step, 0);
      step();

      return cloud;
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      return cloud;
    },

    timeInterval(milliseconds) {
      timeInterval = milliseconds == null ? Infinity : milliseconds;
      return cloud;
    },
    words(next) {
      words = next;
      return cloud;
    },
    size(next) {
      size = [+next[0], +next[1]];
      return cloud;
    },
    font(next) {
      font = functor(next);
      return cloud;
    },
    fontStyle(next) {
      fontStyle = functor(next);
      return cloud;
    },
    fontWeight(next) {
      fontWeight = functor(next);
      return cloud;
    },
    rotate(next) {
      rotate = functor(next);
      return cloud;
    },
    text(next) {
      text = functor(next);
      return cloud;
    },
    spiral(next) {
      spiral = next === 'archimedean' ? archimedeanSpiral : next === 'rectangular' ? rectangularSpiral : next;
      return cloud;
    },
    fontSize(next) {
      fontSize = functor(next);
      return cloud;
    },
    padding(next) {
      padding = functor(next);
      return cloud;
    },
    random(next) {
      random = next;
      return cloud;
    },
    on(type: 'word' | 'end', listener: ((word: W) => void) | ((tags: W[], bounds: CloudBounds | null) => void)) {
      if (type === 'word') onWord = listener as (word: W) => void;
      else onEnd = listener as (tags: W[], bounds: CloudBounds | null) => void;
      return cloud;
    },
  };

  function getContext(target: CloudCanvas): ContextAndRatio {
    target.width = target.height = 1;
    const ratio = Math.sqrt(context2d(target).getImageData(0, 0, 1, 1).data.length >> 2);
    target.width = (cw << 5) / ratio;
    target.height = ch / ratio;

    const context = context2d(target);
    context.fillStyle = context.strokeStyle = 'red';
    context.textAlign = 'center';

    return { context, ratio };
  }

  function place(board: number[], tag: W, bounds: CloudBounds | null): boolean {
    const startX = num(tag.x);
    const startY = num(tag.y);
    const maxDelta = Math.sqrt(size[0] * size[0] + size[1] * size[1]);
    const s = spiral(size);
    const dt = random() < 0.5 ? 1 : -1;
    let t = -dt;
    let dxdy: [number, number] | undefined;
    let dx: number;
    let dy: number;

    while ((dxdy = s((t += dt)))) {
      dx = ~~dxdy[0];
      dy = ~~dxdy[1];

      if (Math.min(Math.abs(dx), Math.abs(dy)) >= maxDelta) break;

      tag.x = startX + dx;
      tag.y = startY + dy;

      if (tag.x + num(tag.x0) < 0 || tag.y + num(tag.y0) < 0 || tag.x + num(tag.x1) > size[0] || tag.y + num(tag.y1) > size[1]) {
        continue;
      }
      // TODO only check for collisions within current bounds.
      if (!bounds || !cloudCollide(tag, board, size[0])) {
        if (!bounds || collideRects(tag, bounds)) {
          const sprite = tag.sprite as number[];
          const w = num(tag.width) >> 5;
          const sw = size[0] >> 5;
          const lx = tag.x - (w << 4);
          const sx = lx & 0x7f;
          const msx = 32 - sx;
          const h = num(tag.y1) - num(tag.y0);
          let x = (tag.y + num(tag.y0)) * sw + (lx >> 5);
          let last: number;
          for (let j = 0; j < h; j++) {
            last = 0;
            for (let k = 0; k <= w; k++) {
              board[x + k] |= (last << msx) | (k < w ? (last = sprite[j * w + k]) >>> sx : 0);
            }
            x += sw;
          }
          delete tag.sprite;
          return true;
        }
      }
    }
    return false;
  }

  return cloud;
}

interface ContextAndRatio {
  context: CloudContext;
  ratio: number;
}

// Fetches a monochrome sprite bitmap for the specified text.
// Load in batches for speed.
function cloudSprite<W extends CloudWord>(contextAndRatio: ContextAndRatio, word: W, data: W[], index: number): void {
  if (word.sprite) return;
  const c = contextAndRatio.context;
  const ratio = contextAndRatio.ratio;

  c.clearRect(0, 0, (cw << 5) / ratio, ch / ratio);
  let x = 0;
  let y = 0;
  let maxh = 0;
  const n = data.length;
  let di = index - 1;
  while (++di < n) {
    const d = data[di];
    const size = num(d.size);
    c.save();
    c.font = `${d.style} ${d.weight} ${~~((size + 1) / ratio)}px ${d.font}`;
    let w = c.measureText(`${d.text}m`).width * ratio;
    let h = size << 1;
    if (d.rotate) {
      const sr = Math.sin(d.rotate * cloudRadians);
      const cr = Math.cos(d.rotate * cloudRadians);
      const wcr = w * cr;
      const wsr = w * sr;
      const hcr = h * cr;
      const hsr = h * sr;
      w = ((Math.max(Math.abs(wcr + hsr), Math.abs(wcr - hsr)) + 0x1f) >> 5) << 5;
      h = ~~Math.max(Math.abs(wsr + hcr), Math.abs(wsr - hcr));
    } else {
      w = ((w + 0x1f) >> 5) << 5;
    }
    if (h > maxh) maxh = h;
    if (x + w >= cw << 5) {
      x = 0;
      y += maxh;
      maxh = 0;
    }
    if (y + h >= ch) break;
    c.translate((x + (w >> 1)) / ratio, (y + (h >> 1)) / ratio);
    if (d.rotate) c.rotate(d.rotate * cloudRadians);
    c.fillText(d.text as string, 0, 0);
    if (d.padding) {
      c.lineWidth = 2 * d.padding;
      c.strokeText(d.text as string, 0, 0);
    }
    c.restore();
    d.width = w;
    d.height = h;
    d.xoff = x;
    d.yoff = y;
    d.x1 = w >> 1;
    d.y1 = h >> 1;
    d.x0 = -d.x1;
    d.y0 = -d.y1;
    d.hasText = true;
    x += w;
  }
  // Every word drawn before is read again from this canvas, as the original reads them all
  const pixels = c.getImageData(0, 0, (cw << 5) / ratio, ch / ratio).data;
  const sprite: number[] = [];
  while (--di >= 0) {
    const d = data[di];
    if (!d.hasText) continue;
    const w = num(d.width);
    const w32 = w >> 5;
    let h = num(d.y1) - num(d.y0);
    // Zero the buffer
    for (let i = 0; i < h * w32; i++) sprite[i] = 0;
    if (d.xoff == null) return;
    x = d.xoff;
    y = num(d.yoff);
    let seen = 0;
    let seenRow = -1;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = w32 * j + (i >> 5);
        const m = pixels[((y + j) * (cw << 5) + (x + i)) << 2] ? 1 << (31 - (i % 32)) : 0;
        sprite[k] |= m;
        seen |= m;
      }
      if (seen) seenRow = j;
      else {
        d.y0 = num(d.y0) + 1;
        h--;
        j--;
        y++;
      }
    }
    d.y1 = num(d.y0) + seenRow;
    d.sprite = sprite.slice(0, (d.y1 - num(d.y0)) * w32);
  }
}

// Use mask-based collision detection.
function cloudCollide(tag: CloudWord, board: number[], boardWidth: number): boolean {
  const sw = boardWidth >> 5;
  const sprite = tag.sprite as number[];
  const w = num(tag.width) >> 5;
  const lx = num(tag.x) - (w << 4);
  const sx = lx & 0x7f;
  const msx = 32 - sx;
  const h = num(tag.y1) - num(tag.y0);
  let x = (num(tag.y) + num(tag.y0)) * sw + (lx >> 5);
  let last: number;
  for (let j = 0; j < h; j++) {
    last = 0;
    for (let i = 0; i <= w; i++) {
      if (((last << msx) | (i < w ? (last = sprite[j * w + i]) >>> sx : 0)) & board[x + i]) return true;
    }
    x += sw;
  }
  return false;
}

function cloudBounds(bounds: CloudBounds, d: CloudWord): void {
  const b0 = bounds[0];
  const b1 = bounds[1];
  const x = num(d.x);
  const y = num(d.y);
  if (x + num(d.x0) < b0.x) b0.x = x + num(d.x0);
  if (y + num(d.y0) < b0.y) b0.y = y + num(d.y0);
  if (x + num(d.x1) > b1.x) b1.x = x + num(d.x1);
  if (y + num(d.y1) > b1.y) b1.y = y + num(d.y1);
}

function collideRects(a: CloudWord, b: CloudBounds): boolean {
  const x = num(a.x);
  const y = num(a.y);
  return x + num(a.x1) > b[0].x && x + num(a.x0) < b[1].x && y + num(a.y1) > b[0].y && y + num(a.y0) < b[1].y;
}

function archimedeanSpiral(size: [number, number]): (t: number) => [number, number] {
  const e = size[0] / size[1];
  return (t) => {
    const turn = t * 0.1;
    return [e * turn * Math.cos(turn), turn * Math.sin(turn)];
  };
}

function rectangularSpiral(size: [number, number]): (t: number) => [number, number] {
  const dy = 4;
  const dx = (dy * size[0]) / size[1];
  let x = 0;
  let y = 0;
  return (t) => {
    const sign = t < 0 ? -1 : 1;
    // See triangular numbers: T_n = n * (n + 1) / 2.
    switch ((Math.sqrt(1 + 4 * sign * t) - sign) & 3) {
      case 0:
        x += dx;
        break;
      case 1:
        y += dy;
        break;
      case 2:
        x -= dx;
        break;
      default:
        y -= dy;
        break;
    }
    return [x, y];
  };
}

// TODO reuse arrays?
function zeroArray(n: number): number[] {
  const a: number[] = [];
  let i = -1;
  while (++i < n) a[i] = 0;
  return a;
}
