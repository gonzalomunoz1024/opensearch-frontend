/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Writes web/lib/zone_names.ts: the abbreviation of each time zone ("CET", "IST", "-03") as
 * moment-timezone names it, which is what the `z` of a date format writes in OpenSearch Dashboards.
 * A browser knows the offsets of the zones but names few of them ("GMT+1"), so the names are kept
 * here and the offsets are left to the browser.
 *
 *   node scripts/zone_names.mjs <moment-timezone>/data/packed/latest.json
 *
 * The data file is the one of the moment-timezone the original ships (0.5.37, tz database 2022c);
 * it is read here and is no dependency. For each zone the table holds its eras: the stretches of
 * time in which each offset from UTC has one name.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/zone_names.mjs <moment-timezone>/data/packed/latest.json');
  process.exit(1);
}
const packed = JSON.parse(readFileSync(source, 'utf8'));

// moment-timezone's packed numbers: base 60, digits 0-9 a-z A-X, a fraction after a point
function digit(character) {
  const code = character.charCodeAt(0);
  if (code > 96) return code - 87;
  if (code > 64) return code - 29;
  return code - 48;
}

function unpackNumber(text) {
  const negative = text.charCodeAt(0) === 45;
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  let out = 0;
  for (const character of whole) out = 60 * out + digit(character);
  let scale = 1;
  for (const character of fraction) {
    scale /= 60;
    out += digit(character) * scale;
  }
  return negative ? -out : out;
}

/** The eras of a packed zone: [start in minutes since 1970 (none for the first), {offset east: name}] */
function erasOf(line) {
  const [, names, offsets, indices, untils] = line.split('|');
  const nameList = names.split(' ');
  const offsetList = offsets.split(' ').map(unpackNumber);
  const untilList = untils ? untils.split(' ').map(unpackNumber) : [];
  const eras = [];
  let current;
  let start = 0;
  [...indices].forEach((character, position) => {
    const index = digit(character);
    // moment counts offsets west of UTC; rounded to the minute, as a browser gives them
    const east = Math.round(-offsetList[index]) || 0;
    const name = nameList[index];
    if (position > 0) start = Math.round((start + untilList[position - 1]) * 60) / 60;
    if (!current || (current.names[east] !== undefined && current.names[east] !== name)) {
      current = { start: position === 0 ? undefined : start, names: {} };
      eras.push(current);
    }
    current.names[east] = name;
  });
  return eras;
}

const maps = [];
const mapIndex = new Map();
const tables = [];
const tableIndex = new Map();
const zones = {};

for (const line of packed.zones) {
  const name = line.slice(0, line.indexOf('|'));
  const table = erasOf(line)
    .map((era) => {
      const map = Object.entries(era.names)
        .map(([east, abbreviation]) => `${east}:${abbreviation}`)
        .join(',');
      if (!mapIndex.has(map)) {
        mapIndex.set(map, maps.length);
        maps.push(map);
      }
      const index = mapIndex.get(map).toString(36);
      return era.start === undefined ? index : `${Math.round(era.start).toString(36)}@${index}`;
    })
    .join(';');
  if (!tableIndex.has(table)) {
    tableIndex.set(table, tables.length);
    tables.push(table);
  }
  zones[name] = tableIndex.get(table);
}
for (const link of packed.links) {
  const [target, name] = link.split('|');
  zones[name] = zones[target];
}

const names = Object.keys(zones).sort();
const byTable = tables.map((table, index) => `${table}|${names.filter((name) => zones[name] === index).join(' ')}`);

const text = `/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The abbreviations of the time zones as moment-timezone ${packed.version} names them. Written by
 * scripts/zone_names.mjs: change it there.
 *
 * ZONE_NAME_MAPS: the names of the offsets of an era, "minutes east of UTC:name", by commas.
 * ZONE_NAME_TABLES: one line for the zones that share a history: its eras by semicolons, each the
 * minute since 1970 it starts at (none for the first) and "@" before the number of its map, both
 * in base 36; then "|" and the zones by spaces.
 */

export const ZONE_NAME_MAPS: string[] = ${JSON.stringify(maps)};

export const ZONE_NAME_TABLES: string[] = ${JSON.stringify(byTable, null, 2)};
`;

const target = fileURLToPath(new URL('../web/lib/zone_names.ts', import.meta.url));
writeFileSync(target, text);
console.log(`${names.length} zones, ${tables.length} histories, ${maps.length} maps, ${text.length} bytes -> ${target}`);
