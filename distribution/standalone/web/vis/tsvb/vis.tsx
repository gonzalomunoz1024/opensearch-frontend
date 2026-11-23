/* SPDX-License-Identifier: Apache-2.0 */

/* TSVB: series over time as a chart, or their latest values as a number, bars, a gauge, text or a table. */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ChartMessage, SERIES_COLORS, assignColors, type LegendPosition } from '../../charts/core';
import { XYChart, type XYAxis, type XYSeries } from '../../charts/xy';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { formatDate, utcOffset, type TimeRange } from '../../lib/dates';
import { Markdown } from '../../lib/markdown';
import type { UiState, Vis } from '../../lib/vis';
import { href, navigate } from '../../router';
import { services } from '../../services';
import type { RequestRecord } from '../../services/search';
import type { VisInput } from '../request';
import { visFailure, type VisFailure } from '../types';
import {
  fetchTsvb,
  fetchTsvbTable,
  MathScriptError,
  TooMuchDataError,
  isSortable,
  metricBackground,
  metricRule,
  ruleFor,
  seriesFormatter,
  splitParts,
  timeAxisPattern,
  topNRows,
  type TsvbData,
  type TsvbParams,
  type TsvbSeries,
  type TsvbSeriesData,
  type TsvbTableData,
  type TsvbTableSort,
} from './data';
import { panelError, TsvbError, type TsvbPanelError } from './error';
import { axisColor, isColor, isInverted, legendColor, placeBox, placedStyle, type BoxSize, type Placement } from './fit';
import { annotationIcon } from './icons';
import { convertSeriesToVars } from './markdown_vars';
import { annotationTexts, replaceVars, type TemplateFault } from './replace_vars';
import { DEFAULT_SORT, PIVOT_COLUMN, columnLabel, nextSort, pivotLabel, rowDisplay, sortIcon, trendIcon } from './table_model';

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

// The grid lines of a TSVB chart, as the product draws them
const GRID_COLOR = 'rgba(125,125,125,0.1)';

/** An end of a TSVB axis: the number set, none when nothing is */
const axisEnd = (value: unknown): number | undefined =>
  value === undefined || value === null || String(value) === '' ? undefined : Number(value);

/** The labels of an axis of shares, as the product writes them: whole percents */
const percentLabel = (value: number): string => {
  const share = Number(value) * 100;
  return `${(Number.isNaN(share) ? 0 : share).toFixed(0)}%`;
};

/** A series with an axis, and a range, of its own: one on a separate axis, or stacked by itself */
const ownGroup = (model: TsvbSeries) => Boolean(model.separate_axis) || model.stacked === 'stacked_within_series';

/**
 * A message in the corner while an annotation's template cannot be filled in, as the product
 * shows one: again only when the reason changes, gone once every template fills in
 */
function useTemplateFault(fault: TemplateFault | undefined) {
  const shown = useRef<{ id: number; reason: string }>();
  useEffect(() => {
    if (fault && shown.current?.reason !== fault.reason) {
      if (shown.current) services.toasts.dismiss(shown.current.id);
      shown.current = { id: services.toasts.danger(fault.title, fault.reason), reason: fault.reason };
    }
    if (!fault && shown.current) {
      services.toasts.dismiss(shown.current.id);
      shown.current = undefined;
    }
  }, [fault]);
}

function TimeSeries({ params, data, onTimeChange }: { params: TsvbParams; data: TsvbData; onTimeChange?: (range: TimeRange) => void }) {
  const zone = services.timeZone();
  const pattern = timeAxisPattern(data.interval.ms);
  // Each mark is named after its latest document, under its time as the chart's tooltip writes it
  let fault: TemplateFault | undefined;
  const annotations = data.annotations.flatMap(({ annotation, marks }) => {
    const named = annotationTexts(annotation.template ?? '', marks);
    fault = named.fault ?? fault;
    return marks.map((mark, index) => ({
      x: mark.time,
      color: annotation.color,
      label: `${formatDate(new Date(mark.time), pattern, zone)}\n${named.texts[index]}`,
      icon: annotationIcon(annotation.icon),
    }));
  });
  useTemplateFault(fault);
  const times = [...new Set(data.series.flatMap((series) => series.data.map(([time]) => time)))].sort((a, b) => a - b);
  if (times.length === 0) return <ChartMessage>No results found</ChartMessage>;
  const models = (params.series ?? []).filter((model) => !model.hidden);
  const axes = new Map<string, XYAxis>();
  // The main axis takes the side of the panel's axis, and is hidden when the first series on it
  // hides its own axis; it speaks as that series when every series has the same formatter, and
  // gives the bare values otherwise
  const firstMain = models.find((model) => !ownGroup(model));
  const sameFormatter = models.every((model) => model.formatter === models[0]?.formatter);
  if (firstMain) {
    axes.set('main', {
      id: 'main',
      position: params.axis_position === 'right' ? 'right' : 'left',
      show: firstMain.axis_position !== 'hidden',
      showLabels: true,
      scale: params.axis_scale === 'log' ? 'log' : 'linear',
      mode: models.some((model) => !ownGroup(model) && model.stacked === 'percent') ? 'percentage' : 'normal',
      min: axisEnd(params.axis_min),
      max: axisEnd(params.axis_max),
      // The range fits the data when no series fills an area under its line
      fitToData: models.every((model) => model.fill === '0'),
      tickCount: 5,
      exact: true,
      format: sameFormatter ? seriesFormatter(firstMain.formatter, firstMain.value_template) : (value) => String(value),
    });
  }
  for (const model of models.filter(ownGroup)) {
    const percent = model.stacked === 'percent';
    axes.set(`own-${model.id}`, {
      id: `own-${model.id}`,
      position: model.axis_position === 'right' || model.axis_position === undefined ? 'right' : 'left',
      show: model.stacked !== 'stacked_within_series' && model.axis_position !== 'hidden',
      showLabels: true,
      scale: model.axis_scale === 'log' ? 'log' : 'linear',
      mode: percent ? 'percentage' : 'normal',
      min: axisEnd(model.axis_min),
      max: axisEnd(model.axis_max),
      fitToData: model.fill === '0',
      tickCount: 5,
      exact: true,
      format: percent ? percentLabel : seriesFormatter(model.formatter, model.value_template),
    });
  }
  // A part of a split its series gave no colour takes the colour of its name, as on every chart
  const named = assignColors(data.series.filter((item) => !item.color).map((item) => item.label));
  const colorOf = (item: TsvbSeriesData) => item.color || named.get(item.label) || SERIES_COLORS[0];
  // A series with no name, or set so, is drawn but left out of the legend
  const hideInLegend = (item: TsvbSeriesData) => Boolean(item.series.hide_in_legend) || item.label === '';
  const series: XYSeries[] = data.series.map((item) => {
    const axisId = ownGroup(item.series) ? `own-${item.seriesId}` : 'main';
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
        axisId,
        interpolate: 'linear',
        showCircles: false,
        drawLines: false,
        fillOpacity: Math.min(1, Math.max(0, band.fill)),
        band: { upper: band.upper, lower: band.lower },
        points: item.data.map(([time, value, lower]) => ({ x: time, y: lower === null || lower === undefined ? null : value, y0: lower ?? null })),
      };
    }
    const stacked = item.series.stacked && item.series.stacked !== 'none';
    const lineWidth = number(item.series.line_width, 1);
    // The points: a ring as wide as the point size round a dot of one pixel, on lines only
    const pointSize = number(item.series.point_size ?? item.series.line_width, 1);
    const points = !bar && pointSize > 0;
    return {
      id: item.id,
      label: item.label,
      color: colorOf(item),
      hideInLegend: hideInLegend(item),
      type: bar ? 'histogram' : number(item.series.fill, 0) > 0 || stacked ? 'area' : 'line',
      mode: stacked ? 'stacked' : 'normal',
      axisId,
      interpolate: item.series.steps ? 'step' : 'linear',
      showCircles: points,
      drawLines: lineWidth > 0,
      lineWidth,
      fillOpacity: Math.min(1, number(item.series.fill, 0)),
      pointSize: points ? 1 : undefined,
      pointStroke: points ? pointSize : undefined,
      points: item.data.map(([time, value]) => ({ x: time, y: value })),
    };
  });
  const position = (['bottom', 'left', 'right'].includes(params.legend_position ?? '') ? params.legend_position : 'right') as LegendPosition;
  const background = params.background_color || undefined;
  // Over a background of its own the axes and the legend take colours that stand out from it,
  // and the points are filled with it
  const colors: Record<string, string> = isColor(background)
    ? { '--cht-elastic-text': axisColor(background), '--cht-elastic-legend': legendColor(background), '--cht-elastic-point': background }
    : {};
  return (
    <div className="visTsvbFrame" style={{ background, ...colors }}>
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
        elastic={{
          offset: (time) => utcOffset(new Date(time), zone),
          histogram: data.series.some((item) => item.series.chart_type === 'bar' && item.series.stacked && item.series.stacked !== 'none'),
          gridColor: GRID_COLOR,
        }}
        legend={params.show_legend === 0 ? false : position}
        legendValues={Object.fromEntries(
          data.series.map((item): [string, string | [string, string]] => [item.id, item.band ? [lastText(item, data.series), lowerText(item)] : lastText(item, data.series)])
        )}
        grid={{ value: params.show_grid !== 0, category: params.show_grid !== 0 }}
        annotations={annotations}
        onBrush={onTimeChange ? (from, to) => onTimeChange({ from: new Date(from).toISOString(), to: new Date(to).toISOString() }) : undefined}
        testId="tsvbChart"
      />
    </div>
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
  const filled = replaceVars(template, {}, { key });
  if ('fault' in filled) return;
  const address = filled.text;
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

// The ring of a gauge as the product draws it: its circle, the size of the drawing and the share
// of the circle it sweeps. The drawing stands in a line of text, so the box around it is as tall
// as that line makes it (a little taller than the drawing, by how much depends on the line-height
// it inherits), and the ring is scaled from the size that box measures, as the product's is.
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 50;
const GAUGE_TRACK = 'rgba(105,112,125,0.2)';
const GAUGE_RING = {
  half: { svg: [120.72, 78.72], sweep: 0.6 },
  circle: { svg: [120.72, 120.72], sweep: 1 },
} as const;

/**
 * A gauge as the product draws it: its label, value and the name of its part in a box of 100 by
 * 70 (100 by 100 for a circle), and its ring in a box of its own, each scaled to the largest size
 * that fits the panel and laid in its middle, the ring over the text
 */
function Gauge({ params, data, extra }: { params: TsvbParams; data: TsvbData; extra?: string }) {
  const [panelRef, panel] = useClientSize<HTMLDivElement>();
  const [ringRef, ringBox] = useClientSize<HTMLDivElement>();
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
        <div ref={ringRef} className="visTsvbGauge__ring" style={placed(placeBox(panel, ringBox))}>
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

/**
 * The text of a markdown panel filled in as the product fills it; what stops it is an error the
 * panel shows instead of the text
 */
function fillMarkdown(markdown: string, variables: Record<string, unknown>): { text?: string; error?: TsvbPanelError } {
  const filled = replaceVars(markdown, {}, { _all: variables, ...variables });
  return 'fault' in filled ? { error: { error: { caused_by: filled.fault } } } : { text: filled.text };
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
  // The text is written in the product's markdown body, in the other theme's colours over a
  // background that reads as the other theme
  const reversed = isInverted(background, darkTheme());
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
            reversed ? 'visTsvbMarkdown__content--reversed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div id={elementId}>
            {text !== undefined && <Markdown className="visMarkdownBody" text={text} openLinksInNewTab={Boolean(params.markdown_openLinksInNewTab)} />}
          </div>
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

/**
 * A table as the product's TSVB draws it, which is its own table and not the data table: a row
 * for each value of the field it groups by, the latest value of each series in a column, an arrow
 * for its trend beside it when the series asks for one. A click on a column's title sorts by it.
 */
function TsvbTable({
  params,
  data,
  sort = DEFAULT_SORT,
  onSort,
}: {
  params: TsvbParams;
  data: TsvbTableData;
  sort?: TsvbTableSort;
  onSort?: (sort: TsvbTableSort) => void;
}) {
  const columns = (params.series ?? []).filter((series) => !series.hidden);
  const dateFormat = services.uiSettings.get<string>('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS');
  const zone = services.timeZone();
  const formatTime = (time: number) => formatDate(new Date(time), dateFormat, zone);
  // What a title needs to sort by its column at a click, and from the keyboard, which the
  // product's titles cannot be reached with
  const sorting = (column: string) => {
    if (!onSort) return {};
    const act = () => onSort(nextSort(sort, column));
    return {
      'aria-sort': sort.column === column ? (sort.order === 'asc' ? ('ascending' as const) : ('descending' as const)) : undefined,
      tabIndex: 0,
      onClick: act,
      onKeyDown: (event: KeyboardEvent<HTMLTableCellElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        act();
      },
    };
  };
  const pivotIcon = sortIcon(sort, PIVOT_COLUMN, true);
  return (
    <div className="visTsvbTable">
      <div className="visTsvbTable__frame" data-test-subj="tableView">
        <table className="visTsvbTable__table" data-test-subj="tsvbTable">
          <thead>
            <tr>
              <th className="visTsvbTable__pivot" scope="col" {...sorting(PIVOT_COLUMN)}>
                {pivotLabel(params)} {pivotIcon && <Icon name={pivotIcon} />}
              </th>
              {columns.map((series) => {
                const sortable = isSortable(series.metrics?.[series.metrics.length - 1]);
                const icon = sortIcon(sort, series.id, sortable);
                const title = (
                  <span>
                    {columnLabel(series)} {icon && <Icon name={icon} />}
                  </span>
                );
                return (
                  <th key={series.id} scope="col" {...(sortable ? sorting(series.id) : {})}>
                    {sortable ? (
                      title
                    ) : (
                      <Tooltip content="This column is not sortable" delay="regular">
                        {title}
                      </Tooltip>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1}>
                  {params.pivot_id ? 'No results available.' : 'No results available. You must choose a group by field for this visualization.'}
                </td>
              </tr>
            ) : (
              data.rows.map((row) => {
                const name = rowDisplay(row.key, params.pivot_type, formatTime);
                const drill = params.drilldown_url;
                const address = drill ? replaceVars(drill, {}, { key: row.key }) : undefined;
                return (
                  <tr key={row.key}>
                    <td>
                      {drill ? (
                        <a
                          href={address && 'text' in address ? address.text : undefined}
                          onClick={(event) => {
                            event.preventDefault();
                            drillDown(drill, row.key);
                          }}
                        >
                          {name}
                        </a>
                      ) : (
                        name
                      )}
                    </td>
                    {row.series.map((item) => {
                      const column = columns.find((series) => series.id === item.seriesId);
                      if (!column) return null;
                      return (
                        <td
                          key={item.seriesId}
                          className="visTsvbTable__value"
                          data-test-subj="tvbTableVis__value"
                          style={{ color: ruleFor(column.color_rules, item.last ?? null)?.text }}
                        >
                          <span>{item.format(item.last)}</span>
                          {Boolean(column.trend_arrows) && (
                            <span>
                              {'\u00a0'} <Icon name={trendIcon(item.data)} className="visTsvbTable__trend" />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoData() {
  return (
    <div className="visError visTsvbNoData" data-test-subj="noTSVBDataMessage">
      {/* The icon stands in a line of the text, a little taller than itself, as the product's does */}
      <div>
        <Icon name="visualize" />
      </div>
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
  onError,
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
  /** Told of a request the panel did not make, as the product's request handler fails: around the panel, which keeps what it drew */
  onError?: (failure: VisFailure | undefined) => void;
}) {
  const params = vis.params as TsvbParams;
  const kind = params.type ?? 'timeseries';
  const [data, setData] = useState<{ kind: string; series?: TsvbData; table?: TsvbTableData }>();
  const [error, setError] = useState<TsvbPanelError>();
  const [loading, setLoading] = useState(true);
  const report = useRef(onData);
  report.current = onData;
  const reportError = useRef(onError);
  reportError.current = onError;
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
        reportError.current?.(undefined);
        report.current?.({ requests: answer.requests, tsvb: 'series' in answer ? answer.series : answer.table });
      })
      .catch((failure) => {
        if ((failure as Error).name === 'AbortError') return;
        setLoading(false);
        // A panel the product would not ask for at all, or whose Math it cannot work out, fails its
        // request, told around the panel (the editor's "Search Error"); a request that could not
        // be made (a query in DQL that cannot be read) or that OpenSearch refused is shown in the
        // panel, and nowhere else
        const request = failure instanceof TooMuchDataError || failure instanceof MathScriptError;
        if (request && reportError.current) reportError.current(visFailure('tsvb', failure));
        else setError(panelError(failure));
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
    else if (kind === 'table' && data.table) body = <TsvbTable params={params} data={data.table} sort={sort} onSort={onSort} />;
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
