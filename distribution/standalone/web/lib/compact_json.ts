/* SPDX-License-Identifier: Apache-2.0 */

/*
 * JSON that is indented only where a line would be too long, as the Vega editor of OpenSearch
 * Dashboards writes it: the rules of json-stringify-pretty-compact 1.2.0 (MIT License,
 * Copyright (c) 2014, 2016, 2017 Simon Lydell).
 */

export interface CompactJsonOptions {
  indent?: number | string;
  /** The longest a line may be before its value is spread over several lines: 80 unless said */
  maxLength?: number;
  /** Spaces inside the brackets of a value kept on one line */
  margins?: boolean;
}

// Strings, or the punctuation between them, in text JSON.stringify wrote
const STRING_OR_CHAR = /("(?:[^\\"]|\\.)*")|[:,\][}{]/g;

function prettify(text: string, addMargin: boolean): string {
  const m = addMargin ? ' ' : '';
  const tokens: Record<string, string> = { '{': `{${m}`, '[': `[${m}`, '}': `${m}}`, ']': `${m}]`, ',': ', ', ':': ': ' };
  return text.replace(STRING_OR_CHAR, (match: string, string?: string) => (string ? match : tokens[match]));
}

export function compactJson(value: unknown, options: CompactJsonOptions = {}): string | undefined {
  const indent = JSON.stringify([1], null, 'indent' in options ? options.indent : 2).slice(2, -3);
  const addMargin = 'margins' in options ? Boolean(options.margins) : false;
  const maxLength = indent === '' ? Infinity : 'maxLength' in options ? (options.maxLength ?? 80) : 80;

  const stringify = (item: unknown, currentIndent: string, reserved: number): string | undefined => {
    let target = item;
    if (target && typeof (target as { toJSON?: unknown }).toJSON === 'function') {
      target = (target as { toJSON: () => unknown }).toJSON();
    }
    const string = JSON.stringify(target);
    if (string === undefined) return string;
    const length = maxLength - currentIndent.length - reserved;
    if (string.length <= length) {
      const prettified = prettify(string, addMargin);
      if (prettified.length <= length) return prettified;
    }
    if (typeof target === 'object' && target !== null) {
      const nextIndent = currentIndent + indent;
      const items: string[] = [];
      let delimiters: string;
      const comma = (count: number, index: number) => (index === count - 1 ? 0 : 1);
      if (Array.isArray(target)) {
        for (let index = 0; index < target.length; index++) {
          items.push(stringify(target[index], nextIndent, comma(target.length, index)) || 'null');
        }
        delimiters = '[]';
      } else {
        const record = target as Record<string, unknown>;
        const keys = Object.keys(record);
        keys.forEach((key, index) => {
          const keyPart = `${JSON.stringify(key)}: `;
          const part = stringify(record[key], nextIndent, keyPart.length + comma(keys.length, index));
          if (part !== undefined) items.push(keyPart + part);
        });
        delimiters = '{}';
      }
      if (items.length > 0) {
        return [delimiters[0], indent + items.join(`,\n${nextIndent}`), delimiters[1]].join(`\n${currentIndent}`);
      }
    }
    return string;
  };

  return stringify(value, '', 0);
}
