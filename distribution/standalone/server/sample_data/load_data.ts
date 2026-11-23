/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The documents of a sample data set: a gzipped file of one JSON document per line, read as a
 * stream and handed over in batches of 500, as OpenSearch Dashboards loads them, so that a set
 * never sits in memory whole. An empty line, or one that starts with `#`, is no document.
 */

import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';
import type { Document } from './timestamps';

export const BULK_INSERT_SIZE = 500;

/** The lines of a gzipped file, without their line ends */
export async function* readLines(file: string): AsyncGenerator<string> {
  // pipeline passes a failure of the file on to the stream read here
  const gunzip = pipeline(createReadStream(file), createGunzip(), () => undefined);
  const decoder = new StringDecoder('utf8');
  let rest = '';
  for await (const chunk of gunzip) {
    const parts = (rest + decoder.write(chunk as Buffer)).split('\n');
    rest = parts.pop() ?? '';
    for (const part of parts) yield part.endsWith('\r') ? part.slice(0, -1) : part;
  }
  rest += decoder.end();
  if (rest) yield rest.endsWith('\r') ? rest.slice(0, -1) : rest;
}

/**
 * Hands the documents of a file to `insert`, `batchSize` at a time, each batch once the one
 * before it is in; resolves to the number of documents. A line that is not JSON stops it.
 */
export async function loadData(
  file: string,
  insert: (docs: Document[]) => Promise<void>,
  batchSize = BULK_INSERT_SIZE
): Promise<number> {
  let count = 0;
  let docs: Document[] = [];
  for await (const line of readLines(file)) {
    if (line.length === 0 || line.charAt(0) === '#') continue;
    let doc: Document;
    try {
      doc = JSON.parse(line) as Document;
    } catch (error) {
      throw new Error(
        `Unable to parse line as JSON document, line: """${line}""", Error: ${(error as Error).message}`
      );
    }
    count += 1;
    docs.push(doc);
    if (docs.length >= batchSize) {
      const batch = docs;
      docs = [];
      await insert(batch);
    }
  }
  if (docs.length > 0) await insert(docs);
  return count;
}
