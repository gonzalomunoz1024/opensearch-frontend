/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The values of the `es` function's arguments that the browser looks up, as upstream's
 * `arg_value_suggestions.ts` does: index patterns for `index`, and the fields of the pattern
 * named by `index` for `metric`, `split` and `timefield`. Other arguments take the values the
 * server lists with the function.
 */

import type { Field } from '../../lib/types';
import type { ArgValueSuggestions, FunctionArg, TimelineArgSuggestion } from './expression_context';

interface FoundPattern {
  id: string;
  attributes: { title: string; type?: string };
}

/** What the lookups need: the saved objects' search and an index pattern's fields */
export interface ArgValueSources {
  findIndexPatterns(options: { search?: string; fields: string[]; perPage: number }): Promise<FoundPattern[]>;
  getFields(id: string): Promise<Field[]>;
}

const isNestedField = (field: Field) => Boolean(field.subType?.nested);

export function getArgValueSuggestions(sources: ArgValueSources): ArgValueSuggestions {
  async function getIndexPatternFields(functionArgs: FunctionArg[]) {
    const indexPatternArg = functionArgs.find(({ name }) => name === 'index');
    if (!indexPatternArg) {
      // index argument not provided
      return undefined;
    }
    const indexPatternTitle = indexPatternArg.value?.text;
    const savedObjects = await sources.findIndexPatterns({
      search: indexPatternTitle,
      fields: ['title'],
      perPage: 100,
    });
    const indexPatternSavedObject = savedObjects.find(({ attributes }) => attributes.title === indexPatternTitle);
    if (!indexPatternSavedObject) {
      // index argument does not match an index pattern
      return undefined;
    }
    return sources.getFields(indexPatternSavedObject.id);
  }

  function containsFieldName(partial: string, field: { name: string }) {
    if (!partial) return true;
    return field.name.includes(partial);
  }

  type Handler = (partial: string, functionArgs: FunctionArg[]) => Promise<TimelineArgSuggestion[]>;

  // Argument value suggestion handlers requiring custom client side code
  // Could not put with function definition since functions are defined on server
  const customHandlers: Record<string, Record<string, Handler>> = {
    es: {
      async index(partial) {
        const found = await sources.findIndexPatterns({
          search: partial || undefined,
          fields: ['title', 'type'],
          perPage: 25,
        });
        return found.filter((object) => !object.attributes.type).map((object) => ({ name: object.attributes.title }));
      },
      async metric(partial, functionArgs) {
        if (!partial || !partial.includes(':')) {
          return [
            { name: 'avg:' },
            { name: 'cardinality:' },
            { name: 'count' },
            { name: 'max:' },
            { name: 'min:' },
            { name: 'percentiles:' },
            { name: 'sum:' },
          ];
        }
        const fields = await getIndexPatternFields(functionArgs);
        if (!fields) return [];
        const valueSplit = partial.split(':');
        return fields
          .filter(
            (field) =>
              field.aggregatable &&
              field.type === 'number' &&
              containsFieldName(valueSplit[1], field) &&
              !isNestedField(field)
          )
          .map((field) => ({ name: `${valueSplit[0]}:${field.name}`, help: field.type }));
      },
      async split(partial, functionArgs) {
        const fields = await getIndexPatternFields(functionArgs);
        if (!fields) return [];
        return fields
          .filter(
            (field) =>
              field.aggregatable &&
              ['number', 'boolean', 'date', 'ip', 'string'].includes(field.type) &&
              containsFieldName(partial, field) &&
              !isNestedField(field)
          )
          .map((field) => ({ name: field.name, help: field.type }));
      },
      async timefield(partial, functionArgs) {
        const fields = await getIndexPatternFields(functionArgs);
        if (!fields) return [];
        return fields
          .filter((field) => field.type === 'date' && containsFieldName(partial, field) && !isNestedField(field))
          .map((field) => ({ name: field.name }));
      },
    },
  };

  const handlerFor = (functionName: string, argName: string): Handler | undefined =>
    Object.prototype.hasOwnProperty.call(customHandlers, functionName) &&
    Object.prototype.hasOwnProperty.call(customHandlers[functionName], argName)
      ? customHandlers[functionName][argName]
      : undefined;

  return {
    hasDynamicSuggestionsForArgument: (functionName, argName) => handlerFor(functionName, argName) !== undefined,

    getDynamicSuggestionsForArgument: async (functionName, argName, functionArgs, partialInput = '') => {
      const handler = handlerFor(functionName, argName);
      return handler ? handler(partialInput, functionArgs) : [];
    },

    getStaticSuggestionsForInput: (partialInput = '', staticSuggestions = []) => {
      if (partialInput) return staticSuggestions.filter((suggestion) => suggestion.name.includes(partialInput));
      return staticSuggestions;
    },
  };
}
