/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A failed search, told as OpenSearch Dashboards 3.9.0 tells it: the error its HTTP client makes of
 * a refused search (named for the status of the answer, OpenSearch's answer kept for the whole
 * text), and the toast service's addError, which shows the same message once while it is showing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpFetchError } from '../../web/services/http';
import { searchFailure } from '../../web/services/search';
import { Toasts } from '../../web/services/toasts';

const ANSWER = {
  error: {
    root_cause: [{ type: 'query_shard_exception', reason: 'Failed to parse query [foo:(]' }],
    type: 'search_phase_execution_exception',
    reason: 'all shards failed',
    caused_by: { type: 'query_shard_exception', reason: 'Failed to parse query [foo:(]' },
  },
  status: 400,
};

describe('a refused search, as the original names it', () => {
  it('takes the words of the answer\'s status, and keeps OpenSearch\'s answer', () => {
    const refused = new HttpFetchError(400, 'all shards failed: Failed to parse query [foo:(]', ANSWER, 'Bad Request');
    const shown = searchFailure(refused) as HttpFetchError;
    assert.ok(shown instanceof HttpFetchError);
    assert.equal(shown.message, 'Bad Request');
    assert.equal(shown.name, 'Error');
    assert.equal(shown.status, 400);
    assert.equal(shown.body, ANSWER);
    assert.match(shown.stack ?? '', /^Error: Bad Request\n/);
    assert.equal(/HttpFetchError/.test(shown.stack ?? ''), false);
  });

  it('knows the words of a status the answer left without them', () => {
    assert.equal(searchFailure(new HttpFetchError(502, 'The request failed (502)')).message, 'Bad Gateway');
    assert.equal(searchFailure(new HttpFetchError(504, 'The request failed (504)')).message, 'Gateway Timeout');
    assert.equal(searchFailure(new HttpFetchError(599, 'The request failed (599)')).message, '599');
  });

  it('gives the same error when asked twice', () => {
    const once = searchFailure(new HttpFetchError(400, 'x', ANSWER, 'Bad Request'));
    const twice = searchFailure(once);
    assert.equal(twice.message, 'Bad Request');
    assert.equal(twice.stack?.match(/Error: Bad Request/g)?.length, 1);
  });

  it('leaves alone what is not a refused answer: a query that cannot be read, a server out of reach', () => {
    const unread = new Error('Expected whitespace, NOT, "(", value but end of input found.');
    assert.equal(searchFailure(unread), unread);
    const unreachable = new HttpFetchError(0, 'The server cannot be reached');
    assert.equal(searchFailure(unreachable), unreachable);
  });
});

describe('the toast service\'s errors, as the original\'s addError', () => {
  // The waits the service asks the browser for, which these tests only record
  const withTimers = (run: (timers: number[]) => void) => {
    const timers: number[] = [];
    const globals = globalThis as { window?: unknown };
    globals.window = { setTimeout: (_run: () => void, wait: number) => timers.push(wait) };
    try {
      run(timers);
    } finally {
      delete globals.window;
    }
  };

  it('shows the error\'s message under the title, keeps the error and stays as long as errors do', () =>
    withTimers((timers) => {
      const toasts = new Toasts();
      toasts.lifetimes.critical = 300000;
      const error = new Error('Expected AND, OR, whitespace, ")" but end of input found.');
      toasts.addError(error, { title: 'Search Error', id: '12345' });
      const [shown] = toasts.get();
      assert.equal(shown.kind, 'critical');
      assert.equal(shown.title, 'Search Error');
      assert.equal(shown.text, error.message);
      assert.equal(shown.error, error);
      assert.deepEqual(timers, [300000]);
    }));

  it('says toastMessage in place of the error\'s message when given one', () =>
    withTimers(() => {
      const toasts = new Toasts();
      toasts.addError(new Error('long'), { title: 'Saving failed', toastMessage: 'short' });
      assert.equal(toasts.get()[0].text, 'short');
    }));

  it('adds no second message for an id still showing, and a new one once it has gone', () =>
    withTimers(() => {
      const toasts = new Toasts();
      const first = toasts.addError(new Error('a'), { title: 'Search Error', id: 'same' });
      assert.equal(toasts.addError(new Error('a'), { title: 'Search Error', id: 'same' }), first);
      assert.equal(toasts.get().length, 1);
      toasts.dismiss(first);
      const again = toasts.addError(new Error('a'), { title: 'Search Error', id: 'same' });
      assert.notEqual(again, first);
      assert.equal(toasts.get().length, 1);
    }));

  it('keeps a red message in a few words as long as a warning, as the original\'s addDanger', () =>
    withTimers((timers) => {
      const toasts = new Toasts();
      toasts.lifetimes.warning = 10000;
      toasts.danger('Search Error', 'Error executing Painless script');
      assert.deepEqual(timers, [10000]);
    }));
});
