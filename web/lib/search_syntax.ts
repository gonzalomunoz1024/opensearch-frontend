/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The search of the tables that are searched in the browser: the index patterns, the snapshots
 * and repositories of Index Management, the results of Query Workbench. In OpenSearch Dashboards
 * these are its library's tables that search what they hold (`EuiInMemoryTable`, or a search bar
 * and `Query.execute`): the text is read by the grammar of `search_query.ts` and run on the rows
 * as that file runs it, and a text the grammar cannot read keeps every row.
 *
 * None of those tables gives its search bar a schema that changes the reading: the index pattern
 * table names its `title` field without `strict`, the others name nothing.
 */

import { executeQuery, parseQuery, type QueryClause } from './search_query';

/** The clauses of a search, or `undefined` for a text that is not one */
export function readSearch(text: string): QueryClause[] | undefined {
  let clauses: QueryClause[];
  try {
    clauses = parseQuery(text);
  } catch {
    return undefined;
  }
  // The original files the clauses by field in a plain object, and fails on a field named as
  // something every object has (`constructor:x`): for its tables that is a text it cannot read
  const unfiled = clauses.some((clause) => clause.type === 'field' && clause.field in Object.prototype);
  return unfiled ? undefined : clauses;
}

/** The rows a search keeps, in their order; every row when the text is not a search */
export function searchItems<T extends object>(items: T[], text: string): T[] {
  const clauses = readSearch(text);
  if (!clauses || clauses.length === 0) return items;
  return executeQuery(clauses, items);
}
