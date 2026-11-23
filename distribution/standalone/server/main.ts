/* SPDX-License-Identifier: Apache-2.0 */

/* Starts the server:  node dist/server/main.js [--config settings.yml] */

import { resolve } from 'node:path';
import { PRODUCT_NAME, createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { readBuild } from './static';

const USAGE = `Usage: node dist/server/main.js [options]

  -c, --config <file>   a settings file (YAML); the environment overrides it
  -v, --version         print the version
  -h, --help            print this

Settings carry the names OpenSearch Dashboards gives them: opensearch.hosts, server.port,
server.basePath, ... Each can also be given in the environment, in capitals with the dots as
underscores: OPENSEARCH_HOSTS='["http://opensearch-lite:9200"]'.`;

async function main() {
  const args = process.argv.slice(2);
  const distDirectory = resolve(__dirname, '..');
  let file = process.env.INFRADASHBOARD_CONFIG || undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      return;
    }
    if (arg === '-v' || arg === '--version') {
      console.log(readBuild(distDirectory).version);
      return;
    }
    if (arg === '-c' || arg === '--config') {
      file = args[index + 1];
      index += 1;
      if (!file) throw new Error(`${arg} needs a file`);
    } else {
      throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
    }
  }

  const { config, ignored, deprecations } = loadConfig({ file });
  const logger = createLogger(config.logging);
  // What the original says of a deprecated setting, in its words
  for (const message of deprecations) logger.warn(message, { tags: ['deprecation'] });
  if (ignored.length) {
    logger.warn(`Settings in ${file} that ${PRODUCT_NAME} does not read were ignored`, { ignored });
  }

  const app = createApp({ config, logger, distDirectory });
  await app.start();
  const { ssl } = config.server;
  logger.listening(
    `${PRODUCT_NAME} is listening on ${ssl.enabled ? 'https' : 'http'}://${config.server.host}:${config.server.port}`,
    {
      basePath: config.server.basePath,
      opensearch: config.opensearch.hosts,
      ...(ssl.enabled && ssl.redirectHttpFromPort !== undefined ? { redirectHttpFromPort: ssl.redirectHttpFromPort } : {}),
    }
  );

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, stopping`);
    // A request that never ends must not keep the container from stopping
    setTimeout(() => process.exit(0), 10000).unref();
    void app.stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((error: unknown) => {
  console.error((error as Error).message ?? error);
  process.exit(1);
});
