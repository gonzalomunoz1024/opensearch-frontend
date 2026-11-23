/* SPDX-License-Identifier: Apache-2.0 */

/*
 * JSON whose numbers are kept: what OpenSearch Dashboards does with an integer too large for a
 * JavaScript number (@osd/std parse and stringify, with BigInt), done here with Node's own
 * JSON.rawJSON, which JSON.stringify writes as it is.
 */

type RawJson = (text: string) => unknown;
type Reviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

const rawJson = (JSON as unknown as { rawJSON?: RawJson }).rawJSON;

const parseWith = (text: string, keep: (source: string, value: number) => boolean): unknown => {
  if (typeof rawJson !== 'function') return JSON.parse(text);
  const reviver: Reviver = (_key, value, context) =>
    typeof value === 'number' && typeof context?.source === 'string' && keep(context.source, value)
      ? rawJson(context.source)
      : value;
  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown);
};

/**
 * JSON read as @osd/std reads it: an integer outside the safe range is kept with all its digits
 * (JSON.stringify writes it back as it came); every other number is a number
 */
export function parseLongNumerals(text: string): unknown {
  return parseWith(text, (source, value) => /^-?\d+$/.test(source) && !Number.isSafeInteger(value));
}

/**
 * JSON written again without the spaces between its parts, each number as it was written;
 * undefined when the text is no JSON
 */
export function compactJson(text: string): string | undefined {
  try {
    return JSON.stringify(parseWith(text, () => true));
  } catch {
    return undefined;
  }
}
