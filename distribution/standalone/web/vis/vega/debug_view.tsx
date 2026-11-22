/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Inspect's "Vega debug" view: the data sets of a Vega view, the values of its signals as they
 * change, and the spec Vega was given, read and shown as the original shows them.
 */

import { useEffect, useMemo, useState } from 'react';
import { Button, Tabs } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { Select } from '../../components/form';
import { copyText } from '../../components/overlay';
import { DataTable, type Column } from '../../components/table';
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
const PAGE_SIZE = 15;
// the signal's name 150 pixels wide, its value the rest
const SIGNAL_WIDTHS = [150, undefined];

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

// The grid's columns as wide as the original's: 100 pixels unless set, scrolled sideways when there are many
const COLUMN_WIDTH = 100;

function RuntimeGrid({
  columns,
  data,
  ariaLabel,
  widths,
}: VegaRuntimeData & { ariaLabel: string; widths?: Array<number | undefined> }) {
  const rows = useMemo(() => data.map((row, index) => ({ row, index })), [data]);
  const gridColumns = useMemo<Array<Column<{ row: Record<string, string | undefined>; index: number }>>>(
    () =>
      columns.map((column, index) => ({
        id: column,
        name: column,
        // as the original's grid: an empty value shows nothing
        render: (item) => item.row[column] || null,
        sortValue: (item) => item.row[column],
        // text compared as written, as the original sorts its rows
        plainOrder: true,
        truncate: true,
        width: widths ? widths[index] : COLUMN_WIDTH,
      })),
    [columns, widths]
  );
  return (
    <div aria-label={ariaLabel} role="region">
      <DataTable
        compact
        rows={rows}
        rowId={(item) => String(item.index)}
        columns={gridColumns}
        pageSize={PAGE_SIZE}
        pageSizes={[PAGE_SIZE, 25, 50]}
      />
    </div>
  );
}

function DataViewer({ values }: { values: VegaDebugValues }) {
  const sets = useMemo(() => vegaDataSets(values.view), [values]);
  // the set first shown is kept until another is picked, as in the original
  const [selected, setSelected] = useState<VegaDataSet | undefined>(sets[0]);
  useEffect(() => {
    if (!selected) setSelected(sets[0]);
  }, [selected, sets]);
  if (!selected) return null;
  return (
    <div className="atlStack vgaDebug__panel">
      <Select
        value={selected.id}
        onChange={(id) => {
          const next = sets.find((set) => set.id === id);
          if (next) setSelected(next);
        }}
        options={sets.map((set) => ({ value: set.id, label: set.id }))}
        aria-label="Data set"
        compact
      />
      <RuntimeGrid columns={selected.columns} data={selected.data} ariaLabel={`${selected.id} data grid`} />
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
      <RuntimeGrid columns={signals.columns} data={signals.data} ariaLabel="Signal values data grid" widths={SIGNAL_WIDTHS} />
    </div>
  );
}

function SpecViewer({ values }: { values: VegaDebugValues }) {
  const spec = useMemo(() => vegaSpecText(values), [values]);
  if (!spec) return null;
  return (
    <div className="atlStack vgaDebug__panel vgaDebug__spec">
      <div className="atlRow" style={{ justifyContent: 'flex-end' }}>
        <Button variant="empty" size="s" icon="copy" onClick={() => copyText(spec)} testId="vegaDataInspectorCopyClipboardButton">
          Copy to clipboard
        </Button>
      </div>
      <CodeEditor value={spec} readOnly wrap gutter={false} fontSize={12} height="calc(100vh - 240px)" ariaLabel="Spec" />
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
    <div className="atlStack vgaDebug">
      <Tabs tabs={TABS} selected={tab} onSelect={setTab} />
      {tab === 'data-viewer--id' && <DataViewer values={values} />}
      {tab === 'signal-viewer--id' && <SignalViewer values={values} />}
      {tab === 'spec-viewer--id' && <SpecViewer values={values} />}
    </div>
  );
}
