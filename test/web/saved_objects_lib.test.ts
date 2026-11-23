/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OBJECT_SERVICES,
  askedOnce,
  createFieldList,
  importItems,
  inspectDelete,
  inspectedObject,
  processImportResponse,
  resolveImportErrors,
  savedAttributes,
  tokenizeFieldJson,
  type FailedConflict,
  type ImportResponse,
  type RetryDecision,
  type RetryObject,
} from '../../web/apps/management/saved_objects_lib';
// The table's pages are the kit's
import { pageButtons } from '../../web/components/table';

const meta = (title: string) => ({ title, icon: 'visualizeApp' });

describe('the answer of an import', () => {
  it('lists the missing index patterns once, with each object that needs one', () => {
    const response: ImportResponse = {
      success: false,
      successCount: 1,
      successResults: [{ type: 'dashboard', id: 'd1', meta: meta('Dash') }],
      errors: [
        {
          type: 'visualization',
          id: 'v1',
          meta: meta('One'),
          error: {
            type: 'missing_references',
            references: [
              { type: 'index-pattern', id: 'gone' },
              { type: 'search', id: 's1' },
            ],
          },
        },
        {
          type: 'visualization',
          id: 'v2',
          meta: meta('Two'),
          error: { type: 'missing_references', references: [{ type: 'index-pattern', id: 'gone' }] },
        },
        { type: 'index-pattern', id: 'ip', meta: meta('Pattern'), error: { type: 'conflict' } },
      ],
    };
    const processed = processImportResponse(response);
    assert.equal(processed.status, 'idle');
    assert.equal(processed.importCount, 1);
    assert.equal(processed.failedImports.length, 3);
    assert.deepEqual(processed.failedImports[2], { obj: { type: 'index-pattern', id: 'ip', meta: meta('Pattern') }, error: { type: 'conflict' } });
    assert.deepEqual(
      processed.unmatchedReferences.map(({ existingIndexPatternId, list }) => [existingIndexPatternId, list.map(({ id }) => id)]),
      [['gone', ['v1', 'v2']]]
    );
    assert.deepEqual(processed.successfulImports, response.successResults);
  });

  it('is done when nothing can be resolved', () => {
    const processed = processImportResponse({
      success: false,
      successCount: 0,
      errors: [{ type: 'thing', id: 't', meta: {}, error: { type: 'unsupported_type' } }],
    });
    assert.equal(processed.status, 'success');
    assert.deepEqual(processed.unmatchedReferences, []);
    assert.deepEqual(processed.successfulImports, []);
  });
});

describe('the resolution of the errors of an import', () => {
  const calls: Array<{ retries: RetryObject[]; createNewCopies: boolean }> = [];
  const answering =
    (...responses: ImportResponse[]) =>
    async (retries: RetryObject[], createNewCopies: boolean) => {
      calls.push({ retries, createNewCopies });
      const response = responses.shift();
      assert.ok(response, 'no more answers');
      return response as ImportResponse;
    };

  it('overwrites the plain conflicts, asks about the others, and retries what went through', async () => {
    calls.length = 0;
    const asked: FailedConflict[][] = [];
    const result = await resolveImportErrors({
      state: {
        importCount: 1,
        importMode: { createNewCopies: false, overwrite: true },
        successfulImports: [{ type: 'search', id: 's1', meta: meta('Search') }],
        failedImports: [
          { obj: { type: 'dashboard', id: 'd1', meta: meta('Dash') }, error: { type: 'conflict', destinationId: 'd9' } },
          {
            obj: { type: 'visualization', id: 'v1', meta: meta('Vis') },
            error: { type: 'ambiguous_conflict', destinations: [{ id: 'a' }, { id: 'b' }] },
          },
        ],
      },
      getConflictResolutions: async (conflicts) => {
        asked.push(conflicts);
        const answers: Record<string, RetryDecision> = {};
        for (const { obj } of conflicts) answers[`${obj.type}:${obj.id}`] = { retry: true, options: { overwrite: true, destinationId: 'b' } };
        return answers;
      },
      callResolveImportErrors: answering({
        success: true,
        successCount: 3,
        successResults: [
          { type: 'dashboard', id: 'd1', meta: meta('Dash'), overwrite: true },
          { type: 'visualization', id: 'v1', meta: meta('Vis'), overwrite: true },
          { type: 'search', id: 's1', meta: meta('Search') },
        ],
      }),
    });
    assert.deepEqual(
      asked.map((conflicts) => conflicts.map(({ obj }) => obj.id)),
      [['v1']]
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].createNewCopies, false);
    assert.deepEqual(calls[0].retries, [
      { id: 'd1', type: 'dashboard', overwrite: true, destinationId: 'd9', replaceReferences: undefined },
      { id: 'v1', type: 'visualization', overwrite: true, destinationId: 'b', replaceReferences: undefined },
      { type: 'search', id: 's1', destinationId: undefined, createNewCopy: undefined },
    ]);
    assert.equal(result.status, 'success');
    assert.equal(result.importCount, 3);
    assert.equal(result.failedImports.length, 0);
    assert.equal(result.successfulImports.length, 3);
  });

  it('asks about every conflict when they are not overwritten, and stops when all are skipped', async () => {
    calls.length = 0;
    const asked: string[] = [];
    const result = await resolveImportErrors({
      state: {
        importCount: 0,
        importMode: { createNewCopies: false, overwrite: false },
        failedImports: [
          { obj: { type: 'dashboard', id: 'd1', meta: meta('Dash') }, error: { type: 'conflict' } },
          { obj: { type: 'search', id: 's1', meta: meta('Search') }, error: { type: 'conflict' } },
        ],
      },
      getConflictResolutions: async (conflicts) => {
        asked.push(...conflicts.map(({ obj }) => obj.id));
        return {};
      },
      callResolveImportErrors: answering(),
    });
    assert.deepEqual(asked, ['d1', 's1']);
    assert.equal(calls.length, 0);
    // A conflict skipped is not a failure
    assert.deepEqual(result.failedImports, []);
  });

  it('retries an object of a type that cannot be imported with the others, as the original does', async () => {
    calls.length = 0;
    const unsupported = { obj: { type: 'thing', id: 't', meta: {} }, error: { type: 'unsupported_type' as const } };
    const result = await resolveImportErrors({
      state: {
        importCount: 0,
        importMode: { createNewCopies: false, overwrite: false },
        failedImports: [{ obj: { type: 'dashboard', id: 'd1', meta: meta('Dash') }, error: { type: 'conflict' } }, unsupported],
      },
      getConflictResolutions: async () => ({}),
      callResolveImportErrors: answering({ success: false, successCount: 0, errors: [{ ...unsupported.obj, error: unsupported.error }] }),
    });
    assert.deepEqual(calls[0].retries, [{ id: 't', type: 'thing', replaceReferences: undefined }]);
    assert.deepEqual(
      result.failedImports.map(({ obj, error }) => `${obj.id}:${error.type}`),
      ['t:unsupported_type']
    );
  });

  it('replaces a missing index pattern by the one chosen, and resolves the conflict of that object after', async () => {
    calls.length = 0;
    const asked: string[] = [];
    const missing = {
      obj: { type: 'visualization', id: 'v1', meta: meta('Vis') },
      error: { type: 'missing_references' as const, references: [{ type: 'index-pattern', id: 'gone' }] },
    };
    const result = await resolveImportErrors({
      state: {
        importCount: 0,
        importMode: { createNewCopies: true, overwrite: false },
        unmatchedReferences: [{ existingIndexPatternId: 'gone', list: [missing.obj], newIndexPatternId: 'here' }],
        failedImports: [missing, { obj: missing.obj, error: { type: 'conflict' } }],
      },
      getConflictResolutions: async (conflicts) => {
        asked.push(...conflicts.map(({ obj }) => obj.id));
        return Object.fromEntries(conflicts.map(({ obj }) => [`${obj.type}:${obj.id}`, { retry: true, options: { overwrite: true } }]));
      },
      callResolveImportErrors: answering(
        { success: false, successCount: 0, errors: [{ ...missing.obj, error: { type: 'conflict' } }] },
        { success: true, successCount: 1, successResults: [{ ...missing.obj, overwrite: true }] }
      ),
    });
    // The conflict waits for the reference: nobody is asked the first time round
    assert.deepEqual(asked, ['v1']);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].retries, [
      { id: 'v1', type: 'visualization', replaceReferences: [{ type: 'index-pattern', from: 'gone', to: 'here' }] },
    ]);
    assert.equal(calls[0].createNewCopies, true);
    assert.deepEqual(calls[1].retries, [
      { id: 'v1', type: 'visualization', overwrite: true, replaceReferences: [{ type: 'index-pattern', from: 'gone', to: 'here' }] },
    ]);
    assert.equal(result.importCount, 1);
    assert.equal(result.failedImports.length, 0);
  });

  it('skips an object whose missing index pattern is not replaced', async () => {
    calls.length = 0;
    const missing = {
      obj: { type: 'visualization', id: 'v1', meta: meta('Vis') },
      error: { type: 'missing_references' as const, references: [{ type: 'index-pattern', id: 'gone' }] },
    };
    const result = await resolveImportErrors({
      state: {
        importCount: 0,
        importMode: { createNewCopies: false, overwrite: true },
        unmatchedReferences: [{ existingIndexPatternId: 'gone', list: [missing.obj] }],
        failedImports: [missing],
      },
      getConflictResolutions: async () => ({}),
      callResolveImportErrors: answering(),
    });
    assert.equal(calls.length, 0);
    assert.deepEqual(result.failedImports, []);
  });
});

describe('the summary of an import', () => {
  it('lists the objects by type and title, with what happened to each', () => {
    const items = importItems(
      [
        { obj: { type: 'visualization', id: 'v2', meta: { title: 'Beta' } }, error: { type: 'unknown', message: 'Broken' } },
        { obj: { type: 'thing', id: 't', meta: {} }, error: { type: 'unsupported_type' } },
      ],
      [
        { type: 'visualization', id: 'v1', meta: { title: 'Alpha', icon: 'visualizeApp' }, overwrite: true },
        { type: 'dashboard', id: 'd1', meta: { title: 'Zeta' } },
      ]
    );
    assert.deepEqual(
      items.map(({ type, title, outcome, errorMessage, icon }) => [type, title, outcome, errorMessage, icon]),
      [
        ['dashboard', 'Zeta', 'created', undefined, 'apps'],
        ['thing', 'thing [id=t]', 'error', 'Unsupported object type', 'apps'],
        ['visualization', 'Alpha', 'overwritten', undefined, 'visualizeApp'],
        ['visualization', 'Beta', 'error', 'Broken', 'apps'],
      ]
    );
  });
});

describe('the fields of an object on its page', () => {
  it('lists the attributes by their path, then the references, then the fields of its class it lacks', () => {
    const fields = createFieldList(
      {
        attributes: {
          title: 'Chart',
          visState: '{"type":"markdown"}',
          uiStateJSON: 'not json',
          version: 1,
          kibanaSavedObjectMeta: { searchSourceJSON: '{}' },
          flags: [1, 2],
          shown: true,
        },
        references: [{ id: 'ip', name: 'ref', type: 'index-pattern' }],
      },
      OBJECT_SERVICES.savedVisualizations
    );
    assert.deepEqual(
      fields.map(({ name, type }) => `${name}:${type}`),
      [
        'title:text',
        'visState:json',
        'uiStateJSON:text',
        'version:number',
        'kibanaSavedObjectMeta.searchSourceJSON:json',
        'flags:array',
        'shown:boolean',
        'references:array',
        'description:text',
        'savedSearchId:text',
      ]
    );
    assert.equal(fields[1].value, '{\n  "type": "markdown"\n}');
    assert.equal(fields[7].value, JSON.stringify([{ id: 'ip', name: 'ref', type: 'index-pattern' }], undefined, 2));
    assert.equal(fields[8].value, undefined);
  });

  it('gives a home page its sections and heroes, and a dashboard its search source', () => {
    const home = createFieldList({ attributes: {}, references: [] }, OBJECT_SERVICES.savedHomepage);
    assert.deepEqual(
      home.map(({ name, type }) => `${name}:${type}`),
      ['references:array', 'heroes:json', 'sections:json']
    );
    const dashboard = createFieldList({ attributes: { title: 'D' }, references: [] }, OBJECT_SERVICES.savedDashboards);
    assert.deepEqual(dashboard[dashboard.length - 1], { name: 'kibanaSavedObjectMeta.searchSourceJSON', type: 'json', value: '{}' });
  });

  it('saves every field back at its path, the arrays read, and the references apart', () => {
    const attributes = { title: 'Old', kibanaSavedObjectMeta: { searchSourceJSON: '{}' }, flags: [1] };
    const references = [{ id: 'ip', name: 'ref', type: 'index-pattern' }];
    const fields = createFieldList({ attributes, references }, OBJECT_SERVICES.savedSearches);
    const saved = savedAttributes({ ...attributes, references }, fields, {
      title: 'New',
      'kibanaSavedObjectMeta.searchSourceJSON': '{"query":1}',
      flags: '[2, 3]',
      references: '[]',
    });
    assert.equal(saved.attributes.title, 'New');
    assert.deepEqual(saved.attributes.kibanaSavedObjectMeta, { searchSourceJSON: '{"query":1}' });
    assert.deepEqual(saved.attributes.flags, [2, 3]);
    assert.deepEqual(saved.references, []);
    assert.ok(!('references' in saved.attributes));
    // The fields of the class the object did not have are written as they were: empty
    assert.ok('description' in saved.attributes);
    assert.equal(saved.attributes.description, undefined);
    assert.equal(attributes.title, 'Old');
  });
});

describe('the pages of a table', () => {
  it('shows five around the current one, the first and the last, and a skip between', () => {
    assert.deepEqual(pageButtons(1, 0), [0]);
    assert.deepEqual(pageButtons(3, 1), [0, 1, 2]);
    assert.deepEqual(pageButtons(10, 0), [0, 1, 2, 3, 4, 'skip', 9]);
    assert.deepEqual(pageButtons(10, 5), [0, 'skip', 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(pageButtons(12, 5), [0, 'skip', 3, 4, 5, 6, 7, 'skip', 11]);
    assert.deepEqual(pageButtons(10, 9), [0, 'skip', 5, 6, 7, 8, 9]);
    assert.deepEqual(pageButtons(7, 3), [0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('the colours of a JSON field', () => {
  const kinds = (text: string) => tokenizeFieldJson(text).map((line) => line.map((run) => [run.kind ?? '', run.text]));

  it('colours keys, strings, numbers and booleans as the original editor does, and leaves null plain', () => {
    assert.deepEqual(kinds('{"a": "b", "n": -1.5e3, "t": true, "z": null}'), [
      [
        ['', '{'],
        ['Key', '"a"'],
        ['', ': '],
        ['String', '"b"'],
        ['', ', '],
        ['Key', '"n"'],
        ['', ': '],
        ['Number', '-1.5e3'],
        ['', ', '],
        ['Key', '"t"'],
        ['', ': '],
        ['Boolean', 'true'],
        ['', ', '],
        ['Key', '"z"'],
        ['', ': null}'],
      ],
    ]);
  });

  it('colours the escapes of a string apart, and ends a string with its line', () => {
    assert.deepEqual(kinds('["a\\"b\\u00e9", "open\n"x"]'), [
      [
        ['', '['],
        ['String', '"a'],
        ['Escape', '\\"'],
        ['String', 'b'],
        ['Escape', '\\u00e9'],
        ['String', '"'],
        ['', ', '],
        ['String', '"open'],
      ],
      [
        ['String', '"x"'],
        ['', ']'],
      ],
    ]);
  });

  it('draws a guide for each two spaces of an indent but the last', () => {
    assert.deepEqual(kinds('  "a": 1'), [[['', '  '], ['Key', '"a"'], ['', ': '], ['Number', '1']]]);
    assert.deepEqual(kinds('    "a": 1'), [[['Guide', '  '], ['', '  '], ['Key', '"a"'], ['', ': '], ['Number', '1']]]);
    assert.deepEqual(kinds('     }'), [[['Guide', '  '], ['Guide', '  '], ['', ' }']]]);
    assert.deepEqual(kinds('      '), [[['Guide', '  '], ['Guide', '  '], ['', '  ']]]);
    assert.deepEqual(kinds('"a": "  b"'), [[['Key', '"a"'], ['', ': '], ['String', '"  b"']]]);
  });

  it('colours comments, a block of them over several lines', () => {
    assert.deepEqual(kinds('1 // one\n/* two\nthree */ 2'), [
      [
        ['Number', '1'],
        ['', ' '],
        ['Comment', '// one'],
      ],
      [['Comment', '/* two']],
      [
        ['Comment', 'three */'],
        ['', ' '],
        ['Number', '2'],
      ],
    ]);
  });

  it('keeps an empty line', () => {
    assert.deepEqual(kinds('{\n\n}'), [[['', '{']], [['', '']], [['', '}']]]);
  });
});

describe('an object of the inspect page that is not there', () => {
  it('is shown as the original shows it: the fields of its class, all empty, after its references', () => {
    // The bulk get's answer for an id that is not there
    const answered = { id: 'gone', type: 'visualization', error: { statusCode: 404, message: 'Saved object [visualization/gone] not found' } };
    const object = inspectedObject('visualization', 'gone', answered);
    assert.deepEqual(object.attributes, {});
    assert.deepEqual(object.references, []);
    assert.equal(object.id, 'gone');
    // Measured in the original's page of `savedVisualizations/undefined`
    assert.deepEqual(
      createFieldList(object, OBJECT_SERVICES.savedVisualizations).map((field) => field.name),
      ['references', 'title', 'visState', 'uiStateJSON', 'description', 'savedSearchId', 'version']
    );
    // An answer without the object at all is shown the same
    assert.deepEqual(inspectedObject('visualization', 'gone', undefined), { id: 'gone', type: 'visualization', attributes: {}, references: [] });
  });

  it('leaves an object that is there as it was answered', () => {
    const answered = { id: 'v', type: 'visualization', attributes: { title: 'T' }, references: [{ name: 'a', type: 'search', id: 's' }], version: 'WzEsMV0=' };
    assert.deepEqual(inspectedObject('visualization', 'v', answered), answered);
  });
});

describe("the inspect page's delete", () => {
  it("says it is not forced, as the original's client does, and writes the id so that it stays one", () => {
    assert.deepEqual(inspectDelete('visualization', 'a/b c'), { path: '/api/saved_objects/visualization/a%2Fb%20c', query: { force: false } });
  });
});

describe('what the section keeps for as long as the page lives', () => {
  it('asks once, however often it is needed, and again only after an answer that failed', async () => {
    let asked = 0;
    let fail = true;
    const types = askedOnce(async () => {
      asked += 1;
      if (fail) throw new Error('no answer');
      return ['dashboard'];
    });
    let failed = 0;
    await types().catch(() => (failed += 1));
    assert.deepEqual([asked, failed], [1, 1]);
    fail = false;
    assert.deepEqual(await types(), ['dashboard']);
    assert.deepEqual(await Promise.all([types(), types()]), [['dashboard'], ['dashboard']]);
    assert.equal(asked, 2);
  });
});
