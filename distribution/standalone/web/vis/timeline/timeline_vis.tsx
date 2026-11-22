/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A Timeline visualization: the expression is run on the server, and the series it answers are
 * drawn as the original draws them, with its legend that shows the values under the cursor, its
 * crosshair shared by every Timeline chart on the page, and a drag across the chart that sets the
 * time range.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartMessage, SERIES_COLORS } from '../../charts/core';
import { formatDate, type TimeRange } from '../../lib/dates';
import type { Vis } from '../../lib/vis';
import { services } from '../../services';
import type { RequestRecord } from '../../services/search';
import type { VisInput } from '../request';
import { mergeGlobal, TICK_FORMATTERS } from './formatters';
import { Plot, type CursorPosition, type PlotSeries } from './plot';
import { calculateInterval, fetchTimeline, xaxisFormat, type TimelineSeries, type TimelineSheet } from './request';
import '../../styles/timeline.css';

export const DEFAULT_TIME_FORMAT = 'MMMM Do YYYY, HH:mm:ss.SSS';
const SERIES_ID_ATTR = 'data-series-id';
const DEBOUNCE_DELAY = 50;
// keeps the legend as tall with a caption as without, so that its entries do not move
const EMPTY_CAPTION = '<br>';

type Loose = Record<string, unknown>;

const clone = <T,>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** A colour as the browser writes it back: the original passes every colour through a span's style */
function normalizeColor(color: string): string {
  const span = document.createElement('span');
  span.style.color = color;
  return span.style.color;
}

export function buildSeriesData(chart: TimelineSeries[], options: Loose) {
  return chart.map((series, seriesIndex) => {
    const withDefaults: Loose = { ...series };
    if (withDefaults.shadowSize === undefined) withDefaults.shadowSize = 0;
    if (withDefaults.lines === undefined) withDefaults.lines = { lineWidth: 3 };
    const newSeries = clone(withDefaults) as TimelineSeries;
    newSeries._id = seriesIndex;
    if (series.color) newSeries.color = normalizeColor(series.color);
    if (series._hide) {
      newSeries.data = [];
      newSeries.stack = false;
      newSeries.label = `(hidden) ${series.label}`;
    }
    if (series._global) mergeGlobal(options, clone(series._global));
    return newSeries;
  });
}

export function buildOptions(intervalValue: string, bounds: { min: number; max: number }, clientWidth = 0, showGrid?: boolean) {
  const settings = services.uiSettings;
  const interval = calculateInterval(
    bounds.min,
    bounds.max,
    settings.get<number>('timeline:target_buckets') || 200,
    intervalValue,
    settings.get<string>('timeline:min_interval') || '1ms'
  );
  const format = xaxisFormat(interval);
  const tickLetterWidth = 7;
  const tickPadding = 45;
  const zone = services.timeZone();
  return {
    xaxis: {
      mode: 'time',
      tickLength: 5,
      timezone: 'browser',
      ticks: Math.floor(clientWidth / (format.length * tickLetterWidth + tickPadding)),
      tickFormatter: (val: number) => formatDate(new Date(val), format, zone),
    },
    selection: { mode: 'x', color: '#ccc' },
    crosshair: { mode: 'x', color: '#C66', lineWidth: 2 },
    colors: SERIES_COLORS,
    grid: {
      show: showGrid,
      borderWidth: 0,
      borderColor: null,
      margin: 10,
      hoverable: true,
      autoHighlight: false,
    },
    legend: {
      backgroundColor: 'rgb(255,255,255,0)',
      position: 'nw',
      labelBoxBorderColor: 'rgb(255,255,255,0)',
      labelFormatter(label: string, series: { _id: number }) {
        const wrapperSpan = document.createElement('span');
        const labelSpan = document.createElement('span');
        const numberSpan = document.createElement('span');
        wrapperSpan.setAttribute('class', 'ngLegendValue');
        wrapperSpan.setAttribute(SERIES_ID_ATTR, `${series._id}`);
        labelSpan.appendChild(document.createTextNode(label));
        numberSpan.setAttribute('class', 'ngLegendValueNumber');
        wrapperSpan.appendChild(labelSpan);
        wrapperSpan.appendChild(numberSpan);
        return wrapperSpan.outerHTML;
      },
    },
  } as Loose;
}

// --- The crosshair every Timeline chart of the page follows ------------------------------------------

type CursorListener = (source: object, position: CursorPosition) => void;
const cursorListeners = new Set<CursorListener>();

// --- The chart -------------------------------------------------------------------------------------------

interface ChartProps {
  interval: string;
  seriesList: TimelineSheet;
  bounds: { min: number; max: number };
  onTimeChange?: (range: TimeRange) => void;
}

export function TimelineChart({ interval, seriesList, bounds, onTimeChange }: ChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<Plot | null>(null);
  const identity = useRef({});
  const [chart, setChart] = useState<TimelineSeries[]>([]);
  const originalColors = useRef<string[]>([]);
  const highlighted = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const timeChange = useRef(onTimeChange);
  timeChange.current = onTimeChange;

  // Every series has a colour: its own, or the next of the palette
  useEffect(() => {
    const colors: string[] = [];
    const next = seriesList.list.map((series, index) => {
      const copy = { ...series };
      if (!copy.color) copy.color = SERIES_COLORS[index % SERIES_COLORS.length];
      colors.push(copy.color);
      return copy;
    });
    originalColors.current = colors;
    highlighted.current = null;
    setChart(next);
  }, [seriesList.list]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const legend = useRef<{ numbers: HTMLElement[]; caption: HTMLElement | null }>({ numbers: [], caption: null });

  const recolor = useCallback((id: number | null) => {
    highlighted.current = id;
    setChart((state) =>
      state.map((series, index) => ({
        ...series,
        color: id === null || index === id ? originalColors.current[index] : 'rgba(128,128,128,0.1)',
      }))
    );
  }, []);

  const setLegendNumbers = useCallback(
    (pos: CursorPosition) => {
      const plot = plotRef.current;
      if (!plot) return;
      if (highlighted.current !== null) recolor(null);
      const axes = plot.getAxes();
      if (pos.x < axes.xaxis.min || pos.x > axes.xaxis.max) return;
      const dataset = plot.getData() as Array<PlotSeries & { _global?: Loose; _meta?: { precision?: number }; _hide?: boolean }>;
      const { caption, numbers } = legend.current;
      if (caption) {
        const legendOptions = (dataset[0]?._global?.legend ?? {}) as { timeFormat?: string };
        caption.textContent = formatDate(new Date(pos.x), legendOptions.timeFormat ?? DEFAULT_TIME_FORMAT, services.timeZone());
      }
      dataset.forEach((series, i) => {
        const useNearestPoint = series.lines.show && !series.lines.steps;
        const precision = series._meta?.precision ?? 2;
        if (series._hide) return;
        const data = series.data as Array<[number, number | null]>;
        const currentPoint = data.find((point, index) => {
          if (index + 1 === data.length) return true;
          if (useNearestPoint) return pos.x - point[0] < data[index + 1][0] - pos.x;
          return pos.x < data[index + 1][0];
        });
        if (!currentPoint) return;
        const y = currentPoint[1];
        const number = numbers[i];
        if (!number) return;
        if (y == null) number.replaceChildren();
        else {
          let label = y.toFixed(precision);
          const formatter = series.yaxis.tickFormatter;
          if (formatter) label = formatter(Number(label), series.yaxis);
          number.textContent = `(${label})`;
        }
      });
    },
    [recolor]
  );

  // Flot's legend numbers follow the cursor at most every 50 ms, at the start of each burst
  const lastNumbers = useRef(0);
  const plotHover = useCallback(
    (pos: CursorPosition) => {
      plotRef.current?.setCrosshair(pos);
      const now = Date.now();
      if (now - lastNumbers.current >= DEBOUNCE_DELAY) {
        lastNumbers.current = now;
        setLegendNumbers(pos);
      }
    },
    [setLegendNumbers]
  );

  useEffect(() => {
    const listener: CursorListener = (source, position) => {
      if (source !== identity.current) plotHover(position);
    };
    cursorListeners.add(listener);
    return () => void cursorListeners.delete(listener);
  }, [plotHover]);

  // Draw the chart whenever the series, their colours or the room for them change
  useEffect(() => {
    const canvas = canvasRef.current;
    const element = chartRef.current;
    if (!canvas || !element || canvas.clientWidth <= 0 || canvas.clientHeight <= 0 || chart.length === 0) return undefined;
    const options = buildOptions(interval, bounds, element.clientWidth, seriesList.render?.grid);
    const data = buildSeriesData(chart, options);
    const yaxes = options.yaxes as Array<Loose | null> | undefined;
    for (const yaxis of yaxes ?? []) {
      const units = yaxis?.units as { type: string } | undefined;
      if (yaxis && units) yaxis.tickFormatter = TICK_FORMATTERS[units.type];
    }
    plotRef.current?.destroy();
    const plot = new Plot(canvas, data, options, {
      hover: (pos) => {
        plotHover(pos);
        for (const listener of cursorListeners) listener(identity.current, pos);
      },
      selected: (ranges) => {
        const range = ranges.xaxis;
        if (range) {
          timeChange.current?.({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() });
        }
      },
    });
    plotRef.current = plot;

    // The caption under the legend's title row shows the time under the cursor
    const global = (plot.getData()[0]?._global ?? {}) as { legend?: { showTime?: boolean } };
    legend.current = { numbers: [], caption: null };
    if (global.legend?.showTime ?? true) {
      const table = canvas.querySelector('div.legend table');
      const caption = document.createElement('caption');
      caption.className = 'timChart__legendCaption';
      caption.innerHTML = EMPTY_CAPTION;
      table?.appendChild(caption);
      legend.current = {
        caption,
        numbers: [...canvas.querySelectorAll<HTMLElement>('.ngLegendValueNumber')],
      };
      let hoverTimer: ReturnType<typeof setTimeout> | undefined;
      canvas.querySelectorAll<HTMLElement>('.ngLegendValue').forEach((entry) => {
        const id = Number(entry.getAttribute(SERIES_ID_ATTR));
        entry.addEventListener('click', () =>
          setChart((state) => state.map((series, index) => (index === id ? { ...series, _hide: !series._hide } : series)))
        );
        entry.addEventListener('mouseover', () => {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => {
            if (highlighted.current !== id) recolor(id);
          }, DEBOUNCE_DELAY);
        });
      });
    }
    return undefined;
  }, [chart, size, interval, bounds, seriesList.render, plotHover, recolor]);

  useEffect(
    () => () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    },
    []
  );

  const onMouseLeave = () => {
    plotRef.current?.clearCrosshair();
    const { caption, numbers } = legend.current;
    if (caption) caption.innerHTML = EMPTY_CAPTION;
    for (const number of numbers) number.replaceChildren();
  };

  const title = useMemo(
    () => seriesList.list.map((series) => series._title).filter(Boolean).pop() || '',
    [seriesList.list]
  );

  return (
    <div ref={chartRef} className="timChart" onMouseLeave={onMouseLeave}>
      <div className="chart-top-title">{title}</div>
      <div ref={canvasRef} className="chart-canvas" />
    </div>
  );
}

// --- The visualization ----------------------------------------------------------------------------------

export interface TimelineVisProps {
  vis: Vis;
  input: VisInput;
  tick?: number;
  onTimeChange?: (range: TimeRange) => void;
  onData?: (data: { requests: RequestRecord[] }) => void;
}

export function TimelineVis({ vis, input, tick, onTimeChange, onData }: TimelineVisProps) {
  const params = vis.params as { expression?: string; interval?: string };
  const [state, setState] = useState<{ sheet?: TimelineSheet; bounds?: { min: number; max: number } }>({});
  const [loading, setLoading] = useState(true);
  const report = useRef(onData);
  report.current = onData;
  const key = JSON.stringify([params.expression, params.interval, input]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchTimeline(params, input, controller.signal)
      .then(({ answer, range }) => {
        if (controller.signal.aborted) return;
        setState({ sheet: answer.sheet[0], bounds: { min: range.from.getTime(), max: range.to.getTime() } });
        setLoading(false);
        // The original gives Inspect nothing to show for Timeline
        report.current?.({ requests: [] });
      })
      .catch((failure) => {
        if ((failure as Error).name === 'AbortError') return;
        // As in the original, the chart is left empty and the failure is told in a toast
        setState({});
        setLoading(false);
        services.toasts.error(failure, 'Search Error');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  let body = null;
  if (state.sheet && state.bounds) {
    body =
      state.sheet.list.length === 0 ? (
        <ChartMessage>No results found</ChartMessage>
      ) : (
        <TimelineChart interval={params.interval ?? 'auto'} seriesList={state.sheet} bounds={state.bounds} onTimeChange={onTimeChange} />
      );
  }
  return (
    <>
      {loading && <div className="atlProgress visRoot__progress" />}
      {body}
    </>
  );
}
