/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Templates filled in as TSVB fills them: the text of a Markdown panel and the names of a time
 * series' annotations, in Handlebars' strict mode, with what stops one told as the product tells
 * it.
 */

import { renderTemplate } from '../../lib/template';

/** What stopped a template being filled in, in the words of the product's message */
export interface TemplateFault {
  title: string;
  reason: string;
}

const MARKDOWN_ERROR = 'Error processing your markdown';

/**
 * A template filled in with variables, and `args` beside them, as the product fills it: while it
 * is not well formed (being typed) it is kept as written; a name it has no variable for, or
 * anything else that stops it, is a fault, told apart by the words of the failure as the product
 * tells them apart
 */
export function replaceVars(template: string, args: unknown, vars: Record<string, unknown>): { text: string } | { fault: TemplateFault } {
  try {
    return { text: renderTemplate(template, { ...vars, args }, { strict: true }) };
  } catch (failure) {
    if (String(failure).includes('Parse error')) return { text: template };
    const message = failure instanceof Error ? failure.message : String(failure);
    const reason = message.includes('not defined in')
      ? `{{${String(message.split('"')[1])}}} is an unknown variable`
      : 'Please verify you are only using markdown, known variables, and built-in Handlebars expressions';
    return { fault: { title: MARKDOWN_ERROR, reason } };
  }
}

/**
 * The names of an annotation's marks: its template filled in with the latest document of each
 * (the template as written where it cannot be), and the fault of the last document of all that
 * could not fill it in, as the product fills in every document it is given to tell of it
 */
export function annotationTexts(template: string, marks: Array<{ docs: unknown[] }>): { texts: string[]; fault?: TemplateFault } {
  let fault: TemplateFault | undefined;
  const texts = marks.map((mark) => {
    const filled = mark.docs.map((doc) => {
      const result = replaceVars(template, null, doc !== null && typeof doc === 'object' ? (doc as Record<string, unknown>) : {});
      if ('fault' in result) {
        fault = result.fault;
        return template;
      }
      return result.text;
    });
    return filled[0] ?? template;
  });
  return fault ? { texts, fault } : { texts };
}
