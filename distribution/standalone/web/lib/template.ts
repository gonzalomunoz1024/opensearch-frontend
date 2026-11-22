/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Text with places to fill in, in the small part of the Handlebars notation that TSVB's Markdown
 * panel is written in: `{{ a.b }}` for a value, `{{#each list}}…{{/each}}` to repeat for every
 * item of a list or value of a map, `{{#if a}}…{{else}}…{{/if}}` and `{{#unless a}}`.
 * A value is put in as text; nothing in it is ever run.
 */

type Scope = Record<string, unknown>;

/**
 * Why a text could not be filled in: it is not well formed ('parse'), it names a value there is
 * none of ('unknown', in strict mode, with the last part of the name), or it uses a block this
 * text cannot ('helper')
 */
export class TemplateError extends Error {
  constructor(
    message: string,
    readonly kind: 'parse' | 'unknown' | 'helper',
    readonly variable?: string
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

interface Frame {
  value: unknown;
  key?: string | number;
  index?: number;
  parent?: Frame;
}

function lookup(path: string, frame: Frame): unknown {
  let at: Frame = frame;
  let rest = path.trim();
  while (rest.startsWith('../')) {
    at = at.parent ?? at;
    rest = rest.slice(3);
  }
  if (rest === 'this' || rest === '.') return at.value;
  if (rest === '@key') return at.key;
  if (rest === '@index') return at.index;
  if (rest.startsWith('this.')) rest = rest.slice(5);
  const read = (from: unknown) =>
    rest.split('.').reduce<unknown>((value, part) => (value !== null && typeof value === 'object' ? (value as Scope)[part.replace(/^\[|\]$/g, '')] : undefined), from);
  // A name not found where the text stands is looked for further out
  for (let scope: Frame | undefined = at; scope; scope = scope.parent) {
    const found = read(scope.value);
    if (found !== undefined) return found;
  }
  return undefined;
}

const truthy = (value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

const text = (value: unknown): string => (value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));

function render(template: string, frame: Frame, strict: boolean): string {
  let output = '';
  let at = 0;
  const tag = /\{\{\{?\s*([#/]?)\s*([^}]*?)\s*\}?\}\}/g;
  for (let match = tag.exec(template); match; match = tag.exec(template)) {
    output += template.slice(at, match.index);
    at = tag.lastIndex;
    const [, kind, body] = match;
    if (kind === '#') {
      const [helper, ...args] = body.split(/\s+/);
      // The end of this block: the matching close, past any blocks of the same kind inside it
      const inner = new RegExp(`\\{\\{\\s*([#/])\\s*${helper}\\b[^}]*\\}\\}`, 'g');
      inner.lastIndex = at;
      let depth = 1;
      let end = -1;
      let endLength = 0;
      for (let found = inner.exec(template); found; found = inner.exec(template)) {
        depth += found[1] === '#' ? 1 : -1;
        if (depth === 0) {
          end = found.index;
          endLength = found[0].length;
          break;
        }
      }
      if (end === -1) throw new TemplateError(`{{#${helper}}} is never closed`, 'parse');
      const block = template.slice(at, end);
      const [whenTrue, whenFalse = ''] = block.split(/\{\{\s*else\s*\}\}/);
      const subject = lookup(args.join(' '), frame);
      if (helper === 'each') {
        const entries: Array<[string | number, unknown]> = Array.isArray(subject)
          ? subject.map((item, index) => [index, item])
          : subject && typeof subject === 'object'
            ? Object.entries(subject as Scope)
            : [];
        if (entries.length === 0) output += render(whenFalse, frame, strict);
        entries.forEach(([key, value], index) => {
          output += render(whenTrue, { value, key, index, parent: frame }, strict);
        });
      } else if (helper === 'if') output += render(truthy(subject) ? whenTrue : whenFalse, frame, strict);
      else if (helper === 'unless') output += render(truthy(subject) ? whenFalse : whenTrue, frame, strict);
      else if (helper === 'with') output += render(whenTrue, { value: subject, parent: frame }, strict);
      else throw new TemplateError(`{{#${helper}}} is not something this text can use`, 'helper');
      at = end + endLength;
      tag.lastIndex = at;
    } else if (kind === '/') {
      throw new TemplateError(`{{/${body}}} closes nothing`, 'parse');
    } else if (body !== 'else' && !body.startsWith('!')) {
      const value = lookup(body, frame);
      // In strict mode, as Handlebars', a value named but found nowhere stops the text
      if (strict && value === undefined && !/^(@|this$|\.$)/.test(body.trim())) {
        const variable = body.trim().split('.').pop()?.replace(/^\[|\]$/g, '') ?? body;
        throw new TemplateError(`"${variable}" not defined`, 'unknown', variable);
      }
      output += text(value);
    }
  }
  return output + template.slice(at);
}

/** The text filled in from the scope; in strict mode a name found nowhere is an error */
export function renderTemplate(template: string, scope: Scope, options: { strict?: boolean } = {}): string {
  return render(template, { value: scope }, Boolean(options.strict));
}
