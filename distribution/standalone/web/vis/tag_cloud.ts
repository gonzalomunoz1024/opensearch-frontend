/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The tag cloud of OpenSearch Dashboards 3.9.0 (vis_type_tagcloud: TagCloud and the data of
 * TagCloudVisualization), as it works there: the words of a table's terms, as large as their
 * measure on a linear, log or square root scale and turned as the orientation says, laid out by
 * d3-cloud with a constant seed, drawn into an SVG element and moved, when they are laid out
 * again, over 600 ms. A job at a time: a new size, new data or new options while one is drawn
 * wait for it, and only the last of them is drawn after it. When it is drawn, the cloud says
 * whether all of it is inside its box.
 */

import { cloudLayout, type CloudWord } from './cloud_layout';
import {
  attrTween,
  extent,
  interpolateTransform,
  linearScale,
  logScale,
  sqrtScale,
  styleTween,
  transition,
  type Scale,
} from './tag_cloud_d3';
import type { Table, TableColumn, TableRow } from '../lib/aggs';

export type TagCloudScale = 'linear' | 'log' | 'square root';
export type TagCloudOrientation = 'single' | 'right angled' | 'multiple';

export interface TagCloudOptions {
  scale?: TagCloudScale | string;
  orientation?: TagCloudOrientation | string;
  minFontSize?: number;
  maxFontSize?: number;
  showLabel?: boolean;
}

/** The defaults of the tag cloud's options, as its type gives them to a visualization without them */
export const TAG_CLOUD_DEFAULTS: Required<Pick<TagCloudOptions, 'scale' | 'orientation' | 'minFontSize' | 'maxFontSize' | 'showLabel'>> = {
  scale: 'linear',
  orientation: 'single',
  minFontSize: 18,
  maxFontSize: 72,
  showLabel: true,
};

/** A word of the cloud: what a row gives it, and what the layout sets on it */
export interface CloudTag extends CloudWord {
  displayText: string;
  rawText: unknown;
  value: unknown;
  /** The table of its row, which a click on it filters by */
  meta: { data: Table; rowIndex: number };
}

/** The most words a cloud draws: the rest are left out, and the cloud says so */
export const MAX_TAG_COUNT = 200;

/**
 * The words of a table, as TagCloudVisualization makes them: one per row, the row's term (or
 * "all", without a term) written by its column's format, and the row's measure. Undefined when the
 * table has no rows.
 */
export function cloudTags(
  table: Table,
  bucket: TableColumn | undefined,
  metric: TableColumn | undefined,
  write: (column: TableColumn, value: unknown) => string
): { tags: CloudTag[]; truncated: boolean } | undefined {
  if (!table.rows.length) return undefined;
  const tags = table.rows.map((row: TableRow, rowIndex) => {
    const value = bucket ? row[bucket.id] : undefined;
    const tag = value === undefined ? 'all' : value;
    return {
      displayText: bucket ? write(bucket, tag) : String(tag),
      rawText: tag,
      value: metric ? row[metric.id] : undefined,
      meta: { data: table, rowIndex },
    };
  });
  if (tags.length > MAX_TAG_COUNT) {
    tags.length = MAX_TAG_COUNT;
    return { tags, truncated: true };
  }
  return { tags, truncated: false };
}

/** A number from 0 to max - 1 for a text, the same for the same text */
export function hashWithinRange(text: unknown, max: number): number {
  const str = JSON.stringify(text) ?? '';
  let hash = 0;
  for (const ch of str) {
    hash = (hash * 31 + ch.charCodeAt(0)) % max;
  }
  return Math.abs(hash) % max;
}

/** The angle of a word for each orientation */
export const ORIENTATIONS: Record<string, (tag: CloudWord) => number> = {
  single: () => 0,
  'right angled': (tag) => hashWithinRange(tag.text, 2) * 90,
  // Fanned out 12 * 15 degrees over the top right and bottom right quarters (-90 degrees from there)
  multiple: (tag) => hashWithinRange(tag.text, 12) * 15 - 90,
};

const SCALES: Record<string, (domain: [unknown, unknown], range: [number, number]) => Scale> = {
  linear: linearScale,
  log: logScale,
  'square root': sqrtScale,
};

/**
 * The font size of a measure: the smallest size for the least measure and the largest for the
 * greatest, the largest for a single word, on the scale the options name
 */
export function textSizeMapper(scale: string, words: Array<{ value: unknown }>, minFontSize: number, maxFontSize: number): Scale {
  const range: [number, number] = words.length === 1 ? [maxFontSize, maxFontSize] : [minFontSize, maxFontSize];
  const make = SCALES[scale];
  if (!make) throw new TypeError(`${scale} is not a scale of a tag cloud`);
  return make(extent(words, (word) => word.value), range);
}

/** Where a word is drawn: its place from the layout around the middle of the box, or far out of it without one */
export function positionWord(xTranslate: number, yTranslate: number, word: CloudWord): string {
  if (Number.isNaN(Number(word.x)) || Number.isNaN(Number(word.y)) || Number.isNaN(Number(word.rotate))) {
    // Move off-screen
    return `translate(${xTranslate * 3}, ${yTranslate * 3})rotate(0)`;
  }
  return `translate(${Number(word.x) + xTranslate}, ${Number(word.y) + yTranslate})rotate(${word.rotate})`;
}

/** The constant seed of the layout, so that the same data is always laid out the same */
const seed = () => 0.5;

interface Job {
  refreshLayout: boolean;
  size: [number, number];
  words: CloudTag[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export const TAG_CLOUD_STATUS = { COMPLETE: 0, INCOMPLETE: 1 } as const;

/** The tag cloud in an element of the page, which it fills with an SVG element of its words */
export class TagCloud {
  private readonly element: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly group: SVGGElement;
  private readonly size: [number, number] = [1, 1];
  private readonly colorScale: (value: unknown) => string;
  /** The word each text element draws, as d3 keeps it on the element */
  private readonly data = new WeakMap<Element, CloudTag>();
  private readonly listeners: { select: Array<(tag: CloudTag) => void>; renderComplete: Array<() => void> } = {
    select: [],
    renderComplete: [],
  };

  // The settings no option changes. The font is named for the layout too, so that the words it
  // measures are the words drawn and do not overlap.
  private readonly fontFamily = 'Inter UI, sans-serif';
  private readonly fontStyle = 'normal';
  private readonly fontWeight = 'normal';
  private readonly spiral = 'archimedean';
  /** The time the layout takes at a time before it lets the page go on */
  private readonly timeInterval = 1000;
  private readonly padding = 5;

  private orientation: string = 'single';
  private minFontSize = 10;
  private maxFontSize = 36;
  private textScale: string = 'linear';
  private optionsAsString: string | null = null;

  private words: CloudTag[] | null = null;

  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private pendingJob: Job | null = null;
  private completedJob: Job | null = null;
  private layoutIsUpdating = false;
  private allInViewBox = false;
  private domIsUpdating = false;
  private cloudWidth: number | undefined;
  private cloudHeight: number | undefined;

  constructor(element: HTMLElement, colorScale: (value: unknown) => string) {
    this.element = element;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.group = document.createElementNS(SVG_NS, 'g');
    this.svg.appendChild(this.group);
    this.element.appendChild(this.svg);
    this.colorScale = colorScale;
    this.resize();
  }

  on(type: 'select', listener: (tag: CloudTag) => void): void;
  on(type: 'renderComplete', listener: () => void): void;
  on(type: 'select' | 'renderComplete', listener: ((tag: CloudTag) => void) | (() => void)): void {
    if (type === 'select') this.listeners.select.push(listener as (tag: CloudTag) => void);
    else this.listeners.renderComplete.push(listener as () => void);
  }

  off(type: 'renderComplete', listener: () => void): void {
    this.listeners[type] = this.listeners[type].filter((other) => other !== listener);
  }

  setOptions(options: TagCloudOptions): void {
    if (JSON.stringify(options) === this.optionsAsString) return;
    this.optionsAsString = JSON.stringify(options);
    this.orientation = String(options.orientation);
    this.minFontSize = Math.min(Number(options.minFontSize), Number(options.maxFontSize));
    this.maxFontSize = Math.max(Number(options.minFontSize), Number(options.maxFontSize));
    this.textScale = String(options.scale);
    this.invalidate(false);
  }

  resize(): void {
    const newWidth = this.element.offsetWidth;
    const newHeight = this.element.offsetHeight;
    if (newWidth === this.size[0] && newHeight === this.size[1]) return;

    const wasInside = this.cloudWidth !== undefined && this.cloudHeight !== undefined && this.size[0] >= this.cloudWidth && this.size[1] >= this.cloudHeight;
    const willBeInside = this.cloudWidth !== undefined && this.cloudHeight !== undefined && this.cloudWidth <= newWidth && this.cloudHeight <= newHeight;
    this.size[0] = newWidth;
    this.size[1] = newHeight;
    this.invalidate(wasInside && willBeInside && this.allInViewBox);
  }

  setData(data: CloudTag[]): void {
    this.words = data;
    this.invalidate(false);
  }

  destroy(): void {
    if (this.timeoutId !== null) clearTimeout(this.timeoutId);
    this.element.innerHTML = '';
  }

  getStatus(): number {
    return this.allInViewBox ? TAG_CLOUD_STATUS.COMPLETE : TAG_CLOUD_STATUS.INCOMPLETE;
  }

  private emitRenderComplete() {
    for (const listener of [...this.listeners.renderComplete]) listener();
  }

  private updateContainerSize() {
    this.svg.setAttribute('width', String(this.size[0]));
    this.svg.setAttribute('height', String(this.size[1]));
    this.group.setAttribute('width', String(this.size[0]));
    this.group.setAttribute('height', String(this.size[1]));
  }

  private isJobRunning(): boolean {
    return this.timeoutId !== null || this.layoutIsUpdating || this.domIsUpdating;
  }

  private async processPendingJob(): Promise<void> {
    if (!this.pendingJob) return;
    if (this.isJobRunning()) return;

    this.completedJob = null;
    const job = await this.pickPendingJob();
    if (!job) return;
    if (job.words.length) {
      if (job.refreshLayout) await this.updateLayout(job);
      await this.updateDom(job);
      const box = this.group.getBBox();
      this.cloudWidth = box.width;
      this.cloudHeight = box.height;
      this.allInViewBox =
        box.x >= 0 && box.y >= 0 && box.x + box.width <= this.element.offsetWidth && box.y + box.height <= this.element.offsetHeight;
    } else {
      this.emptyDom();
    }

    if (this.pendingJob) {
      // Pick up the next job
      void this.processPendingJob();
    } else {
      this.completedJob = job;
      this.emitRenderComplete();
    }
  }

  private pickPendingJob(): Promise<Job | null> {
    return new Promise((resolve) => {
      this.timeoutId = setTimeout(() => {
        const job = this.pendingJob;
        this.pendingJob = null;
        this.timeoutId = null;
        resolve(job);
      }, 0);
    });
  }

  private emptyDom() {
    for (const text of Array.from(this.group.querySelectorAll('text'))) text.remove();
    this.cloudWidth = 0;
    this.cloudHeight = 0;
    this.allInViewBox = true;
    this.domIsUpdating = false;
  }

  private async updateDom(job: Job): Promise<void> {
    const canSkipDomUpdate = this.pendingJob || this.timeoutId !== null;
    if (canSkipDomUpdate) {
      this.domIsUpdating = false;
      return;
    }

    this.domIsUpdating = true;
    const xTranslate = this.element.offsetWidth / 2;
    const yTranslate = this.element.offsetHeight / 2;
    const affineTransform = (word: CloudTag) => positionWord(xTranslate, yTranslate, word);

    // The words joined to the text elements by their terms, as d3's selection.data with a key
    const nodes = Array.from(this.group.querySelectorAll('text'));
    const byKey = new Map<string, SVGTextElement | true>();
    const keyValues: Array<string | undefined> = [];
    const exiting: SVGTextElement[] = [];
    nodes.forEach((node, index) => {
      const keyValue = String(this.data.get(node)?.rawText);
      if (byKey.has(keyValue)) exiting[index] = node;
      else byKey.set(keyValue, node);
      keyValues[index] = keyValue;
    });
    const entering: Array<CloudTag | undefined> = new Array(job.words.length);
    const moving: Array<SVGTextElement | undefined> = new Array(job.words.length);
    job.words.forEach((word, index) => {
      const keyValue = String(word.rawText);
      const node = byKey.get(keyValue);
      if (!node) entering[index] = word;
      else if (node !== true) {
        moving[index] = node;
        this.data.set(node, word);
      }
      byKey.set(keyValue, true);
    });
    nodes.forEach((node, index) => {
      const keyValue = keyValues[index];
      if (keyValue !== undefined && byKey.get(keyValue) !== true) exiting[index] = node;
    });

    await new Promise<void>((resolve) => {
      // The new words, at the end of the group in the order of the data, and with the others from there
      entering.forEach((word, index) => {
        if (!word) return;
        const node = document.createElementNS(SVG_NS, 'text');
        this.group.appendChild(node);
        this.data.set(node, word);
        moving[index] = node;
        setStyle(node, 'font-size', `${word.size}px`);
        setStyle(node, 'font-style', this.fontStyle);
        setStyle(node, 'font-weight', this.fontWeight);
        setStyle(node, 'font-family', this.fontFamily);
        setStyle(node, 'fill', this.colorScale(word.text));
        node.setAttribute('text-anchor', 'middle');
        node.setAttribute('transform', affineTransform(word));
        if (word.displayText != null) node.setAttribute('data-test-subj', word.displayText);
        node.textContent = word.displayText == null ? '' : word.displayText;
        node.addEventListener('click', () => {
          const current = this.data.get(node);
          if (current) for (const listener of this.listeners.select) listener(current);
        });
        node.addEventListener('mouseover', () => node.style.setProperty('cursor', 'pointer', ''));
        node.addEventListener('mouseout', () => node.style.setProperty('cursor', 'default', ''));
      });

      const movingTags = moving.filter((node): node is SVGTextElement => node !== undefined);
      const exitingTags = exiting.filter((node): node is SVGTextElement => node !== undefined);
      let exits = exitingTags.length;
      let moves = movingTags.length;
      const resolveWhenDone = () => {
        if (exits === 0 && moves === 0) {
          this.domIsUpdating = false;
          resolve();
        }
      };

      // Each word to its size and place, from where it is; the font's style, weight and family are
      // the same as they were set, so that their tweens change nothing and are left out
      transition(
        movingTags,
        600,
        (node) => {
          const word = this.data.get(node) as CloudTag;
          return [styleTween(node, 'font-size', `${word.size}px`), attrTween(node, 'transform', affineTransform(word), (a, b) => interpolateTransform(a, b))];
        },
        () => {
          moves -= 1;
          resolveWhenDone();
        }
      );

      // The words gone go at once; their transition only tells when it would have ended
      transition(
        exitingTags,
        200,
        () => [],
        () => {
          exits -= 1;
          resolveWhenDone();
        }
      );
      for (const node of exitingTags) {
        node.style.setProperty('fill-opacity', '0.000001', '');
        node.setAttribute('font-size', '1');
        node.remove();
      }
    });
  }

  private makeTextSizeMapper(): Scale {
    return textSizeMapper(this.textScale, this.words ?? [], this.minFontSize, this.maxFontSize);
  }

  private makeNewJob(): Job {
    return { refreshLayout: true, size: [this.size[0], this.size[1]], words: this.words ?? [] };
  }

  private makeJobPreservingLayout(completed: Job): Job {
    return {
      refreshLayout: false,
      size: [this.size[0], this.size[1]],
      words: completed.words.map((tag) => ({
        x: tag.x,
        y: tag.y,
        rotate: tag.rotate,
        size: tag.size,
        rawText: tag.rawText || tag.text,
        displayText: tag.displayText,
        value: tag.value,
        meta: tag.meta,
      })),
    };
  }

  private invalidate(keepLayout: boolean) {
    if (!this.words) return;

    this.updateContainerSize();

    const completed = keepLayout && !this.isJobRunning() ? this.completedJob : null;
    this.pendingJob = completed ? this.makeJobPreservingLayout(completed) : this.makeNewJob();
    void this.processPendingJob();
  }

  private async updateLayout(job: Job): Promise<void> {
    if (job.size[0] <= 0 || job.size[1] <= 0) {
      // Without a width and a height above 0 nothing is laid out, as d3-cloud would never end
      return;
    }

    const mapSizeToFontSize = this.makeTextSizeMapper();
    const orientation = ORIENTATIONS[this.orientation] as ((tag: CloudWord) => number) | undefined;
    const layout = cloudLayout<CloudTag>()
      .size(job.size)
      .padding(this.padding)
      .rotate(orientation ?? (() => undefined))
      .font(this.fontFamily)
      .fontStyle(this.fontStyle)
      .fontWeight(this.fontWeight)
      .fontSize((tag) => mapSizeToFontSize(tag.value))
      .random(seed)
      .spiral(this.spiral)
      .words(job.words)
      .text((tag) => tag.displayText)
      .timeInterval(this.timeInterval);

    this.layoutIsUpdating = true;
    await new Promise<void>((resolve) => {
      layout.on('end', () => {
        this.layoutIsUpdating = false;
        resolve();
      });
      layout.start();
    });
  }
}

function setStyle(node: SVGElement, name: string, value: string) {
  node.style.setProperty(name, value, '');
}
