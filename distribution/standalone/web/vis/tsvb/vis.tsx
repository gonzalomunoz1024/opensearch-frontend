/* SPDX-License-Identifier: Apache-2.0 */

/* TSVB: series over time as a chart, or their latest values as a number, bars, a gauge, text or a table. */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChartMessage, SERIES_COLORS, assignColors, type LegendPosition } from '../../charts/core';
import { XYChart, type XYAxis, type XYSeries } from '../../charts/xy';
import { Icon } from '../../components/icon';
import { formatDate, scaledDateFormat, type TimeRange } from '../../lib/dates';
import { Markdown } from '../../lib/markdown';
import { renderTemplate } from '../../lib/template';
import type { UiState, Vis } from '../../lib/vis';
import { href, navigate } from '../../router';
import { services } from '../../services';
import type { RequestRecord } from '../../services/search';
import type { VisInput } from '../request';
import {
  fetchTsvb,
  fetchTsvbTable,
  metricLabel,
  isSortable,
  ruleFor,
  seriesFormatter,
  splitParts,
  topNRows,
  type TsvbData,
  type TsvbParams,
  type TsvbPoint,
  type TsvbSeries,
  type TsvbSeriesData,
  type TsvbTableData,
  type TsvbTableSort,
} from './data';
import { panelError, TsvbError, type TsvbPanelError } from './error';
import { isInverted, placeBox, placedStyle, type BoxSize, type Placement } from './fit';
import { annotationIcon } from './icons';
import { convertSeriesToVars } from './markdown_vars';

const number = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};

/** "per 60 minutes": the width of a bucket in the largest unit that counts more than one of it */
function perInterval(ms: number): string {
  const units: Array<[string, number]> = [
    ['years', 31536000000],
    ['months', 2592000000],
    ['days', 86400000],
    ['hours', 3600000],
    ['minutes', 60000],
    ['seconds', 1000],
    ['milliseconds', 1],
  ];
  for (const [unit, size] of units) {
    if (ms / size > 1) return `per ${Math.round(ms / size)} ${unit}`;
  }
  return `per ${ms} milliseconds`;
}

/** The value of the last bucket of a series, none when it has none */
const lastBucket = (item: TsvbSeriesData): number | null => item.data[item.data.length - 1]?.[1] ?? null;

/**
 * The latest value of a series as its legend shows it: that of its last bucket, nothing when the
 * bucket has none (as the product's charts show it), and its share of the stack when the stack is
 * of shares
 */
function lastText(item: TsvbSeriesData, all: TsvbSeriesData[]): string {
  const value = lastBucket(item);
  if (value === null) return '';
  if (item.series.stacked !== 'percent') return item.format(value);
  const total = all.filter((other) => other.series.stacked === 'percent').reduce((sum, other) => sum + Math.abs(lastBucket(other) ?? 0), 0);
  return seriesFormatter('percent', item.series.value_template)(total === 0 ? 0 : value / total);
}

/** The lower value of the last bucket of a band as its legend shows it, nothing when it has none */
function lowerText(item: TsvbSeriesData): string {
  const value = item.data[item.data.length - 1]?.[2];
  return value === null || value === undefined ? '' : item.format(value);
}

/** Whether the values of a series rise or fall over its time: the slope of the line that fits them best */
function slopeOf(data: TsvbPoint[]): number {
  const points = data.filter((point): point is [number, number] => point[1] !== null && Number.isFinite(point[1]));
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  let above = 0;
  let below = 0;
  for (const [x, y] of points) {
    above += (x - meanX) * (y - meanY);
    below += (x - meanX) ** 2;
  }
  // Rounded to two decimals, as the product's regression gives it: over time in milliseconds,
  // nearly every slope rounds to 0, which the product draws as falling
  return below === 0 ? 0 : Math.round((above / below) * 100) / 100;
}

function TimeSeries({ params, data, onTimeChange }: { params: TsvbParams; data: TsvbData; onTimeChange?: (range: TimeRange) => void }) {
  const times = [...new Set(data.series.flatMap((series) => series.data.map(([time]) => time)))].sort((a, b) => a - b);
  if (times.length === 0) return <ChartMessage>No results found</ChartMessage>;
  const pattern = scaledDateFormat(data.interval.ms);
  const zone = services.timeZone();
  const main = `main-${params.axis_position ?? 'left'}`;
  const axes = new Map<string, XYAxis>();
  // The main axis speaks as its series do when they all speak alike, and in plain numbers otherwise
  const onMain = data.series.filter((item) => !item.series.separate_axis);
  const first = new Set(onMain.map((item) => `${item.series.formatter ?? ''}|${item.series.value_template ?? ''}`)).size === 1 ? onMain[0] : undefined;
  const anyPercent = data.series.some((series) => series.series.stacked === 'percent');
  axes.set(main, {
    id: main,
    position: params.axis_position === 'right' ? 'right' : 'left',
    show: true,
    showLabels: true,
    scale: params.axis_scale === 'log' ? 'log' : 'linear',
    mode: anyPercent ? 'percentage' : 'normal',
    min: params.axis_min === undefined || params.axis_min === '' ? undefined : number(params.axis_min, 0),
    max: params.axis_max === undefined || params.axis_max === '' ? undefined : number(params.axis_max, 0),
    tickCount: 5,
    exact: true,
    format: first ? seriesFormatter(first.series.formatter, first.series.value_template) : seriesFormatter('0.[00]a', undefined),
  });
  // A part of a split its series gave no colour takes the colour of its name, as on every chart
  const named = assignColors(data.series.filter((item) => !item.color).map((item) => item.label));
  const colorOf = (item: TsvbSeriesData) => item.color || named.get(item.label) || SERIES_COLORS[0];
  // A series with no name, or set so, is drawn but left out of the legend
  const hideInLegend = (item: TsvbSeriesData) => Boolean(item.series.hide_in_legend) || item.label === '';
  const series: XYSeries[] = data.series.map((item) => {
    const own = item.series.separate_axis ? `own-${item.seriesId}` : main;
    if (!axes.has(own)) {
      axes.set(own, {
        id: own,
        position: item.series.axis_position === 'left' ? 'left' : 'right',
        show: true,
        showLabels: true,
        min: item.series.axis_min === undefined || item.series.axis_min === '' ? undefined : number(item.series.axis_min, 0),
        max: item.series.axis_max === undefined || item.series.axis_max === '' ? undefined : number(item.series.axis_max, 0),
        tickCount: 5,
        exact: true,
        format: (value) => item.format(value),
      });
    }
    const bar = item.series.chart_type === 'bar';
    const { band } = item;
    if (band) {
      // A band is an area, or bars, from its lower values up to its values, with no line and no
      // points, never stacked; it is not drawn where either value is missing
      return {
        id: item.id,
        label: item.label,
        color: colorOf(item),
        hideInLegend: hideInLegend(item),
        type: bar ? 'histogram' : 'area',
        mode: 'normal',
        axisId: own,
        interpolate: 'linear',
        showCircles: false,
        drawLines: false,
        fillOpacity: Math.min(1, Math.max(0, band.fill)),
        band: { upper: band.upper, lower: band.lower },
        points: item.data.map(([time, value, lower]) => ({ x: time, y: lower === null || lower === undefined ? null : value, y0: lower ?? null })),
      };
    }
    const stacked = item.series.stacked && item.series.stacked !== 'none';
    return {
      id: item.id,
      label: item.label,
      color: colorOf(item),
      hideInLegend: hideInLegend(item),
      type: bar ? 'histogram' : number(item.series.fill, 0) > 0 || stacked ? 'area' : 'line',
      mode: stacked ? 'stacked' : 'normal',
      axisId: own,
      interpolate: item.series.steps ? 'step-after' : 'linear',
      showCircles: number(item.series.point_size, 0) > 0,
      drawLines: number(item.series.line_width, 1) > 0,
      lineWidth: Math.max(1, number(item.series.line_width, 1)),
      fillOpacity: Math.min(1, number(item.series.fill, 0)),
      pointSize: number(item.series.point_size, 0) > 0 ? Math.max(1.5, number(item.series.point_size, 0) + 1) : undefined,
      points: item.data.map(([time, value]) => ({ x: time, y: value })),
    };
  });
  const position = (['top', 'bottom', 'left', 'right'].includes(params.legend_position ?? '') ? params.legend_position : 'right') as LegendPosition;
  return (
    <XYChart
      series={series}
      axes={[...axes.values()]}
      x={{
        type: 'time',
        values: times,
        interval: data.interval.ms,
        domain: [data.range.from.getTime(), data.range.to.getTime()],
        format: (value) => formatDate(new Date(value as number), pattern, zone),
        // The product's tooltip names the time alone
        tooltipFormat: (value) => formatDate(new Date(value as number), pattern, zone),
        title: perInterval(data.interval.ms),
      }}
      // The product's bars take the whole of their bucket
      fillBuckets
      legend={params.show_legend === 0 ? false : position}
      legendValues={Object.fromEntries(
        data.series.map((item): [string, string | [string, string]] => [item.id, item.band ? [lastText(item, data.series), lowerText(item)] : lastText(item, data.series)])
      )}
      grid={{ value: params.show_grid !== 0, category: false }}
      annotations={data.annotations.flatMap(({ annotation, marks }) =>
        marks.map((mark) => ({
          x: mark.time,
          color: annotation.color,
          label: mark.text || formatDate(new Date(mark.time), 'MMM D, YYYY @ HH:mm:ss', zone),
          icon: annotationIcon(annotation.icon),
        }))
      )}
      onBrush={onTimeChange ? (from, to) => onTimeChange({ from: new Date(from).toISOString(), to: new Date(to).toISOString() }) : undefined}
      testId="tsvbChart"
    />
  );
}

const darkTheme = (): boolean => services.uiSettings.get<boolean>('theme:darkMode', false) === true;

/** An element's size as the product reads it to place a box, in whole pixels before any transform */
function useClientSize<T extends HTMLElement>(): [(element: T | null) => void, BoxSize] {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<BoxSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return undefined;
    const measure = () =>
      setSize((current) =>
        current.width === element.clientWidth && current.height === element.clientHeight
          ? current
          : { width: element.clientWidth, height: element.clientHeight }
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size];
}

/** The style of a box laid over a panel, hidden until both are measured */
const placed = (placement: Placement | null): CSSProperties => (placement ? placedStyle(placement) : { visibility: 'hidden' });

/** The colour rule of a metric's panel: the last one its first series' last value meets, 0 without one */
const metricRule = (params: TsvbParams, data: TsvbData) => ruleFor(params.background_color_rules, data.series[0]?.last ?? 0);

/** The background of a metric's panel: that of its colour rule, or the panel's own */
const metricBackground = (params: TsvbParams, data: TsvbData): string | undefined =>
  metricRule(params, data)?.background_color || params.background_color || undefined;

/**
 * A metric as the product draws it: its label at half the size of its value, a second series at
 * a third and the name of its part at a quarter, in a box the size of its text, scaled to the
 * largest size that fits the panel and laid in its middle
 */
function Metric({ params, data, extra }: { params: TsvbParams; data: TsvbData; extra?: string }) {
  const [panelRef, panel] = useClientSize<HTMLDivElement>();
  const [innerRef, inner] = useClientSize<HTMLDivElement>();
  const [primary, secondary] = data.series;
  const color = metricRule(params, data)?.color || undefined;
  const inverted = isInverted(metricBackground(params, data), darkTheme());
  return (
    <div className={`visTsvbMetric${inverted ? ' visTsvbMetric--reversed' : ''}`} data-test-subj="tsvbMetric">
      <div ref={panelRef} className="visTsvbMetric__resize">
        <div ref={innerRef} className="visTsvbMetric__inner" style={placed(placeBox(panel, inner))}>
          <div className="visTsvbMetric__primary">
            {primary?.label && <div className="visTsvbMetric__label">{primary.label}</div>}
            <div className="visTsvbMetric__value" style={{ color }} data-test-subj="tsvbMetricValue">
              {primary ? primary.format(primary.last) : 0}
            </div>
          </div>
          {secondary && (
            <div className="visTsvbMetric__secondary">
              {secondary.label && <div className="visTsvbMetric__secondaryLabel">{secondary.label}</div>}
              <div className="visTsvbMetric__secondaryValue">{secondary.format(secondary.last)}</div>
            </div>
          )}
          {extra && <div className="visTsvbMetric__additional">{extra}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * A metric or a gauge, or one of either for each part of its split, each in the frame of a panel
 * with the background it takes
 */
function Splits({
  params,
  data,
  background,
  draw,
}: {
  params: TsvbParams;
  data: TsvbData;
  background: (data: TsvbData) => string | undefined;
  draw: (data: TsvbData, extra?: string) => ReactNode;
}) {
  const parts = splitParts(params, data);
  if (!parts) {
    return (
      <div className="visTsvbFrame" style={{ background: background(data) }}>
        {draw(data)}
      </div>
    );
  }
  return (
    <div className="visTsvbSplit" data-test-subj="tsvbSplitVis">
      {parts.map((part) => (
        <div key={part.key} className="visTsvbSplit__part" style={{ background: background(part.data) }}>
          {draw(part.data, part.label)}
        </div>
      ))}
    </div>
  );
}

/**
 * Goes where a Top N's drilldown address leads for a term: in the product when it is an address
 * of the product, else to the page; an address that cannot be filled in goes nowhere
 */
function drillDown(template: string, key: string) {
  let address: string;
  try {
    address = renderTemplate(template, { key, args: {} }, { strict: true });
  } catch (failure) {
    if (!String(failure).includes('Parse error')) return;
    address = template;
  }
  const target = new URL(address, window.location.href);
  const base = new URL(href('/'), window.location.href).pathname;
  if (target.origin === window.location.origin && target.pathname.startsWith(`${base}app/`)) {
    navigate(`/${target.pathname.slice(base.length)}${target.search}${target.hash}`);
  } else {
    window.location.assign(target.href);
  }
}

/**
 * A Top N as the product draws it: a row for each part, its label (at most a little over a third
 * of the width), a bar as long as its share of the largest, and its value; when the values are
 * both above and below zero, the bars of each run from the middle
 */
function TopN({ params, data }: { params: TsvbParams; data: TsvbData }) {
  const [tableRef, table] = useClientSize<HTMLTableElement>();
  const rows = topNRows(params, data.series);
  const values = rows.map((row) => row.last ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mode = min >= 0 ? 'positive' : max < 0 ? 'negative' : 'mixed';
  const domain = mode === 'mixed' ? Math.max(max, Math.abs(min)) : mode === 'negative' ? Math.abs(min) : max;
  const models = new Map((params.series ?? []).map((model) => [model.id, model]));
  const rules = (params.bar_color_rules ?? []).filter((rule) => rule.bar_color);
  const background = params.background_color || undefined;
  const inverted = isInverted(background, darkTheme());
  return (
    <div className="visTsvbFrame" style={{ background }}>
      <div className={`visTsvbTopN${inverted ? ' visTsvbTopN--reversed' : ''}`} data-test-subj="tsvbTopN">
        <table ref={tableRef} className="visTsvbTopN__table" data-test-subj="tvbVisTopNTable">
          <tbody>
            {rows.map((row) => {
              const value = row.last ?? 0;
              const positive = value >= 0;
              const width = 100 * (Math.abs(value) / domain) || 0;
              const color = ruleFor(rules, value)?.bar_color || row.color || models.get(row.seriesId)?.color;
              const drill = params.drilldown_url;
              return (
                <tr key={row.id || row.label} onClick={drill ? () => drillDown(drill, row.label) : undefined}>
                  <td title={row.label} className="visTsvbTopN__label" style={{ maxWidth: table.width > 0 ? table.width * 0.35 : 150 }}>
                    {row.label}
                  </td>
                  <td width="100%" className="visTsvbTopN__bar">
                    <div className="visTsvbTopN__innerBar" style={mode === 'mixed' ? { [positive ? 'marginLeft' : 'marginRight']: '50%' } : undefined}>
                      <div style={{ backgroundColor: color, width: `${width}%`, float: positive ? 'left' : 'right' }} />
                    </div>
                  </td>
                  <td className="visTsvbTopN__value" data-test-subj="tsvbTopNValue">
                    {row.format(value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The ring of a gauge as the product draws it: its circle, the drawing, the box the drawing sits
// in (as tall as its line, a little taller than the drawing) and the size the product reads it at
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 50;
const GAUGE_TRACK = 'rgba(105,112,125,0.2)';
const GAUGE_RING = {
  half: { svg: [120.72, 78.72], box: [120.72, 81.72], read: { width: 121, height: 82 }, sweep: 0.6 },
  circle: { svg: [120.72, 120.72], box: [120.72, 123.72], read: { width: 121, height: 124 }, sweep: 1 },
} as const;

/**
 * A gauge as the product draws it: its label, value and the name of its part in a box of 100 by
 * 70 (100 by 100 for a circle), and its ring in a box of its own, each scaled to the largest size
 * that fits the panel and laid in its middle, the ring over the text
 */
function Gauge({ params, data, extra }: { params: TsvbParams; data: TsvbData; extra?: string }) {
  const [panelRef, panel] = useClientSize<HTMLDivElement>();
  const series = data.series[0];
  const half = params.gauge_style !== 'circle';
  const ring = GAUGE_RING[half ? 'half' : 'circle'];
  const rule = ruleFor(params.gauge_color_rules, series?.last ?? 0);
  const value = series?.last || 0;
  // Without a maximum of its own, a gauge goes up to the largest value of its series
  const largest = Math.max(...(series?.data ?? []).map(([, y]) => y ?? Number.NEGATIVE_INFINITY));
  const max = number(params.gauge_max, 0) || (Number.isFinite(largest) && largest !== 0 ? largest : 1);
  const share = value < max ? Math.max(0, value / max) : 1;
  const stroke = number(params.gauge_width, 0) || 10;
  const track = number(params.gauge_inner_width, 0) || 2;
  const inverted = isInverted(params.background_color || undefined, darkTheme());
  const label = <div className="visTsvbGauge__label">{series?.label ?? ''}</div>;
  const text = (
    <div className="visTsvbGauge__value" style={{ color: rule?.text || undefined }} data-test-subj="tsvbGaugeValue">
      {series ? series.format(series.last) : 0}
    </div>
  );
  return (
    <div ref={panelRef} className={`visTsvbGauge${inverted ? ' visTsvbGauge--reversed' : ''}`} data-test-subj="tsvbGauge">
      <div className={`visTsvbGauge__metrics${half ? ' visTsvbGauge__metrics--half' : ''}`} style={placed(placeBox(panel, { width: 100, height: half ? 70 : 100 }))}>
        {half ? label : text}
        {half ? text : label}
        {extra && <div className="visTsvbGauge__additional">{extra}</div>}
      </div>
      <div className="visTsvbGauge__rings">
        <div className="visTsvbGauge__ring" style={{ width: ring.box[0], height: ring.box[1], ...placed(placeBox(panel, ring.read)) }}>
          <svg width={ring.svg[0]} height={ring.svg[1]} aria-hidden="true">
            <circle
              r={50}
              cx={60}
              cy={60}
              fill="none"
              stroke={params.gauge_inner_color || GAUGE_TRACK}
              strokeWidth={track}
              strokeDasharray={`${ring.sweep * GAUGE_CIRCUMFERENCE} ${GAUGE_CIRCUMFERENCE}`}
              transform={half ? 'rotate(162 60 60)' : undefined}
            />
            <circle
              r={50}
              cx={60}
              cy={60}
              fill="none"
              stroke={rule?.gauge || series?.color || '#8ac336'}
              strokeWidth={stroke}
              strokeDasharray={`${share * ring.sweep * GAUGE_CIRCUMFERENCE} ${GAUGE_CIRCUMFERENCE}`}
              transform={half ? 'rotate(-197.8 60 60)' : 'rotate(-90 60 60)'}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

const MARKDOWN_ERROR = 'Error processing your markdown';

/**
 * The text of a markdown panel filled in as the product fills it, in strict mode: while it is not
 * well formed (being typed) it shows as written, and a name it has no variable for, or anything
 * else that stops it, is an error the panel shows instead of the text, told apart by the words of
 * the failure as the product tells them apart
 */
function fillMarkdown(markdown: string, variables: Record<string, unknown>): { text?: string; error?: TsvbPanelError } {
  try {
    return { text: renderTemplate(markdown, { _all: variables, ...variables, args: {} }, { strict: true }) };
  } catch (failure) {
    if (String(failure).includes('Parse error')) return { text: markdown };
    const message = failure instanceof Error ? failure.message : String(failure);
    const reason = message.includes('not defined in')
      ? `{{${String(message.split('"')[1])}}} is an unknown variable`
      : 'Please verify you are only using markdown, known variables, and built-in Handlebars expressions';
    return { error: { error: { caused_by: { title: MARKDOWN_ERROR, reason } } } };
  }
}

function MarkdownPanel({ params, data }: { params: TsvbParams; data: TsvbData }) {
  // The panel's custom CSS names it by its id; each drawing of it gets an id of its own instead
  const [elementId] = useState(() => `markdown-${Math.random().toString(36).slice(2)}`);
  const background = params.background_color || undefined;
  if (!params.markdown) return <div className="visTsvbFrame" style={{ background }} />;
  const dateFormat = services.uiSettings.get<string>('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS');
  const variables = convertSeriesToVars(data.series, params, dateFormat, services.timeZone());
  const { text, error } = fillMarkdown(params.markdown, variables);
  const css = params.markdown_css ? params.markdown_css.split(`markdown-${params.id}`).join(elementId) : '';
  const align = params.markdown_vertical_align;
  return (
    <div className="visTsvbFrame" style={{ background }}>
      <div className="visTsvbMarkdown" data-test-subj="tsvbMarkdown">
        {error && <TsvbError error={error} />}
        <style>{css}</style>
        <div
          className={[
            'visTsvbMarkdown__content',
            align === 'middle' || align === 'bottom' ? `visTsvbMarkdown__content--${align}` : '',
            params.markdown_scrollbars ? 'visTsvbMarkdown__content--scroll' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div id={elementId}>{text !== undefined && <Markdown text={text} openLinksInNewTab={Boolean(params.markdown_openLinksInNewTab)} />}</div>
        </div>
      </div>
    </div>
  );
}

/** The sort of a table its UI state keeps, if it keeps one */
function tableSortOf(uiState: Vis['uiState'] | undefined): TsvbTableSort | undefined {
  const table = uiState?.table;
  const sort = table && typeof table === 'object' ? (table as { sort?: unknown }).sort : undefined;
  return sort && typeof sort === 'object' ? (sort as TsvbTableSort) : undefined;
}

/** A column's title, as the product writes it: the series' label or its metric's, with the percentile it shows */
function columnLabel(series: TsvbSeries): string {
  const metric = series.metrics?.[series.metrics.length - 1];
  const label = series.label || metricLabel(series);
  if (metric?.type === 'percentile') return `${label} (${metric.percentiles?.[metric.percentiles.length - 1]?.value || 0})`;
  if (metric?.type === 'percentile_rank') return `${label} (${metric.values?.[metric.values.length - 1] || 0})`;
  return label;
}

function PivotTable({
  params,
  data,
  sort = { column: '_default_', order: 'asc' },
  onSort,
}: {
  params: TsvbParams;
  data: TsvbTableData;
  sort?: TsvbTableSort;
  onSort?: (sort: TsvbTableSort) => void;
}) {
  if (data.rows.length === 0) return <ChartMessage>No results found</ChartMessage>;
  const columns = (params.series ?? []).filter((series) => !series.hidden);
  // The column the rows are sorted by shows an arrow, and the others that could sort them room for
  // one; a click on one sorts by it, or the other way round when it already does, as the product's
  const header = (column: string, label: string, sortable: boolean) => {
    const arrow =
      sort.column === column ? (
        <Icon name={sort.order === 'desc' ? 'sortDown' : 'sortUp'} className="visTsvbTable__sort" />
      ) : sortable ? (
        <span className="visTsvbTable__noSort" />
      ) : null;
    if (!sortable || !onSort) {
      return (
        <>
          {label} {arrow}
        </>
      );
    }
    const order = sort.column === column && sort.order === 'asc' ? 'desc' : 'asc';
    return (
      <button type="button" className="atlTable__sort" onClick={() => onSort({ column, order })}>
        {label} {arrow}
      </button>
    );
  };
  return (
    <div className="visTable" data-test-subj="tsvbTable">
      <div className="visTable__scroll">
        <table className="atlTable atlTable--compact">
          <thead>
            <tr>
              <th>{header('_default_', params.pivot_label || params.pivot_id || '', true)}</th>
              {columns.map((series) => (
                <th key={series.id} className="atlTable__numeric">
                  {header(series.id, columnLabel(series), isSortable(series.metrics?.[series.metrics.length - 1]))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                {columns.map((series) => {
                  const found = row.series.find((item) => item.seriesId === series.id);
                  const color = ruleFor(series.color_rules, found?.last ?? null)?.text;
                  return (
                    <td key={series.id} className="atlTable__numeric" style={{ color }}>
                      {found ? found.format(found.last) : '-'}
                      {found && Number(series.trend_arrows) === 1 && (
                        // The product's arrow: its sort icons, after a space
                        <span className="visTsvbTable__trend">
                          {'  '}
                          <Icon name={slopeOf(found.data) > 0 ? 'sortUp' : 'sortDown'} title={slopeOf(found.data) > 0 ? 'Rising' : 'Falling'} />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoData() {
  return (
    <div className="visError visTsvbNoData" data-test-subj="noTSVBDataMessage">
      <Icon name="visualize" />
      <p>No data to display for the selected metrics</p>
    </div>
  );
}

const PANELS: Record<string, (props: { params: TsvbParams; data: TsvbData; onTimeChange?: (range: TimeRange) => void }) => ReactNode> = {
  timeseries: (props) => <TimeSeries {...props} />,
  metric: ({ params, data }) => (
    <Splits
      params={params}
      data={data}
      background={(part) => metricBackground(params, part)}
      draw={(part, extra) => <Metric params={params} data={part} extra={extra} />}
    />
  ),
  top_n: (props) => <TopN {...props} />,
  gauge: ({ params, data }) => (
    <Splits
      params={params}
      data={data}
      background={() => params.background_color || undefined}
      draw={(part, extra) => <Gauge params={params} data={part} extra={extra} />}
    />
  ),
  markdown: (props) => <MarkdownPanel {...props} />,
};

export function TsvbVis({
  vis,
  input,
  tick,
  uiState,
  onUiState,
  onTimeChange,
  onData,
}: {
  vis: Vis;
  input: VisInput;
  tick?: number;
  /** The panel's UI state, where it differs from the visualization's own (on a dashboard) */
  uiState?: UiState;
  /** Takes the UI state a click on a table's column gives: the table sorted by that column */
  onUiState?: (next: UiState) => void;
  onTimeChange?: (range: TimeRange) => void;
  onData?: (data: { requests: RequestRecord[]; tsvb?: TsvbData | TsvbTableData }) => void;
}) {
  const params = vis.params as TsvbParams;
  const kind = params.type ?? 'timeseries';
  const [data, setData] = useState<{ kind: string; series?: TsvbData; table?: TsvbTableData }>();
  const [error, setError] = useState<TsvbPanelError>();
  const [loading, setLoading] = useState(true);
  const report = useRef(onData);
  report.current = onData;
  const state = uiState ?? vis.uiState;
  const sort = kind === 'table' ? tableSortOf(state) : undefined;
  // A click on a column of a table keeps its sort under `table.sort`, as the product does
  const onSort = onUiState
    ? (next: TsvbTableSort) => onUiState({ ...state, table: { ...(state?.table && typeof state.table === 'object' ? state.table : {}), sort: next } })
    : undefined;

  const key = JSON.stringify([params, input, sort]);
  useEffect(() => {
    // While its editor holds an interval OpenSearch would refuse, the panel is not asked for
    if (params.isModelInvalid) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    const work =
      kind === 'table'
        ? fetchTsvbTable(params, input, controller.signal, sort).then((table) => ({ kind, table, requests: table.requests }))
        : fetchTsvb(params, input, controller.signal).then((series) => ({ kind, series, requests: series.requests }));
    work
      .then((answer) => {
        setData(answer);
        setError(undefined);
        setLoading(false);
        report.current?.({ requests: answer.requests, tsvb: 'series' in answer ? answer.series : answer.table });
      })
      .catch((failure) => {
        if ((failure as Error).name === 'AbortError') return;
        // A request that could not be made (a query in DQL that cannot be read) or that OpenSearch
        // refused is shown in the panel, as the product shows it, and nowhere else
        setError(panelError(failure));
        setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  let body: ReactNode = null;
  if (params.isModelInvalid) body = <NoData />;
  else if (error) {
    body = (
      <div className="visTsvbFrame">
        <TsvbError error={error} />
      </div>
    );
  } else if (data && data.kind === kind) {
    // A panel none of whose series drew anything says so, whatever its kind
    if (kind === 'table' ? !data.table?.rows.length : !data.series?.series.length) body = <NoData />;
    else if (kind === 'table' && data.table) body = <PivotTable params={params} data={data.table} sort={sort} onSort={onSort} />;
    else if (data.series && PANELS[kind]) body = PANELS[kind]({ params, data: data.series, onTimeChange });
    else body = <ChartMessage>This kind of TSVB panel is not drawn by this build.</ChartMessage>;
  }
  return (
    <>
      {loading && <div className="atlProgress visRoot__progress" />}
      {body}
    </>
  );
}
