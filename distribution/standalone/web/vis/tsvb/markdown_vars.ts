/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The variables a TSVB markdown panel is written with, made from its series as the product makes
 * them: under the series' label in snake case, and under its variable name inside that when it
 * has one, the last value and every value, raw and formatted, and the label.
 */

import { formatDate } from '../../lib/dates';
import { getLastValue, valueTemplate, type TsvbParams, type TsvbSeriesData } from './data';

// Lodash's snake case, which names the variables. Letters with accents first lose them, as lodash's
// deburr writes them, and apostrophes go. A text of plain words is then split at what is not a
// letter or a digit; any other also at changes of case, at digits and around emoji, with letters
// of other scripts kept together as lodash keeps them.
const LATIN = /[\xc0-\xd6\xd8-\xf6\xf8-\xffĀ-ſ]/g;
// The Latin letters lodash writes otherwise than as the letter without its accent
const LATIN_LETTERS: Record<string, string> = {
  'Æ': 'Ae', 'Ð': 'D', 'Ø': 'O', 'Þ': 'Th', 'ß': 'ss', 'æ': 'ae', 'ð': 'd', 'ø': 'o',
  'þ': 'th', 'Đ': 'D', 'đ': 'd', 'Ħ': 'H', 'ħ': 'h', 'ı': 'i', 'Ĳ': 'IJ', 'ĳ': 'ij',
  'ĸ': 'k', 'Ŀ': 'L', 'ŀ': 'l', 'Ł': 'L', 'ł': 'l', 'ŉ': "'n", 'Ŋ': 'N', 'ŋ': 'n',
  'Œ': 'Oe', 'œ': 'oe', 'Ŧ': 'T', 'ŧ': 't', 'ſ': 's',
};
const COMBO = '\\u0300-\\u036f\\ufe20-\\ufe2f\\u20d0-\\u20ff';
const COMBO_MARK = new RegExp(`[${COMBO}]`, 'g');
const ASTRAL = '\\ud800-\\udfff';
const DINGBAT = '\\u2700-\\u27bf';
const LOWER = 'a-z\\xdf-\\xf6\\xf8-\\xff';
const UPPER = 'A-Z\\xc0-\\xd6\\xd8-\\xde';
const BREAK =
  '\\xac\\xb1\\xd7\\xf7\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf\\u2000-\\u206f' +
  ' \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000';
// Lodash writes "\d+" inside this class, so "+" is left out of it too
const MISC = `[^${ASTRAL}${BREAK}\\d+${DINGBAT}${LOWER}${UPPER}]`;
const MODIFIER = `(?:[${COMBO}]|\\ud83c[\\udffb-\\udfff])`;
const REGIONAL = '(?:\\ud83c[\\udde6-\\uddff]){2}';
const SURROGATE_PAIR = '[\\ud800-\\udbff][\\udc00-\\udfff]';
const VARIATION = '[\\ufe0e\\ufe0f]?';
const JOINED = `(?:\\u200d(?:[^${ASTRAL}]|${REGIONAL}|${SURROGATE_PAIR})${VARIATION}${MODIFIER}?)*`;
const MISC_LOWER = `(?:[${LOWER}]|${MISC})`;
const MISC_UPPER = `(?:[${UPPER}]|${MISC})`;
const HAS_WORD_BREAKS = /[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/;
const ASCII_WORD = /[^\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g;
const WORD = new RegExp(
  [
    `[${UPPER}]?[${LOWER}]+(?=[${BREAK}]|[${UPPER}]|$)`,
    `${MISC_UPPER}+(?=[${BREAK}]|[${UPPER}]${MISC_LOWER}|$)`,
    `[${UPPER}]?${MISC_LOWER}+`,
    `[${UPPER}]+`,
    '\\d*(?:1ST|2ND|3RD|(?![123])\\dTH)(?=\\b|[a-z_])',
    '\\d*(?:1st|2nd|3rd|(?![123])\\dth)(?=\\b|[A-Z_])',
    '\\d+',
    `(?:[${DINGBAT}]|${REGIONAL}|${SURROGATE_PAIR})${VARIATION}${MODIFIER}?${JOINED}`,
  ].join('|'),
  'g'
);

/** A text in snake case as lodash writes it: "Average of bytes" is average_of_bytes, "Zürich" zurich */
export function snakeCase(value: unknown): string {
  const text = String(value ?? '')
    .replace(LATIN, (letter) => LATIN_LETTERS[letter] ?? letter.normalize('NFD'))
    .replace(COMBO_MARK, '')
    .replace(/['’]/g, '');
  const words = HAS_WORD_BREAKS.test(text) ? text.match(WORD) : text.match(ASCII_WORD);
  return (words ?? []).map((word) => word.toLowerCase()).join('_');
}

export { getLastValue };

type Tree = Record<string, unknown>;

/** Sets a value at a dotted path, making the objects on the way as lodash's set does */
function setPath(tree: Tree, path: string, value: unknown) {
  const keys = path.split('.');
  let at = tree;
  keys.slice(0, -1).forEach((key) => {
    const next = at[key];
    if (next === null || typeof next !== 'object') at[key] = {};
    at = at[key] as Tree;
  });
  at[keys[keys.length - 1]] = value;
}

export function convertSeriesToVars(series: TsvbSeriesData[], params: TsvbParams, dateFormat: string, zone?: string): Tree {
  const variables: Tree = {};
  for (const model of params.series ?? []) {
    for (const row of series.filter((item) => item.id.startsWith(model.id))) {
      const name = [snakeCase(row.label), snakeCase(model.var_name)].filter(Boolean).join('.');
      // A missing value is written as nothing in the series' template, as the product's formatter
      // writes it
      const empty = valueTemplate(model.value_template)(null);
      const format = (value: number | null) => (value === null || value === undefined ? empty : row.format(value));
      const lastValue = getLastValue(row.data);
      setPath(variables, name, {
        last: { raw: lastValue, formatted: format(lastValue) },
        data: {
          raw: row.data,
          formatted: row.data.map(([time, value]) => [formatDate(new Date(time), dateFormat, zone), format(value)]),
        },
      });
      setPath(variables, `${snakeCase(row.label)}.label`, row.label);
      // A term OpenSearch writes in words of its own (a date, true or false) is given as well, a
      // date in the date format, as the product reads it with moment
      if (row.labelFormatted) {
        const time = new Date(row.labelFormatted);
        const formatted = Number.isNaN(time.getTime()) ? row.labelFormatted : formatDate(time, dateFormat, zone);
        setPath(variables, `${snakeCase(row.label)}.formatted`, formatted);
      }
    }
  }
  return variables;
}
