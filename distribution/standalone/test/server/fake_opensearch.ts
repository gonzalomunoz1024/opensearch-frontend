/* SPDX-License-Identifier: Apache-2.0 */

/* Something that listens as OpenSearch does, for the tests of what the server sends to it. */

import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface FakeOpenSearch {
  url: string;
  /** Each request that arrived, as "METHOD path" */
  seen: string[];
  close(): Promise<void>;
}

/**
 * Notes each request and answers it with an empty object, or with what the function makes of
 * its path, or never answers
 */
export async function fakeOpenSearch(
  answer: 'answer' | 'hang' | ((path: string) => unknown) = 'answer'
): Promise<FakeOpenSearch> {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (answer === 'hang') return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify((typeof answer === 'function' ? answer(req.url ?? '') : undefined) ?? {}));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
