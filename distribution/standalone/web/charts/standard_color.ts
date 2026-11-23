/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A colour of visualization:colorMapping as OpenSearch Dashboards reads it before it compares it
 * with the palette: the charts plugin's MappedColors runs every value of the setting through
 * `new Color(value).hex().toLowerCase()` (color 1.0.3, with the color-string, color-convert and
 * color-name it brings). That gives '#rrggbb' in lower case for a text (#hex, rgb(), hsl(), hwb()
 * or the name of a colour), a number, a list of channels or an object of them, and black for an
 * empty value. Where the original cannot read a value it throws, and every chart of the page fails
 * with it; here such a value gives `undefined`, and the charts go on. So does an object of xyz,
 * lab, lch, hcg, apple, ansi, hex or keyword channels, which the original reads too.
 */

type Model = 'rgb' | 'hsl' | 'hsv' | 'hwb' | 'cmyk' | 'gray';

// color-name: the 148 colours with a name, as color-string looks them up (lower case only)
const NAMES =
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc ' +
  'bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a ' +
  'burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 ' +
  'cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b ' +
  'darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b ' +
  'darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 ' +
  'darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f ' +
  'darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff ' +
  'dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 ' +
  'forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 ' +
  'gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 ' +
  'indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 ' +
  'lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
  'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 ' +
  'lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 ' +
  'lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 ' +
  'linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd ' +
  'mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee ' +
  'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 ' +
  'mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 ' +
  'olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa ' +
  'palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 ' +
  'peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 ' +
  'rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 ' +
  'seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd ' +
  'slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c ' +
  'teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff ' +
  'whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32';

const NAMED = new Map<string, number[]>(
  NAMES.split(' ').map((entry) => {
    const [name, hex] = entry.split(':');
    return [name, [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16))];
  })
);

// color-string's patterns
const ABBR = /^#([a-f0-9]{3,4})$/i;
const HEX = /^#([a-f0-9]{6})([a-f0-9]{2})?$/i;
const RGBA = /^rgba?\(\s*([+-]?\d+)(?=[\s,])\s*(?:,\s*)?([+-]?\d+)(?=[\s,])\s*(?:,\s*)?([+-]?\d+)\s*(?:[,|/]\s*([+-]?[\d.]+)(%?)\s*)?\)$/;
const PER = /^rgba?\(\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*(?:[,|/]\s*([+-]?[\d.]+)(%?)\s*)?\)$/;
const KEYWORD = /^(\w+)$/;
const ALPHA = '([+-]?(?=\\.\\d|\\d)(?:0|[1-9]\\d*)?(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)';
const HSL = new RegExp(
  `^hsla?\\(\\s*([+-]?(?:\\d{0,3}\\.)?\\d+)(?:deg)?\\s*,?\\s*([+-]?[\\d.]+)%\\s*,?\\s*([+-]?[\\d.]+)%\\s*(?:[,|/]\\s*${ALPHA}\\s*)?\\)$`
);
const HWB = new RegExp(
  `^hwb\\(\\s*([+-]?\\d{0,3}(?:\\.\\d+)?)(?:deg)?\\s*,\\s*([+-]?[\\d.]+)%\\s*,\\s*([+-]?[\\d.]+)%\\s*(?:,\\s*${ALPHA}\\s*)?\\)$`
);

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(low, value), high);
const hue = (value: number) => ((value % 360) + 360) % 360;
const upTo = (most: number) => (value: number) => Math.max(0, Math.min(most, value));
const byte = upTo(255);
const percent = upTo(100);

/** color's limits of each channel of a model */
const LIMITS: Record<Model, Array<((value: number) => number) | undefined>> = {
  rgb: [byte, byte, byte],
  hsl: [hue, percent, percent],
  hsv: [hue, percent, percent],
  hwb: [hue, percent, percent],
  cmyk: [percent, percent, percent, percent],
  gray: [undefined],
};

/** The model an object's channels name, by its keys in order; `null` for those not read here */
const MODEL_OF_KEYS = new Map<string, Model | null>([
  ['bgr', 'rgb'],
  ['hls', 'hsl'],
  ['hsv', 'hsv'],
  ['bhw', 'hwb'],
  ['ckmy', 'cmyk'],
  ['gray', 'gray'],
  ['xyz', null],
  ['abl', null],
  ['chl', null],
  ['cgh', null],
  ['b16g16r16', null],
  ['ansi16', null],
  ['ansi256', null],
  ['hex', null],
  ['keyword', null],
]);

const LABELS: Record<Model, string[]> = {
  rgb: ['r', 'g', 'b'],
  hsl: ['h', 's', 'l'],
  hsv: ['h', 's', 'v'],
  hwb: ['h', 'w', 'b'],
  cmyk: ['c', 'm', 'y', 'k'],
  gray: ['gray'],
};

/** color-convert's conversions to RGB, unrounded */
const TO_RGB: Record<Exclude<Model, 'rgb'>, (channels: number[]) => number[] | undefined> = {
  hsl([hueOf, saturation, lightness]) {
    const h = hueOf / 360;
    const s = saturation / 100;
    const l = lightness / 100;
    if (s === 0) {
      const value = l * 255;
      return [value, value, value];
    }
    const t2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const t1 = 2 * l - t2;
    const rgb = [0, 0, 0];
    for (let i = 0; i < 3; i += 1) {
      let t3 = h + (1 / 3) * -(i - 1);
      if (t3 < 0) t3 += 1;
      if (t3 > 1) t3 -= 1;
      let value: number;
      if (6 * t3 < 1) value = t1 + (t2 - t1) * 6 * t3;
      else if (2 * t3 < 1) value = t2;
      else if (3 * t3 < 2) value = t1 + (t2 - t1) * (2 / 3 - t3) * 6;
      else value = t1;
      rgb[i] = value * 255;
    }
    return rgb;
  },
  hsv([hueOf, saturation, brightness]) {
    const h = hueOf / 60;
    const s = saturation / 100;
    let v = brightness / 100;
    const hi = Math.floor(h) % 6;
    const f = h - Math.floor(h);
    const p = 255 * v * (1 - s);
    const q = 255 * v * (1 - s * f);
    const t = 255 * v * (1 - s * (1 - f));
    v *= 255;
    switch (hi) {
      case 0:
        return [v, t, p];
      case 1:
        return [q, v, p];
      case 2:
        return [p, v, t];
      case 3:
        return [p, q, v];
      case 4:
        return [t, p, v];
      case 5:
        return [v, p, q];
      default:
        return undefined;
    }
  },
  hwb([hueOf, whiteness, blackness]) {
    const h = hueOf / 360;
    let wh = whiteness / 100;
    let bl = blackness / 100;
    const ratio = wh + bl;
    if (ratio > 1) {
      wh /= ratio;
      bl /= ratio;
    }
    const i = Math.floor(6 * h);
    const v = 1 - bl;
    let f = 6 * h - i;
    if ((i & 0x01) !== 0) f = 1 - f;
    const n = wh + f * (v - wh);
    const channels: Record<number, [number, number, number]> = {
      1: [n, v, wh],
      2: [wh, v, n],
      3: [wh, n, v],
      4: [n, wh, v],
      5: [v, wh, n],
    };
    const [r, g, b] = channels[i] ?? [v, n, wh];
    return [r * 255, g * 255, b * 255];
  },
  cmyk([cyan, magenta, yellow, black]) {
    const c = cyan / 100;
    const m = magenta / 100;
    const y = yellow / 100;
    const k = black / 100;
    const r = 1 - Math.min(1, c * (1 - k) + k);
    const g = 1 - Math.min(1, m * (1 - k) + k);
    const b = 1 - Math.min(1, y * (1 - k) + k);
    return [r * 255, g * 255, b * 255];
  },
  gray([gray]) {
    return [(gray / 100) * 255, (gray / 100) * 255, (gray / 100) * 255];
  },
};

interface Read {
  model: Model;
  channels: number[];
  alpha: number;
}

/** color-string's get: what a text says, or undefined when it says no colour */
function readText(text: string): Read | undefined {
  const prefix = text.substring(0, 3).toLowerCase();
  if (prefix === 'hsl' || prefix === 'hwb') {
    const match = (prefix === 'hsl' ? HSL : HWB).exec(text);
    if (!match) return undefined;
    const channels = [hue(parseFloat(match[1])), clamp(parseFloat(match[2]), 0, 100), clamp(parseFloat(match[3]), 0, 100)];
    return { model: prefix, channels, alpha: 1 };
  }
  const hex = HEX.exec(text);
  const abbr = hex ? null : ABBR.exec(text);
  const rgba = hex || abbr ? null : RGBA.exec(text);
  const per = hex || abbr || rgba ? null : PER.exec(text);
  let rgb: number[];
  if (hex) rgb = [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16));
  else if (abbr) rgb = [0, 1, 2].map((at) => parseInt(abbr[1][at] + abbr[1][at], 16));
  else if (rgba) rgb = [1, 2, 3].map((at) => parseInt(rgba[at], 10));
  else if (per) rgb = [1, 2, 3].map((at) => Math.round(parseFloat(per[at]) * 2.55));
  else {
    const keyword = KEYWORD.exec(text);
    if (!keyword) return undefined;
    if (keyword[1] === 'transparent') return { model: 'rgb', channels: [0, 0, 0], alpha: 0 };
    const named = NAMED.get(keyword[1]);
    return named ? { model: 'rgb', channels: [...named], alpha: 1 } : undefined;
  }
  return { model: 'rgb', channels: rgb.map((channel) => clamp(channel, 0, 255)), alpha: 1 };
}

/** `new Color(value)`: the model and channels it reads, or undefined where it throws */
function read(value: unknown): Read | undefined {
  if (!value) return { model: 'rgb', channels: [0, 0, 0], alpha: 1 };
  if (typeof value === 'string') return readText(value);
  if (typeof value === 'object' && (value as { length?: unknown }).length) {
    // A list of channels, of red, green and blue; what is not a number counts as nought
    const channels = Array.prototype.slice.call(value as ArrayLike<unknown>, 0, 3) as unknown[];
    return { model: 'rgb', channels: [0, 1, 2].map((at) => (typeof channels[at] === 'number' ? (channels[at] as number) : 0)), alpha: 1 };
  }
  if (typeof value === 'number') {
    const rgb = value & 0xffffff;
    return { model: 'rgb', channels: [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff], alpha: 1 };
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  let alpha = 1;
  if ('alpha' in record) {
    keys.splice(keys.indexOf('alpha'), 1);
    alpha = typeof record.alpha === 'number' ? record.alpha : 0;
  }
  const model = MODEL_OF_KEYS.get(keys.sort().join(''));
  if (!model) return undefined;
  return { model, channels: LABELS[model].map((label) => Number(record[label])), alpha: Math.max(0, Math.min(1, alpha)) };
}

/** color-string's two hex digits of a channel */
function hexDouble(value: number): string {
  const text = Math.round(value).toString(16).toUpperCase();
  return text.length < 2 ? `0${text}` : text;
}

/** A channel list as `new Color(list, 'rgb')` keeps it: three numbers, each from 0 to 255 */
const asRgb = (channels: unknown[]): number[] => [0, 1, 2].map((at) => byte(typeof channels[at] === 'number' ? (channels[at] as number) : 0));

/**
 * The colour of a value of visualization:colorMapping as the original compares it: '#rrggbb' in
 * lower case, or `undefined` for a value it cannot read
 */
export function standardColor(value: unknown): string | undefined {
  const color = read(value);
  if (!color) return undefined;
  const limits = LIMITS[color.model];
  const limited = color.channels.map((channel, index) => limits[index]?.(channel) ?? channel);
  // .rgb(): a conversion that gives nothing leaves the alpha in its second channel, as there
  const converted: unknown[] =
    color.model === 'rgb' ? limited : [...(TO_RGB[color.model](limited) ?? [undefined]), color.alpha];
  // .round(), then the hex of what is left
  const rounded = asRgb(asRgb(converted).map((channel) => Number(channel.toFixed(0))));
  return `#${rounded.map(hexDouble).join('')}`.toLowerCase();
}
