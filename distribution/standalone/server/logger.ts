/* SPDX-License-Identifier: Apache-2.0 */

/* One line of JSON per event on standard output, which is what a container platform collects. */

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(options: { quiet?: boolean; verbose?: boolean } = {}): Logger {
  const write = (level: string, message: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({ '@timestamp': new Date().toISOString(), level, message, ...fields });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    info: (message, fields) => {
      if (!options.quiet) write('info', message, fields);
    },
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    debug: (message, fields) => {
      if (options.verbose) write('debug', message, fields);
    },
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} };
