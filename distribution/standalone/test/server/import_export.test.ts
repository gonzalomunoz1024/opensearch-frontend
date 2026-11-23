/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  UploadedFile,
  exportValidationError,
  fileExtension,
  parseMultipart,
  parseNdjson,
  sortObjects,
  stableStringify,
} from '../../server/import_export';

const messageOf = (body: () => unknown): string => {
  try {
    body();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

const object = (type: string, id: string, references: Array<{ type: string; id: string }> = []) => ({
  type,
  id,
  references: references.map((reference, at) => ({ ...reference, name: `ref_${at}` })),
});

describe('export files', () => {
  it('writes the keys of every object in order', () => {
    assert.equal(stableStringify({ b: 1, a: { d: [3, undefined], c: 'x' }, e: undefined }), '{"a":{"c":"x","d":[3,null]},"b":1}');
  });

  it('puts what an object refers to before it', () => {
    const pattern = object('index-pattern', 'p');
    const visualization = object('visualization', 'v', [{ type: 'index-pattern', id: 'p' }]);
    const dashboard = object('dashboard', 'd', [{ type: 'visualization', id: 'v' }]);
    assert.deepEqual(
      sortObjects([dashboard, visualization, pattern]).map((entry) => entry.id),
      ['p', 'v', 'd']
    );
    // By the references alone, not by a usual order of the types: here a visualization refers to
    // a dashboard, and an index pattern to a search
    const dash = object('dashboard', 'd2');
    const vis = object('visualization', 'v2', [{ type: 'dashboard', id: 'd2' }]);
    const search = object('search', 's2');
    const odd = object('index-pattern', 'p2', [{ type: 'search', id: 's2' }]);
    assert.deepEqual(
      sortObjects([vis, odd, dash, search]).map((entry) => entry.id),
      ['d2', 'v2', 's2', 'p2']
    );
    // Among objects of one type, and through several steps
    const a = object('visualization', 'a', [{ type: 'visualization', id: 'b' }]);
    const b = object('visualization', 'b', [{ type: 'visualization', id: 'c' }]);
    const c = object('visualization', 'c');
    assert.deepEqual(
      sortObjects([a, c, b]).map((entry) => entry.id),
      ['c', 'b', 'a']
    );
  });

  it('keeps the order of the file where nothing refers to anything, and passes over what is not in it', () => {
    const first = object('visualization', 'z', [{ type: 'index-pattern', id: 'not in the file' }]);
    const second = object('index-pattern', 'a');
    const third = object('dashboard', 'm', [{ type: 'visualization', id: 'z' }]);
    assert.deepEqual(
      sortObjects([first, second, third]).map((entry) => entry.id),
      ['z', 'a', 'm']
    );
    // An object referred to twice is written once
    const both = object('dashboard', 'n', [
      { type: 'visualization', id: 'z' },
      { type: 'visualization', id: 'z' },
    ]);
    assert.deepEqual(
      sortObjects([both, third, first]).map((entry) => entry.id),
      ['z', 'n', 'm']
    );
  });

  it('refuses objects that refer to each other in a circle', () => {
    const a = object('dashboard', 'a', [{ type: 'dashboard', id: 'b' }]);
    const b = object('dashboard', 'b', [{ type: 'dashboard', id: 'a' }]);
    assert.equal(messageOf(() => sortObjects([a, b])), 'circular reference: [dashboard:a] ref-> [dashboard:b] ref-> [dashboard:a]');
  });

  it('refuses types that cannot be exported, as the route words it', () => {
    assert.equal(exportValidationError({ types: ['dashboard', 'ui-metric', 'foo'] }), 'Trying to export non-exportable type(s): ui-metric, foo');
    assert.equal(
      exportValidationError({ objects: [{ type: 'foo', id: '1' }] }),
      'Trying to export object(s) with non-exportable types: foo:1'
    );
    assert.equal(exportValidationError({ types: ['dashboard'] }), undefined);
  });
});

describe('import files', () => {
  it('reads one object a line and leaves out the line that counts them', () => {
    const text = '{"type":"dashboard","id":"a","attributes":{}}\r\n\n  \n{"exportedCount":1,"missingRefCount":0,"missingReferences":[]}';
    assert.deepEqual(parseNdjson(text), [{ type: 'dashboard', id: 'a', attributes: {} }]);
    assert.deepEqual(parseNdjson('{"exportedCount":0,"missingRefCount":0,"missingReferences":[]}\n'), []);
  });

  it('refuses a line that is not JSON with what JSON.parse says, and a prototype set by the file', () => {
    assert.match(messageOf(() => parseNdjson('abc')), /is not valid JSON/);
    assert.equal(
      messageOf(() => parseNdjson('{"type":"dashboard","attributes":{"__proto__":{"a":1}}}')),
      "Invalid object in import stream: '__proto__' is an invalid key"
    );
  });

  it('takes the files and the fields of a form', () => {
    const boundary = 'XyZ';
    const body = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="export.NDJSON"',
        'Content-Type: application/octet-stream',
        '',
        '{"a":1}',
        `--${boundary}`,
        'Content-Disposition: form-data; name="retries"',
        '',
        '[]',
        `--${boundary}--`,
        '',
      ].join('\r\n')
    );
    const parts = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
    const file = parts.file as UploadedFile;
    assert.ok(file instanceof UploadedFile);
    assert.equal(file.content.toString('utf8'), '{"a":1}');
    assert.equal(fileExtension(file.filename), '.ndjson');
    assert.equal(parts.retries, '[]');
    assert.equal(fileExtension('noext'), '');
  });
});
