/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The search syntax of the tables that are searched in the browser: words and "phrases",
 * `field:value`, `-not`, `is:flag` and `(this OR that)`, as the search bars of OpenSearch
 * Dashboards read it.
 */

type Match = 'must' | 'must_not';
type Operator = 'eq' | 'exact' | 'gt' | 'gte' | 'lt' | 'lte';

export type Clause =
  | { type: 'term'; match: Match; value: string }
  | { type: 'field'; match: Match; field: string; operator: Operator; value: string | string[] }
  | { type: 'is'; match: Match; flag: string }
  | { type: 'group'; match: Match; clauses: Clause[] };

const OPERATORS: Array<[string, Operator]> = [
  ['>=', 'gte'],
  ['<=', 'lte'],
  [':', 'eq'],
  ['=', 'exact'],
  ['>', 'gt'],
  ['<', 'lt'],
];

/**
 * A search as its clauses: words and "phrases" that must be found, `-word` that must not,
 * `field:value` (also `=`, `>`, `>=`, `<`, `<=` and `field:(a or b)`), `is:flag`, and
 * `(this OR that)`. `undefined` for a text that is not a search, which then filters nothing.
 */
export function parseSearch(text: string): Clause[] | undefined {
  let at = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at += 1;
  };
  const phrase = (): string | undefined => {
    // at an opening quote
    let end = at + 1;
    let out = '';
    while (end < text.length && text[end] !== '"') {
      if (text[end] === '\\' && end + 1 < text.length) end += 1;
      out += text[end];
      end += 1;
    }
    if (end >= text.length) return undefined;
    at = end + 1;
    return out;
  };
  const word = (stop: RegExp): string => {
    const start = at;
    while (at < text.length && !stop.test(text[at])) at += 1;
    return text.slice(start, at);
  };
  const value = (): string | undefined => (text[at] === '"' ? phrase() : word(/[\s()]/) || undefined);

  const clause = (): Clause | undefined => {
    let match: Match = 'must';
    if (text[at] === '-') {
      match = 'must_not';
      at += 1;
    }
    if (text[at] === '(') {
      at += 1;
      const clauses: Clause[] = [];
      for (;;) {
        space();
        const inner = clause();
        if (!inner) return undefined;
        clauses.push(inner);
        space();
        if (text[at] === ')') {
          at += 1;
          return { type: 'group', match, clauses };
        }
        if (!/^or\s/i.test(text.slice(at, at + 3))) return undefined;
        at += 2;
      }
    }
    if (text[at] === '"') {
      const found = phrase();
      return found === undefined ? undefined : { type: 'term', match, value: found };
    }
    const start = at;
    const name = word(/[\s():=<>"]/);
    const operator = OPERATORS.find(([sign]) => text.startsWith(sign, at));
    if (name && operator && /^[\w.-]+$/.test(name)) {
      at += operator[0].length;
      if (name === 'is' && operator[1] === 'eq') {
        const flag = word(/[\s()]/);
        return flag ? { type: 'is', match, flag } : undefined;
      }
      if (text[at] === '(') {
        at += 1;
        const values: string[] = [];
        for (;;) {
          space();
          const found = value();
          if (found === undefined) return undefined;
          values.push(found);
          space();
          if (text[at] === ')') {
            at += 1;
            return { type: 'field', match, field: name, operator: operator[1], value: values };
          }
          if (!/^or\s/i.test(text.slice(at, at + 3))) return undefined;
          at += 2;
        }
      }
      const found = value();
      return found === undefined
        ? undefined
        : { type: 'field', match, field: name, operator: operator[1], value: found };
    }
    at = start;
    const term = word(/[\s()]/);
    return term ? { type: 'term', match, value: term } : undefined;
  };

  const clauses: Clause[] = [];
  for (;;) {
    space();
    if (at >= text.length) return clauses;
    const next = clause();
    if (!next) return undefined;
    clauses.push(next);
  }
}

function compare(fieldValue: unknown, wanted: string, operator: Operator): boolean {
  if (fieldValue === null || fieldValue === undefined) return false;
  if (Array.isArray(fieldValue) && (operator === 'eq' || operator === 'exact')) {
    return fieldValue.some((item) => compare(item, wanted, operator));
  }
  if (typeof fieldValue === 'string') {
    const have = fieldValue.toLowerCase();
    const want = wanted.toLowerCase();
    if (operator === 'eq') return have.includes(want);
    if (operator === 'exact') return have === want;
    if (operator === 'gt') return fieldValue > wanted;
    if (operator === 'gte') return fieldValue >= wanted;
    if (operator === 'lt') return fieldValue < wanted;
    return fieldValue <= wanted;
  }
  if (typeof fieldValue === 'number') {
    const want = Number(wanted);
    if (operator === 'eq' || operator === 'exact') return fieldValue === want;
    if (operator === 'gt') return fieldValue > want;
    if (operator === 'gte') return fieldValue >= want;
    if (operator === 'lt') return fieldValue < want;
    return fieldValue <= want;
  }
  if (typeof fieldValue === 'boolean') {
    return (operator === 'eq' || operator === 'exact') && String(fieldValue) === wanted.toLowerCase();
  }
  return false;
}

/** Whether an item is what a clause asks for */
export function holds(item: Record<string, unknown>, clause: Clause): boolean {
  const must = clause.match === 'must';
  if (clause.type === 'group') return clause.clauses.some((inner) => holds(item, inner)) === must;
  if (clause.type === 'is') return Boolean(item[clause.flag]) === must;
  if (clause.type === 'field') {
    const values = Array.isArray(clause.value) ? clause.value : [clause.value];
    return values.some((wanted) => compare(item[clause.field], wanted, clause.operator)) === must;
  }
  // A word is looked for in the columns that hold text
  const wanted = clause.value.toLowerCase();
  const found = Object.keys(item).some((key) => {
    const value = item[key];
    return typeof value === 'string' && value.toLowerCase().includes(wanted);
  });
  return found === must;
}

/** The items a search keeps; every item when the text is empty or is not a search */
export function searchItems<T extends Record<string, unknown>>(items: T[], text: string): T[] {
  const clauses = text.trim() === '' ? [] : parseSearch(text);
  if (!clauses || clauses.length === 0) return items;
  return items.filter((item) => clauses.every((clause) => holds(item, clause)));
}
