/* SPDX-License-Identifier: Apache-2.0 */

/*
 * JSON as the plugin shows it in an `EuiCodeBlock language="json"`: 24 px in, the small code type,
 * strings, numbers and keywords in the theme's code block colours, the punctuation faded.
 */

import type { ReactNode } from 'react';
import type { CodeToken } from '../../components/code_editor';
import { tokenizeJson } from '../../lib/json_text';

/** The prism class a JSON token has in the theme's code block */
export function jsonTokenClass(token: CodeToken): string | undefined {
  switch (token.kind) {
    case 'String':
      return 'ismTok--string';
    case 'Number':
      return 'ismTok--number';
    case 'Keyword':
      // prism marks `true` and `false` as booleans, drawn as numbers are, and `null` as a keyword
      return token.text === 'null' ? 'ismTok--keyword' : 'ismTok--number';
    case 'Comment':
      return 'ismTok--comment';
    default:
      return undefined;
  }
}

/** A plain run with its braces, brackets and commas apart, as prism's punctuation */
function Plain({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let run = '';
  for (const char of text) {
    if ('{}[],'.includes(char)) {
      if (run) parts.push(run);
      run = '';
      parts.push(
        <span key={parts.length} className="ismTok--punctuation">
          {char}
        </span>
      );
    } else {
      run += char;
    }
  }
  if (run) parts.push(run);
  return <>{parts}</>;
}

export function JsonBlock({ text, height, testId }: { text: string; height?: number; testId?: string }) {
  return (
    <div className="ismCodeBlock">
      <pre className="ismCodeBlock__pre">
        <code className="ismCodeBlock__code" style={height ? { height } : undefined} data-test-subj={testId}>
          {tokenizeJson(text).map((tokens, line) => (
            <span key={line} className="ismCodeBlock__line">
              {tokens.map((token, at) => {
                const className = jsonTokenClass(token);
                return className ? (
                  <span key={at} className={className}>
                    {token.text}
                  </span>
                ) : (
                  <Plain key={at} text={token.text} />
                );
              })}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
