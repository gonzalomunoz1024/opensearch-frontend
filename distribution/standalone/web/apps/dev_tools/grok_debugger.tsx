/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The Grok debugger of Dev Tools: a line of a log and a grok pattern, tried against each other
 * by OpenSearch's own grok processor in a simulated pipeline.
 */

import { useEffect, useState } from 'react';
import { Button } from '../../components/basic';
import { Checkbox, FormRow, TextArea } from '../../components/form';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { HttpFetchError } from '../../services/http';
import { services } from '../../services';
import { failureReason, grokSimulation, grokValue, readSimulation } from './grok_request';

const STORAGE_KEY = 'grokDebugger';
const DOCS = 'https://docs.opensearch.org/latest/ingest-pipelines/processors/grok/';

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

export function GrokDebugger() {
  const [pattern, setPattern] = useState(() => load('pattern'));
  const [sampleLog, setSampleLog] = useState(() => load('sampleLog'));
  const [customPatterns, setCustomPatterns] = useState(() => load('customPatterns'));
  const [captureAll, setCaptureAll] = useState(() => load('captureAllMatches') === 'true');
  const [result, setResult] = useState<Record<string, unknown>>();
  const [error, setError] = useState<string>();
  const [customError, setCustomError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => save('pattern', pattern), [pattern]);
  useEffect(() => save('sampleLog', sampleLog), [sampleLog]);
  useEffect(() => save('customPatterns', customPatterns), [customPatterns]);
  useEffect(() => save('captureAllMatches', String(captureAll)), [captureAll]);

  const simulate = async () => {
    setLoading(true);
    setResult(undefined);
    setError(undefined);
    const simulation = grokSimulation(pattern, sampleLog, customPatterns, captureAll);
    if ('customPatternError' in simulation) {
      setCustomError(simulation.customPatternError);
      setLoading(false);
      return;
    }
    setCustomError(undefined);
    try {
      const response = await services.http.post<unknown>('/api/console/proxy', {
        query: { path: '_ingest/pipeline/_simulate', method: 'POST' },
        body: simulation.body,
      });
      const read = readSimulation(response);
      if ('error' in read) setError(read.error);
      else setResult(read.result);
    } catch (failure) {
      setError(failureReason((failure as HttpFetchError).body, (failure as Error).message));
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
    <div className="dvtGrokPage">
      <div className="dvtGrok" data-test-subj="grokDebugger">
        <div className="dvtGrok__form">
          <div className="dvtGrok__docs">
            <a className="atlButton dvtWide" href={DOCS} target="_blank" rel="noopener noreferrer">
              Grok documentation
              <Icon name="external" />
            </a>
          </div>
          <FormRow label="Sample Log" full>
            <TextArea rows={4} value={sampleLog} onChange={setSampleLog} placeholder="e.g. 127.0.0.1 198.126.12 10/Oct/2025:13:55:36 -0700 200" testId="grokSampleLog" />
          </FormRow>
          <FormRow label="Grok Pattern" full>
            <TextArea rows={4} value={pattern} onChange={setPattern} placeholder="e.g. %{IPORHOST:clientip} %{HTTPDATE:timestamp} %{NUMBER:response_status:int}" testId="grokPattern" />
          </FormRow>
          <div className="dvtGrok__advanced">
            <button type="button" className="dvtGrok__toggle" aria-expanded={advanced} aria-controls="advanced_config" onClick={() => setAdvanced(!advanced)}>
              <Icon name={advanced ? 'chevronDown' : 'chevronRight'} />
              <span>Advanced settings</span>
            </button>
            {advanced && (
              <div className="dvtGrok__advancedBody" role="region" id="advanced_config">
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
                <Tooltip content='Collects all matches of repeated patterns into an array. For example, given "192.168.1.1 10.0.0.1 172.16.0.1" and pattern "%{IP:ipAddress} %{IP:ipAddress} %{IP:ipAddress}", all three IPs are collected into the ipAddress field.'>
                  <Checkbox checked={captureAll} onChange={setCaptureAll} label="Capture all matches" testId="grokCaptureAll" />
                </Tooltip>
              </div>
            )}
          </div>
          <div className="atlRow">
            <Button variant="primary" className="dvtWide" loading={loading} disabled={!pattern.trim() || !sampleLog.trim()} onClick={() => void simulate()} testId="grokSimulate">
              Simulate
            </Button>
            <Button className="dvtWide" onClick={clear} testId="grokClear">
              Clear
            </Button>
          </div>
        </div>

        <div className="dvtGrok__side">
        <div className="dvtGrok__result">
          <div className="dvtGrok__resultHead">
            <h2>Results</h2>
            {result && <span className="dvtGrok__matched">✓ Pattern matched</span>}
            {error && <span className="dvtGrok__failed">✗ Pattern match failed</span>}
          </div>
          <div className="dvtGrok__resultBody">
            {!result && !error && <p className="dvtGrok__placeholder">Run Simulate to see results.</p>}
            {error && (
              <div className="dvtGrok__failed">
                <p>Correct the grok pattern or add custom pattern definitions.</p>
                <p>{error}</p>
              </div>
            )}
            {result && (
              <table className="dvtGrok__table">
                <caption className="atlScreenReaderOnly">This table contains {Object.keys(result).length} rows.</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '30%' }}>
                      Field
                    </th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result).map(([field, value]) => (
                    <tr key={field}>
                      <td>{field}</td>
                      <td>{grokValue(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
