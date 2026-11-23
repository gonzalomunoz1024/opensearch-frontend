/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Reads the part of YAML a settings file uses: maps (nested by indentation or with dotted keys),
 * block lists, inline lists and maps, strings with or without quotes, numbers, booleans and
 * null, and comments. Anchors, tags, multi-line strings and documents are not YAML this reads;
 * it says so instead of guessing.
 *
 * Where it reads a file the way the reader of OpenSearch Dashboards (js-yaml) does not, it reads
 * it as that one: a key written twice in one map is an error, a key `__proto__` is left out, and
 * numbers and switches are those of YAML 1.2 (0x10, .inf, True).
 *
 * The result is flat: `server: { port: 5601 }` and `server.port: 5601` both come out as
 * `{ 'server.port': 5601 }`, which is how the settings are named everywhere else.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

/** A map of the file: no key of it is taken from the prototype of an object */
const newMap = (): { [key: string]: YamlValue } => Object.create(null) as { [key: string]: YamlValue };

/**
 * Puts a key into a map as the reader of OpenSearch Dashboards does: a key that is already there
 * is an error, and `__proto__` is dropped, as its way of setting a value drops it
 */
function setKey(map: { [key: string]: YamlValue }, key: string, value: YamlValue, line: number) {
  if (Object.prototype.hasOwnProperty.call(map, key)) throw new YamlError('duplicated mapping key', line);
  if (key !== '__proto__') map[key] = value;
}

export class YamlError extends Error {
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = 'YamlError';
  }
}

interface Line {
  indent: number;
  text: string;
  number: number;
}

function stripComment(text: string): string {
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index);
    }
  }
  return text;
}

function splitTopLevel(text: string, separator: string, line: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '[' || char === '{') {
      depth += 1;
    } else if (char === ']' || char === '}') {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (quote || depth !== 0) throw new YamlError('a quote or a bracket is not closed', line);
  parts.push(text.slice(start));
  return parts;
}

// The place of the colon that ends a key, outside quotes and brackets
function keyEnd(text: string): number {
  let quote: string | undefined;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '[' || char === '{') {
      depth += 1;
    } else if (char === ']' || char === '}') {
      depth -= 1;
    } else if (char === ':' && depth === 0 && (index + 1 === text.length || text[index + 1] === ' ')) {
      return index;
    }
  }
  return -1;
}

function unquoteKey(key: string): string {
  const trimmed = key.trim();
  if (/^".*"$/.test(trimmed)) return JSON.parse(trimmed) as string;
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function scalar(raw: string, line: number): YamlValue {
  const text = raw.trim();
  if (text === '' || text === '~' || text === 'null') return null;
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text) as string;
    } catch {
      throw new YamlError(`cannot read the string ${text}`, line);
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new YamlError('a quote is not closed', line);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new YamlError('a list is not closed', line);
    const inner = text.slice(1, -1).trim();
    return inner === '' ? [] : splitTopLevel(inner, ',', line).map((item) => scalar(item, line));
  }
  if (text.startsWith('{')) {
    if (!text.endsWith('}')) throw new YamlError('a map is not closed', line);
    const inner = text.slice(1, -1).trim();
    const map = newMap();
    if (inner === '') return map;
    for (const pair of splitTopLevel(inner, ',', line)) {
      const colon = keyEnd(pair.trim());
      if (colon === -1) throw new YamlError(`"${pair.trim()}" is not a key and a value`, line);
      setKey(map, unquoteKey(pair.trim().slice(0, colon)), scalar(pair.trim().slice(colon + 1), line), line);
    }
    return map;
  }
  if (/^[|>&*!]/.test(text)) {
    throw new YamlError(`"${text[0]}" starts a kind of YAML this reader does not read`, line);
  }
  // The scalars of YAML 1.2's core schema, which is what js-yaml reads
  if (/^(null|Null|NULL)$/.test(text)) return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  const radix = /^[-+]?0([xob])([0-9a-fA-F]+)$/.exec(text);
  const base = radix ? { x: 16, o: 8, b: 2 }[radix[1] as 'x' | 'o' | 'b'] : undefined;
  if (radix && base && [...radix[2]].every((digit) => parseInt(digit, 16) < base)) {
    const value = parseInt(radix[2], base);
    return text.startsWith('-') ? -value : value;
  }
  if (/^[-+]?\.(inf|Inf|INF)$/.test(text)) return text.startsWith('-') ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(text)) return NaN;
  return text;
}

function parseBlock(lines: Line[], start: number, indent: number): [YamlValue, number] {
  let index = start;
  const isItem = (text: string) => text.startsWith('- ') || text === '-';
  if (isItem(lines[index].text)) {
    const list: YamlValue[] = [];
    // A list ends at the first line that is no item of it: a list may sit at the indentation of
    // its key, and the next key follows it there
    while (index < lines.length && lines[index].indent === indent && isItem(lines[index].text)) {
      const { text, number } = lines[index];
      const rest = text.slice(1).trim();
      if (rest === '') {
        if (index + 1 < lines.length && lines[index + 1].indent > indent) {
          const [value, next] = parseBlock(lines, index + 1, lines[index + 1].indent);
          list.push(value);
          index = next;
        } else {
          list.push(null);
          index += 1;
        }
      } else if (keyEnd(rest) !== -1 && !/^["'[{]/.test(rest)) {
        // "- key: value" starts a map whose other keys are indented under it
        const inner: Line[] = [{ indent: indent + 2, text: rest, number }];
        let next = index + 1;
        while (next < lines.length && lines[next].indent > indent) {
          inner.push(lines[next]);
          next += 1;
        }
        list.push(parseBlock(inner, 0, inner[0].indent)[0]);
        index = next;
      } else {
        list.push(scalar(rest, number));
        index += 1;
      }
    }
    return [list, index];
  }

  const map = newMap();
  while (index < lines.length && lines[index].indent === indent) {
    const { text, number } = lines[index];
    const colon = keyEnd(text);
    if (colon === -1) throw new YamlError(`"${text}" is not a key and a value`, number);
    const key = unquoteKey(text.slice(0, colon));
    const rest = text.slice(colon + 1).trim();
    if (rest === '') {
      if (index + 1 < lines.length && lines[index + 1].indent > indent) {
        const [value, next] = parseBlock(lines, index + 1, lines[index + 1].indent);
        setKey(map, key, value, number);
        index = next;
      } else if (
        index + 1 < lines.length &&
        lines[index + 1].indent === indent &&
        lines[index + 1].text.startsWith('- ')
      ) {
        // a list may sit at the indentation of its key
        const [value, next] = parseBlock(lines, index + 1, indent);
        setKey(map, key, value, number);
        index = next;
      } else {
        setKey(map, key, null, number);
        index += 1;
      }
    } else {
      setKey(map, key, scalar(rest, number), number);
      index += 1;
    }
  }
  if (index < lines.length && lines[index].indent > indent) {
    throw new YamlError('this line is indented further than the lines before it', lines[index].number);
  }
  return [map, index];
}

export function parseYaml(source: string): YamlValue {
  const lines: Line[] = [];
  source.split(/\r?\n/).forEach((raw, at) => {
    if (raw.includes('\t') && /^\s*\t/.test(raw)) {
      throw new YamlError('a tab is not allowed as indentation', at + 1);
    }
    const text = stripComment(raw).trimEnd();
    if (text.trim() === '' || text.trim() === '---') return;
    lines.push({ indent: text.length - text.trimStart().length, text: text.trim(), number: at + 1 });
  });
  if (lines.length === 0) return {};
  const [value, end] = parseBlock(lines, 0, lines[0].indent);
  if (end < lines.length) {
    throw new YamlError('this line is indented less than the first one', lines[end].number);
  }
  return value;
}

/**
 * Nested maps become dotted keys; lists and scalars are the values, and so is a map with no keys.
 * A file that is a list has the keys "0", "1" and so on, as OpenSearch Dashboards reads it.
 */
export function flatten(value: YamlValue, prefix = '', out: Record<string, YamlValue> = Object.create(null)) {
  if (!prefix && Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, String(index), out));
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (prefix && entries.length === 0) out[prefix] = value;
    for (const [key, inner] of entries) {
      flatten(inner, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (prefix) {
    out[prefix] = value;
  }
  return out;
}
