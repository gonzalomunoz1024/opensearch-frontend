/* SPDX-License-Identifier: Apache-2.0 */

/* The server as it is built (dist/), started for a test and asked for a few addresses. */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { silentLogger } from '../../server/logger';
import { fakeOpenSearch } from './fake_opensearch';

export interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  bytes: Buffer;
}

/** An address as a request sends it (not read as a URL first), with the headers it adds */
export type Target = string | { path: string; headers?: Record<string, string> };

/** The directory the server is built in, which holds the browser side's files under public/ */
export const DIST_DIRECTORY = resolve(__dirname, '..', '..');

/** The server as it is built, with the given settings, asked for each target in turn */
export async function served(targets: Target[], settings: Record<string, string> = {}): Promise<Answer[]> {
  const opensearch = await fakeOpenSearch();
  let app: ReturnType<typeof createApp> | undefined;
  try {
    const { config } = loadConfig({
      env: { SERVER_HOST: '127.0.0.1', SERVER_PORT: '0', OPENSEARCH_HOSTS: JSON.stringify([opensearch.url]), ...settings },
    });
    app = createApp({ config, logger: silentLogger, distDirectory: DIST_DIRECTORY });
    await app.start();
    const { port } = app.server.address() as AddressInfo;
    const answers: Answer[] = [];
    for (const target of targets) {
      const { path, headers } = typeof target === 'string' ? { path: target, headers: {} } : target;
      answers.push(
        await new Promise<Answer>((done, failed) => {
          const request = http.request({ host: '127.0.0.1', port, path, headers, agent: false }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => {
              const bytes = Buffer.concat(chunks);
              done({ status: response.statusCode ?? 0, headers: response.headers, body: bytes.toString('utf8'), bytes });
            });
          });
          request.on('error', failed);
          request.end();
        })
      );
    }
    return answers;
  } finally {
    await app?.stop();
    await opensearch.close();
  }
}
