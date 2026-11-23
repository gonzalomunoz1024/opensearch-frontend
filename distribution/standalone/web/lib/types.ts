/* SPDX-License-Identifier: Apache-2.0 */

/* Shapes shared across the browser side. They are OpenSearch Dashboards', as saved objects hold them. */

export interface Field {
  name: string;
  /** string, number, date, boolean, ip, geo_point, geo_shape, _source, conflict, unknown */
  type: string;
  esTypes?: string[];
  searchable: boolean;
  aggregatable: boolean;
  readFromDocValues?: boolean;
  scripted?: boolean;
  script?: string;
  lang?: string;
  /** How often the field was picked in Discover: what "popular" sorts by */
  count?: number;
  subType?: { multi?: { parent: string }; nested?: { path: string } };
}

export interface FieldFormatSpec {
  id: string;
  params?: Record<string, unknown>;
}

export interface IndexPattern {
  id: string;
  title: string;
  /** A name shown in place of the pattern */
  displayName?: string;
  timeFieldName?: string;
  fields: Field[];
  fieldFormatMap: Record<string, FieldFormatSpec>;
  sourceFilters?: Array<{ value: string }>;
}

export interface Query {
  query: string | Record<string, unknown>;
  /** kuery (DQL) or lucene */
  language: string;
}

export interface FilterMeta {
  alias?: string | null;
  disabled?: boolean;
  negate?: boolean;
  /** The id of the index pattern the filter was made on */
  index?: string;
  /** In a saved object, the name of the reference that holds that id */
  indexRefName?: string;
  key?: string;
  type?: string;
  value?: unknown;
  params?: unknown;
  controlledBy?: string;
  /** The scripted field a script filter asks about: a script names no field of its own */
  field?: string;
  /** What the bucket a range was made from is called; the pill of a range that is all of a field says it */
  formattedValue?: string;
}

export interface Filter {
  meta: FilterMeta;
  $state?: { store: 'appState' | 'globalState' };
  query?: Record<string, unknown>;
  range?: Record<string, Record<string, unknown>>;
  exists?: { field: string };
  match_all?: Record<string, unknown>;
  script?: Record<string, unknown>;
  [clause: string]: unknown;
}

export interface RefreshInterval {
  pause: boolean;
  /** Milliseconds */
  value: number;
}
