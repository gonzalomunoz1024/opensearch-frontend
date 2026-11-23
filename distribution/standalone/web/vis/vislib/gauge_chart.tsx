/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The gauges of a chart as vislib lays them out (its gauge layout and GaugeChart): in the chart's
 * room, centred on a line or one under the other, each in an SVG of its own, with the name of the
 * measure, or of the chart in a split, under them. A split puts its charts side by side in
 * columns or one under another in rows, five pixels apart, with one legend for them all and no
 * title beside them. Pointing at a gauge's value shows its tooltip; pointing at a range in the
 * legend dims the gauges whose value is in another, in every chart. A gauge is not clicked on.
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSize } from '../../charts/core';
import { drawMeter, gaugeSize, type MeterConfig } from './gauge';
import { VisLegend, type VisLegendProps } from './legend';
import { SplitCharts } from './split';
import { measureText } from './text';
import { VislibTooltip, type Placement, type TooltipDetail, type TooltipState } from './tooltip';

export interface GaugeSeries {
  /** The series' name, as vislib names it */
  label: string;
  y: number | null;
  /** Writes its value, by its format */
  format: (value: number | null) => string;
  /** The rows of its tooltip */
  details: TooltipDetail[];
}

/** The gauges of one chart and the name under them */
export interface GaugeChartPart {
  series: GaugeSeries[];
  title: string;
}

export interface GaugeChartProps {
  config: MeterConfig;
  /** The chart, or the charts of a split */
  charts: GaugeChartPart[];
  /** In a split, whether its charts are rows, one under another, or columns side by side */
  rows?: boolean;
  /** The names of the ranges, which the legend lists */
  labels: string[];
  colorOf: (label: string) => string;
  addTooltip: boolean;
  dimming: number;
  legend?: Omit<VisLegendProps, 'labels' | 'colorOf' | 'opacityOf' | 'onHighlight'>;
}

interface Hover {
  label?: string;
  touched: boolean;
}

/** A gauge's text, drawn as MeterGauge writes it: centred on its height, shown or left out */
const textStyle = (hidden: boolean, large = false): CSSProperties => ({
  dominantBaseline: 'central',
  textAnchor: 'middle',
  ...(large ? { fontSize: '2em' } : {}),
  display: hidden ? 'none' : 'initial',
});

interface GaugeCanvasProps extends Pick<GaugeChartProps, 'config' | 'colorOf' | 'addTooltip'>, GaugeChartPart {
  opacityOf: (label: string) => number | undefined;
  onUnhighlight: () => void;
  onTooltip: (state: TooltipState | undefined) => void;
}

/** The gauges of a chart in its room */
function GaugeCanvas({ config, series, title, colorOf, addTooltip, opacityOf, onUnhighlight, onTooltip }: GaugeCanvasProps) {
  const [chartRef, size] = useSize<HTMLDivElement>();

  const drawn = useMemo(() => {
    // The room as the chart's clientWidth and clientHeight give it
    const width = Math.round(size.width);
    const height = Math.round(size.height);
    if (!width || !height || !config.colorsRange.length) return undefined;
    const dims = gaugeSize(config.alignment, width, height, series.length);
    if (dims.width < 0 || dims.height < 0) return undefined;
    const element = chartRef.current;
    const base = element ? parseFloat(getComputedStyle(element).fontSize) || 14 : 14;
    const measure = (text: string, large: boolean) => measureText(text, { size: `${large ? base * 2 : base}px` }).width;
    return {
      ...dims,
      gauges: series.map((item) =>
        drawMeter({ config, y: item.y, label: item.label, width: dims.width, height: dims.height, format: item.format, colorOf, measure })
      ),
    };
  }, [size, config, series, colorOf, chartRef]);

  const outline = config.outline ? 'visGauge__meter--outline' : undefined;
  return (
    <div className="chart" ref={chartRef} style={{ textAlign: 'center', overflowY: 'auto' }}>
      {drawn?.gauges.map((gauge, index) => {
        const item = series[index];
        return (
          <svg key={index} style={{ display: 'inline-block', overflow: 'hidden' }} focusable="false" width={drawn.width} height={drawn.height}>
            <g transform={gauge.transform}>
              <g data-label={gauge.holderLabel} style={{ opacity: opacityOf(gauge.holderLabel) }}>
                <path d={gauge.background} className={outline} style={{ fill: config.style.bgFill }} />
                <path
                  d={gauge.value}
                  className={outline}
                  style={{ fill: gauge.valueColor }}
                  onMouseOut={onUnhighlight}
                  onMouseMove={
                    addTooltip ? (event) => onTooltip({ clientX: event.clientX, clientY: event.clientY, details: item.details }) : undefined
                  }
                  onMouseLeave={() => onTooltip(undefined)}
                />
                <text className="chart-label" y={-5} style={textStyle(gauge.valueText.hidden, true)}>
                  {gauge.valueText.text}
                </text>
              </g>
              {gauge.label && (
                <text className="chart-label" y={-30} style={textStyle(gauge.label.hidden)}>
                  {gauge.label.text}
                </text>
              )}
              {gauge.subText && (
                <text className="chart-label" y={20} style={textStyle(gauge.subText.hidden)}>
                  {gauge.subText.text}
                </text>
              )}
              {gauge.scale && (
                <g>
                  {gauge.scale.arcs.map((arc, at) => (
                    <path key={at} d={arc.d} style={{ stroke: arc.color, fill: arc.color }} />
                  ))}
                  {gauge.scale.ticks.map((tick, at) => (
                    <line
                      key={`tick${at}`}
                      x1={tick.x1}
                      x2={tick.x2}
                      y1={tick.y1}
                      y2={tick.y2}
                      style={{ strokeWidth: config.scale.width, stroke: tick.color }}
                    />
                  ))}
                </g>
              )}
            </g>
          </svg>
        );
      })}
      {drawn && (
        <div className="chart-title" style={{ textAlign: 'center' }}>
          {title}
        </div>
      )}
    </div>
  );
}

export function GaugeChart({ config, charts, rows, labels, colorOf, addTooltip, dimming, legend }: GaugeChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>({ touched: false });
  const [tooltip, setTooltip] = useState<TooltipState>();
  const placement = useRef<Placement | undefined>(undefined);

  const highlight = useCallback((label: string | undefined) => {
    setHover((current) => (label === undefined ? { touched: current.touched || current.label !== undefined } : { label, touched: true }));
  }, []);
  // Pointing at a gauge lights up nothing, but leaving it puts every opacity back
  const unhighlight = useCallback(() => setHover({ touched: true }), []);
  const opacityOf = (label: string): number | undefined => {
    if (hover.label !== undefined) return hover.label === label ? 1 : dimming;
    return hover.touched ? 1 : undefined;
  };
  // The tooltip keeps its side over all the charts of a split, until the pointer leaves the wrapper
  const onLeave = useCallback(() => (placement.current = undefined), []);

  const canvases = charts.map((chart, index) => (
    <GaugeCanvas
      key={index}
      config={config}
      series={chart.series}
      title={chart.title}
      colorOf={colorOf}
      addTooltip={addTooltip}
      opacityOf={opacityOf}
      onUnhighlight={unhighlight}
      onTooltip={setTooltip}
    />
  ));

  const legendPosition = legend?.position;
  return (
    <div className={`visLib${legendPosition ? ` visLib--legend-${legendPosition}` : ''}`} data-test-subj="visLib">
      <div className="visLib__chart">
        <div className="visWrapper" ref={wrapperRef} data-test-subj="visChart" onMouseLeave={onLeave}>
          <div className="visAxis__splitTitles--y" />
          <div className="visWrapper__column">
            {rows === undefined ? <div className="visWrapper__chart">{canvases}</div> : <SplitCharts rows={rows}>{canvases}</SplitCharts>}
            <div className="visWrapper__alerts" />
            <div className="visAxis__splitTitles--x" />
          </div>
        </div>
      </div>
      <div className="visLib__legend">
        {legend ? <VisLegend {...legend} labels={labels} colorOf={colorOf} opacityOf={opacityOf} onHighlight={highlight} /> : null}
      </div>
      <VislibTooltip state={tooltip} container={() => wrapperRef.current} placement={placement} />
    </div>
  );
}
