/* SPDX-License-Identifier: Apache-2.0 */

/* TSVB: series over time as a chart, or their latest values as a number, bars, a gauge, text or a table. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChartMessage, fitText, readableOn, useSize, type LegendPosition } from '../../charts/core';
import { XYChart, type XYAxis, type XYSeries } from '../../charts/xy';
import { Icon } from '../../components/icon';
import { formatDate, scaledDateFormat, type TimeRange } from '../../lib/dates';
import { Markdown } from '../../lib/markdown';
import { renderTemplate, TemplateError } from '../../lib/template';
import type { Vis } from '../../lib/vis';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import type { RequestRecord } from '../../services/search';
import type { VisInput } from '../request';
import {
  fetchTsvb,
  fetchTsvbTable,
  ruleFor,
  seriesFormatter,
  type TsvbData,
  type TsvbParams,
  type TsvbTableData,
} from './data';
import { TsvbError, type TsvbPanelError } from './error';
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

/** The latest value of a series as its legend shows it: its share of the stack when the stack is of shares */
function lastText(item: TsvbData['series'][number], all: TsvbData['series']): string {
  if (item.series.stacked !== 'percent') return item.format(item.last);
  const total = all.filter((other) => other.series.stacked === 'percent').reduce((sum, other) => sum + Math.abs(other.last ?? 0), 0);
  return seriesFormatter('percent', item.series.value_template)(total === 0 ? 0 : (item.last ?? 0) / total);
}

/** Whether the values of a series rise or fall over its time: the slope of the line that fits them best */
function slopeOf(data: Array<[number, number | null]>): number {
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
  return below === 0 ? 0 : above / below;
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
    const stacked = item.series.stacked && item.series.stacked !== 'none';
    return {
      id: item.id,
      label: item.label,
      color: item.color,
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
        title: perInterval(data.interval.ms),
      }}
      legend={params.show_legend === 0 ? false : position}
      legendValues={Object.fromEntries(data.series.map((item) => [item.id, lastText(item, data.series)]))}
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

function Metric({ params, data }: { params: TsvbParams; data: TsvbData }) {
  const [primary, secondary] = data.series;
  if (!primary) return <ChartMessage>No results found</ChartMessage>;
  const rule = ruleFor(params.background_color_rules, primary.last);
  const background = rule?.background_color ?? params.background_color;
  const color = rule?.color ?? (background ? readableOn(background) : undefined);
  return (
    <div className="visTsvbMetric" style={{ background, color }} data-test-subj="tsvbMetric">
      <div className="visTsvbMetric__label">{primary.label}</div>
      <div className="visTsvbMetric__value" data-test-subj="tsvbMetricValue">
        {primary.format(primary.last)}
      </div>
      {secondary && (
        <div className="visTsvbMetric__secondary">
          <span>{secondary.label}</span> <strong>{secondary.format(secondary.last)}</strong>
        </div>
      )}
    </div>
  );
}

function TopN({ params, data }: { params: TsvbParams; data: TsvbData }) {
  if (data.series.length === 0) return <ChartMessage>No results found</ChartMessage>;
  const max = Math.max(0, ...data.series.map((series) => series.last ?? 0));
  const min = Math.min(0, ...data.series.map((series) => series.last ?? 0));
  const span = max - min || 1;
  return (
    <div className="visTsvbTopN" data-test-subj="tsvbTopN">
      <table>
        <tbody>
          {data.series.map((series) => {
            const value = series.last ?? 0;
            const color = ruleFor(params.bar_color_rules, series.last)?.bar_color ?? series.color;
            return (
              <tr key={series.id}>
                <td className="visTsvbTopN__label" title={series.label}>
                  {series.label}
                </td>
                <td className="visTsvbTopN__bar">
                  <span style={{ width: `${Math.max(0.5, (Math.abs(value) / span) * 100)}%`, background: color }} />
                </td>
                <td className="visTsvbTopN__value">{series.format(series.last)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Gauge({ params, data }: { params: TsvbParams; data: TsvbData }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const series = data.series[0];
  if (!series) return <ChartMessage>No results found</ChartMessage>;
  const half = params.gauge_style !== 'circle';
  const rule = ruleFor(params.gauge_color_rules, series.last);
  const color = rule?.gauge ?? series.color;
  const value = series.last ?? 0;
  const max = number(params.gauge_max, 0) || Math.max(1, value);
  const share = Math.max(0, Math.min(1, value / max));
  // Drawn in a square of 120 with the ring's middle 50 from the centre, as TSVB draws it, so
  // that the widths a panel was saved with mean what they meant
  const stroke = number(params.gauge_width, 10);
  const track = number(params.gauge_inner_width, 10);
  const radius = 50;
  const edge = Math.max(stroke, track) / 2;
  const sweep = half ? 0.6 : 1;
  const start = half ? -Math.PI * sweep : 0;
  const arc = (portion: number) => {
    const end = start + Math.PI * 2 * sweep * Math.min(portion, 0.9999);
    const point = (angle: number) => `${60 + radius * Math.sin(angle)},${60 - radius * Math.cos(angle)}`;
    return `M${point(start)}A${radius},${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(end)}`;
  };
  const height = half ? 60 + radius * Math.cos(Math.PI * (1 - sweep)) + edge + 2 : 120;
  const scale = Math.max(0.1, Math.min(size.width / 120, size.height / height));
  const text = series.format(series.last);
  return (
    <div ref={ref} className="visTsvbGauge" data-test-subj="tsvbGauge">
      {size.width > 0 && (
        <svg width={120 * scale} height={height * scale} viewBox={`0 0 120 ${height}`} role="img" aria-label={`${series.label}: ${text}`}>
          <path d={arc(1)} fill="none" stroke={params.gauge_inner_color || 'var(--chart-band)'} strokeWidth={track} />
          {share > 0 && <path d={arc(share)} fill="none" stroke={color} strokeWidth={stroke} />}
          <text x={60} y={half ? 62 : 52} textAnchor="middle" fontSize={8} fill="var(--color-text-secondary)">
            {fitText(series.label, (radius - edge) * 1.7, 8)}
          </text>
          <text x={60} y={half ? 79 : 70} textAnchor="middle" fontSize={14} fill={rule?.text ?? 'var(--color-text-primary)'} data-test-subj="tsvbGaugeValue">
            {text}
          </text>
        </svg>
      )}
    </div>
  );
}

const MARKDOWN_ERROR = 'Error processing your markdown';

/**
 * The text of a markdown panel filled in as the product fills it, in strict mode: while it is not
 * well formed (being typed) it shows as written, and a name it has no variable for, or a block it
 * cannot use, is an error the panel shows instead of the text
 */
function fillMarkdown(markdown: string, variables: Record<string, unknown>): { text?: string; error?: TsvbPanelError } {
  try {
    return { text: renderTemplate(markdown, { _all: variables, ...variables, args: {} }, { strict: true }) };
  } catch (failure) {
    if (failure instanceof TemplateError && failure.kind === 'parse') return { text: markdown };
    const reason =
      failure instanceof TemplateError && failure.kind === 'unknown'
        ? `{{${failure.variable}}} is an unknown variable`
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

function PivotTable({ params, data }: { params: TsvbParams; data: TsvbTableData }) {
  if (data.rows.length === 0) return <ChartMessage>No results found</ChartMessage>;
  const columns = (params.series ?? []).filter((series) => !series.hidden);
  return (
    <div className="visTable" data-test-subj="tsvbTable">
      <div className="visTable__scroll">
        <table className="atlTable atlTable--compact">
          <thead>
            <tr>
              <th>{params.pivot_label || params.pivot_id}</th>
              {columns.map((series) => (
                <th key={series.id} className="atlTable__numeric">
                  {series.label || 'Value'}
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
                        <span className="visTsvbTable__trend" aria-label={slopeOf(found.data) > 0 ? 'Rising' : 'Falling'}>
                          {slopeOf(found.data) > 0 ? '↑' : '↓'}
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
  metric: (props) => <Metric {...props} />,
  top_n: (props) => <TopN {...props} />,
  gauge: (props) => <Gauge {...props} />,
  markdown: (props) => <MarkdownPanel {...props} />,
};

export function TsvbVis({
  vis,
  input,
  tick,
  onTimeChange,
  onData,
}: {
  vis: Vis;
  input: VisInput;
  tick?: number;
  onTimeChange?: (range: TimeRange) => void;
  onData?: (data: { requests: RequestRecord[]; tsvb?: TsvbData | TsvbTableData }) => void;
}) {
  const params = vis.params as TsvbParams;
  const kind = params.type ?? 'timeseries';
  const [data, setData] = useState<{ kind: string; series?: TsvbData; table?: TsvbTableData }>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const report = useRef(onData);
  report.current = onData;

  const key = JSON.stringify([params, input]);
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
        ? fetchTsvbTable(params, input, controller.signal).then((table) => ({ kind, table, requests: table.requests }))
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
        setError(errorMessage(failure));
        setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  let body: ReactNode = null;
  if (params.isModelInvalid) body = <NoData />;
  else if (error) {
    body = (
      <div className="visError" role="alert" data-test-subj="visError">
        <strong>This visualization could not be drawn</strong>
        <span>{error}</span>
      </div>
    );
  } else if (data && data.kind === kind) {
    // A panel none of whose series drew anything says so, whatever its kind
    if (kind === 'table' ? !data.table?.rows.length : !data.series?.series.length) body = <NoData />;
    else if (kind === 'table' && data.table) body = <PivotTable params={params} data={data.table} />;
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
