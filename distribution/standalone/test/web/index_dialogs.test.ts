/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jsonTokenClass } from '../../web/apps/index_management/json_block';
import { tokenizeJson } from '../../web/lib/json_text';

describe('JSON in a code block of a dialog', () => {
  const classOf = (line: string, text: string) => {
    const [tokens] = tokenizeJson(line);
    const token = tokens.find((candidate) => candidate.text === text);
    if (!token) throw new Error(`no token ${text} in ${line}`);
    return jsonTokenClass(token);
  };

  it('colours a text, a number and a keyword as the code block of the theme does', () => {
    const line = '{"policy_id": "hot", "schema_version": 31, "ism_template": null}';
    assert.equal(classOf(line, '"hot"'), 'ismTok--string');
    assert.equal(classOf(line, '31'), 'ismTok--number');
    assert.equal(classOf(line, 'null'), 'ismTok--keyword');
  });

  it('draws true and false as numbers, which is what a boolean is drawn as', () => {
    const line = '{"enabled": true, "failed": false}';
    assert.equal(classOf(line, 'true'), 'ismTok--number');
    assert.equal(classOf(line, 'false'), 'ismTok--number');
  });

  it('leaves a name and the punctuation without a colour of their own', () => {
    const line = '{"policy_id": "hot"}';
    assert.equal(classOf(line, '"policy_id"'), undefined);
    assert.equal(classOf(line, '{'), undefined);
  });

  it('draws a comment as one', () => {
    assert.equal(jsonTokenClass({ text: '# not JSON', kind: 'Comment' }), 'ismTok--comment');
  });
});
