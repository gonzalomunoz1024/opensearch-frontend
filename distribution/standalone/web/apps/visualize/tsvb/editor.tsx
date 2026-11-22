/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editor of a TSVB visualization, as OpenSearch Dashboards lays it out: the kinds of panel as
 * tabs, the chart under them at a height that can be dragged, a bar that applies the changes, and
 * the panel's settings under it all. A change is applied a fifth of a second after the last one
 * while "Auto apply" is on, and waits for "Apply changes" while it is off.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Loading, cx } from '../../../components/basic';
import { services } from '../../../services';
import { errorMessage } from '../../../services/http';
import {
  AUTO_INTERVAL,
  drawnInterval,
  extractIndexPatterns,
  formatInterval,
  isAutoInterval,
  isGteInterval,
  isModelInvalid,
  stableKey,
  type Doc,
  type Fields,
  type Panel,
  type TsvbField,
} from './model';
import { PanelConfig } from './panel_config';
import type { PanelData } from './series';
import '../../../styles/tsvb_editor.css';

const APPLY_DELAY = 200;
const MIN_CHART_HEIGHT = 300;
const RESIZE_STEP = 15;

const PICKS: Array<[string, string]> = [
  ['timeseries', 'Time Series'],
  ['metric', 'Metric'],
  ['top_n', 'Top N'],
  ['gauge', 'Gauge'],
  ['markdown', 'Markdown'],
  ['table', 'Table'],
];

const INTERVAL_SHOWN = new Set(['metric', 'top_n', 'gauge', 'markdown', 'table']);

/** The fields of each index pattern, from the route the editor lists them with */
export async function fetchFields(patterns: string[]): Promise<Fields> {
  try {
    const answers = await Promise.all(
      patterns.map((pattern) => services.http.get<TsvbField[]>('/api/metrics/fields', { query: { index: pattern } }))
    );
    return Object.fromEntries(patterns.map((pattern, index) => [pattern, answers[index]]));
  } catch (failure) {
    services.toasts.danger('Unable to load index_pattern fields', errorMessage(failure));
    return {};
  }
}

function VisPicker({ type, onChange }: { type: string; onChange: (part: Doc) => void }) {
  return (
    <div className="tvbTabs tvbVisPicker" role="tablist">
      {PICKS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          className="tvbTab tvbVisPickerItem"
          aria-selected={type === value}
          onClick={() => onChange({ type: value })}
          data-test-subj={`${value}TsvbTypeBtn`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The interval the chart was drawn at, for the kinds of panel that show one number per series */
function panelInterval(model: Panel, data: PanelData | undefined): string | null {
  const interval = model.interval ?? AUTO_INTERVAL;
  if (!INTERVAL_SHOWN.has(model.type) || !(isAutoInterval(interval) || isGteInterval(interval)) || !data) return null;
  const series = 'rows' in data ? (data.rows[0]?.series ?? []) : data.series;
  return formatInterval(drawnInterval(series));
}

export interface TsvbEditorProps {
  /** The params the chart is drawn from */
  params: Doc;
  /** Draw the chart from these params */
  onApply: (params: Doc) => void;
  /** Whether there are changes "Apply changes" has still to apply */
  onPending?: (pending: boolean) => void;
  chart: ReactNode;
  /** What the chart drew last */
  data?: PanelData;
}

export function TsvbEditor({ params, onApply, onPending, chart, data }: TsvbEditorProps) {
  const [model, setModel] = useState<Panel>();
  const [fields, setFields] = useState<Fields>({});
  const [autoApply, setAutoApply] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [height, setHeight] = useState(MIN_CHART_HEIGHT);
  const [dragging, setDragging] = useState(false);

  const current = useRef<Panel>();
  const autoApplyRef = useRef(autoApply);
  autoApplyRef.current = autoApply;
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const timer = useRef<number>();
  const extracted = useRef<string[]>(['']);
  const fieldsTurn = useRef(0);
  // The params last drawn: what comes back from the address after an apply is not a change
  const drawn = useRef<string>();
  const defaults = useRef<Doc>({});

  // The editor opens on the default index pattern, which a panel without one of its own uses,
  // and with the fields of the patterns the panel names
  useEffect(() => {
    let live = true;
    void (async () => {
      const pattern = await services.indexPatterns.getDefault().catch(() => undefined);
      defaults.current = { default_index_pattern: pattern?.title ?? '', default_timefield: pattern?.timeFieldName ?? '' };
      const start = { ...params, ...defaults.current } as Panel;
      const loaded = await fetchFields(extractIndexPatterns(start));
      if (!live) return;
      drawn.current = stableKey(params);
      current.current = start;
      setModel(start);
      setFields(loaded);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Params changed elsewhere, as when the browser goes back: the editor starts from them again
  useEffect(() => {
    if (!current.current) return;
    const key = stableKey(params);
    if (key === drawn.current) return;
    drawn.current = key;
    const next = { ...params } as Panel;
    for (const [name, value] of Object.entries(defaults.current)) {
      if (next[name] === undefined) next[name] = value;
    }
    current.current = next;
    setModel(next);
    setDirty(false);
  }, [params]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => onPending?.(dirty), [dirty, onPending]);

  const scheduleApply = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const latest = current.current;
      if (!latest) return;
      // The chart is not asked for while an interval is not one OpenSearch takes
      const next = { ...latest, isModelInvalid: isModelInvalid(latest) };
      drawn.current = stableKey(next);
      applyRef.current(next);
    }, APPLY_DELAY);
  }, []);

  const handleChange = useCallback(
    (part: Doc) => {
      const before = current.current;
      if (!before || Object.keys(part).length === 0) return;
      const typeChanged = part.type !== undefined && part.type !== before.type;
      const next = { ...before, ...part } as Panel;
      current.current = next;
      setModel(next);
      if (autoApplyRef.current || typeChanged) {
        scheduleApply();
        setDirty(false);
      } else setDirty(true);
      const patterns = extractIndexPatterns(next);
      if (patterns.join('\n') !== extracted.current.join('\n')) {
        const turn = ++fieldsTurn.current;
        void fetchFields(patterns).then((found) => {
          if (turn !== fieldsTurn.current) return;
          extracted.current = patterns;
          setFields(found);
        });
      }
    },
    [scheduleApply]
  );

  const commit = () => {
    scheduleApply();
    setDirty(false);
  };

  // The handle under the chart drags its height, and the arrow keys change it a step at a time
  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event: MouseEvent) => setHeight((value) => Math.max(MIN_CHART_HEIGHT, value + event.movementY));
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);
  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = event.key === 'ArrowUp' ? -RESIZE_STEP : RESIZE_STEP;
    setHeight((value) => Math.max(MIN_CHART_HEIGHT, value + step));
  };

  if (!model) return <Loading />;

  const interval = panelInterval(model, data);
  let message = 'The latest changes have been applied.';
  if (dirty) message = 'The changes to this visualization have not been applied.';
  if (autoApply) message = 'The changes will be automatically applied.';

  return (
    <div className="tvbEditor" data-test-subj="tvbVisEditor">
      <div className="tvbEditor--hideForReporting">
        <VisPicker type={model.type} onChange={handleChange} />
      </div>
      <div>
        <div className="tvbEditorVisualization" style={{ height, userSelect: dragging ? 'none' : undefined }}>
          {chart}
        </div>
        <div className="tvbEditor--hideForReporting">
          <div className="tvbEditorVisualization__apply">
            <div className="tvbEditorVisualization__auto">
              <span className="atlSwitch">
                <button
                  id="tsvbAutoApplyInput"
                  type="button"
                  role="switch"
                  className="atlSwitch__track"
                  aria-checked={autoApply}
                  aria-label="Auto apply"
                  onClick={() => setAutoApply(!autoApply)}
                />
                <span onClick={() => setAutoApply(!autoApply)}>Auto apply</span>
              </span>
            </div>
            {interval && <p className="tvbText tvbText--xs">Interval: {interval}</p>}
            <p className={cx('tvbText', 'tvbText--xs', !dirty && 'tvbText--subdued')}>{message}</p>
            {!autoApply && (
              <Button variant="primary" size="s" icon="play" onClick={commit} disabled={!dirty} testId="applyBtn">
                Apply changes
              </Button>
            )}
          </div>
          <button
            type="button"
            className="tvbEditorVisualization__draghandle"
            onMouseDown={() => setDragging(true)}
            onMouseUp={() => setDragging(false)}
            onKeyDown={onHandleKey}
            aria-label="Press up/down to adjust the chart size"
          >
            <span className="tvbEditorVisualization__grip" />
          </button>
        </div>
      </div>
      <div className="tvbEditor--hideForReporting">
        <PanelConfig model={model} fields={fields} onChange={handleChange} visData={data} />
      </div>
    </div>
  );
}
