/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the Grok debugger sends and how it reads the answer, as OpenSearch Dashboards does: a
 * simulated ingest pipeline with one grok processor, run on one document holding the sample.
 */

export interface GrokProcessor {
  field: 'message';
  patterns: string[];
  pattern_definitions?: Record<string, string>;
  capture_all_matches?: true;
}

export interface GrokSimulation {
  pipeline: { processors: Array<{ grok: GrokProcessor }> };
  docs: Array<{ _source: { message: string } }>;
}

/** The body of `POST _ingest/pipeline/_simulate`, or what is wrong with the custom patterns */
export function grokSimulation(
  pattern: string,
  sampleLog: string,
  customPatterns: string,
  captureAllMatches: boolean
): { body: GrokSimulation } | { customPatternError: string } {
  const definitions: Record<string, string> = {};
  const malformed: number[] = [];
  customPatterns.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const space = trimmed.search(/\s/);
    if (space <= 0) malformed.push(index + 1);
    else definitions[trimmed.slice(0, space)] = trimmed.slice(space).trimStart();
  });
  if (malformed.length > 0) {
    return {
      customPatternError: `Malformed pattern definition on line${malformed.length > 1 ? 's' : ''} ${malformed.join(', ')} — each line must be: PATTERN_NAME regex`,
    };
  }
  const grok: GrokProcessor = { field: 'message', patterns: [pattern] };
  if (Object.keys(definitions).length > 0) grok.pattern_definitions = definitions;
  if (captureAllMatches) grok.capture_all_matches = true;
  return { body: { pipeline: { processors: [{ grok }] }, docs: [{ _source: { message: sampleLog } }] } };
}

interface Reason {
  reason?: string;
  root_cause?: Array<{ reason?: string }>;
}

/** The fields the pattern took out of the sample, or why it did not match */
export function readSimulation(response: unknown): { result: Record<string, unknown> } | { error: string } {
  const doc = (response as { docs?: Array<{ doc?: { _source?: Record<string, unknown> }; error?: Reason }> } | undefined)?.docs?.[0];
  if (doc?.error) return { error: doc.error.root_cause?.[0]?.reason ?? doc.error.reason ?? 'Unknown error' };
  if (doc?.doc?._source) return { result: doc.doc._source };
  return { error: 'Unexpected response format' };
}

/** Why the request itself failed: OpenSearch's reason when it gave one */
export function failureReason(body: unknown, message: string | undefined): string {
  const answer = body as { error?: Reason; message?: string } | undefined;
  return answer?.error?.root_cause?.[0]?.reason ?? answer?.error?.reason ?? answer?.message ?? message ?? 'Request failed';
}

/** A value of the result as the table shows it */
export const grokValue = (value: unknown): string => (typeof value === 'object' ? JSON.stringify(value) : String(value));
