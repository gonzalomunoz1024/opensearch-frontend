/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../../server/http';
import {
  assertShortUrlValid,
  gotoLocation,
  readShortenBody,
  shortUrlId,
} from '../../server/short_urls';

/** The status and message an address or a body is refused with */
function refusal(body: () => unknown): [number, string] | undefined {
  try {
    body();
    return undefined;
  } catch (error) {
    if (error instanceof HttpError) return [error.status, error.message];
    throw error;
  }
}

describe('short URLs', () => {
  it('names an address by the MD5 of its text, as the original does', () => {
    assert.equal(shortUrlId('/app/home#/'), '5111b0f660e6f17d2021bd31f6fe2211');
  });

  it('takes addresses of an app of this product, also inside a workspace', () => {
    assert.equal(refusal(() => assertShortUrlValid('/app/home#/')), undefined);
    assert.equal(refusal(() => assertShortUrlValid('/app/dashboards?_g=()')), undefined);
    assert.equal(refusal(() => assertShortUrlValid('/w/ws1/app/discover')), undefined);
  });

  it('refuses another site, another protocol and other paths with the messages of the original', () => {
    assert.deepEqual(refusal(() => assertShortUrlValid('http://localhost:5601/app/home')), [
      406,
      'Short url targets cannot have a protocol, found "http:"',
    ]);
    assert.deepEqual(refusal(() => assertShortUrlValid('//foo/app/x')), [
      406,
      'Short url targets cannot have a hostname, found "foo"',
    ]);
    assert.deepEqual(refusal(() => assertShortUrlValid('/foo/bar')), [
      406,
      'Short url target path must be in the format "/app/{{appId}}", found "/foo/bar"',
    ]);
    assert.deepEqual(refusal(() => assertShortUrlValid('/app/')), [
      406,
      'Short url target path must be in the format "/app/{{appId}}", found "/app/"',
    ]);
    assert.deepEqual(refusal(() => assertShortUrlValid('')), [
      406,
      'Short url target path must be in the format "/app/{{appId}}", found "null"',
    ]);
  });

  it('sends the browser under the base path, escaping the address as the original does', () => {
    assert.equal(gotoLocation('/app/home#/', ''), '/app/home#/');
    assert.equal(gotoLocation('/app/home#/', '/osd'), '/osd/app/home#/');
    assert.equal(
      gotoLocation("/app/home#/view?_a=(query:'a b')", ''),
      '/app/home#/view?_a=(query:%27a%20b%27)'
    );
    assert.equal(
      gotoLocation('/app/home?b=x y&a=1&c=%41&d#/view', ''),
      '/app/home?b=x%20y&a=1&c=A&d=#/view'
    );
    assert.equal(
      gotoLocation("/app/dashboards?embed=true&_g=(x:'1')#/view/1?_a=(t:'%20')", ''),
      "/app/dashboards?embed=true&_g=(x%3A'1')#/view/1?_a=(t:%27%20%27)"
    );
  });

  it('reads the body of a request to shorten as the original validates it', () => {
    assert.equal(readShortenBody({ url: '/app/home' }), '/app/home');
    assert.equal(readShortenBody('{"url":"/app/home"}'), '/app/home');
    const cases: Array<[unknown, string]> = [
      [undefined, '[request body]: expected a plain object value, but found [null] instead.'],
      [[], '[request body]: expected a plain object value, but found [Array] instead.'],
      [12, '[request body]: expected a plain object value, but found [number] instead.'],
      ['x', '[request body]: could not parse object value from json input'],
      ['12', '[request body]: expected a plain object value, but found [number] instead.'],
      [{}, '[request body.url]: expected value of type [string] but got [undefined]'],
      [{ url: null }, '[request body.url]: expected value of type [string] but got [null]'],
      [{ url: [] }, '[request body.url]: expected value of type [string] but got [Array]'],
      [{ url: {} }, '[request body.url]: expected value of type [string] but got [Object]'],
      [{ url: true }, '[request body.url]: expected value of type [string] but got [boolean]'],
      [{ url: 123 }, '[request body.url]: expected value of type [string] but got [number]'],
      [{ a: 1 }, '[request body.url]: expected value of type [string] but got [undefined]'],
      [{ url: '/app/x', a: 1, b: 2 }, '[request body.a]: definition for this key is missing'],
    ];
    for (const [body, message] of cases) {
      assert.deepEqual(refusal(() => readShortenBody(body)), [400, message]);
    }
  });
});
