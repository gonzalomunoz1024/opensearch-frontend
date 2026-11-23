/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { annotationInterval, isAnnotationAsked, lastSeriesTime } from '../../web/vis/tsvb/data';
import { annotationIcon } from '../../web/vis/tsvb/icons';
import { annotationTexts, replaceVars } from '../../web/vis/tsvb/replace_vars';

const ASKED = {
  id: 'a',
  index_pattern: 'logs',
  time_field: 'timestamp',
  fields: 'geo.src, host',
  icon: 'fa-asterisk',
  template: 'Error from {{geo.src}} on {{host}}',
};

describe('which TSVB annotations the product asks for, and where their marks may fall', () => {
  it('asks only for a shown annotation with an index, a time field, fields, an icon and a template', () => {
    assert.equal(isAnnotationAsked(ASKED), true);
    assert.equal(isAnnotationAsked({ ...ASKED, hidden: true }), false);
    for (const key of ['index_pattern', 'time_field', 'fields', 'icon', 'template'] as const) {
      assert.equal(isAnnotationAsked({ ...ASKED, [key]: '' }), false, key);
    }
  });

  it('keeps marks up to the last point of all the series, and none without series', () => {
    assert.equal(lastSeriesTime([]), null);
    assert.equal(
      lastSeriesTime([
        { data: [[1000, 1], [2000, 2]] },
        { data: [[1000, 3], [3000, null]] },
        { data: [] },
      ]),
      3000
    );
  });

  it('asks for the buckets in seconds, or in milliseconds for a fraction of one', () => {
    assert.deepEqual(annotationInterval(3600000), { expression: '3600s', seconds: 3600 });
    assert.deepEqual(annotationInterval(500), { expression: '500ms', seconds: 1 });
  });

  it('marks an annotation with the product shapes, the asterisk for a name it does not know', () => {
    assert.equal(annotationIcon('fa-unknown'), annotationIcon('fa-asterisk'));
    assert.equal(annotationIcon('fa-exclamation-circle'), annotationIcon('fa-exclamation-triangle'));
    assert.equal(annotationIcon('fa-star').evenOdd, true);
  });
});

describe('the names of TSVB annotations and the text of templates, as the product fills them in', () => {
  it('fills a template in with a document and its args', () => {
    assert.deepEqual(replaceVars('{{host}} at {{args.when}}', { when: 'noon' }, { host: 'a' }), { text: 'a at noon' });
  });

  it('keeps a template being typed as written, and tells an unknown name apart from other faults', () => {
    assert.deepEqual(replaceVars('{{host', null, {}), { text: '{{host' });
    assert.deepEqual(replaceVars('{{host}}', null, {}), {
      fault: { title: 'Error processing your markdown', reason: '{{host}} is an unknown variable' },
    });
    assert.deepEqual(replaceVars('{{#each}}{{/each}}', null, {}), {
      fault: {
        title: 'Error processing your markdown',
        reason: 'Please verify you are only using markdown, known variables, and built-in Handlebars expressions',
      },
    });
  });

  it('names a mark after its latest document, and tells of the last document that could not be named', () => {
    // As Handlebars tells of a path, by its last part: the second document has no geo.src
    const marks = [
      { docs: [{ geo: { src: 'US' }, host: 'a' }, { host: 'b' }] },
      { docs: [{ geo: { src: 'CN' }, host: 'c' }] },
    ];
    assert.deepEqual(annotationTexts(ASKED.template, marks), {
      texts: ['Error from US on a', 'Error from CN on c'],
      fault: { title: 'Error processing your markdown', reason: '{{src}} is an unknown variable' },
    });
    assert.deepEqual(annotationTexts('{{host}}', [{ docs: [{}] }]), {
      texts: ['{{host}}'],
      fault: { title: 'Error processing your markdown', reason: '{{host}} is an unknown variable' },
    });
    assert.deepEqual(annotationTexts('{{host}}', [{ docs: [{ host: 'a' }] }]), { texts: ['a'] });
  });
});
