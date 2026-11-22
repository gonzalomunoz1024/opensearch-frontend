/* SPDX-License-Identifier: Apache-2.0 */

/* Gauge and goal: where a measure stands between the ends of its ranges, as an arc or a ring. */

import { ChartMessage, ChartTooltip, assignColors, fitText, rampColor, textWidth, useSize, useTooltip } from '../charts/core';
import { asPercent } from './metric_vis';
import { bucketColumns, metricColumns, numberOf, type VisRenderProps } from './types';

interface Range {
  from: number;
  to: number;
}

interface GaugeParams {
  addTooltip?: boolean;
  gauge?: {
    gaugeType?: 'Arc' | 'Circle';
    percentageMode?: boolean;
    extendRange?: boolean;
    autoExtend?: boolean;
    colorSchema?: string;
    gaugeColorMode?: 'None' | 'Labels' | 'Background';
    colorsRange?: Range[];
    invertColors?: boolean;
    labels?: { show?: boolean };
    scale?: { show?: boolean; labels?: boolean };
    style?: { subText?: string; fontSize?: number; labelColor?: boolean; width?: number; bgWidth?: number };
    alignment?: 'automatic' | 'horizontal' | 'vertical';
  };
}

interface Item {
  key: string;
  label: string;
  value: number | null;
  text: string;
}

const polar = (cx: number, cy: number, radius: number, angle: number) => `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`;

function arc(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  const span = Math.min(end - start, Math.PI * 2 - 0.0001);
  const to = start + span;
  const large = span > Math.PI ? 1 : 0;
  return `M${polar(cx, cy, outer, start)}A${outer},${outer} 0 ${large} 1 ${polar(cx, cy, outer, to)}L${polar(cx, cy, inner, to)}A${inner},${inner} 0 ${large} 0 ${polar(cx, cy, inner, start)}Z`;
}

/*
 * The measures of the gauge are those of OpenSearch Dashboards, so that a saved gauge takes the
 * room and the weight it had there: the same margins around it, the ring a sixth of the radius
 * wide, an arc open over 144 degrees at the bottom, the value in 28 pixel figures a little above
 * the middle, and the name under it all.
 */
// What OpenSearch Dashboards keeps free around a chart of this family inside the room it is given
const INSET = { top: 7, side: 5, bottom: 24 };
const MARGIN = 25;
const VALUE_FONT = 28;
const LABEL_FONT = 14;

function Gauge({
  item,
  config,
  width,
  height,
  onHover,
  onLeave,
}: {
  item: Item;
  config: NonNullable<GaugeParams['gauge']>;
  width: number;
  height: number;
  onHover: (event: React.MouseEvent) => void;
  onLeave: () => void;
}) {
  const circle = config.gaugeType === 'Circle';
  const ranges = config.colorsRange?.length ? config.colorsRange : [{ from: 0, to: 100 }];
  const min = ranges[0].from;
  let max = ranges[ranges.length - 1].to;
  const value = item.value;
  if (value !== null && value > max && (config.extendRange || config.autoExtend)) max = value;
  const shareOf = (at: number) => (max === min ? 0 : Math.max(0, Math.min(1, (at - min) / (max - min))));
  const share = value === null ? 0 : shareOf(value);

  const boxWidth = Math.max(0, width - INSET.side * 2 - MARGIN);
  const boxHeight = Math.max(0, height - INSET.top - INSET.bottom - MARGIN);
  const radius = Math.max(4, (Math.min(boxWidth, boxHeight / (circle ? 1 : 0.75)) / 2) * 0.95);
  const band = radius / 6;
  const pad = (band * (1 - (config.style?.width ?? 0.9))) / 2;
  const backPad = (band * (1 - (config.style?.bgWidth ?? 0.9))) / 2;
  const cx = width / 2;
  const cy = INSET.top + Math.max(boxHeight / 2, radius);
  const start = circle ? 0 : -Math.PI * 0.6;
  const sweep = circle ? Math.PI * 2 : Math.PI * 1.2;
  const angleOf = (at: number) => start + sweep * shareOf(at);

  const bucketOf = (at: number) => {
    const found = ranges.findIndex((range) => at >= range.from && at < range.to);
    return found === -1 ? (at < ranges[0].from ? 0 : ranges.length - 1) : found;
  };
  const colorOf = (at: number) =>
    rampColor(config.colorSchema ?? 'Green to Red', bucketOf(at) / Math.max(ranges.length - 1, 1), Boolean(config.invertColors));
  const color = colorOf(Math.max(min, value ?? min));

  // What fits inside the ring is shown; a value too wide for it goes, and the lines around it with it
  const showScale = Boolean(config.scale?.show);
  const free = (radius - band) * 2 - (showScale ? 16 : -Math.max(pad, backPad) * 2);
  const showValue = textWidth(item.text, VALUE_FONT) < free - 6;
  const small = radius * (circle ? 2 : 1.6) < 70;
  const labels = config.labels?.show !== false && !small;
  const subText = config.style?.subText ?? '';
  const showLabel = labels && textWidth(item.label, LABEL_FONT) <= radius;
  const showSubText = labels && showValue && subText !== '' && textWidth(subText, LABEL_FONT) <= radius;
  const inner = radius - band;

  return (
    <svg width={width} height={height} role="img" aria-label={`${item.label}: ${item.text}`} onMouseMove={onHover} onMouseLeave={onLeave}>
      <path d={arc(cx, cy, inner + backPad, radius - backPad, start, start + sweep)} fill="var(--chart-band)" />
      {share > 0 && <path d={arc(cx, cy, inner + pad, radius - pad, start, start + sweep * share)} fill={color} data-test-subj="gaugeValueArc" />}
      {showScale &&
        ranges.map((range) => (
          <path key={range.from} d={arc(cx, cy, inner, inner + 2, angleOf(range.from), angleOf(range.to))} fill={colorOf(range.from)} />
        ))}
      {showScale &&
        Array.from({ length: 11 }, (_, at) => {
          const tick = min + ((max - min) * at) / 10;
          const angle = angleOf(tick);
          return (
            <line
              key={at}
              x1={cx + inner * Math.sin(angle)}
              y1={cy - inner * Math.cos(angle)}
              x2={cx + (inner - 8) * Math.sin(angle)}
              y2={cy - (inner - 8) * Math.cos(angle)}
              stroke={colorOf(tick)}
              strokeWidth={2}
            />
          );
        })}
      {showLabel && (
        <text x={cx} y={cy - 30} dy="0.35em" textAnchor="middle" fontSize={LABEL_FONT} fill="var(--color-text-secondary)">
          {item.label}
        </text>
      )}
      {showValue && (
        <text x={cx} y={cy - 5} dy="0.35em" textAnchor="middle" fontSize={VALUE_FONT} fill="var(--color-text-secondary)" data-test-subj="gaugeValue">
          {item.text}
        </text>
      )}
      {showSubText && (
        <text x={cx} y={cy + 20} dy="0.35em" textAnchor="middle" fontSize={LABEL_FONT} fill="var(--color-text-secondary)">
          {subText}
        </text>
      )}
      <text x={cx} y={INSET.top + boxHeight + 12} textAnchor="middle" fontSize={LABEL_FONT} fill="var(--color-text-primary)">
        {fitText(item.label, width - 8, LABEL_FONT)}
      </text>
    </svg>
  );
}

export function GaugeVis({ vis, data }: VisRenderProps) {
  const params = vis.params as GaugeParams;
  const config = params.gauge ?? {};
  const { table } = data;
  const [ref, size] = useSize<HTMLDivElement>();
  const tip = useTooltip();
  const metrics = metricColumns(table);
  const bucket = bucketColumns(table)[0];
  const ranges = config.colorsRange?.length ? config.colorsRange : [{ from: 0, to: 100 }];

  const items: Item[] = table.rows.flatMap((row) =>
    metrics.map((metric) => {
      const value = numberOf(row, metric);
      const bucketLabel = bucket ? bucket.format(row[bucket.id]) : undefined;
      return {
        key: `${bucketLabel ?? ''}|${metric.id}`,
        label: bucketLabel === undefined ? metric.name : metrics.length > 1 ? `${bucketLabel} - ${metric.name}` : bucketLabel,
        value,
        text: value === null ? '-' : config.percentageMode ? `${Math.round(asPercent(value, ranges) * 100)}%` : metric.format(value),
      };
    })
  );
  if (items.length === 0) return <ChartMessage>No results found</ChartMessage>;
  // A gauge takes no colour from the palette, but its labels take their place in the page's
  // memory of colours as they do in OpenSearch Dashboards, which the charts beside it then follow
  assignColors(items.map((item) => item.label));

  // Side by side, or one under the other where the room is taller than it is wide
  const count = items.length;
  const upright = config.alignment === 'vertical' || (config.alignment !== 'horizontal' && size.width < size.height);
  const width = Math.floor(upright ? size.width : size.width / count);
  const height = Math.floor(upright ? size.height / count : size.height);

  return (
    <div ref={ref} className="visGauge" data-test-subj="visChart">
      {size.width > 0 &&
        size.height > 0 &&
        items.map((item) => (
          <Gauge
            key={item.key}
            item={item}
            config={config}
            width={width}
            height={height}
            onHover={(event) => {
              if (params.addTooltip !== false) tip.show({ x: event.clientX, y: event.clientY, rows: [{ label: item.label, value: item.text }] });
            }}
            onLeave={tip.hide}
          />
        ))}
      <ChartTooltip content={tip.content} />
    </div>
  );
}
