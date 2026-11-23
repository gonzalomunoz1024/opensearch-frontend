/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the URL and colour formats draw: a link made absolute from where the page was loaded, a
 * picture, a player, and a list value by value. The addresses are those the original's UrlFormat
 * wrote for the same values with the same parsedUrl (OpenSearch Dashboards 3.9.0).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormattedText } from '../../web/components/formatted';
import { createFormatter, DEFAULT_FORMAT_SETTINGS, type FormatSettings } from '../../web/lib/field_formats';
import { createServices, type BootData } from '../../web/services';

const at = (basePath: string): FormatSettings => ({
  ...DEFAULT_FORMAT_SETTINGS,
  parsedUrl: { origin: 'http://h.test:5690', pathname: '/xyz/app/data-explorer/discover', basePath },
});
const draw = (spec: { id: string; params?: Record<string, unknown> }, value: unknown, settings = at('')) =>
  renderToStaticMarkup(<FormattedText formatted={createFormatter(spec, settings)(value)} />);

describe('a link of the URL format', () => {
  // [value, where it goes on a server without a base path, where under the base path /xyz]
  const rows: Array<[value: string, plain: string, based: string]> = [
    ['#/discover', 'http://h.test:5690/xyz/app/data-explorer/discover#/discover', 'http://h.test:5690/xyz/app/data-explorer/discover#/discover'],
    ['/app/home', 'http://h.test:5690/app/home', 'http://h.test:5690/xyz/app/app/home'],
    ['/xyz/app/home', 'http://h.test:5690/xyz/app/home', 'http://h.test:5690/xyz/app/home'],
    ['/xyzapp', 'http://h.test:5690/xyzapp', 'http://h.test:5690/xyzapp'],
    ['../app/home', 'http://h.test:5690/app/../app/home', 'http://h.test:5690/xyz/app/../app/home'],
    ['relative/path', 'http://h.test:5690/app/relative/path', 'http://h.test:5690/xyz/app/relative/path'],
    ['//example.com/x', 'http://h.test:5690//example.com/x', 'http://h.test:5690/xyz/app//example.com/x'],
    ['mailto:a@b.c', 'http://h.test:5690/app/mailto:a@b.c', 'http://h.test:5690/xyz/app/mailto:a@b.c'],
    ['HTTP://EXAMPLE.COM/x', 'http://h.test:5690/app/HTTP://EXAMPLE.COM/x', 'http://h.test:5690/xyz/app/HTTP://EXAMPLE.COM/x'],
    ['https://example.com/p?a=1', 'https://example.com/p?a=1', 'https://example.com/p?a=1'],
    ['javascript:alert(1)', 'http://h.test:5690/app/javascript:alert(1)', 'http://h.test:5690/xyz/app/javascript:alert(1)'],
    ['', 'http://h.test:5690/app/', 'http://h.test:5690/xyz/app/'],
    [' x ', 'http://h.test:5690/app/ x ', 'http://h.test:5690/xyz/app/ x '],
    ['/', 'http://h.test:5690/', 'http://h.test:5690/xyz/app/'],
    ['xyz', 'http://h.test:5690/app/xyz', 'http://h.test:5690/xyz/app/xyz'],
  ];

  it('that is not to an http or https address is made absolute from where the page was loaded, as the original makes it', () => {
    for (const [basePath, column] of [['', 1], ['/xyz', 2]] as const) {
      const url = createFormatter({ id: 'url' }, at(basePath));
      assert.deepEqual(
        rows.map(([value]) => [url(value).text, url(value).href]),
        rows.map((row) => [row[0], row[column]]),
        `base path "${basePath}"`
      );
    }
  });

  it('is made from the template first, and opens in the tab the format says', () => {
    const params = { urlTemplate: '#/doc/{{value}}', labelTemplate: 'Open {{value}}' };
    assert.equal(
      draw({ id: 'url', params }, 'a b'),
      '<a href="http://h.test:5690/xyz/app/data-explorer/discover#/doc/a%20b" target="_blank" rel="noopener noreferrer">Open a b</a>'
    );
    // Anything but nothing for "in the current tab" means it, as the original reads the parameter
    assert.equal(
      draw({ id: 'url', params: { openLinkInCurrentTab: 'yes' } }, '#/discover'),
      '<a href="http://h.test:5690/xyz/app/data-explorer/discover#/discover" target="_self" rel="noopener noreferrer">#/discover</a>'
    );
  });

  it('stays what is safe to follow where the formats are not told where the page is', () => {
    const url = createFormatter({ id: 'url' });
    assert.equal(url('relative/path').href, 'relative/path');
    assert.equal(url('javascript:alert(1)').href, undefined);
  });

  it('is told where the page was loaded and the base path of the server by the services', () => {
    const scope = globalThis as { window?: unknown };
    const before = scope.window;
    scope.window = { location: { origin: 'http://h.test:5690', pathname: '/xyz/app/home' } };
    try {
      const boot = { basePath: '/xyz', version: '3.9.0', name: 'test', settings: {}, settingsDefaults: {}, settingsOverrides: {} };
      const settings = createServices(boot as unknown as BootData).formatSettings();
      assert.deepEqual(settings.parsedUrl, { origin: 'http://h.test:5690', pathname: '/xyz/app/home', basePath: '/xyz' });
      assert.equal(createFormatter({ id: 'url' }, settings)('#/x').href, 'http://h.test:5690/xyz/app/home#/x');
    } finally {
      scope.window = before;
    }
  });
});

describe('a sound and a picture of the URL format', () => {
  it('draws the Audio type as a player that loads nothing until it is played', () => {
    assert.equal(
      draw({ id: 'url', params: { type: 'audio' } }, 'https://example.com/a.ogg'),
      '<audio controls="" preload="none" src="https://example.com/a.ogg"></audio>'
    );
    // The address as it is, not made absolute, as the original writes a player's and a picture's
    assert.equal(
      draw({ id: 'url', params: { type: 'audio', urlTemplate: '/sounds/{{value}}.ogg' } }, 'bell', at('/xyz')),
      '<audio controls="" preload="none" src="/sounds/bell.ogg"></audio>'
    );
    // No player for an address a browser would run
    assert.equal(draw({ id: 'url', params: { type: 'audio' } }, 'javascript:alert(1)'), 'javascript:alert(1)');
  });

  it('tells where a picture comes from when no label says what it shows', () => {
    assert.equal(
      draw({ id: 'url', params: { type: 'img' } }, 'https://example.com/a.png'),
      '<img src="https://example.com/a.png" alt="A dynamically-specified image located at https://example.com/a.png" style="width:auto;height:auto;max-width:none;max-height:none"/>'
    );
    assert.equal(
      draw({ id: 'url', params: { type: 'img', labelTemplate: 'The logo of {{value}}', urlTemplate: '/img/{{value}}.png', width: '40', height: 30.7 } }, 'acme'),
      '<img src="/img/acme.png" alt="The logo of acme" style="width:auto;height:auto;max-width:40px;max-height:30px"/>'
    );
  });
});

describe('a list under a format that draws', () => {
  it('gets a link for each value', () => {
    assert.equal(
      draw({ id: 'url', params: { urlTemplate: 'https://example.com/{{value}}' } }, ['a', 'b c', null]),
      '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>, ' +
        '<a href="https://example.com/b%20c" target="_blank" rel="noopener noreferrer">https://example.com/b%20c</a>,  - '
    );
    const formatted = createFormatter({ id: 'url' }, at(''))(['#/a', ['#/b']]);
    assert.equal(formatted.text, '#/a, #/b');
    assert.deepEqual(formatted.parts?.map((part) => part.href), [
      'http://h.test:5690/xyz/app/data-explorer/discover#/a',
      'http://h.test:5690/xyz/app/data-explorer/discover#/b',
    ]);
  });

  it('gets a picture or a player for each value', () => {
    const pictures = draw({ id: 'url', params: { type: 'img' } }, ['https://example.com/a.png', 'https://example.com/b.png']);
    assert.equal(pictures.match(/<img /g)?.length, 2);
    const players = draw({ id: 'url', params: { type: 'audio' } }, ['https://example.com/a.ogg', 'https://example.com/b.ogg']);
    assert.equal(players.match(/<audio /g)?.length, 2);
  });

  it('gets the colour of each value, not the first one for all', () => {
    const colors = [
      { range: '0:100', text: '#ff0000', background: '#00ff00' },
      { range: '500:600', text: '#0000ff', background: '#ffff00' },
    ];
    const spec = { id: 'color', params: { fieldType: 'number', colors } };
    const formatted = createFormatter(spec)([50, 200, 503]);
    assert.equal(formatted.text, '50, 200, 503');
    assert.deepEqual(
      formatted.parts?.map((part) => [part.text, part.color, part.background]),
      [
        ['50', '#ff0000', '#00ff00'],
        ['200', undefined, undefined],
        ['503', '#0000ff', '#ffff00'],
      ]
    );
    const drawn = draw(spec, [50, 200, 503]);
    assert.match(drawn, /^<span style="color:#ff0000;background-color:#00ff00[^"]*">50<\/span>, 200, <span style="color:#0000ff;background-color:#ffff00[^"]*">503<\/span>$/);
  });

  it('is one value when it holds one, and nothing when it holds none', () => {
    assert.equal(draw({ id: 'url' }, ['https://example.com/a']), '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>');
    assert.equal(draw({ id: 'url' }, []), '');
  });
});
