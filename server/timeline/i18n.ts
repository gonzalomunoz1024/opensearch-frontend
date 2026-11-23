/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The messages of Timeline in English, as OpenSearch Dashboards formats them: `{name}` takes the
 * value's text, and a value that is missing gives nothing. The identifiers stay, as upstream
 * wrote them, so that the texts can be compared with its own.
 */

interface TranslateArguments {
  defaultMessage: string;
  values?: Record<string, unknown>;
  description?: string;
}

function translate(_id: string, { defaultMessage, values = {} }: TranslateArguments): string {
  return defaultMessage.replace(/\{\s*([A-Za-z0-9_]+)\s*\}/g, (_match, name: string) => {
    const value = values[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

export const i18n = { translate };
