/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the document migrator of OpenSearch Dashboards 3.9.0 does to an object it writes (a create,
 * a bulk create, an import): an object without `migrationVersion` is marked as written by this
 * release; one with it is migrated from that version up, and one that names a version newer than
 * the release's is refused. Of the transforms themselves only the move of ids into `references`
 * (the 7.0.0 step of dashboards, visualizations and searches) runs here.
 */

import { extractReferences, MIGRATION_VERSIONS, type SavedObject } from '../common/saved_objects';
import { HttpError } from './http';

/** The last migration of each type that has migrations in OpenSearch Dashboards 3.9.0 */
export const LATEST_MIGRATION_VERSIONS: Readonly<Record<string, string>> = {
  ...MIGRATION_VERSIONS,
  config: '7.9.0',
};

/** The types whose 7.0.0 migration moves the ids an object names into its references */
const REFERENCE_MIGRATION_TYPES = new Set(['dashboard', 'visualization', 'search']);

export interface MigrationDocument {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  references: SavedObject['references'];
  migrationVersion?: Record<string, string>;
  [key: string]: unknown;
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses a version as `semver` does, and throws as it does on one it cannot read */
function parseVersion(version: string) {
  const match = SEMVER.exec(String(version).trim());
  if (!match) throw new TypeError(`Invalid Version: ${version}`);
  return { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] };
}

/** `semver.gt`, for the versions a migration names */
export function versionGreaterThan(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let at = 0; at < 3; at += 1) {
    if (left.numbers[at] !== right.numbers[at]) return left.numbers[at] > right.numbers[at];
  }
  if (left.prerelease === right.prerelease) return false;
  if (left.prerelease === undefined) return true;
  if (right.prerelease === undefined) return false;
  return left.prerelease > right.prerelease;
}

const ownVersion = (migrationVersion: unknown, prop: string): string | undefined => {
  if (!migrationVersion || typeof migrationVersion !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(migrationVersion, prop)
    ? (migrationVersion as Record<string, string>)[prop]
    : undefined;
};

/** The object as the original's migrator hands it to be written */
export function migrateDocument<T extends MigrationDocument>(document: T): T {
  const latest = Object.prototype.hasOwnProperty.call(LATEST_MIGRATION_VERSIONS, document.type)
    ? LATEST_MIGRATION_VERSIONS[document.type]
    : undefined;
  const { migrationVersion: _omitted, ...rest } = document;
  if (!document.migrationVersion) {
    // Written by this release: marked as migrated
    return { ...rest, ...(latest ? { migrationVersion: { [document.type]: latest } } : {}) } as T;
  }

  const props = [...Object.keys(document), document.type];
  for (const prop of props) {
    const latestVersion = prop === document.type ? latest : undefined;
    const docVersion = ownVersion(document.migrationVersion, prop);
    if (latestVersion === docVersion) continue;
    if (docVersion && (!latestVersion || versionGreaterThan(docVersion, latestVersion))) {
      throw new HttpError(
        422,
        `Document "${document.id}" has property "${prop}" which belongs to a more recent` +
          ` version of OpenSearch Dashboards [${docVersion}]. The last known version is [${latestVersion}]`
      );
    }
  }

  let migrated: T = document;
  const typeVersion = ownVersion(document.migrationVersion, document.type);
  if (latest && typeVersion !== latest) {
    if (REFERENCE_MIGRATION_TYPES.has(document.type) && (!typeVersion || versionGreaterThan('7.0.0', typeVersion))) {
      migrated = extractReferences(document);
    }
    migrated = { ...migrated, migrationVersion: { ...document.migrationVersion, [document.type]: latest } };
  }
  if (Object.keys(migrated.migrationVersion ?? {}).length === 0) {
    const { migrationVersion: _empty, ...withoutVersion } = migrated;
    return withoutVersion as T;
  }
  return migrated;
}
