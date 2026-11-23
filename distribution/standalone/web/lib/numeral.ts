/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Numbers written by a pattern such as "0,0.[000]", "0.0%", "0.[0]b" or "$0,0.00": the pattern
 * language OpenSearch Dashboards uses for a field's number format (it comes from the numeral
 * library). This reads the patterns people use: thousands separators, fixed and optional
 * decimals, percent, bytes, abbreviations (1.2k), ordinals, a sign, and text before or after.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
const BIT_UNITS = ['bit', 'kbit', 'Mbit', 'Gbit', 'Tbit', 'Pbit', 'Ebit', 'Zbit', 'Ybit'];
const ABBREVIATIONS: Array<[number, string]> = [
  [1e12, 't'],
  [1e9, 'b'],
  [1e6, 'm'],
  [1e3, 'k'],
];

interface Parsed {
  prefix: string;
  suffix: string;
  thousands: boolean;
  minDecimals: number;
  maxDecimals: number;
  percent: boolean;
  bytes: 'b' | 'bb' | 'bitd' | undefined;
  abbreviate: boolean;
  ordinal: boolean;
  forceSign: boolean;
  parentheses: boolean;
  spaceBeforeUnit: boolean;
}

const cache = new Map<string, Parsed>();

function parsePattern(pattern: string): Parsed {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let rest = pattern;
  const parsed: Parsed = {
    prefix: '',
    suffix: '',
    thousands: false,
    minDecimals: 0,
    maxDecimals: 0,
    percent: false,
    bytes: undefined,
    abbreviate: false,
    ordinal: false,
    forceSign: false,
    parentheses: false,
    spaceBeforeUnit: false,
  };

  if (/^\(.*\)$/.test(rest)) {
    parsed.parentheses = true;
    rest = rest.slice(1, -1);
  }
  // The number part starts at the first 0 (or a sign before it) and ends at the last 0 or ]
  const start = rest.search(/[+-]?0/);
  if (start === -1) {
    cache.set(pattern, parsed);
    return parsed;
  }
  parsed.prefix = rest.slice(0, start);
  rest = rest.slice(start);
  if (rest.startsWith('+')) {
    parsed.forceSign = true;
    rest = rest.slice(1);
  } else if (rest.startsWith('-')) {
    rest = rest.slice(1);
  }
  const body = /^[0,]*(\.(0*)(\[(0+)\])?|\[\.\](0+))?/.exec(rest)![0];
  let tail = rest.slice(body.length);
  parsed.thousands = body.includes(',');
  const decimals = /\.(0*)(?:\[(0+)\])?$/.exec(body);
  const optionalPoint = /\[\.\](0+)$/.exec(body);
  if (optionalPoint) {
    parsed.maxDecimals = optionalPoint[1].length;
  } else if (decimals) {
    parsed.minDecimals = decimals[1].length;
    parsed.maxDecimals = decimals[1].length + (decimals[2]?.length ?? 0);
  }

  if (tail.startsWith(' ')) {
    parsed.spaceBeforeUnit = true;
    tail = tail.slice(1);
  }
  if (tail.startsWith('bitd')) {
    parsed.bytes = 'bitd';
    tail = tail.slice(4);
  } else if (tail.startsWith('bb')) {
    parsed.bytes = 'bb';
    tail = tail.slice(2);
  } else if (tail.startsWith('b')) {
    parsed.bytes = 'b';
    tail = tail.slice(1);
  } else if (tail.startsWith('a')) {
    parsed.abbreviate = true;
    tail = tail.slice(1);
  } else if (tail.startsWith('o')) {
    parsed.ordinal = true;
    tail = tail.slice(1);
  }
  if (tail.startsWith('%')) {
    parsed.percent = true;
    tail = tail.slice(1);
  } else if (parsed.prefix.endsWith('%')) {
    parsed.percent = true;
  }
  if (parsed.spaceBeforeUnit && !parsed.bytes && !parsed.abbreviate && !parsed.percent) {
    tail = ` ${tail}`;
    parsed.spaceBeforeUnit = false;
  }
  parsed.suffix = tail;
  cache.set(pattern, parsed);
  return parsed;
}

// numeral's toFixed: the value moved by the decimals as text, then rounded half up with its sign,
// so that 1.005 is 1.01 and -2.5 is -2, as the original's numeral writes them
const roundAsNumeral = (value: number, decimals: number) => Math.round(Number(`${value}e+${decimals}`)) / 10 ** decimals;

function digits(value: number, parsed: Parsed): string {
  const decimals = Math.min(parsed.maxDecimals, 20);
  const fixed = Math.abs(roundAsNumeral(value, decimals)).toFixed(decimals);
  let [whole, fraction = ''] = fixed.split('.');
  while (fraction.length > parsed.minDecimals && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  if (parsed.thousands) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${whole}.${fraction}` : whole;
}

// numeral's formatTime, for a pattern with a colon: the value as seconds, written as whole hours,
// minutes and rounded seconds, whatever else the pattern says ("00:00:00" writes 3725 as 1:02:05)
function timeOf(value: number): string {
  const total = Math.abs(value);
  const hours = Math.floor(total / 60 / 60);
  const minutes = Math.floor((total - hours * 60 * 60) / 60);
  const seconds = Math.round(total - hours * 60 * 60 - minutes * 60);
  const twoDigits = (part: number) => (part < 10 ? `0${part}` : String(part));
  return `${value < 0 ? '-' : ''}${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

// numeral's English ordinal, of the value as it is, not as it is rounded: 3.14 is "3th"
function ordinalSuffix(value: number): string {
  if (Math.trunc((value % 100) / 10) === 1) return 'th';
  const last = value % 10;
  return last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
}

export function formatNumber(value: number, pattern: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return String(value);
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  // As numeral chooses: a currency or percent sign first, then a colon
  if (pattern.includes(':') && !pattern.includes('$') && !pattern.includes('%')) return timeOf(value);
  const parsed = parsePattern(pattern);
  let scaled = value;
  let unit = '';

  if (parsed.percent) {
    scaled = value * 100;
    unit = '%';
  } else if (parsed.bytes) {
    const base = parsed.bytes === 'b' ? 1024 : 1000;
    const units = parsed.bytes === 'bitd' ? BIT_UNITS : BYTE_UNITS;
    let power = 0;
    let magnitude = Math.abs(value);
    while (magnitude >= base && power < units.length - 1) {
      magnitude /= base;
      power += 1;
    }
    scaled = Math.sign(value) * magnitude;
    unit = units[power];
  } else if (parsed.abbreviate) {
    const found = ABBREVIATIONS.find(([threshold]) => Math.abs(value) >= threshold);
    if (found) {
      scaled = value / found[0];
      unit = found[1];
    }
  } else if (parsed.ordinal) {
    unit = ordinalSuffix(value);
  }

  // A number JavaScript writes with an exponent (before it is abbreviated) is written so, without
  // decimals, as numeral writes it
  const exponent = /e[+-]/.test(String(parsed.abbreviate ? value : scaled));
  const shown = String(Math.abs(scaled));
  const text = !exponent
    ? digits(scaled, parsed)
    : parsed.thousands
      ? shown.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
      : shown;
  // What rounds to zero carries no sign
  const negative = scaled < 0 && Number(text.replace(/,/g, '')) !== 0;
  const sign = negative ? (parsed.parentheses ? '' : '-') : parsed.forceSign ? '+' : '';
  const body = `${parsed.prefix.replace(/%$/, '')}${text}${parsed.spaceBeforeUnit && unit ? ' ' : ''}${unit}${parsed.suffix}`;
  if (negative && parsed.parentheses) return `(${body})`;
  return `${sign}${body}`;
}
