/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Discover's histogram: how many documents fell in each stretch of the time range, drawn as
 * OpenSearch Dashboards' chart library draws it (see histogram_scale.ts for the arithmetic). The
 * pointer lights the bucket under it and tells its count; dragging across the chart, or clicking
 * a bar, narrows the time range to what was chosen.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSize } from '../../charts/core';
import { bucketAt, histogramGeometry, LABEL_GAP, LABEL_PADDING, LABEL_SIZE, TITLE_GAP, TITLE_SIZE, type OffsetAt } from './histogram_scale';

export interface HistogramProps {
  /** Each bucket and how many documents fell in it, in time order */
  points: ReadonlyArray<{ x: number; y: number }>;
  /** The time range searched */
  from: number;
  to: number;
  /** The length of a bucket as its interval says (a month is 30 days) */
  intervalMs: number;
  /** The shortest bucket */
  minInterval: number;
  offsetAt: OffsetAt;
  formatX: (value: number) => string;
  xTitle: string;
  yTitle: string;
  /** A stretch of time dragged across, or the bucket of a bar clicked */
  onTimeChange: (from: number, to: number) => void;
}

// The colour of the series: the first of the component library's palette, in its lighter turn
// that the original gives the histogram
const BAR_COLOR = '#79AAD9';
// A drag shorter than this is a click
const MIN_BRUSH = 2;
// The room between the tooltip and the bucket it tells about
const TOOLTIP_GAP = 10;

let measureContext: CanvasRenderingContext2D | null | undefined;

/** A canvas set to the face of the page at a size, to measure text with; none outside a browser */
function contextFor(size: number, weight: 'normal' | 'bold'): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!measureContext) return null;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-family').trim() || 'sans-serif';
  measureContext.font = `normal normal ${weight} ${size}px ${family}`;
  return measureContext;
}

/** The width of a text in the face of the page, at a size */
function measureText(text: string, size: number, weight: 'normal' | 'bold' = 'normal'): number {
  const context = contextFor(size, weight);
  return context ? context.measureText(text).width : text.length * size * 0.6;
}

/**
 * How far under the middle of a line its baseline lies. The original's chart library draws each
 * label from its middle, as a canvas does, which sits a little higher than SVG's "central".
 */
function baselineBelowMiddle(size: number, weight: 'normal' | 'bold' = 'normal'): number {
  const context = contextFor(size, weight);
  if (!context) return size * 0.3;
  context.textBaseline = 'middle';
  const offset = -context.measureText('0').alphabeticBaseline;
  context.textBaseline = 'alphabetic';
  return Number.isFinite(offset) ? offset : size * 0.3;
}

/** A title cut to a length, with an ellipsis, as the original cuts one that does not fit */
function fitTitle(text: string, length: number): string {
  if (measureText(text, TITLE_SIZE, 'bold') <= length) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measureText(`${text.slice(0, middle)}…`, TITLE_SIZE, 'bold') <= length) low = middle;
    else high = middle - 1;
  }
  return low > 0 ? `${text.slice(0, low)}…` : '';
}

interface Hover {
  /** Across and down the plot */
  x: number;
  y: number;
  /** The pointer on the page */
  clientY: number;
}

export function Histogram({ points, from, to, intervalMs, minInterval, offsetAt, formatX, xTitle, yTitle, onTimeChange }: HistogramProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  // The plot's outline, which the bars are cut to, named apart from any other chart's
  const clipId = `dscHistogramClip${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [hover, setHover] = useState<Hover>();
  const [brush, setBrush] = useState<{ start: number; end: number }>();
  const drag = useRef<{ start: number; end: number }>();
  // A drag ends with the button let go over the chart, which is no click on a bar
  const brushed = useRef(false);

  const geometry = useMemo(
    () =>
      size.width > 0 && size.height > 0
        ? histogramGeometry({
            width: size.width,
            height: size.height,
            points,
            from,
            to,
            intervalMs,
            minInterval,
            offsetAt,
            formatX,
            formatY: (value) => `${value}`,
            measure: (text) => measureText(text, LABEL_SIZE),
            hasXTitle: Boolean(xTitle),
            hasYTitle: Boolean(yTitle),
          })
        : undefined,
    [size.width, size.height, points, from, to, intervalMs, minInterval, offsetAt, formatX, xTitle, yTitle]
  );
  const keys = useMemo(() => points.map((point) => point.x), [points]);
  // Measured once the chart has a size, which is once the page's face is known
  const baselines = useMemo(
    () => ({ label: baselineBelowMiddle(LABEL_SIZE), title: baselineBelowMiddle(TITLE_SIZE, 'bold') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(geometry)]
  );

  // Where the pointer is on the plot. The original reads it on whole pixels of the chart (a mouse
  // event's offset), so a drag narrows the time to the same instants here as there.
  const placeOf = (clientX: number, clientY: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !geometry) return { x: 0, y: 0 };
    return { x: Math.round(clientX - box.left) - geometry.plot.left, y: Math.round(clientY - box.top) - geometry.plot.top };
  };

  // A drag goes on until the button is let go, wherever the pointer has gone
  useEffect(() => {
    if (!brush || !geometry) return undefined;
    const clamp = (x: number) => Math.max(0, Math.min(geometry.plot.width, x));
    const onMove = (event: MouseEvent) => {
      if (!drag.current) return;
      drag.current.end = clamp(placeOf(event.clientX, event.clientY).x);
      setBrush({ ...drag.current });
    };
    const onUp = () => {
      const dragged = drag.current;
      drag.current = undefined;
      setBrush(undefined);
      if (!dragged) return;
      const low = Math.min(dragged.start, dragged.end);
      const high = Math.max(dragged.start, dragged.end);
      brushed.current = high - low >= MIN_BRUSH;
      if (brushed.current) onTimeChange(geometry.invert(low), geometry.invert(high));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(brush), geometry, onTimeChange]);

  // While a drag goes on the chart tells nothing about the bucket under the pointer
  const dragging = brush !== undefined && brush.end !== brush.start;
  const inside = hover && geometry && hover.x >= 0 && hover.y >= 0 && hover.x <= geometry.plot.width && hover.y <= geometry.plot.height;
  const bucket = inside && geometry && hover && !dragging ? bucketAt(geometry, hover.x, keys) : undefined;
  const bucketBar = bucket === undefined || !geometry ? undefined : geometry.bars.find((bar) => bar.key === bucket);
  // The bar under the pointer itself, which a click narrows the time range to
  const pointed =
    bucketBar && hover && hover.x >= bucketBar.x && hover.x <= bucketBar.x + bucketBar.width && hover.y >= bucketBar.y && hover.y <= bucketBar.y + bucketBar.height
      ? bucketBar
      : undefined;
  // The room of the bucket under the pointer, kept inside the plot
  let band: { x: number; width: number } | undefined;
  if (bucket !== undefined && geometry) {
    let x = geometry.project(bucket);
    let width = geometry.band;
    if (width > 1 && x + width > geometry.plot.width) width = geometry.plot.width - x;
    else if (width > 1 && x < 0) {
      width += x;
      x = 0;
    }
    band = { x, width };
  }

  if (!geometry) return <div ref={ref} className="dscHistogram__chart" />;
  const { plot } = geometry;
  const nowAt = geometry.nowAt(Date.now());

  const onMouseMove = (event: ReactMouseEvent<SVGRectElement>) => {
    const place = placeOf(event.clientX, event.clientY);
    setHover({ ...place, clientY: event.clientY });
  };
  const onMouseDown = (event: ReactMouseEvent<SVGRectElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    brushed.current = false;
    const { x } = placeOf(event.clientX, event.clientY);
    drag.current = { start: x, end: x };
    setBrush({ start: x, end: x });
  };
  const onClick = (event: ReactMouseEvent<SVGRectElement>) => {
    if (brushed.current) {
      brushed.current = false;
      return;
    }
    const { x, y } = placeOf(event.clientX, event.clientY);
    const target = bucketAt(geometry, x, keys);
    const bar = geometry.bars.find((candidate) => candidate.key === target);
    if (bar && x >= bar.x && x <= bar.x + bar.width && y >= bar.y && y <= bar.y + bar.height) {
      onTimeChange(bar.key, bar.key + intervalMs);
    }
  };

  return (
    <div ref={ref} className="dscHistogram__chart">
      <svg ref={svgRef} className="dscHistogram__svg" width={size.width} height={size.height} role="img" aria-label={`${yTitle} by ${xTitle}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={plot.width} height={plot.height} />
          </clipPath>
        </defs>
        <g transform={`translate(${plot.left},${plot.top})`}>
          {band && <rect className="dscHistogram__band" x={band.x} y={0} width={band.width} height={plot.height} />}
          {geometry.xGrid.map((at, index) => (
            <line key={`x${index}`} className="dscHistogram__grid" x1={at} x2={at} y1={0} y2={plot.height} />
          ))}
          {geometry.yGrid.map((at, index) => (
            <line key={`y${index}`} className="dscHistogram__grid dscHistogram__grid--dashed" x1={0} x2={plot.width} y1={at} y2={at} />
          ))}
          <line className="dscHistogram__axis" x1={0} x2={0} y1={0} y2={plot.height} />
          <line className="dscHistogram__axis" x1={0} x2={plot.width} y1={plot.height} y2={plot.height} />
        </g>
        <g className="dscHistogram__labels">
          {geometry.yTicks.map((tick, index) => (
            <text key={index} x={plot.left - LABEL_GAP} y={plot.top + tick.position + baselines.label} textAnchor="end">
              {tick.label}
            </text>
          ))}
          {geometry.xTicks.map((tick, index) => (
            <text key={index} x={plot.left + tick.position} y={plot.top + plot.height + LABEL_GAP + LABEL_SIZE / 2 + baselines.label} textAnchor="middle">
              {tick.label}
            </text>
          ))}
        </g>
        {xTitle && (
          <text
            className="dscHistogram__title"
            x={plot.left + plot.width / 2}
            y={plot.top + plot.height + LABEL_PADDING + LABEL_SIZE + TITLE_GAP + TITLE_SIZE / 2 + baselines.title}
            textAnchor="middle"
          >
            {fitTitle(xTitle, plot.width)}
          </text>
        )}
        {yTitle && (
          <text
            className="dscHistogram__title"
            transform={`translate(${geometry.yAxisLeft + TITLE_SIZE / 2},${plot.top + plot.height / 2}) rotate(-90)`}
            y={baselines.title}
            textAnchor="middle"
          >
            {fitTitle(yTitle, plot.height)}
          </text>
        )}
        <g transform={`translate(${plot.left},${plot.top})`} clipPath={`url(#${clipId})`}>
          {geometry.bars.map((bar) => (
            <rect key={bar.key} x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={BAR_COLOR} />
          ))}
          {nowAt !== undefined && <line className="dscHistogram__now" x1={nowAt} x2={nowAt} y1={0} y2={plot.height} />}
          {geometry.shades.map((shade, index) => (
            <rect key={index} className="dscHistogram__shade" x={shade.x} y={0} width={shade.width} height={plot.height} />
          ))}
          {pointed && <rect className="dscHistogram__highlight" x={pointed.x} y={pointed.y} width={pointed.width} height={pointed.height} />}
          {brush && dragging && (
            <g className="dscHistogram__brush">
              <rect x={Math.min(brush.start, brush.end)} y={0} width={Math.abs(brush.end - brush.start)} height={plot.height} />
              {/* Its edges a pixel wide, inside it */}
              <line x1={Math.min(brush.start, brush.end) + 0.5} x2={Math.min(brush.start, brush.end) + 0.5} y1={0} y2={plot.height} />
              <line x1={Math.max(brush.start, brush.end) - 0.5} x2={Math.max(brush.start, brush.end) - 0.5} y1={0} y2={plot.height} />
            </g>
          )}
          <rect
            className="dscHistogram__pointer"
            x={0}
            y={0}
            width={plot.width}
            height={plot.height}
            style={{ cursor: pointed ? 'pointer' : 'crosshair' }}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHover(undefined)}
            onMouseDown={onMouseDown}
            onClick={onClick}
          />
        </g>
      </svg>
      {bucketBar && hover && band && svgRef.current && (
        <HistogramTooltip
          title={formatX(bucketBar.key)}
          label={yTitle}
          value={`${bucketBar.count}`}
          band={{
            left: svgRef.current.getBoundingClientRect().left + plot.left + band.x,
            right: svgRef.current.getBoundingClientRect().left + plot.left + band.x + band.width,
          }}
          clientY={hover.clientY}
        />
      )}
    </div>
  );
}

/** The count of the bucket under the pointer, beside it: right of it, or left where there is no room */
function HistogramTooltip({ title, label, value, band, clientY }: { title: string; label: string; value: string; band: { left: number; right: number }; clientY: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    if (!box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    let left = band.right + TOOLTIP_GAP;
    if (left + width > window.innerWidth) left = band.left - TOOLTIP_GAP - width;
    const top = Math.max(0, Math.min(clientY - height / 2, window.innerHeight - height));
    // On whole pixels, as the original's is placed, so that its text is as sharp
    setPlace({ left: Math.round(Math.max(0, left)), top: Math.round(top) });
  }, [band.left, band.right, clientY, title, value]);
  return createPortal(
    <div ref={box} className="dscHistogram__tooltip" role="tooltip" style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}>
      <div className="dscHistogram__tooltipHeader">{title}</div>
      <div className="dscHistogram__tooltipDivider" />
      <div className="dscHistogram__tooltipTable">
        <span className="dscHistogram__tooltipColor" style={{ background: BAR_COLOR }} />
        <span className="dscHistogram__tooltipLabel">{label}</span>
        <span className="dscHistogram__tooltipValue">{value}</span>
      </div>
    </div>,
    document.body
  );
}
