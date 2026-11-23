/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../../web/lib/markdown';
import { evaluateMath } from '../../web/lib/math_expression';
import { renderTemplate } from '../../web/lib/template';
import { buildHash, parseHash, parseQuery } from '../../web/lib/url';
import { metricLabel, ruleFor, seriesFormatter, splitColors, type ColorRule, type TsvbMetric } from '../../web/vis/tsvb/data';

const html = (text: string, openLinksInNewTab = false) =>
  renderToStaticMarkup(<Markdown text={text} openLinksInNewTab={openLinksInNewTab} />);

describe('Markdown', () => {
  it('draws headings, emphasis, lists and code', () => {
    const out = html('# Title\n\nSome *slanted* and **strong** text with `code`.\n\n- one\n- two\n');
    assert.match(out, /<h1[^>]*>Title<\/h1>/);
    assert.match(out, /<em>slanted<\/em>/);
    assert.match(out, /<strong>strong<\/strong>/);
    assert.match(out, /<code>code<\/code>/);
    // markdown-it's HTML, a line after each block, as the original sets it
    assert.match(out, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
  });

  it('keeps a list tight when a list of the other kind follows it after a blank line', () => {
    const out = html('- one\n- two\n\n1. first\n2. second');
    assert.match(out, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>\n<ol>\n<li>first<\/li>\n<li>second<\/li>\n<\/ol>/);
    // A blank line between two items of one list still makes it loose
    assert.match(html('- one\n\n- two'), /<ul>\n<li>\n<p>one<\/p>\n<\/li>\n<li>\n<p>two<\/p>\n<\/li>\n<\/ul>/);
  });

  it('shows HTML as the text it is', () => {
    const out = html('before <script>alert(1)</script> <img src=x onerror=alert(1)> after');
    assert.ok(!out.includes('<script'));
    assert.ok(!out.includes('<img'));
    assert.ok(out.includes('&lt;script&gt;'));
  });

  it('keeps a link only when it leads somewhere safe', () => {
    assert.match(html('[site](https://example.org/a)'), /<a href="https:\/\/example.org\/a">site<\/a>/);
    assert.match(html('[here](/app/dashboards#/view/1)'), /<a href="\/app\/dashboards#\/view\/1">here<\/a>/);
    const unsafe = html('[click](javascript:alert(1)) [data](data:text/html,x) [vb](VBScript:x)');
    assert.ok(!unsafe.includes('href'));
    assert.ok(unsafe.includes('click'));
  });

  it('opens links in a new tab when asked to, without handing the page over', () => {
    assert.match(html('[site](https://example.org)', true), /target="_blank" rel="noopener noreferrer"/);
  });
});

describe('the text of a TSVB Markdown panel', () => {
  const scope = {
    count: { last: { raw: 12, formatted: '12' }, label: 'Count' },
    hosts: [{ name: 'a' }, { name: 'b' }],
    empty: [],
  };

  it('fills in values by their path', () => {
    assert.equal(renderTemplate('{{ count.label }}: {{count.last.formatted}}{{ missing.path }}', scope), 'Count: 12');
  });

  it('repeats, and chooses', () => {
    assert.equal(renderTemplate('{{#each hosts}}{{@index}}={{name}};{{/each}}', scope), '0=a;1=b;');
    assert.equal(renderTemplate('{{#each empty}}x{{else}}none{{/each}}', scope), 'none');
    assert.equal(renderTemplate('{{#if count.last.raw}}yes{{else}}no{{/if}}', scope), 'yes');
    assert.equal(renderTemplate('{{#unless empty}}nothing{{/unless}}', scope), 'nothing');
  });

  it('says what is wrong with a text it cannot use', () => {
    assert.throws(() => renderTemplate('{{#each hosts}}x', scope), /never closed/);
    assert.throws(() => renderTemplate('{{#lookup hosts}}x{{/lookup}}', scope), /lookup needs/);
  });
});

describe('the Math aggregation', () => {
  it('works out arithmetic in the usual order', () => {
    assert.equal(evaluateMath('1 + 2 * 3'), 7);
    assert.equal(evaluateMath('(1 + 2) * 3'), 9);
    assert.equal(evaluateMath('2 ^ 3 + 10 % 4'), 10);
    assert.equal(evaluateMath('-2 + 5 - -1'), 4);
    assert.equal(evaluateMath('1e3 / 4'), 250);
  });

  it('reads names from what it is given', () => {
    assert.equal(evaluateMath('params.a / params.b * 100', { params: { a: 1, b: 4 } }), 25);
    assert.equal(evaluateMath('divide(params.a, params.b)', { params: { a: 6, b: 3 } }), 2);
    assert.equal(evaluateMath('sum(params.values) + mean(params.values)', { params: { values: [1, 2, 3] } }), 8);
    assert.equal(evaluateMath('round(3.14159, 2)'), 3.14);
  });

  it('runs nothing that is not arithmetic', () => {
    assert.throws(() => evaluateMath('constructor("return 1")()'));
    assert.throws(() => evaluateMath('1 +'));
    assert.throws(() => evaluateMath('a = 1'));
  });
});

describe('TSVB series', () => {
  it('are named after their last metric', () => {
    assert.equal(metricLabel({ id: 's', metrics: [{ id: '1', type: 'count' }] }), 'Count');
    assert.equal(metricLabel({ id: 's', metrics: [{ id: '1', type: 'avg', field: 'bytes' }] }), 'Average of bytes');
    assert.equal(
      metricLabel({
        id: 's',
        metrics: [
          { id: '1', type: 'max', field: 'bytes' },
          { id: '2', type: 'derivative', field: '1' },
        ],
      }),
      'Derivative of Max of bytes'
    );
    assert.equal(metricLabel({ id: 's', metrics: [] }), 'Unknown');
  });

  it('are named as the product names a positive rate and a metric worked out from a percentile', () => {
    assert.equal(metricLabel({ id: 's', metrics: [{ id: '1', type: 'positive_rate', field: 'bytes', unit: '' }] }), 'Positive Rate of bytes');
    const percentile: TsvbMetric = { id: '1', type: 'percentile', field: 'bytes', percentiles: [{ id: 'a', value: 50, mode: 'line' }] };
    assert.equal(metricLabel({ id: 's', metrics: [percentile, { id: '2', type: 'derivative', field: '1[50.0]' }] }), 'Derivative of Percentile of bytes (50.0)');
    // A metric that names none of the series' metrics is worked out from an unknown one
    assert.equal(metricLabel({ id: 's', metrics: [{ id: '2', type: 'cumulative_sum', field: '9' }] }), 'Cumulative Sum of Unknown');
  });

  it('colour the terms they are split by from their own colour, darkening, or leave it to the chart', () => {
    assert.deepEqual(splitColors('#ff0000', 3, 'gradient'), ['#ff0000', '#c90000', '#930000']);
    assert.deepEqual(splitColors('rgba(255,0,0,1)', 1, 'gradient'), ['#ff0000']);
    assert.equal(splitColors('#ff0000', 3, 'rainbow')[0], '#68BC00');
    // The default colours the terms by their names, in the chart
    assert.deepEqual(splitColors('#ff0000', 3, 'opensearchDashboards'), []);
    assert.deepEqual(splitColors('#ff0000', 3, undefined), []);
  });

  it('write their values in their format, inside their template', () => {
    assert.equal(seriesFormatter('number')(1234.5), '1,234.5');
    assert.equal(seriesFormatter('percent')(0.123), '12.3%');
    assert.equal(seriesFormatter('number', '{{value}} req')(3), '3 req');
    assert.equal(seriesFormatter('ms,s,1')(1500), '1.5s');
    assert.equal(seriesFormatter(undefined)(null), '-');
  });

  it('take the colour of the last rule that holds', () => {
    const rules: ColorRule[] = [
      { id: 'a', operator: 'gte', value: 0, color: 'green' },
      { id: 'b', operator: 'gte', value: 100, color: 'red' },
    ];
    assert.equal(ruleFor(rules, 150)?.color, 'red');
    assert.equal(ruleFor(rules, 50)?.color, 'green');
    assert.equal(ruleFor(rules, null), undefined);
  });
});

describe('addresses', () => {
  it('are read and written with their state', () => {
    assert.deepEqual(parseHash('#/view/abc?_g=(time:(from:now-7d,to:now))&embed=true'), {
      hashPath: '/view/abc',
      hashParams: { _g: '(time:(from:now-7d,to:now))', embed: 'true' },
    });
    assert.equal(buildHash('/view/abc', { _g: "(a:'b c')", gone: undefined }), "#/view/abc?_g=(a:'b%20c')");
    assert.equal(buildHash('/', {}), '');
    assert.deepEqual(parseQuery('?a=1&b=x+y&c=%zz'), { a: '1', b: 'x y', c: '%zz' });
  });
});
