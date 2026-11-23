/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The fields of the indices an index pattern matches, in the shape OpenSearch Dashboards keeps
 * them: each with the kind of field the product treats it as, and whether it can be searched and
 * aggregated on.
 */

import { notFound } from './http';
import { OpenSearchError, type OpenSearchClient } from './opensearch';

export interface FieldDescriptor {
  name: string;
  /** The product's kind: string, number, date, boolean, ip, geo_point, ..., or conflict */
  type: string;
  esTypes?: string[];
  searchable: boolean;
  aggregatable: boolean;
  readFromDocValues: boolean;
  subType?: { multi?: { parent: string }; nested?: { path: string } };
  /** Of a field of several kinds: the indices that hold it as each type */
  conflictDescriptions?: Record<string, string[] | undefined>;
}

const KINDS: Record<string, string[]> = {
  string: ['string', 'text', 'match_only_text', 'keyword', 'wildcard', 'constant_keyword', '_type', '_id', '_index'],
  number: [
    'float',
    'half_float',
    'scaled_float',
    'double',
    'integer',
    'long',
    'unsigned_long',
    'short',
    'byte',
    'token_count',
  ],
  date: ['date', 'date_nanos'],
  ip: ['ip'],
  boolean: ['boolean'],
  object: ['object', 'flat_object'],
  nested: ['nested'],
  geo_point: ['geo_point'],
  geo_shape: ['geo_shape'],
  attachment: ['attachment'],
  murmur3: ['murmur3'],
  histogram: ['histogram'],
  _source: ['_source'],
};

const KIND_OF = new Map<string, string>();
for (const [kind, types] of Object.entries(KINDS)) types.forEach((type) => KIND_OF.set(type, kind));

export const kindOf = (esType: string) => KIND_OF.get(esType) ?? 'unknown';

// Fields the mapping API does not describe the way the product needs them
const META_OVERRIDES: Record<string, Partial<FieldDescriptor>> = {
  _source: { type: '_source', esTypes: ['_source'], searchable: false, aggregatable: false },
  _id: { type: 'string', esTypes: ['_id'], searchable: true, aggregatable: true },
  // OpenSearch has no _type any more: the original describes it as it describes any field it lacks
  _type: { type: 'string' },
  _index: { type: 'string', esTypes: ['_index'], searchable: true, aggregatable: true },
  _score: { type: 'number', searchable: false, aggregatable: false },
};

type FieldCaps = Record<
  string,
  Record<
    string,
    {
      type: string;
      searchable: boolean;
      aggregatable: boolean;
      indices?: string[];
      non_searchable_indices?: string[] | null;
      non_aggregatable_indices?: string[] | null;
    }
  >
>;

export function readFieldCaps(fields: FieldCaps, metaFields: string[]): FieldDescriptor[] {
  const containers = new Map<string, string>();
  const described: FieldDescriptor[] = [];

  for (const [name, byType] of Object.entries(fields)) {
    const esTypes = Object.keys(byType);
    const kinds = [...new Set(esTypes.map(kindOf))];
    if (kinds.length === 1 && (kinds[0] === 'object' || kinds[0] === 'nested')) {
      containers.set(name, kinds[0]);
      continue;
    }
    if (name.startsWith('_') && !metaFields.includes(name)) continue;

    const caps = Object.values(byType);
    // What some of its indices can do a field can do, as the original reads the capabilities
    const searchable = caps.some((cap) => cap.searchable || (cap.non_searchable_indices?.length ?? 0) > 0);
    const aggregatable = caps.some((cap) => cap.aggregatable || (cap.non_aggregatable_indices?.length ?? 0) > 0);
    if (kinds.length > 1) {
      described.push({
        name,
        type: 'conflict',
        esTypes,
        searchable,
        aggregatable,
        readFromDocValues: false,
        conflictDescriptions: Object.fromEntries(esTypes.map((type) => [type, byType[type].indices])),
      });
      continue;
    }
    described.push({
      name,
      type: kinds[0],
      esTypes,
      searchable,
      aggregatable,
      readFromDocValues:
        aggregatable && !name.startsWith('_') && !esTypes.some((type) => ['text', 'geo_shape'].includes(type)),
    });
  }

  const byName = new Map(described.map((field) => [field.name, field]));
  for (const field of described) {
    const parts = field.name.split('.');
    if (parts.length < 2) continue;
    // The nearest nested container, if any, is where the field has to be queried
    for (let length = parts.length - 1; length > 0; length -= 1) {
      const path = parts.slice(0, length).join('.');
      if (containers.get(path) === 'nested') {
        field.subType = { ...field.subType, nested: { path } };
        break;
      }
    }
    // `title.keyword` under the field `title` is another way to index the same value
    const parent = parts.slice(0, -1).join('.');
    if (byName.has(parent) && !containers.has(parent)) {
      field.subType = { multi: { parent }, ...field.subType };
    }
  }

  for (const name of metaFields) {
    const override = META_OVERRIDES[name];
    const existing = byName.get(name);
    if (existing) {
      if (override) Object.assign(existing, override);
    } else {
      // A meta field OpenSearch does not describe is a text nothing can be done with
      described.push({
        name,
        type: 'string',
        searchable: false,
        aggregatable: false,
        readFromDocValues: false,
        ...override,
      });
    }
  }

  return described.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function fieldsForWildcard(
  client: OpenSearchClient,
  pattern: string,
  metaFields: string[]
): Promise<FieldDescriptor[]> {
  try {
    const result = await client.request<{ fields: FieldCaps }>({
      method: 'GET',
      path: `/${pattern.split(',').map(encodeURIComponent).join(',')}/_field_caps`,
      query: { fields: '*', ignore_unavailable: true, allow_no_indices: false },
    });
    return readFieldCaps(result.fields ?? {}, metaFields);
  } catch (error) {
    if (error instanceof OpenSearchError && error.status === 404) {
      throw notFound(`No indices match pattern "${pattern}"`);
    }
    throw error;
  }
}
