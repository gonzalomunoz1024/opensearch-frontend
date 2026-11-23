/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import http from 'node:http';
import net, { type AddressInfo, type Socket } from 'node:net';
import { describe, it } from 'node:test';
import { gunzipSync, inflateSync } from 'node:zlib';
import {
  ClientClosedError,
  HttpError,
  Router,
  acceptedEncoding,
  errorBody,
  normalizePath,
  parseBody,
  readBody,
  readablePath,
  sendReply,
  targetPath,
  type Reply,
  type SendOptions,
} from '../../server/http';

interface Served {
  url: string;
  port: number;
  /** How many connections have been opened to it */
  connections(): number;
  close(): Promise<void>;
}

/** A server of Node's own that hands each request to the function */
async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>): Promise<Served> {
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => void handler(req, res));
  server.on('connection', (socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    connections: () => connections,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** One request; a body given as a list is sent in those chunks, without a length */
function call(
  served: Served,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string | string[]; agent?: http.Agent }
): Promise<Answer> {
  return new Promise((done, failed) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: served.port,
        method: options.method ?? 'GET',
        path: options.path ?? '/',
        headers: options.headers,
        agent: options.agent ?? false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
      }
    );
    request.on('error', failed);
    if (Array.isArray(options.body)) for (const chunk of options.body) request.write(chunk);
    else if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

const json = (answer: Answer) => JSON.parse(answer.body.toString('utf8')) as unknown;

describe('the routes of a router', () => {
  const router = new Router();
  const handler = () => ({});
  router.get('/api/status', handler);
  router.post('/api/saved_objects/{type}/{id}', handler);
  router.get('/api/files/{rest*}', handler);
  const found = (method: string, path: string) => {
    const { route, params, allowed } = router.match(method, path);
    return { pattern: route?.pattern, params, allowed };
  };

  it('match every part of the path, as hapi matches them', () => {
    assert.equal(found('GET', '/api/status').pattern, '/api/status');
    assert.equal(found('GET', '/api//status').pattern, undefined);
    assert.equal(found('GET', '/api/status/').pattern, undefined);
    assert.equal(found('GET', '//api/status').pattern, undefined);
    assert.equal(found('HEAD', '/api/status').pattern, '/api/status');
  });

  it('give the named parts decoded, and never match an empty one', () => {
    assert.deepEqual(found('POST', '/api/saved_objects/index-pattern/a%20b').params, { type: 'index-pattern', id: 'a b' });
    assert.equal(found('POST', '/api/saved_objects/index-pattern/').pattern, undefined);
    assert.equal(found('POST', '/api/saved_objects//x').pattern, undefined);
    assert.deepEqual(found('GET', '/api/files/a/b%2Fc').params, { rest: 'a/b/c' });
    assert.deepEqual(found('GET', '/api/files').params, { rest: '' });
    // hapi's route for a path it cannot read answers so (Boom.badRequest())
    assert.throws(() => router.match('POST', '/api/saved_objects/a/%E0%A4%A'), {
      name: 'UnreadablePathError',
      status: 400,
      message: 'Bad Request',
    });
  });

  it('are looked for with the path as hapi normalizes it, which is as it was sent', () => {
    // @hapi/call normalize: escapes in capitals, those of what needs none decoded, then the steps
    assert.equal(normalizePath('/api/st%61tus'), '/api/status');
    assert.equal(normalizePath('/a%2fb%7e%41%5f%2D'), '/a%2Fb~A_-');
    assert.equal(normalizePath('/a%20b%25%3f%23%2F'), '/a%20b%25%3F%23%2F');
    assert.equal(normalizePath('/a/./b/../c'), '/a/c');
    assert.equal(normalizePath('/a/%2e%2E/c'), '/c');
    assert.equal(normalizePath('/a/..'), '/');
    assert.equal(normalizePath('/a/.'), '/a/');
    assert.equal(normalizePath('/../../a'), '/a');
    assert.equal(normalizePath('/a\\b/%zz'), '/a\\b/%zz');
    assert.equal(targetPath('/a\\b?c=/d#e'), '/a\\b');
    assert.equal(targetPath('/a#b?c'), '/a');
    assert.equal(targetPath('/a'), '/a');
    assert.equal(readablePath('/a%20b/%C3%A9'), true);
    for (const path of ['/a%zz', '/a%', '/a%2', '/a%C3', '/a%C3%28', '/a%ED%A0%80']) assert.equal(readablePath(path), false, path);
  });

  it('say which methods a path has when the one asked for is not among them', () => {
    assert.deepEqual(found('PUT', '/api/status'), { pattern: undefined, params: {}, allowed: ['GET'] });
    assert.deepEqual(found('PUT', '/api/nothing'), { pattern: undefined, params: {}, allowed: [] });
  });
});

describe('the body of a request', () => {
  /** A server that reads each body up to 10 bytes and answers what it read, or why it could not */
  const bodyServer = (onError?: (error: unknown) => void) =>
    serve(async (req, res) => {
      try {
        const body = await readBody(req, 10);
        await sendReply(req, res, { body: { text: body.toString('utf8') } });
      } catch (error) {
        onError?.(error);
        if (error instanceof ClientClosedError) return;
        const status = error instanceof HttpError ? error.status : 500;
        await sendReply(req, res, { status, body: errorBody(status, (error as Error).message) });
      }
    });

  it('is read whole up to the limit', async () => {
    const served = await bodyServer();
    try {
      const answer = await call(served, { method: 'POST', body: ['hello', ' you'] });
      assert.deepEqual(json(answer), { text: 'hello you' });
    } finally {
      await served.close();
    }
  });

  it('over the limit is answered 413 in the words of hapi, sent in chunks or with its length, and the connection carries the next request', async () => {
    const served = await bodyServer();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const tooLarge = {
        statusCode: 413,
        error: 'Request Entity Too Large',
        message: 'Payload content length greater than maximum allowed: 10',
      };
      const declared = await call(served, { method: 'POST', agent, headers: { 'content-length': '20' }, body: 'x'.repeat(20) });
      assert.equal(declared.status, 413);
      assert.deepEqual(json(declared), tooLarge);
      const chunked = await call(served, { method: 'POST', agent, body: ['x'.repeat(8), 'y'.repeat(8), 'z'.repeat(8)] });
      assert.equal(chunked.status, 413);
      assert.deepEqual(json(chunked), tooLarge);
      const next = await call(served, { method: 'POST', agent, body: 'ok' });
      assert.deepEqual(json(next), { text: 'ok' });
      assert.equal(served.connections(), 1);
    } finally {
      agent.destroy();
      await served.close();
    }
  });

  it('of a client that goes away in the middle of it is no failure of the server', async () => {
    let caught: (error: unknown) => void = () => undefined;
    const failure = new Promise<unknown>((resolve) => {
      caught = resolve;
    });
    const served = await bodyServer((error) => caught(error));
    try {
      const socket = net.connect(served.port, '127.0.0.1');
      socket.on('error', () => undefined);
      await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
      socket.write('POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 9\r\n\r\nabc');
      await new Promise((resolve) => setTimeout(resolve, 50));
      socket.destroy();
      assert.ok((await failure) instanceof ClientClosedError);
    } finally {
      await served.close();
    }
  });

  it('is read as its type says, as hapi reads it for a route that validates it', () => {
    const read = (text: string, type?: string) => parseBody(Buffer.from(text), type);
    const status = (text: string, type?: string) => {
      try {
        read(text, type);
        return 'read';
      } catch (error) {
        return error instanceof HttpError ? `${error.status} ${error.message}` : String(error);
      }
    };
    assert.deepEqual(read('{"a":1}'), { a: 1 });
    assert.deepEqual(read('{"a":1}', 'application/json; charset=utf-8'), { a: 1 });
    assert.deepEqual(read('[1]', 'application/vnd.api+json'), [1]);
    assert.deepEqual(read('[1]', 'text/plain'), [1]);
    assert.deepEqual({ ...(read('a=1&b=2&a=3', 'application/x-www-form-urlencoded') as object) }, { a: ['1', '3'], b: '2' });
    assert.equal(read('', 'application/json'), undefined);
    assert.equal(read(' \n'), undefined);
    // Text that is no JSON goes to the route's schema, which refuses it in its words
    assert.equal(read('nope', 'text/plain'), 'nope');
    assert.equal(status('nope', 'application/json'), '400 Invalid request payload JSON format');
    assert.equal(status('<a/>', 'application/xml'), '415 Unsupported Media Type');
    assert.equal(status('[]', 'application/octet-stream'), '415 Unsupported Media Type');
    assert.equal(status('x', 'multipart/form-data; boundary=x'), '415 Unsupported Media Type');
    // A key __proto__ anywhere, written plainly or not, as hapi's JSON parser refuses it
    assert.equal(status('{"changes":{"__proto__":{"x":1}}}'), '400 Invalid request payload JSON format');
    assert.equal(status('[{"type":"config","id":"x","\\u005f_proto__":{}}]'), '400 Invalid request payload JSON format');
    assert.equal(status('{"__proto__":1}', 'text/plain'), '400 Invalid request payload JSON format');
    assert.deepEqual(read('[{"constructor":{"prototype":{}}}]'), [{ constructor: { prototype: {} } }]);
  });
});

describe('an error', () => {
  it('is named as hapi names its status, which is not always the name Node gives it', () => {
    assert.deepEqual(errorBody(413, 'x'), { statusCode: 413, error: 'Request Entity Too Large', message: 'x' });
    assert.equal(errorBody(408, 'x').error, 'Request Time-out');
    assert.equal(errorBody(414, 'x').error, 'Request-URI Too Large');
    assert.equal(errorBody(416, 'x').error, 'Requested Range Not Satisfiable');
    assert.equal(errorBody(504, 'x').error, 'Gateway Time-out');
    assert.equal(errorBody(404, 'x').error, 'Not Found');
    assert.deepEqual(errorBody(400, 'x', { a: 1 }), { statusCode: 400, error: 'Bad Request', message: 'x', attributes: { a: 1 } });
  });
});

describe('the coding of an answer', () => {
  it('is the one hapi picks for each accept-encoding (as measured on the original)', () => {
    const measured: Array<[string | undefined, string | undefined]> = [
      ['gzip;q=0', undefined],
      ['deflate', 'deflate'],
      ['deflate, gzip', 'gzip'],
      ['gzip, deflate', 'gzip'],
      ['br', undefined],
      ['*', undefined],
      ['gzip;q=0.5, deflate;q=0.8', 'deflate'],
      ['identity;q=0', undefined],
      ['*;q=0', undefined],
      ['GZIP', 'gzip'],
      ['x-gzip', 'gzip'],
      ['gzip;q=0.5;x=1', undefined],
      ['gzip, deflate, br, zstd', 'gzip'],
      ['identity, gzip;q=0.5', undefined],
      [undefined, undefined],
    ];
    for (const [header, coding] of measured) {
      assert.equal(`${header} -> ${acceptedEncoding(header)}`, `${header} -> ${coding}`);
    }
  });
});

describe('an answer', () => {
  const large = { text: 'x'.repeat(2000) };
  const replies: Record<string, [Reply, SendOptions?]> = {
    '/small': [{ body: { a: 1 } }],
    '/large': [{ body: large }],
    '/off': [{ body: large }, { compress: false }],
    '/headers': [
      { headers: { 'Content-Type': 'text/csv', 'X-Mine': 'a' }, body: 'a,b' },
      { headers: { 'x-mine': 'b', 'X-Extra': ['1', '2'] } },
    ],
    '/redirect': [{ status: 302, headers: { location: '/x' } }],
    '/empty': [{}],
    '/vary': [{ headers: { vary: 'origin' }, body: 'y'.repeat(1500) }],
    '/bytes': [{ body: Buffer.alloc(2000) }],
  };
  const answering = () =>
    serve(async (req, res) => {
      const [reply, options] = replies[req.url ?? ''] ?? [{ status: 404 }];
      await sendReply(req, res, reply, options);
    });

  it('of less than 1 kB is sent as it is, and says nothing of codings', async () => {
    const served = await answering();
    try {
      const answer = await call(served, { path: '/small', headers: { 'accept-encoding': 'gzip' } });
      assert.equal(answer.status, 200);
      assert.equal(answer.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(answer.headers['content-length'], '7');
      assert.equal(answer.headers.vary, undefined);
      assert.equal(answer.headers['content-encoding'], undefined);
    } finally {
      await served.close();
    }
  });

  it('of 1 kB or more varies with accept-encoding and is compressed when the client accepts it', async () => {
    const served = await answering();
    try {
      const gzipped = await call(served, { path: '/large', headers: { 'accept-encoding': 'gzip, deflate' } });
      assert.equal(gzipped.headers['content-encoding'], 'gzip');
      assert.equal(gzipped.headers.vary, 'accept-encoding');
      assert.equal(gzipped.headers['content-length'], String(gzipped.body.length));
      assert.deepEqual(JSON.parse(gunzipSync(gzipped.body).toString('utf8')), large);

      const deflated = await call(served, { path: '/large', headers: { 'accept-encoding': 'deflate' } });
      assert.deepEqual(JSON.parse(inflateSync(deflated.body).toString('utf8')), large);

      const asked: Array<Record<string, string>> = [{}, { 'accept-encoding': 'gzip;q=0' }];
      for (const headers of asked) {
        const plain = await call(served, { path: '/large', headers });
        assert.equal(plain.headers['content-encoding'], undefined);
        assert.equal(plain.headers.vary, 'accept-encoding');
        assert.deepEqual(json(plain), large);
      }

      const off = await call(served, { path: '/off', headers: { 'accept-encoding': 'gzip' } });
      assert.equal(off.headers['content-encoding'], undefined);
      assert.deepEqual(json(off), large);

      const head = await call(served, { method: 'HEAD', path: '/large', headers: { 'accept-encoding': 'gzip' } });
      assert.equal(head.headers['content-encoding'], undefined);
      assert.equal(head.headers['content-length'], String(JSON.stringify(large).length));
      assert.equal(head.body.length, 0);

      assert.equal((await call(served, { path: '/vary', headers: { 'accept-encoding': 'gzip' } })).headers.vary, 'origin,accept-encoding');
      const bytes = await call(served, { path: '/bytes', headers: { 'accept-encoding': 'gzip' } });
      assert.equal(bytes.headers['content-type'], 'application/octet-stream');
      assert.equal(bytes.headers['content-encoding'], undefined);
      assert.equal(bytes.headers.vary, undefined);
    } finally {
      await served.close();
    }
  });

  it('takes the headers put over it whatever the case of their names', async () => {
    const served = await answering();
    try {
      const answer = await call(served, { path: '/headers' });
      assert.equal(answer.headers['content-type'], 'text/csv');
      assert.equal(answer.headers['x-mine'], 'b');
      assert.equal(answer.headers['x-extra'], '1, 2');
      assert.equal(answer.body.toString('utf8'), 'a,b');
    } finally {
      await served.close();
    }
  });

  it('with nothing in it says so, unless it is a 204', async () => {
    const served = await answering();
    try {
      const redirect = await call(served, { path: '/redirect' });
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers['content-length'], '0');
      assert.equal(redirect.headers['transfer-encoding'], undefined);
      const empty = await call(served, { path: '/empty' });
      assert.equal(empty.status, 204);
      assert.equal(empty.headers['content-length'], undefined);
    } finally {
      await served.close();
    }
  });
});
