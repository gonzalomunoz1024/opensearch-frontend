/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The colours of `.color()`: a colour as CSS writes it (a name, hex, rgb(), hsl() or hsv()) and
 * an even gradient through several of them, giving each series of a list its own, with the same
 * results as the tinycolor2 and tinygradient packages OpenSearch Dashboards uses.
 */

const NAMES: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '0ff', aquamarine: '7fffd4', azure: 'f0ffff',
  beige: 'f5f5dc', bisque: 'ffe4c4', black: '000', blanchedalmond: 'ffebcd', blue: '00f',
  blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', burntsienna: 'ea7e5d',
  cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e', coral: 'ff7f50',
  cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c', cyan: '0ff', darkblue: '00008b',
  darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9', darkgreen: '006400',
  darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f',
  darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a',
  darkseagreen: '8fbc8f', darkslateblue: '483d8b', darkslategray: '2f4f4f',
  darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3', deeppink: 'ff1493',
  deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff',
  firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'f0f',
  gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080',
  green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4',
  indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
  lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6',
  lightcoral: 'f08080', lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3',
  lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '789', lightslategrey: '789',
  lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '0f0', limegreen: '32cd32',
  linen: 'faf0e6', magenta: 'f0f', maroon: '800000', mediumaquamarine: '66cdaa',
  mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000',
  olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6',
  palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093',
  papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd',
  powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'f00', rosybrown: 'bc8f8f',
  royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460',
  seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb',
  slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa',
  springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8',
  tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'fff',
  whitesmoke: 'f5f5f5', yellow: 'ff0', yellowgreen: '9acd32',
};

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

type ColorInput = Record<string, string | number | undefined>;

const CSS_INTEGER = '[-\\+]?\\d+%?';
const CSS_NUMBER = '[-\\+]?\\d*\\.\\d+%?';
const CSS_UNIT = '(?:' + CSS_NUMBER + ')|(?:' + CSS_INTEGER + ')';
const SEP = '[,|\\s]+';
const MATCH3 = `[\\s|\\(]+(${CSS_UNIT})${SEP}(${CSS_UNIT})${SEP}(${CSS_UNIT})\\s*\\)?`;
const MATCH4 =
  `[\\s|\\(]+(${CSS_UNIT})${SEP}(${CSS_UNIT})${SEP}(${CSS_UNIT})${SEP}(${CSS_UNIT})` +
  '\\s*\\)?';
const MATCHERS = {
  unit: new RegExp(CSS_UNIT),
  rgb: new RegExp('rgb' + MATCH3),
  rgba: new RegExp('rgba' + MATCH4),
  hsl: new RegExp('hsl' + MATCH3),
  hsla: new RegExp('hsla' + MATCH4),
  hsv: new RegExp('hsv' + MATCH3),
  hsva: new RegExp('hsva' + MATCH4),
  hex3: /^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
  hex6: /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/,
  hex4: /^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
  hex8: /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/,
};

const isValidUnit = (value: unknown) => value !== undefined && MATCHERS.unit.test(String(value));
const hex = (value: string) => parseInt(value, 16);

function bound01(value: string | number, max: number): number {
  let n: string | number = value;
  if (typeof n === 'string' && n.indexOf('.') !== -1 && parseFloat(n) === 1) n = '100%';
  const percent = typeof n === 'string' && n.indexOf('%') !== -1;
  let result = Math.min(max, Math.max(0, parseFloat(String(n))));
  if (percent) result = parseInt(String(result * max), 10) / 100;
  if (Math.abs(result - max) < 0.000001) return 1;
  return (result % max) / max;
}

const toPercentage = (value: string | number) =>
  Number(value) <= 1 ? `${Number(value) * 100}%` : value;

function hslToRgb(h: string | number, s: string | number, l: string | number) {
  const hue = bound01(h, 360);
  const sat = bound01(s, 100);
  const light = bound01(l, 100);
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (sat === 0) {
    r = g = b = light;
  } else {
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    r = hue2rgb(p, q, hue + 1 / 3);
    g = hue2rgb(p, q, hue);
    b = hue2rgb(p, q, hue - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function hsvToRgb(h: string | number, s: string | number, v: string | number) {
  const hue = bound01(h, 360) * 6;
  const sat = bound01(s, 100);
  const val = bound01(v, 100);
  const i = Math.floor(hue);
  const f = hue - i;
  const p = val * (1 - sat);
  const q = val * (1 - f * sat);
  const t = val * (1 - (1 - f) * sat);
  const index = i % 6;
  return {
    r: [val, q, p, p, t, val][index] * 255,
    g: [t, val, val, q, p, p][index] * 255,
    b: [p, p, t, val, val, q][index] * 255,
  };
}

function fromString(text: string): ColorInput | false {
  let color = text.trim().toLowerCase();
  if (NAMES[color]) {
    color = NAMES[color];
  } else if (color === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  let match: RegExpExecArray | null;
  if ((match = MATCHERS.rgb.exec(color))) return { r: match[1], g: match[2], b: match[3] };
  if ((match = MATCHERS.rgba.exec(color))) {
    return { r: match[1], g: match[2], b: match[3], a: match[4] };
  }
  if ((match = MATCHERS.hsl.exec(color))) return { h: match[1], s: match[2], l: match[3] };
  if ((match = MATCHERS.hsla.exec(color))) {
    return { h: match[1], s: match[2], l: match[3], a: match[4] };
  }
  if ((match = MATCHERS.hsv.exec(color))) return { h: match[1], s: match[2], v: match[3] };
  if ((match = MATCHERS.hsva.exec(color))) {
    return { h: match[1], s: match[2], v: match[3], a: match[4] };
  }
  if ((match = MATCHERS.hex8.exec(color))) {
    return { r: hex(match[1]), g: hex(match[2]), b: hex(match[3]), a: hex(match[4]) / 255 };
  }
  if ((match = MATCHERS.hex6.exec(color))) {
    return { r: hex(match[1]), g: hex(match[2]), b: hex(match[3]) };
  }
  if ((match = MATCHERS.hex4.exec(color))) {
    return {
      r: hex(match[1] + match[1]),
      g: hex(match[2] + match[2]),
      b: hex(match[3] + match[3]),
      a: hex(match[4] + match[4]) / 255,
    };
  }
  if ((match = MATCHERS.hex3.exec(color))) {
    return { r: hex(match[1] + match[1]), g: hex(match[2] + match[2]), b: hex(match[3] + match[3]) };
  }
  return false;
}

/** A colour as tinycolor2 holds it: red, green and blue from 0 to 255, and alpha */
export class Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;

  constructor(input: string | ColorInput) {
    const color = typeof input === 'string' ? fromString(input) : input;
    let rgb = { r: 0, g: 0, b: 0 };
    let alpha: unknown = 1;
    if (color) {
      if (isValidUnit(color.r) && isValidUnit(color.g) && isValidUnit(color.b)) {
        rgb = {
          r: bound01(color.r as string | number, 255) * 255,
          g: bound01(color.g as string | number, 255) * 255,
          b: bound01(color.b as string | number, 255) * 255,
        };
      } else if (isValidUnit(color.h) && isValidUnit(color.s) && isValidUnit(color.v)) {
        rgb = hsvToRgb(
          color.h as string | number,
          toPercentage(color.s as string | number),
          toPercentage(color.v as string | number)
        );
      } else if (isValidUnit(color.h) && isValidUnit(color.s) && isValidUnit(color.l)) {
        rgb = hslToRgb(
          color.h as string | number,
          toPercentage(color.s as string | number),
          toPercentage(color.l as string | number)
        );
      }
      if (Object.prototype.hasOwnProperty.call(color, 'a')) alpha = color.a;
    }
    let a = parseFloat(String(alpha));
    if (isNaN(a) || a < 0 || a > 1) a = 1;
    const clamp = (value: number) => {
      const bounded = Math.min(255, Math.max(value, 0));
      return bounded < 1 ? Math.round(bounded) : bounded;
    };
    this.r = clamp(rgb.r);
    this.g = clamp(rgb.g);
    this.b = clamp(rgb.b);
    this.a = a;
  }

  toRgb(): Rgba {
    return { r: Math.round(this.r), g: Math.round(this.g), b: Math.round(this.b), a: this.a };
  }

  toHexString(): string {
    const pad2 = (value: number) => Math.round(value).toString(16).padStart(2, '0');
    return '#' + pad2(this.r) + pad2(this.g) + pad2(this.b);
  }
}

const RGBA_MAX: Rgba = { r: 256, g: 256, b: 256, a: 1 };

function interpolateRgb(start: Color, end: Color, steps: number): Color[] {
  const from = start.toRgb();
  const to = end.toRgb();
  const keys = ['r', 'g', 'b', 'a'] as const;
  const step = { r: 0, g: 0, b: 0, a: 0 };
  for (const key of keys) step[key] = steps === 0 ? 0 : (to[key] - from[key]) / steps;
  const gradient = [start];
  for (let i = 1; i < steps; i++) {
    const color: ColorInput = {};
    for (const key of keys) {
      let value = step[key] * i + from[key];
      if (value < 0) value += RGBA_MAX[key];
      else if (RGBA_MAX[key] !== 1) value %= RGBA_MAX[key];
      color[key] = value;
    }
    gradient.push(new Color(color));
  }
  return gradient;
}

/** tinygradient's `tinygradient(stops).rgb(steps)`: evenly spaced stops, `steps` colours */
export function rgbGradient(stops: string[], steps: number): Color[] {
  if (stops.length < 2) throw new Error('Invalid number of stops (< 2)');
  const l = stops.length;
  const positioned = stops.map((stop, i) => ({ color: new Color(stop), pos: i / (l - 1) }));

  if (isNaN(steps) || steps < 2) throw new Error('Invalid number of steps (< 2)');
  if (steps < l) throw new Error('Number of steps cannot be inferior to number of stops');

  const substeps: number[] = [];
  for (let i = 1; i < l; i++) {
    const step = (steps - 1) * (positioned[i].pos - positioned[i - 1].pos);
    substeps.push(Math.max(1, Math.round(step)));
  }
  let total = 1;
  for (let n = l - 1; n--; ) total += substeps[n];
  while (total !== steps) {
    if (total < steps) {
      substeps[substeps.indexOf(Math.min(...substeps))]++;
      total++;
    } else {
      substeps[substeps.indexOf(Math.max(...substeps))]--;
      total--;
    }
  }

  const gradient: Color[] = [];
  for (let i = 0; i < l - 1; i++) {
    gradient.push(...interpolateRgb(positioned[i].color, positioned[i + 1].color, substeps[i]));
  }
  gradient.push(positioned[l - 1].color);
  return gradient;
}
