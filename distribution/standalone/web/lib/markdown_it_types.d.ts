/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The part of markdown-it 14.2.0 this product uses, typed by hand after its documentation, so that
 * the build needs no package of types for it. Add to it as code needs more.
 */

declare module 'markdown-it' {
  /** One step of a parsed text: a block or inline element opened (1), closed (-1), or whole (0) */
  export interface Token {
    type: string;
    tag: string;
    attrs: Array<[string, string]> | null;
    nesting: 1 | 0 | -1;
    level: number;
    children: Token[] | null;
    content: string;
    markup: string;
    info: string;
    block: boolean;
    hidden: boolean;
    attrGet(name: string): string | null;
    attrPush(attr: [string, string]): void;
  }

  export interface Options {
    html?: boolean;
    xhtmlOut?: boolean;
    breaks?: boolean;
    langPrefix?: string;
    linkify?: boolean;
    typographer?: boolean;
    maxNesting?: number;
  }

  export type RenderRule = (tokens: Token[], index: number, options: Options, env: object, self: Renderer) => string;

  export interface Renderer {
    rules: Record<string, RenderRule | undefined>;
    renderToken(tokens: Token[], index: number, options: Options): string;
  }

  export interface Utils {
    lib: { mdurl: { encode(url: string): string } };
    /** A text with its backslash escapes and character references read */
    unescapeAll(text: string): string;
    /** Whether a character code is a space or a tab */
    isSpace(code: number): boolean;
  }

  /** What a rule of the inline parser sees: the text, where it is in it, and what is not yet a token */
  export interface StateInline {
    src: string;
    pos: number;
    posMax: number;
    pending: string;
    push(type: string, tag: string, nesting: 1 | 0 | -1): Token;
  }

  /** Reads what starts at `state.pos`, and says whether it did; `silent` asks only whether it would */
  export type InlineRule = (state: StateInline, silent: boolean) => boolean;

  export interface Ruler<Rule> {
    /** Puts a rule in place of the one of that name */
    at(name: string, rule: Rule): void;
  }

  export default class MarkdownIt {
    constructor(presetName: 'default' | 'zero' | 'commonmark', options?: Options);
    constructor(options?: Options);
    readonly renderer: Renderer;
    readonly utils: Utils;
    readonly inline: { ruler: Ruler<InlineRule> };
    validateLink: (url: string) => boolean;
    normalizeLink: (url: string) => string;
    normalizeLinkText: (url: string) => string;
    render(text: string, env?: object): string;
    parse(text: string, env: object): Token[];
  }
}
