/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parts of d3 3.5.17 that OpenSearch Dashboards' tag cloud is drawn with, so that its words get
 * the same sizes, colours and moves as there, number for number: the extent of the values, the
 * linear, log and square root scales, the ordinal scale of the colours, the interpolation of the
 * numbers in a text and of an SVG transform, and the transitions, eased in and out, that run on the
 * page's animation frames. d3 is under the BSD 3-Clause License, Copyright (c) 2010-2016, Michael
 * Bostock (licenses/d3.txt).
 */

/** d3.extent with an accessor: the least and the greatest value, passing over missing ones */
export function extent<T>(array: T[], value: (item: T, index: number) => unknown): [unknown, unknown] {
  const n = array.length;
  let i = -1;
  let a: unknown;
  let b: unknown;
  let c: unknown;
  while (++i < n) {
    // The first value that is there and is a number (NaN is not equal to itself)
    if ((b = value(array[i], i)) != null && (b as number) >= (b as number)) {
      a = c = b;
      break;
    }
  }
  while (++i < n) {
    if ((b = value(array[i], i)) != null) {
      if ((a as number) > (b as number)) a = b;
      if ((c as number) < (b as number)) c = b;
    }
  }
  return [a, c];
}

const interpolateNumber = (from: unknown, to: unknown) => {
  const a = Number(from);
  const b = Number(to);
  return (t: number) => a * (1 - t) + b * t;
};

const uninterpolateNumber = (from: unknown, to: unknown) => {
  const a = Number(from);
  let b = Number(to) - a;
  b = b || 1 / b;
  return (x: number) => (x - a) / b;
};

/** A scale from a domain of two values to a range of two numbers */
export type Scale = (value: unknown) => number;

/** d3.scale.linear().range(range).domain(domain) */
export function linearScale(domain: [unknown, unknown], range: [number, number]): Scale {
  const [d0, d1] = domain.map(Number);
  const u = uninterpolateNumber(d0, d1);
  const i = interpolateNumber(range[0], range[1]);
  return (x) => i(u(Number(x)));
}

/** d3.scale.log(), of base 10: the logarithms on a linear scale, of negative values when the domain starts below zero */
export function logScale(domain: [unknown, unknown], range: [number, number]): Scale {
  const positive = Number(domain[0]) >= 0;
  const log = (x: number) => (positive ? Math.log(x < 0 ? 0 : x) : -Math.log(x > 0 ? 0 : -x)) / Math.log(10);
  const [d0, d1] = domain.map(Number);
  const linear = linearScale([log(d0), log(d1)], range);
  return (x) => linear(log(Number(x)));
}

const powPow = (e: number) => (x: number) => (x < 0 ? -Math.pow(-x, e) : Math.pow(x, e));

/** d3.scale.sqrt(): the power of one half on a linear scale */
export function sqrtScale(domain: [unknown, unknown], range: [number, number]): Scale {
  const powp = powPow(0.5);
  const [d0, d1] = domain.map(Number);
  const linear = linearScale([powp(d0), powp(d1)], range);
  return (x) => linear(powp(Number(x)));
}

/**
 * d3.scale.ordinal().range(range): each value the next of the range, in the order they are first
 * asked for, and the same again whenever it is asked for again
 */
export function ordinalScale<T>(range: T[]): (value: unknown) => T {
  const index = new Map<string, number>();
  let count = 0;
  return (value) => {
    const key = String(value);
    let at = index.get(key);
    if (!at) {
      count += 1;
      at = count;
      index.set(key, at);
    }
    return range[(at - 1) % range.length];
  };
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g;

/** d3.interpolateString: the numbers in one text moved to those in the other, the rest as the other has it */
export function interpolateString(from: string, to: string): (t: number) => string {
  const numberA = new RegExp(NUMBER.source, 'g');
  const numberB = new RegExp(NUMBER.source, 'g');
  const a = `${from}`;
  const b = `${to}`;
  let bi = 0;
  let am: RegExpExecArray | null;
  let bm: RegExpExecArray | null;
  let i = -1;
  const s: Array<string | number | null> = [];
  const q: Array<{ i: number; x: (t: number) => number }> = [];
  while ((am = numberA.exec(a)) && (bm = numberB.exec(b))) {
    let bs: number | string = bm.index;
    if (bs > bi) {
      bs = b.slice(bi, bs);
      if (s[i]) s[i] = `${s[i]}${bs}`;
      else s[++i] = bs;
    }
    const an = am[0];
    const bn = bm[0];
    if (an === bn) {
      if (s[i]) s[i] = `${s[i]}${bn}`;
      else s[++i] = bn;
    } else {
      s[++i] = null;
      q.push({ i, x: interpolateNumber(an, bn) });
    }
    bi = numberB.lastIndex;
  }
  if (bi < b.length) {
    const bs = b.slice(bi);
    if (s[i]) s[i] = `${s[i]}${bs}`;
    else s[++i] = bs;
  }
  if (s.length < 2) {
    const only = q[0];
    return only ? (t) => `${only.x(t)}` : () => b;
  }
  return (t) => {
    for (const o of q) s[o.i] = o.x(t);
    return s.join('');
  };
}

/** The six numbers of a 2D transform: x' = a x + c y + e, y' = b x + d y + f */
export interface TransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: TransformMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const SVG_NS = 'http://www.w3.org/2000/svg';
let probe: SVGGElement | undefined;

/** The matrix of an SVG transform as the page reads it, as d3.transform has it read */
export function pageMatrix(value: string | null): TransformMatrix {
  if (value == null) return IDENTITY;
  probe ??= document.createElementNS(SVG_NS, 'g');
  probe.setAttribute('transform', value);
  const consolidated = probe.transform.baseVal.consolidate();
  return consolidated ? consolidated.matrix : IDENTITY;
}

interface Decomposed {
  translate: [number, number];
  rotate: number;
  skew: number;
  scale: [number, number];
}

const DEGREES = 180 / Math.PI;
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1];
const normalize = (a: number[]) => {
  const k = Math.sqrt(dot(a, a));
  if (k) {
    a[0] /= k;
    a[1] /= k;
  }
  return k;
};
const combine = (a: number[], b: number[], k: number) => {
  a[0] += k * b[0];
  a[1] += k * b[1];
  return a;
};

/** d3_transform: a matrix as a translation, a rotation, a skew and a scale */
export function decomposeMatrix(m: TransformMatrix): Decomposed {
  const r0 = [m.a, m.b];
  const r1 = [m.c, m.d];
  let kx = normalize(r0);
  let kz = dot(r0, r1);
  const ky = normalize(combine(r1, r0, -kz)) || 0;
  if (r0[0] * r1[1] < r1[0] * r0[1]) {
    r0[0] *= -1;
    r0[1] *= -1;
    kx *= -1;
    kz *= -1;
  }
  return {
    rotate: (kx ? Math.atan2(r0[1], r0[0]) : Math.atan2(-r1[0], r1[1])) * DEGREES,
    translate: [m.e, m.f],
    scale: [kx, ky],
    skew: ky ? Math.atan2(kz, ky) * DEGREES : 0,
  };
}

type Part = string | number | null;
type Step = { i: number; x: (t: number) => number };

const pop = (s: Part[]) => (s.length ? `${s.pop()},` : '');

/**
 * d3.interpolateTransform: from one SVG transform to another by their translations, rotations,
 * skews and scales, written as d3 writes them on the way and at the end
 */
export function interpolateTransform(
  from: string | null,
  to: string | null,
  matrixOf: (value: string | null) => TransformMatrix = pageMatrix
): (t: number) => string {
  const s: Part[] = [];
  const q: Step[] = [];
  const a = decomposeMatrix(matrixOf(from));
  const b = decomposeMatrix(matrixOf(to));
  // Translate
  if (a.translate[0] !== b.translate[0] || a.translate[1] !== b.translate[1]) {
    const i = s.push('translate(', null, ',', null, ')');
    q.push({ i: i - 4, x: interpolateNumber(a.translate[0], b.translate[0]) }, { i: i - 2, x: interpolateNumber(a.translate[1], b.translate[1]) });
  } else if (b.translate[0] || b.translate[1]) {
    s.push(`translate(${b.translate})`);
  }
  // Rotate
  let ra = a.rotate;
  let rb = b.rotate;
  if (ra !== rb) {
    if (ra - rb > 180) rb += 360;
    else if (rb - ra > 180) ra += 360;
    q.push({ i: s.push(`${pop(s)}rotate(`, null, ')') - 2, x: interpolateNumber(ra, rb) });
  } else if (rb) {
    s.push(`${pop(s)}rotate(${rb})`);
  }
  // Skew
  if (a.skew !== b.skew) {
    q.push({ i: s.push(`${pop(s)}skewX(`, null, ')') - 2, x: interpolateNumber(a.skew, b.skew) });
  } else if (b.skew) {
    s.push(`${pop(s)}skewX(${b.skew})`);
  }
  // Scale
  if (a.scale[0] !== b.scale[0] || a.scale[1] !== b.scale[1]) {
    const i = s.push(`${pop(s)}scale(`, null, ',', null, ')');
    q.push({ i: i - 4, x: interpolateNumber(a.scale[0], b.scale[0]) }, { i: i - 2, x: interpolateNumber(a.scale[1], b.scale[1]) });
  } else if (b.scale[0] !== 1 || b.scale[1] !== 1) {
    s.push(`${pop(s)}scale(${b.scale})`);
  }
  return (t) => {
    for (const o of q) s[o.i] = o.x(t);
    return s.join('');
  };
}

/** d3's default ease of a transition: cubic, in and out */
export function cubicInOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const t2 = t * t;
  const t3 = t2 * t;
  return 4 * (t < 0.5 ? t3 : 3 * (t - t2) + t3 - 0.75);
}

/* --- Transitions --------------------------------------------------------------------------- */

interface Timer {
  /** When it is due */
  time: number;
  /** Called on each frame from then with the time since, until it says it is done */
  callback: ((elapsed: number) => boolean) | null;
}

const timers: Timer[] = [];
let framing = false;

const requestFrame = (step: () => void) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
  else setTimeout(step, 17);
};

// The timers due, on each frame, in the order they were made, those made on the way included
function frame() {
  framing = false;
  const now = Date.now();
  for (let index = 0; index < timers.length; index += 1) {
    const timer = timers[index];
    if (timer.callback && now >= timer.time && timer.callback(now - timer.time)) timer.callback = null;
  }
  for (let index = timers.length - 1; index >= 0; index -= 1) if (!timers[index].callback) timers.splice(index, 1);
  if (timers.length) {
    framing = true;
    requestFrame(frame);
  }
}

function addTimer(callback: (elapsed: number) => boolean, time: number) {
  timers.push({ callback, time });
  if (!framing) {
    framing = true;
    requestFrame(frame);
  }
}

/** A change of one element over a transition: made when it starts, from what the element has then */
export type TweenFactory = () => ((t: number) => void) | undefined;

/**
 * A transition of elements, as d3's selection.transition(): it starts on the next animation
 * frame, when each element's tweens are made from what it has then, eases them over the duration,
 * and tells each element's end in the frame it reaches its end
 */
export function transition<N>(nodes: N[], duration: number, tweens: (node: N) => TweenFactory[], onEnd: (node: N) => void): void {
  const time = Date.now();
  for (const node of nodes) {
    const factories = tweens(node);
    let started: Array<(t: number) => void> | undefined;
    const tick = (elapsed: number) => {
      const t = elapsed / duration;
      const e = cubicInOut(t);
      if (started) for (let n = started.length; n > 0; ) started[--n](e);
      if (t >= 1) {
        onEnd(node);
        return true;
      }
      return false;
    };
    addTimer((elapsed) => {
      if (started) return tick(elapsed);
      started = [];
      for (const factory of factories) {
        const tween = factory();
        if (tween) started.push(tween);
      }
      // The first tick is in the frame it starts in
      return tick(elapsed || 1);
    }, time);
  }
}

/**
 * A tween of an attribute, as transition.attr: from the value the element has when the
 * transition starts, if it is not already the value it ends at
 */
export function attrTween(node: Element, name: string, to: string, interpolate: (a: string | null, b: string) => (t: number) => string): TweenFactory {
  return () => {
    const from = node.getAttribute(name);
    if (from === to) return undefined;
    const i = interpolate(from, to);
    return (t) => node.setAttribute(name, i(t));
  };
}

/**
 * A tween of a style, as transition.style: from the element's computed value when the transition
 * starts, if it is not already the value it ends at
 */
export function styleTween(node: SVGElement | HTMLElement, name: string, to: string): TweenFactory {
  return () => {
    const from = getComputedStyle(node).getPropertyValue(name);
    if (from === to) return undefined;
    const i = interpolateString(from, to);
    return (t) => node.style.setProperty(name, i(t), '');
  };
}
