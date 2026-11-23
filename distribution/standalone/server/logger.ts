/* SPDX-License-Identifier: Apache-2.0 */

/*
 * One line of JSON per event on standard output, which is what a container platform collects.
 * The switches are the original's: logging.silent says nothing, logging.quiet only errors and
 * where the server listens, logging.verbose everything, each request too.
 */

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  /** Where the server listens: said even when logging.quiet is on, as the original says it */
  listening(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(options: { quiet?: boolean; verbose?: boolean; silent?: boolean } = {}): Logger {
  const write = (level: string, message: string, fields?: Record<string, unknown>) => {
    if (options.silent) return;
    const line = JSON.stringify({ '@timestamp': new Date().toISOString(), level, message, ...fields });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    info: (message, fields) => {
      if (!options.quiet) write('info', message, fields);
    },
    warn: (message, fields) => {
      if (!options.quiet) write('warn', message, fields);
    },
    error: (message, fields) => write('error', message, fields),
    debug: (message, fields) => {
      if (options.verbose && !options.quiet) write('debug', message, fields);
    },
    listening: (message, fields) => write('info', message, fields),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {}, debug() {}, listening() {} };
