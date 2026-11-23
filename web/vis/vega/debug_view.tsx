/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Inspect's "Vega debug" view: the data sets of a Vega view, the values of its signals as they
 * change, and the spec Vega was given, read and shown as the original shows them.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '../../components/basic';
import { CodeEditor, type CodeToken } from '../../components/code_editor';
import { ComboBox } from '../../components/combo_box';
import { Icon } from '../../components/icon';
import { copyText } from '../../components/overlay';
import { InspectorDataGrid, type GridColumn } from './inspector_grid';
import type { VegaView } from './library';

/** What Inspect shows of a Vega visualization: its view, and the spec it was drawn from */
export interface VegaDebugValues {
  view: VegaView;
  spec: unknown;
}

export interface VegaRuntimeData {
  columns: string[];
  data: Array<Record<string, string | undefined>>;
}

export interface VegaDataSet extends VegaRuntimeData {
  id: string;
}

const SIGNAL = 'Signal';
const VALUE = 'Value';
// The signal's name 150 pixels wide, its value the rest; a data set's columns are JSON
const SIGNAL_COLUMNS: GridColumn[] = [
  { id: SIGNAL, schema: 'string', initialWidth: 150 },
  { id: VALUE, schema: 'json' },
];

/** A row of a grid: each column's value as text, objects as JSON, and "(..)" for what cannot be written */
export function serializeColumns(item: Record<string, unknown>, columns: string[]) {
  return columns.reduce<Record<string, string | undefined>>((row, column) => {
    try {
      const cell = item[column];
      row[column] = typeof cell === 'object' ? JSON.stringify(cell) : `${String(cell)}`;
    } catch {
      row[column] = '(..)';
    }
    return row;
  }, {});
}

/** The data sets of a view that hold rows, with the columns of their first row */
export function vegaDataSets(view: VegaView): VegaDataSet[] {
  const runtime = view._runtime;
  return Object.keys(runtime.data || []).reduce<VegaDataSet[]>((sets, key) => {
    const value = runtime.data[key].values.value;
    if (value && value[0]) {
      const columns = Object.keys(value[0]);
      sets.push({ id: key, columns, data: value.map((item) => serializeColumns(item, columns)) });
    }
    return sets;
  }, []);
}

/** The signals of a view and their values */
export function vegaSignals(view: VegaView): VegaRuntimeData {
  const runtime = view._runtime;
  return {
    columns: [SIGNAL, VALUE],
    data: Object.keys(runtime.signals).map((key) =>
      serializeColumns({ [SIGNAL]: key, [VALUE]: runtime.signals[key].value }, [SIGNAL, VALUE])
    ),
  };
}

/** The spec as Inspect shows it */
export const vegaSpecText = (values: VegaDebugValues) => JSON.stringify(values.spec, null, 2);

function DataViewer({ values }: { values: VegaDebugValues }) {
  const sets = useMemo(() => vegaDataSets(values.view), [values]);
  // The set first shown is kept until another is picked, as in the original, with its rows as
  // they are now (the original goes on showing the rows it had when the view draws again)
  const [selectedId, setSelectedId] = useState<string | undefined>(sets[0]?.id);
  const selected = sets.find((set) => set.id === selectedId) ?? sets[0];
  const columns = useMemo<GridColumn[]>(
    () => (selected ? selected.columns.map((id) => ({ id, schema: 'json' })) : []),
    [selected]
  );
  if (!selected) return null;
  return (
    <div className="vgaDebug__panel">
      <div className="vgaDebug__chooser" aria-label="Data set">
        <ComboBox
          single
          fullWidth
          clearable={false}
          options={sets.map((set) => ({ value: set.id, label: set.id }))}
          selected={[selected.id]}
          onChange={([id]) => {
            if (id !== undefined && sets.some((set) => set.id === id)) setSelectedId(id);
          }}
        />
      </div>
      <InspectorDataGrid columns={columns} data={selected.data} ariaLabel={`${selected.id} data grid`} />
    </div>
  );
}

function SignalViewer({ values }: { values: VegaDebugValues }) {
  const [signals, setSignals] = useState(() => vegaSignals(values.view));
  useEffect(() => {
    const { view } = values;
    setSignals(vegaSignals(view));
    // read again once the signals have been still for 350 ms
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setSignals(vegaSignals(view)), 350);
    };
    const names = Object.keys(view._runtime.signals);
    names.forEach((name) => view.addSignalListener(name, listener));
    return () => {
      clearTimeout(timer);
      names.forEach((name) => view.removeSignalListener(name, listener));
    };
  }, [values]);
  return (
    <div className="vgaDebug__panel">
      <InspectorDataGrid columns={SIGNAL_COLUMNS} data={signals.data} ariaLabel="Signal values data grid" />
    </div>
  );
}

/**
 * The spec as the original's editor draws it: plain, with a guide at the start of each two spaces
 * of a line's indent
 */
export function specLines(text: string): CodeToken[][] {
  return text.split('\n').map((line) => {
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const guides = Math.floor(indent / 2);
    const tokens: CodeToken[] = Array.from({ length: guides }, () => ({ text: '  ', kind: 'SpecGuide' }));
    const rest = line.slice(guides * 2);
    return rest || tokens.length === 0 ? [...tokens, { text: rest }] : tokens;
  });
}

// The editor ends where the original's does: 32 px above the bottom of the window
const SPEC_BOTTOM_GAP = 32;

function SpecViewer({ values }: { values: VegaDebugValues }) {
  const spec = useMemo(() => vegaSpecText(values), [values]);
  const place = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);
  useLayoutEffect(() => {
    const fit = () => {
      const top = place.current?.getBoundingClientRect().top;
      if (top !== undefined) setHeight(Math.max(120, window.innerHeight - top - SPEC_BOTTOM_GAP));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  if (!spec) return null;
  return (
    <div className="vgaDebug__panel vgaDebug__spec">
      <div className="vgaDebug__copy">
        <button
          type="button"
          className="vgaGrid__footerBtn"
          onClick={() => copyText(spec)}
          data-test-subj="vegaDataInspectorCopyClipboardButton"
        >
          <Icon name="copyClipboard" size="s" />
          Copy to clipboard
        </button>
      </div>
      <div ref={place}>
        <CodeEditor
          value={spec}
          readOnly
          wrap
          gutter={false}
          fontSize={12}
          height={height}
          tokenize={specLines}
          ariaLabel="Spec"
        />
      </div>
    </div>
  );
}

const TABS = [
  { id: 'data-viewer--id', label: 'Data sets', testId: 'vegaDataInspectorDataViewerButton' },
  { id: 'signal-viewer--id', label: 'Signal values', testId: 'vegaDataInspectorSignalViewerButton' },
  { id: 'spec-viewer--id', label: 'Spec', testId: 'vegaDataInspectorSpecViewerButton' },
];

export function VegaDebugView({ values }: { values: VegaDebugValues }) {
  const [tab, setTab] = useState(TABS[0].id);
  return (
    <div className="vgaDebug">
      <Tabs size="s" tabs={TABS} selected={tab} onSelect={setTab} />
      {tab === 'data-viewer--id' && <DataViewer values={values} />}
      {tab === 'signal-viewer--id' && <SignalViewer values={values} />}
      {tab === 'spec-viewer--id' && <SpecViewer values={values} />}
    </div>
  );
}
