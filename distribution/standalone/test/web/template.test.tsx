/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../../web/lib/markdown';
import { compileTemplate, renderTemplate, TemplateError } from '../../web/lib/template';
import { valueTemplate } from '../../web/vis/tsvb/data';

// The variables of a TSVB Markdown panel, as the panel fills its text with them
const variables = {
  count: {
    last: { raw: 12, formatted: '12' },
    data: { raw: [[1, 5], [2, 12]], formatted: [['2026-11-20', '5'], ['2026-11-21', '12']] },
    label: 'Count',
  },
  average_of_bytes: { last: { raw: 0, formatted: '' }, data: { raw: [], formatted: [] }, label: 'Average of bytes' },
  gz: { rate: { last: { raw: 3, formatted: '3' }, data: { raw: [[1, 3]], formatted: [['2026-11-20', '3']] } }, label: 'gz' },
};
const scope = { _all: variables, ...variables, flag: true, off: false, nothing: null, zero: 0, text: `<b>x</b> & "q" 's' a=b`, args: {} };
const fill = (template: string) => renderTemplate(template, scope, { strict: true });
const failure = (template: string) => {
  try {
    fill(template);
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    return { kind: error.kind, variable: error.variable };
  }
  throw new Error(`${template} should fail`);
};

describe('a TSVB Markdown text filled in as the product fills it', () => {
  it('puts in values, escaped as Handlebars escapes them, and lists and objects as JavaScript writes them', () => {
    assert.equal(fill('{{ count.label }}: {{count.last.formatted}}'), 'Count: 12');
    assert.equal(fill('{{text}}'), '&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot; &#x27;s&#x27; a&#x3D;b');
    assert.equal(fill('{{{text}}}|{{&text}}'), `${scope.text}|${scope.text}`);
    assert.equal(fill('{{count.data.raw}} {{count}} {{zero}} {{off}} {{nothing}}'), '1,5,2,12 [object Object] 0 false ');
    assert.equal(fill('{{count.data.raw.[1].[0]}} {{count.data.raw.length}} {{count.[label]}} {{this.count.label}}'), '2 2 Count Count');
  });

  it('runs a section once for an object, with it, and for each item of a list', () => {
    assert.equal(fill('{{#count}}{{label}}={{last.formatted}}{{/count}}'), 'Count=12');
    assert.equal(fill('{{#count}}{{../gz.label}} {{@root.average_of_bytes.label}}{{/count}}'), 'gz Average of bytes');
    assert.equal(fill('{{#count.data.formatted}}{{[0]}}: {{[1]}};{{/count.data.formatted}}'), '2026-11-20: 5;2026-11-21: 12;');
    assert.equal(fill('{{#flag}}on {{count.label}}{{/flag}}'), 'on Count');
  });

  it('takes the else branch of a section for false, nothing and an empty list, and inverts with ^', () => {
    assert.equal(fill('{{#off}}on{{else}}off{{/off}}|{{#nothing}}x{{^}}none{{/nothing}}'), 'off|none');
    assert.equal(fill('{{#average_of_bytes.data.raw}}x{{else}}empty{{/average_of_bytes.data.raw}}'), 'empty');
    assert.equal(fill('{{^off}}not off{{/off}}{{^count}}never{{/count}}'), 'not off');
    // A number is a value to run the section with, even zero
    assert.equal(fill('{{#zero}}zero{{else}}none{{/zero}}'), 'zero');
  });

  it('repeats with each, over a list or the variables, with the data of each turn', () => {
    assert.equal(fill('{{#each _all}}{{@index}}:{{@key}}={{label}}{{#unless @last}}, {{/unless}}{{/each}}'), '0:count=Count, 1:average_of_bytes=Average of bytes, 2:gz=gz');
    assert.equal(fill('{{#each count.data.raw}}{{#each this}}{{@../index}}.{{@index}}{{#if @first}}*{{/if}} {{/each}}{{/each}}'), '0.0* 0.1 1.0* 1.1 ');
    assert.equal(fill('{{#each average_of_bytes.data.raw}}x{{else}}no data{{/each}}'), 'no data');
    assert.equal(fill('{{#each count.label}}x{{else}}not a list{{/each}}'), 'not a list');
  });

  it('chooses with if, unless, else if and with', () => {
    assert.equal(fill('{{#if count.last.raw}}up{{else}}down{{/if}}'), 'up');
    assert.equal(fill('{{#if off}}a{{else if zero}}b{{else if count}}c{{else}}d{{/if}}'), 'c');
    assert.equal(fill('{{#if zero}}a{{else}}b{{/if}}{{#if zero includeZero=true}}a{{else}}b{{/if}}'), 'ba');
    assert.equal(fill('{{#unless average_of_bytes.data.raw}}empty{{/unless}}'), 'empty');
    assert.equal(fill('{{#with count.last}}{{formatted}}/{{raw}}{{/with}}{{#with nothing}}x{{else}}none{{/with}}'), '12/12none');
    assert.equal(fill('{{#if off}}a{{else with gz.rate}}{{last.formatted}}{{/if}}'), '3');
  });

  it('looks values up, in sub-expressions too, and writes nothing for log', () => {
    assert.equal(fill('{{lookup count "label"}} {{lookup count.data.raw 1}} {{lookup missing "x"}}'), 'Count 2,12 ');
    assert.equal(fill('{{#each _all}}{{lookup (lookup ../_all @key) "label"}};{{/each}}'), 'Count;Average of bytes;gz;');
    assert.equal(fill('{{#with (lookup count "last")}}{{formatted}}{{/with}}{{log "seen"}}'), '12');
  });

  it('leaves out the lines that hold only a block tag or a comment, and the spaces ~ strips', () => {
    assert.equal(fill('{{#each _all}}\n- {{ label }}\n{{/each}}\n'), '- Count\n- Average of bytes\n- gz\n');
    assert.equal(fill('| a | b |\n|---|---|\n{{#each _all}}\n  {{#if last}}\n| {{label}} | {{last.formatted}} |\n  {{/if}}\n{{/each}}\n'), '| a | b |\n|---|---|\n| Count | 12 |\n| Average of bytes |  |\n');
    assert.equal(fill('{{#if flag}}\n  yes\n{{else}}\n  no\n{{/if}}\n'), '  yes\n');
    assert.equal(fill('a\n{{! a note }}\n  {{!-- another --}}\nb'), 'a\nb');
    assert.equal(fill('a  {{~count.label~}}  b|{{#if flag~}}  x  {{~/if}}'), 'aCountb|x');
  });

  it('keeps escaped mustaches and raw blocks as written', () => {
    assert.equal(fill('\\{{count.label}} {{count.label}}'), '{{count.label}} Count');
    assert.equal(fill('\\\\{{count.label}}'), '\\Count');
    assert.equal(fill('{{{{if flag}}}}{{count}}{{{{/if}}}}'), '{{count}}');
  });

  it('gives the context and block parameters, where the product fails on them', () => {
    assert.equal(fill('{{#each count.data.formatted}}{{#each this}}{{this}} {{/each}}{{/each}}'), '2026-11-20 5 2026-11-21 12 ');
    assert.equal(fill('{{#each _all as |series name|}}{{name}}={{series.label}};{{/each}}'), 'count=Count;average_of_bytes=Average of bytes;gz=gz;');
    assert.equal(fill('{{#with count.last as |last|}}{{last.formatted}}{{/with}}'), '12');
  });

  it('has inline partials and partial blocks', () => {
    assert.equal(fill('{{#*inline "row"}}{{label}}={{last.formatted}}{{/inline}}{{> row count}}|{{> row gz.rate label="rate"}}'), 'Count=12|rate=3');
    assert.equal(fill('{{#> missing}}fallback for {{count.label}}{{/missing}}'), 'fallback for Count');
  });

  it('sorts what stops a text as the product does: not well formed, an unknown name, or anything else', () => {
    for (const template of ['{{#each _all}}x', '{{/each}}', '{{else}}', '{{count.label', '{{#if}}x{{else}}y{{else}}z{{/if}}', '{{! not closed', '{{foo(bar)}}']) {
      assert.equal(failure(template).kind, 'parse', template);
    }
    assert.deepEqual(failure('{{missing}}'), { kind: 'unknown', variable: 'missing' });
    assert.deepEqual(failure('{{count.nope}}'), { kind: 'unknown', variable: 'nope' });
    assert.deepEqual(failure('{{#missing}}x{{else}}y{{/missing}}'), { kind: 'unknown', variable: 'missing' });
    assert.deepEqual(failure('{{#each _all}}{{count.label}}{{/each}}'), { kind: 'unknown', variable: 'label' });
    assert.deepEqual(failure('{{@index}}'), { kind: 'unknown', variable: 'index' });
    for (const template of [
      '{{#count}}x{{/gz}}',
      '{{missing.a.b}}',
      '{{#if missing.a}}x{{/if}}',
      '{{count.label.length}}',
      '{{foo bar}}',
      '{{#each}}x{{/each}}',
      '{{#if}}x{{/if}}',
      '{{lookup count}}',
      '{{if flag}}',
      '{{> nowhere}}',
      '{{* decorator}}',
      '{{foo.this}}',
      '{{!-- not closed',
    ]) {
      assert.equal(failure(template).kind, 'other', template);
    }
  });

  it('leaves a name with no value empty when not in strict mode', () => {
    assert.equal(renderTemplate('{{missing}}{{count.nope.deeper}}{{#missing}}x{{else}}y{{/missing}}', scope), 'y');
  });

  it('reads a template once and fills it in as often as asked', () => {
    const fillIn = compileTemplate('{{#each items}}{{this}} {{/each}}');
    assert.equal(fillIn({ items: [1, 2] }), '1 2 ');
    assert.equal(fillIn({ items: ['a'] }), 'a ');
    const broken = compileTemplate('{{#each items}}');
    assert.throws(() => broken({}), /Parse error/);
    assert.throws(() => broken({}), /Parse error/);
  });
});

describe('the value template of a TSVB series', () => {
  it('is filled in with the formatted value, escaped, and gives the value alone when it cannot be', () => {
    assert.equal(valueTemplate('{{value}} ms')('1.5'), '1.5 ms');
    assert.equal(valueTemplate(undefined)('a&b'), 'a&amp;b');
    assert.equal(valueTemplate('{{{value}}} {{unit}}')('a&b'), 'a&b ');
    assert.equal(valueTemplate('{{value}} ms')(null), ' ms');
    assert.equal(valueTemplate('{{value')('7'), '7');
    assert.equal(valueTemplate('{{#if value}}up{{else}}none{{/if}}')(''), 'none');
  });
});

describe('the character references of a Markdown text', () => {
  const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

  it('stand for their characters outside code, as markdown-it reads them', () => {
    assert.equal(html('&lt;b&gt; &amp; &quot;q&quot; &#x27;s&#x27; a&#x3D;b &#96;'), '<div class="atlMarkdown"><p>&lt;b&gt; &amp; &quot;q&quot; \'s\' a=b `</p>\n</div>');
    // A reference to no character, or to one no text may hold, is the replacement character; an unknown name stays
    assert.equal(
      html('&copy; &eacute; &Omega; &hellip; &nbsp;|&#0; &#xD800; &unknown; & amp;'),
      `<div class="atlMarkdown"><p>© é Ω … ${String.fromCharCode(160)}|${String.fromCharCode(0xfffd)} ${String.fromCharCode(0xfffd)} &amp;unknown; &amp; amp;</p>\n</div>`
    );
    assert.match(html('Count &amp; bytes: &lt;b&gt;'), /<p>Count &amp; bytes: &lt;b&gt;<\/p>/);
    assert.match(html('`&amp;` and &amp;'), /<code>&amp;amp;<\/code> and &amp;/);
    assert.match(html('&ast;not emphasis&ast; \\*nor this\\*'), /<p>\*not emphasis\* \*nor this\*<\/p>/);
    assert.match(html('[a &amp; b](https://example.org/?a=1&amp;b=2)'), /<a href="https:\/\/example.org\/\?a=1&amp;b=2">a &amp; b<\/a>/);
  });
});
