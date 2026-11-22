/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The dates of a sample data set brought to the day it is installed, as OpenSearch Dashboards
 * brings them: by whole days counted in the server's own time zone, so that every date keeps
 * its time of day as the file has it, and for the sets that ask for it to the week of the
 * install, so that each one keeps its day of the week too.
 */

const MILLISECONDS_IN_DAY = 86400000;

function iso8601ToDateIgnoringTime(iso8601: string): Date {
  const split = iso8601.split('-');
  if (split.length < 3) {
    throw new Error('Unexpected timestamp format, expecting YYYY-MM-DDTHH:mm:ss');
  }
  const year = parseInt(split[0], 10);
  const month = parseInt(split[1], 10) - 1;
  const date = parseInt(split[2], 10);
  return new Date(year, month, date);
}

/** `YYYY-MM-DD` of a moment, in the server's time zone */
export function dateToIso8601IgnoringTime(date: Date): string {
  const day = new Date(date);
  const month = day.getMonth() + 1;
  const monthString = month < 10 ? `0${month}` : `${month}`;
  const dateString = day.getDate() < 10 ? `0${day.getDate()}` : `${day.getDate()}`;
  return `${day.getFullYear()}-${monthString}-${dateString}`;
}

/**
 * `source` moved by as many days as lie between `sourceReference` and `targetReference`; what
 * follows the date in `source` (its time and zone) is kept as it is written
 */
export function translateTimeRelativeToDifference(
  source: string,
  sourceReference: string,
  targetReference: string
): string {
  const sourceDate = iso8601ToDateIgnoringTime(source);
  const sourceReferenceDate = iso8601ToDateIgnoringTime(sourceReference);
  const targetReferenceDate = iso8601ToDateIgnoringTime(targetReference);
  const timeDelta = sourceDate.getTime() - sourceReferenceDate.getTime();
  const translatedDate = new Date(targetReferenceDate.getTime() + timeDelta);
  return `${dateToIso8601IgnoringTime(translatedDate)}T${source.substring(11)}`;
}

/**
 * `source` moved by whole weeks to the week of `targetReference`, so that it keeps its day of the
 * week: the target is first taken back or forward to the weekday of `sourceReference`
 */
export function translateTimeRelativeToWeek(
  source: string,
  sourceReference: string,
  targetReference: string
): string {
  const sourceReferenceDate = iso8601ToDateIgnoringTime(sourceReference);
  const targetReferenceDate = iso8601ToDateIgnoringTime(targetReference);
  const dayOfWeekDelta = sourceReferenceDate.getDay() - targetReferenceDate.getDay();
  const normalizedTargetReference = dateToIso8601IgnoringTime(
    new Date(targetReferenceDate.getTime() + dayOfWeekDelta * MILLISECONDS_IN_DAY)
  );
  return translateTimeRelativeToDifference(source, sourceReference, normalizedTargetReference);
}

export type Document = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A field of a document: a key with dots in its name, or else the path through its objects */
export function getNestedField(doc: Document, path: string): unknown {
  if (path in doc) return doc[path];
  let value: unknown = doc;
  for (const key of path.split('.')) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** Sets a field the way `getNestedField` reads it, making the objects on its path */
export function setNestedField(doc: Document, path: string, value: unknown): void {
  if (path in doc) {
    doc[path] = value;
    return;
  }
  const keys = path.split('.');
  let target: Record<string, unknown> = doc;
  keys.slice(0, -1).forEach((key) => {
    const next = target[key];
    if (isRecord(next)) {
      target = next;
    } else {
      const made: Record<string, unknown> = {};
      target[key] = made;
      target = made;
    }
  });
  target[keys[keys.length - 1]] = value;
}

export interface TimeShift {
  timeFields: string[];
  currentTimeMarker: string;
  preserveDayOfWeekTimeOfDay: boolean;
}

/** Brings the dates of a document to `nowReference` (`YYYY-MM-DD`); a field it lacks is left out */
export function moveTimestamps(doc: Document, shift: TimeShift, nowReference: string): Document {
  for (const field of shift.timeFields) {
    const value = getNestedField(doc, field);
    if (!value) continue;
    const moved = shift.preserveDayOfWeekTimeOfDay
      ? translateTimeRelativeToWeek(String(value), shift.currentTimeMarker, nowReference)
      : translateTimeRelativeToDifference(String(value), shift.currentTimeMarker, nowReference);
    setNestedField(doc, field, moved);
  }
  return doc;
}
