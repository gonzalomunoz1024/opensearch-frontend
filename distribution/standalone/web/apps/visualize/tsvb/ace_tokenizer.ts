/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Text read as the original's code editor (ACE, in OpenSearch Dashboards' EuiCodeEditor) reads it to
 * colour it. A mode is a set of states, each a list of rules. A line is read on from where the last
 * match ended: the rule that matches nearest takes its match, the first in the list where two match
 * at the same place, and text that no rule takes has the state's default token. A rule's next state
 * applies from the end of its match, and the state a line ends in is the one the next line starts in.
 * As ACE's, the reading of a line ends at a match that changes the state at the line's end, or at
 * the first match found at its end, which a rule of the state may still take (to change the state).
 *
 * Derived from the tokenizer of the Ace editor as brace 0.11.1 holds it, BSD 3-Clause License,
 * Copyright (c) 2010, Ajax.org B.V.
 */

import type { CodeToken } from '../../../components/code_editor';

/** The token of a rule's match: one for all of it, one for each of its groups, or made from them */
export type AceTokenOf = string | string[] | ((...values: string[]) => string | string[]);

export interface AceRule<S extends string> {
  /** The expression, as ACE's rule has it */
  regex: string;
  token?: AceTokenOf;
  next?: S;
}

export interface AceState<S extends string> {
  rules: Array<AceRule<S>>;
  /** The token of text no rule takes: "text" unless the state has one */
  defaultToken?: string;
  /** Rules matched whatever the case, as ACE matches each rule of a state where one asks for it */
  caseInsensitive?: boolean;
}

export interface AceToken {
  type: string;
  value: string;
}

export interface AceMode<S extends string> {
  /** One line read in a state: its tokens, those of a type run together, and the state it leaves */
  line(line: string, state: S): { tokens: AceToken[]; state: S };
}

interface CompiledRule<S extends string> {
  /** Sticky: it matches only where it is tried */
  regex: RegExp;
  token?: AceTokenOf;
  next?: S;
  groups: number;
}

/** ACE's bound on the matches of a line; past it, the rest of the line is one token */
const MAX_MATCHES = 2000;

function groupsOf(source: string): number {
  const match = new RegExp(`${source}|`).exec('');
  return match ? match.length - 1 : 0;
}

/** The tokens of a rule's match, as ACE gives them */
function tokensOf<S extends string>(rule: CompiledRule<S>, match: RegExpExecArray, push: (type: string, value: string) => void) {
  const value = match[0];
  const groups = match.slice(1).map((group) => group ?? '');
  const perGroup = (types: string[]) => types.forEach((type, index) => push(type, groups[index] ?? ''));
  const { token } = rule;
  if (typeof token === 'string') push(token, value);
  else if (Array.isArray(token)) {
    if (token.length === 1 || rule.groups === 0) push(token[0] ?? 'text', value);
    else perGroup(token);
  } else if (typeof token === 'function') {
    const types = rule.groups > 0 ? token(...groups) : token(value);
    if (typeof types === 'string') push(types, value);
    else perGroup(types);
  }
}

/** A mode made from its states; `start` is where ACE goes back to when a line has too many matches */
export function aceMode<S extends string>(states: Record<S, AceState<S>>, start: S): AceMode<S> {
  const compiled = {} as Record<S, { rules: Array<CompiledRule<S>>; defaultToken: string }>;
  for (const name of Object.keys(states) as S[]) {
    const state = states[name];
    const flags = state.caseInsensitive ? 'yi' : 'y';
    compiled[name] = {
      rules: state.rules.map((rule) => ({ regex: new RegExp(rule.regex, flags), token: rule.token, next: rule.next, groups: groupsOf(rule.regex) })),
      defaultToken: state.defaultToken ?? 'text',
    };
  }

  /** The nearest match from a place on, the first rule's where two match there; none at the line's end */
  const find = (rules: Array<CompiledRule<S>>, line: string, from: number) => {
    for (let at = from; at <= line.length; at++) {
      for (const rule of rules) {
        rule.regex.lastIndex = at;
        const match = rule.regex.exec(line);
        if (match) return { at, rule, match };
      }
    }
    return { at: line.length };
  };

  return {
    line(line, state) {
      const tokens: AceToken[] = [];
      const push = (type: string, value: string) => {
        if (!value) return;
        const last = tokens[tokens.length - 1];
        if (last && last.type === type) last.value += value;
        else tokens.push({ type, value });
      };
      let current = state;
      // Where the text not yet given a token starts, and where the next match is looked for
      let done = 0;
      let from = 0;
      for (let count = 0; ; count++) {
        const { rules, defaultToken } = compiled[current];
        const found = find(rules, line, from);
        const end = found.at + (found.match ? found.match[0].length : 0);
        if (found.at > done) push(defaultToken, line.slice(done, found.at));
        if (found.rule && found.match) {
          tokensOf(found.rule, found.match, push);
          if (found.rule.next !== undefined) {
            current = found.rule.next;
            done = end;
          }
        }
        if (done === line.length) break;
        done = end;
        from = end;
        if (count > MAX_MATCHES) {
          push('overflow', line.slice(done));
          current = start;
          break;
        }
      }
      return { tokens, state: current };
    },
  };
}

/**
 * The colour of an ACE token as a kind of run (tokAce…), none for plain text: that of the rule of
 * OpenSearch Dashboards' ACE theme that applies, a rule naming two classes before one naming one
 */
export function aceKind(type: string): string | undefined {
  const classes = new Set(type.split('.'));
  const all = (...names: string[]) => names.every((name) => classes.has(name));
  if (all('meta', 'tag')) return 'AceTag';
  if (all('constant', 'numeric')) return 'AceVariable';
  if (all('keyword', 'operator')) return 'AceOperator';
  if (all('support', 'type') || all('support', 'class')) return 'AceType';
  if (all('support', 'constant') || all('constant', 'library')) return 'AceString';
  if (all('support', 'function')) return 'AceFunction';
  if (all('constant', 'language')) return 'AceLanguage';
  if (all('markup', 'underline')) return 'AceUnderline';
  if (classes.has('list')) return 'AceList';
  if (classes.has('heading')) return 'AceHeading';
  if (classes.has('variable') || classes.has('keyword') || classes.has('storage')) return 'AceVariable';
  if (classes.has('comment')) return 'AceComment';
  if (classes.has('string')) return 'AceString';
  if (classes.has('constant')) return 'AceConstant';
  if (classes.has('url')) return 'AceUrl';
  return undefined;
}

/** Lines read in turn, each from the state the last left, as runs of the editor; a fold arrow first */
export function aceRuns<S extends string>(
  mode: AceMode<S>,
  text: string,
  start: S,
  foldOf: (line: string, stateAfter: S) => 'start' | 'end' | undefined
): CodeToken[][] {
  let state = start;
  return text.split('\n').map((line) => {
    const read = mode.line(line, state);
    state = read.state;
    const runs: CodeToken[] = read.tokens.map((token) => {
      const kind = aceKind(token.type);
      return kind ? { text: token.value, kind } : { text: token.value };
    });
    const fold = foldOf(line, read.state);
    return fold ? [{ text: '', kind: fold === 'start' ? 'AceFoldStart' : 'AceFoldEnd' }, ...runs] : runs;
  });
}
