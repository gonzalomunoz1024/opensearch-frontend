/* SPDX-License-Identifier: Apache-2.0 */

/* Tag cloud: the values of a field as words, each as large as its measure. */

import { useMemo } from 'react';
import { ChartMessage, ChartTooltip, ordinalColors, textWidth, useSize, useTooltip } from '../charts/core';
import { bucketFilter } from '../lib/aggs';
import { bucketColumns, metricColumns, numberOf, type VisRenderProps } from './types';

interface TagCloudParams {
  scale?: 'linear' | 'log' | 'square root';
  orientation?: 'single' | 'right angled' | 'multiple';
  minFontSize?: number;
  maxFontSize?: number;
  showLabel?: boolean;
}

interface Word {
  text: string;
  key: unknown;
  value: number;
  size: number;
  rotate: number;
}

interface Placed extends Word {
  x: number;
  y: number;
}

// The same word leans the same way every time it is drawn
function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) >>> 0;
  return value;
}

const ANGLES = [-60, -30, 0, 30, 60];

/** Places words from the middle outwards along a spiral, where they overlap nothing placed before */
export function layoutCloud(words: Word[], width: number, height: number): { placed: Placed[]; skipped: number } {
  const boxes: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  const placed: Placed[] = [];
  let skipped = 0;
  const stretch = height === 0 ? 1 : width / height;
  for (const word of [...words].sort((a, b) => b.size - a.size)) {
    const long = textWidth(word.text, word.size, 400) + 4;
    const tall = word.size * 1.05;
    const angle = (word.rotate * Math.PI) / 180;
    const boxWidth = Math.abs(long * Math.cos(angle)) + Math.abs(tall * Math.sin(angle));
    const boxHeight = Math.abs(long * Math.sin(angle)) + Math.abs(tall * Math.cos(angle));
    let done = false;
    for (let step = 0; step < 4000 && !done; step += 1) {
      const turn = step * 0.22;
      const reach = 1.6 * turn;
      const x = width / 2 + reach * Math.cos(turn) * stretch;
      const y = height / 2 + reach * Math.sin(turn);
      const box = { left: x - boxWidth / 2, top: y - boxHeight / 2, right: x + boxWidth / 2, bottom: y + boxHeight / 2 };
      if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height) {
        if (reach > Math.max(width, height)) break;
        continue;
      }
      if (boxes.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
      boxes.push(box);
      placed.push({ ...word, x, y });
      done = true;
    }
    if (!done) skipped += 1;
  }
  return { placed, skipped };
}

export function TagCloudVis({ vis, data, uiState, onFilter }: VisRenderProps) {
  const params = vis.params as TagCloudParams;
  const { table, context } = data;
  const [ref, size] = useSize<HTMLDivElement>();
  const tip = useTooltip();
  const bucket = bucketColumns(table)[0];
  const metric = metricColumns(table)[0];

  const words = useMemo(() => {
    if (!bucket || !metric) return [];
    const raw = table.rows
      .map((row) => ({ key: row[bucket.id], text: bucket.format(row[bucket.id]), value: numberOf(row, metric) ?? 0 }))
      .filter((word) => word.text !== '');
    const values = raw.map((word) => word.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const scale = (value: number) => {
      if (max === min) return 1;
      if (params.scale === 'log') return (Math.log(Math.max(value, 1e-9)) - Math.log(Math.max(min, 1e-9))) / (Math.log(max) - Math.log(Math.max(min, 1e-9)));
      if (params.scale === 'square root') return (Math.sqrt(value) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
      return (value - min) / (max - min);
    };
    const smallest = params.minFontSize ?? 18;
    const largest = params.maxFontSize ?? 72;
    return raw.map((word) => ({
      ...word,
      size: smallest + (largest - smallest) * Math.max(0, Math.min(1, scale(word.value))),
      rotate:
        params.orientation === 'right angled' ? (hash(word.text) % 2 === 0 ? 0 : 90) : params.orientation === 'multiple' ? ANGLES[hash(word.text) % ANGLES.length] : 0,
    }));
  }, [table, bucket, metric, params.scale, params.minFontSize, params.maxFontSize, params.orientation]);

  const labelHeight = params.showLabel ? 22 : 0;
  const layout = useMemo(() => {
    const height = Math.max(0, size.height - labelHeight);
    // Words that are too large for the room shrink together until the largest fits
    let factor = 1;
    const widest = Math.max(1, ...words.map((word) => textWidth(word.text, word.size, 400) + 8));
    if (size.width > 0 && widest > size.width) factor = size.width / widest;
    let result = layoutCloud(words.map((word) => ({ ...word, size: word.size * factor })), size.width, height);
    for (let attempt = 0; attempt < 4 && result.skipped > 0 && size.width > 0; attempt += 1) {
      factor *= 0.8;
      result = layoutCloud(words.map((word) => ({ ...word, size: word.size * factor })), size.width, height);
    }
    return result;
  }, [words, size.width, size.height, labelHeight]);

  if (words.length === 0) return <ChartMessage>No results found</ChartMessage>;
  // Each word takes the next colour of the palette, the largest first
  const colors = ordinalColors(words.map((word) => word.text), uiState.vis?.colors);

  return (
    <div ref={ref} className="visTagCloud" data-test-subj="visChart">
      {size.width > 0 && size.height > 0 && (
        <svg width={size.width} height={size.height - labelHeight} role="img" aria-label={vis.title || 'Tag cloud'}>
          {layout.placed.map((word) => (
            <text
              key={word.text}
              x={word.x}
              y={word.y}
              dy="0.35em"
              textAnchor="middle"
              fontSize={word.size}
              fontWeight={400}
              fill={colors.get(word.text)}
              transform={word.rotate ? `rotate(${word.rotate} ${word.x} ${word.y})` : undefined}
              style={{ cursor: onFilter ? 'pointer' : undefined }}
              data-test-subj="tagCloudWord"
              onMouseMove={(event) =>
                tip.show({ x: event.clientX, y: event.clientY, rows: [{ label: word.text, value: metric ? metric.format(word.value) : String(word.value) }] })
              }
              onMouseLeave={tip.hide}
              onClick={() => {
                const filter = bucket ? bucketFilter(bucket, word.key, context) : undefined;
                if (filter && onFilter) onFilter([filter]);
              }}
            >
              {word.text}
            </text>
          ))}
        </svg>
      )}
      {params.showLabel && bucket && metric && (
        <div className="visTagCloud__label">
          {bucket.name} - {metric.name}
        </div>
      )}
      <ChartTooltip content={tip.content} />
    </div>
  );
}
