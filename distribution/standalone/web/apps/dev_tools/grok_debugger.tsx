/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The Grok debugger of Dev Tools: a line of a log and a grok pattern, tried against each other
 * by OpenSearch's own grok processor in a simulated pipeline.
 */

import { useEffect, useState } from 'react';
import { Accordion, Button } from '../../components/basic';
import { Checkbox, FormRow, TextArea } from '../../components/form';
import { HttpFetchError } from '../../services/http';
import { services } from '../../services';

const STORAGE_KEY = 'grokDebugger';

function load(key: string, fallback = ''): string {
  try {
    return window.sessionStorage.getItem(`${STORAGE_KEY}.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string) {
  try {
    window.sessionStorage.setItem(`${STORAGE_KEY}.${key}`, value);
  } catch {
    // a browser that keeps nothing still has a debugger
  }
}

interface SimulatedDoc {
  doc?: { _source?: Record<string, unknown> };
  error?: { reason?: string; root_cause?: Array<{ reason?: string }> };
}

export function GrokDebugger() {
  const [pattern, setPattern] = useState(() => load('pattern'));
  const [sampleLog, setSampleLog] = useState(() => load('sampleLog'));
  const [customPatterns, setCustomPatterns] = useState(() => load('customPatterns'));
  const [captureAll, setCaptureAll] = useState(() => load('captureAllMatches') === 'true');
  const [result, setResult] = useState<Record<string, unknown>>();
  const [error, setError] = useState<string>();
  const [customError, setCustomError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => save('pattern', pattern), [pattern]);
  useEffect(() => save('sampleLog', sampleLog), [sampleLog]);
  useEffect(() => save('customPatterns', customPatterns), [customPatterns]);
  useEffect(() => save('captureAllMatches', String(captureAll)), [captureAll]);

  const simulate = async () => {
    setLoading(true);
    setResult(undefined);
    setError(undefined);

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
      setCustomError(
        `Malformed pattern definition on line${malformed.length > 1 ? 's' : ''} ${malformed.join(', ')} — each line must be: PATTERN_NAME regex`
      );
      setLoading(false);
      return;
    }
    setCustomError(undefined);

    const grok: Record<string, unknown> = { field: 'message', patterns: [pattern] };
    if (Object.keys(definitions).length > 0) grok.pattern_definitions = definitions;
    if (captureAll) grok.capture_all_matches = true;

    try {
      const response = await services.http.post<{ docs?: SimulatedDoc[] }>('/api/console/proxy', {
        query: { path: '_ingest/pipeline/_simulate', method: 'POST' },
        body: { pipeline: { processors: [{ grok }] }, docs: [{ _source: { message: sampleLog } }] },
      });
      const doc = response?.docs?.[0];
      if (doc?.error) setError(doc.error.root_cause?.[0]?.reason ?? doc.error.reason ?? 'Unknown error');
      else if (doc?.doc?._source) setResult(doc.doc._source);
      else setError('Unexpected response format');
    } catch (failure) {
      const body = (failure as HttpFetchError).body as { error?: { reason?: string; root_cause?: Array<{ reason?: string }> }; message?: string } | undefined;
      setError(body?.error?.root_cause?.[0]?.reason ?? body?.error?.reason ?? body?.message ?? (failure as Error).message ?? 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setSampleLog('');
    setPattern('');
    setCustomPatterns('');
    setCaptureAll(false);
    setResult(undefined);
    setError(undefined);
    try {
      for (const key of ['pattern', 'sampleLog', 'customPatterns', 'captureAllMatches']) window.sessionStorage.removeItem(`${STORAGE_KEY}.${key}`);
    } catch {
      // nothing was kept
    }
  };

  return (
    <div className="dvtGrok" data-test-subj="grokDebugger">
      <div className="dvtGrok__form">
        <div className="dvtGrok__docs">
          <Button size="s" icon="external" onClick={() => window.open('https://docs.opensearch.org/latest/ingest-pipelines/processors/grok/', '_blank', 'noopener,noreferrer')}>
            Grok documentation
          </Button>
        </div>
        <FormRow label="Sample Log" full>
          <TextArea rows={4} value={sampleLog} onChange={setSampleLog} placeholder="e.g. 127.0.0.1 198.126.12 10/Oct/2025:13:55:36 -0700 200" testId="grokSampleLog" />
        </FormRow>
        <FormRow label="Grok Pattern" full>
          <TextArea rows={4} value={pattern} onChange={setPattern} placeholder="e.g. %{IPORHOST:clientip} %{HTTPDATE:timestamp} %{NUMBER:response_status:int}" testId="grokPattern" />
        </FormRow>
        <div className="dvtGrok__advanced">
          <Accordion title="Advanced settings" initiallyOpen={false}>
            <div className="atlStack">
              <FormRow label="Custom pattern definitions" full error={customError}>
                <TextArea
                  rows={4}
                  value={customPatterns}
                  invalid={Boolean(customError)}
                  onChange={(value) => {
                    setCustomPatterns(value);
                    setCustomError(undefined);
                  }}
                  placeholder={'CUSTOM_PATTERN (?:[a-zA-Z0-9._-]+)\nEach line: PATTERN_NAME pattern_regex'}
                  testId="grokCustomPatterns"
                />
              </FormRow>
              <span title='Collects all matches of repeated patterns into an array. For example, given "192.168.1.1 10.0.0.1 172.16.0.1" and pattern "%{IP:ipAddress} %{IP:ipAddress} %{IP:ipAddress}", all three IPs are collected into the ipAddress field.'>
                <Checkbox checked={captureAll} onChange={setCaptureAll} label="Capture all matches" testId="grokCaptureAll" />
              </span>
            </div>
          </Accordion>
        </div>
        <div className="atlRow">
          <Button variant="primary" size="s" loading={loading} disabled={!pattern.trim() || !sampleLog.trim()} onClick={() => void simulate()} testId="grokSimulate">
            Simulate
          </Button>
          <Button size="s" onClick={clear} testId="grokClear">
            Clear
          </Button>
        </div>
      </div>

      <div className="dvtGrok__result">
        <div className="dvtGrok__resultHead">
          <h2 className="atlTitleXs">Results</h2>
          {result && <span className="dvtGrok__matched">✓ Pattern matched</span>}
          {error && <span className="dvtGrok__failed">✗ Pattern match failed</span>}
        </div>
        <div className="dvtGrok__resultBody">
          {!result && !error && <p className="atlSubdued">Run Simulate to see results.</p>}
          {error && (
            <div className="dvtGrok__failed">
              <p>Correct the grok pattern or add custom pattern definitions.</p>
              <p>{error}</p>
            </div>
          )}
          {result && (
            <table className="atlTable atlTable--compact">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result).map(([field, value]) => (
                  <tr key={field}>
                    <td>{field}</td>
                    <td>{value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
