/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The advanced settings document of this version, made when it is missing as OpenSearch
 * Dashboards makes it (src/core/server/ui_settings/create_or_upgrade_saved_config): with the build
 * number, and with the settings of the newest `config:<version>` of an older release that can be
 * carried over, so that what was set before an upgrade is still set after it.
 */

import { HttpError } from './http';
import type { Logger } from './logger';
import type { SavedObjectsRepository } from './saved_objects';

// --- The comparisons of `semver` the original makes ---------------------------------------------

// `semver`'s FULL version: an optional "v", three numbers without leading zeros, a prerelease, a build
const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_LENGTH = 256;

interface Version {
  main: [number, number, number];
  prerelease: Array<string | number>;
}

/** `semver.parse`: the version, or `undefined` where semver finds none */
function parseVersion(text: string): Version | undefined {
  if (text.length > MAX_LENGTH) return undefined;
  const match = SEMVER.exec(text.trim());
  if (!match) return undefined;
  const main = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  if (main.some((part) => part > Number.MAX_SAFE_INTEGER)) return undefined;
  const prerelease = match[4]
    ? match[4].split('.').map((id) => {
        if (/^[0-9]+$/.test(id)) {
          const value = Number(id);
          if (value >= 0 && value < Number.MAX_SAFE_INTEGER) return value;
        }
        return id;
      })
    : [];
  return { main, prerelease };
}

// semver's compareIdentifiers: numbers by value and before words, words as the characters sort
function compareIdentifiers(a: string | number, b: string | number): number {
  const aNumber = typeof a === 'number' || /^[0-9]+$/.test(a);
  const bNumber = typeof b === 'number' || /^[0-9]+$/.test(b);
  if (aNumber && bNumber) return Number(a) === Number(b) ? 0 : Number(a) < Number(b) ? -1 : 1;
  if (aNumber) return -1;
  if (bNumber) return 1;
  return a === b ? 0 : String(a) < String(b) ? -1 : 1;
}

/** `semver.compare` of two versions it reads */
function compare(a: Version, b: Version): number {
  for (let at = 0; at < 3; at += 1) {
    if (a.main[at] !== b.main[at]) return a.main[at] < b.main[at] ? -1 : 1;
  }
  if (a.prerelease.length && !b.prerelease.length) return -1;
  if (!a.prerelease.length && b.prerelease.length) return 1;
  for (let at = 0; ; at += 1) {
    const left = a.prerelease[at];
    const right = b.prerelease[at];
    if (left === undefined && right === undefined) return 0;
    if (right === undefined) return 1;
    if (left === undefined) return -1;
    const order = compareIdentifiers(left, right);
    if (order !== 0) return order;
  }
}

// The major versions of OpenSearch Dashboards that can take the settings of a Kibana before the fork
const OSD_VALID_MAJOR_VERSIONS = [1, 2, 3];
const RC_VERSION = /^(\d+\.\d+\.\d+)-rc(\d+)$/i;

function extractRcNumber(version: string): [string, number] {
  const match = RC_VERSION.exec(version);
  return match ? [match[1], parseInt(match[2], 10)] : [version, Infinity];
}

/**
 * Whether the settings of `savedVersion` may be carried over to `currentVersion`: an earlier
 * release, an earlier release candidate of the same one, or a Kibana from 6.8.0 to 7.10.2, the
 * releases before the fork. Alpha, beta and snapshot builds never are.
 */
export function isConfigVersionUpgradeable(savedVersion: unknown, currentVersion: unknown): boolean {
  if (
    typeof savedVersion !== 'string' ||
    typeof currentVersion !== 'string' ||
    savedVersion === currentVersion ||
    /alpha|beta|snapshot/i.test(savedVersion)
  ) {
    return false;
  }
  const [savedRelease, savedRc] = extractRcNumber(savedVersion);
  const [currentRelease, currentRc] = extractRcNumber(currentVersion);
  const saved = parseVersion(savedRelease);
  const current = parseVersion(currentRelease);
  if (!saved || !current) return false;

  const savedIsLess = compare(saved, current) < 0;
  const savedIsSame = compare(saved, current) === 0;
  const savedRcIsLess = savedRc < currentRc;
  const fork = { from: parseVersion('6.8.0') as Version, to: parseVersion('7.10.2') as Version };
  const savedIsFromPrefork = compare(saved, fork.from) >= 0 && compare(saved, fork.to) <= 0;
  const currentIsValid = OSD_VALID_MAJOR_VERSIONS.includes(current.main[0]);
  return savedIsLess || (savedIsSame && savedRcIsLess) || (savedIsFromPrefork && currentIsValid);
}

// --- The document itself ------------------------------------------------------------------------

const isStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof HttpError && statuses.includes(error.status);

/** The newest older settings that may be carried over: the first by build number, as text sorts it */
async function getUpgradeableConfig(repository: SavedObjectsRepository, version: string) {
  const { saved_objects: savedConfigs } = await repository.find({
    type: 'config',
    page: 1,
    perPage: 1000,
    sortField: 'buildNum',
    sortOrder: 'desc',
  });
  return savedConfigs.find((savedConfig) => isConfigVersionUpgradeable(savedConfig.id, version));
}

export interface CreateOrUpgradeOptions {
  repository: SavedObjectsRepository;
  version: string;
  buildNum: number;
  logger: Logger;
  /** On a read: another server made it meanwhile, or it may not be written; on a write, throw */
  handleWriteErrors: boolean;
}

/**
 * Makes `config:<version>` with the build number and the settings of the newest older release
 * that may be carried over. Answers `undefined` once it is there, or, when it may not be written,
 * the settings it would have held, which the read then uses as they are.
 */
export async function createOrUpgradeSavedConfig(
  options: CreateOrUpgradeOptions
): Promise<Record<string, unknown> | undefined> {
  const { repository, version, buildNum, logger, handleWriteErrors } = options;
  const upgradeable = await getUpgradeableConfig(repository, version);

  // lodash's `defaults({ buildNum }, older)`: the build number of this release, then the older
  // settings in their order; a `__proto__` key is not a key there either
  const attributes: Record<string, unknown> = { buildNum };
  for (const [key, value] of Object.entries(upgradeable?.attributes ?? {})) {
    if (key === '__proto__' || Object.hasOwn(attributes, key) || value === undefined) continue;
    attributes[key] = value;
  }

  try {
    await repository.create('config', attributes, { id: version });
  } catch (error) {
    if (handleWriteErrors) {
      if (isStatus(error, 409)) return undefined;
      if (isStatus(error, 401, 403)) return attributes;
    }
    throw error;
  }

  if (upgradeable) {
    logger.debug(`Upgrade config from ${upgradeable.id} to ${version}`, {
      prevVersion: upgradeable.id,
      newVersion: version,
    });
  }
  return undefined;
}
