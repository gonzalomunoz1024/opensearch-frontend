/* SPDX-License-Identifier: Apache-2.0 */

/* The shapes Timeline's functions pass between them. */

/** A time in milliseconds and its value */
export type Point = [number, number | null];

export interface Series {
  data: Point[];
  type?: string;
  label?: string;
  fit?: string;
  split?: unknown;
  [key: string]: unknown;
}

export interface SeriesList {
  type: 'seriesList';
  list: Series[];
  [key: string]: unknown;
}

/** The arguments a function is called with: in their order, and by name */
export type Args = unknown[] & { byName: Record<string, unknown> };

export interface ArgSuggestion {
  name: string;
  help?: string;
}

export interface ArgDefinition {
  name: string;
  types: string[];
  help?: string;
  multi?: boolean;
  suggestions?: ArgSuggestion[];
}

export interface TimeRange {
  from: number;
  to: number;
  interval: string;
  timezone: string;
}

/** What `deps.data.search.search` is given: the parameters of one search request */
export interface SearchRequest {
  dataSourceId?: string;
  params: {
    index: string;
    ignore_throttled: boolean;
    body: Record<string, unknown>;
    timeout?: string;
  };
}

export interface SearchResponse {
  _shards: { total: number; [key: string]: unknown };
  aggregations?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface IndexPatternFinder {
  find(options: {
    type: string[];
    fields?: string[];
    search?: string;
    searchFields?: string[];
  }): Promise<{ saved_objects: Array<{ attributes: Record<string, unknown> }> }>;
}

export interface TlConfig {
  getTargetSeries(): Point[];
  setTargetSeries(): void;
  writeTargetSeries(series: Point[]): void;
  getFunction(name: string): TimelineFunctionLike;
  settings: Record<string, unknown>;
  time: TimeRange;
  request?: { body?: unknown };
  allowedGraphiteUrls: string[];
  blockedGraphiteIPs: string[];
  opensearchShardTimeout: number;
  /** Sends one search to OpenSearch and gives its answer (the data plugin's search) */
  search(request: SearchRequest): Promise<SearchResponse>;
  savedObjectsClient: IndexPatternFinder;
  [key: string]: unknown;
}

export type TimelineFn = (args: Args, tlConfig: TlConfig) => unknown;

export interface TimelineFunctionLike {
  name: string;
  args: ArgDefinition[];
  argsByName: Record<string, ArgDefinition>;
  help: string;
  aliases: string[];
  extended: false | { types: string[]; multi?: boolean };
  originalFn: TimelineFn;
  fn: (args: Args, tlConfig: TlConfig) => Promise<SeriesList>;
  chainable?: boolean;
  datasource?: boolean;
  timelineFn?: TimelineFn;
  cacheKey?: (item: { text: string }) => string;
  isAlias?: boolean;
}
