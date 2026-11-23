/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Tag cloud: the values of a field as words, each as large as its measure, drawn as OpenSearch
 * Dashboards 3.9.0 draws them (vis_type_tagcloud: TagCloudChart, TagCloudVisualization, Label
 * and FeedbackMessage). The cloud fills the box but for a warning, when the words were too many or
 * do not all fit, and the names of the columns under it; both are told once the cloud is drawn.
 * The cloud is drawn again, and laid out again, whenever the data, the options or the size of the
 * box change, the size at most every 300 ms. A click on a word filters for its term.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SERIES_COLORS } from '../charts/core';
import { Icon } from '../components/icon';
import { Tooltip } from '../components/overlay';
import { bucketFilter, type AggContext, type Table, type TableColumn } from '../lib/aggs';
import type { Filter } from '../lib/types';
import { formatValue } from './table_data';
import type { VisData } from './request';
import { cloudTags, TAG_CLOUD_DEFAULTS, TAG_CLOUD_STATUS, TagCloud, type TagCloudOptions } from './tag_cloud';
import { ordinalScale } from './tag_cloud_d3';
import { bucketColumns, metricColumns, type VisRenderProps } from './types';
import '../styles/vis_basic.css';

interface LabelState {
  label: string;
  shouldShowLabel: boolean;
}

interface FeedbackState {
  shouldShowTruncate: boolean;
  shouldShowIncomplete: boolean;
}

interface CloudCallbacks {
  onLabel: (state: LabelState) => void;
  onFeedback: (state: FeedbackState) => void;
  onFilter: (filters: Filter[]) => void;
}

/** The options of a visualization with the defaults of the tag cloud for those it has not set */
function withDefaults(params: Record<string, unknown>): TagCloudOptions {
  const options: Record<string, unknown> = { ...params };
  for (const [key, value] of Object.entries(TAG_CLOUD_DEFAULTS)) if (options[key] === undefined) options[key] = value;
  return options as TagCloudOptions;
}

/**
 * lodash's throttle: called at once, then at most once more at the end of each wait in which it
 * was called again
 */
function throttle(func: () => void, wait: number): () => void {
  let lastCallTime: number | undefined;
  let lastInvokeTime = 0;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let called = false;
  const invoke = (time: number) => {
    called = false;
    lastInvokeTime = time;
    func();
  };
  const shouldInvoke = (time: number) => {
    if (lastCallTime === undefined) return true;
    const sinceCall = time - lastCallTime;
    return sinceCall >= wait || sinceCall < 0 || time - lastInvokeTime >= wait;
  };
  const remainingWait = (time: number) => Math.min(wait - (time - (lastCallTime ?? time)), wait - (time - lastInvokeTime));
  const timerExpired = () => {
    const time = Date.now();
    if (shouldInvoke(time)) {
      timerId = undefined;
      if (called) invoke(time);
      called = false;
      return;
    }
    timerId = setTimeout(timerExpired, remainingWait(time));
  };
  return () => {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);
    called = true;
    lastCallTime = time;
    if (isInvoking) {
      if (timerId === undefined) {
        lastInvokeTime = time;
        timerId = setTimeout(timerExpired, wait);
        invoke(time);
        return;
      }
      clearTimeout(timerId);
      timerId = setTimeout(timerExpired, wait);
      invoke(time);
      return;
    }
    if (timerId === undefined) timerId = setTimeout(timerExpired, wait);
  };
}

/** What draws the cloud into its element and tells what to show around it, as TagCloudVisualization */
class TagCloudVisualization {
  private readonly tagCloud: TagCloud;
  private truncated = false;
  private hasBucket = false;
  private context: AggContext | undefined;

  constructor(node: HTMLElement, private readonly callbacks: CloudCallbacks) {
    this.tagCloud = new TagCloud(node, ordinalScale(SERIES_COLORS));
    this.tagCloud.on('select', (tag) => {
      if (!this.hasBucket || !this.context) return;
      const { data, rowIndex } = tag.meta;
      const column = data.columns[0];
      const row = data.rows[rowIndex];
      const filter = column && row ? bucketFilter(column, row[column.id], this.context, { table: data, row }) : undefined;
      if (filter) this.callbacks.onFilter([filter]);
    });
  }

  async render(data: VisData, options: TagCloudOptions): Promise<void> {
    const { table, context } = data;
    const bucket = bucketColumns(table)[0];
    this.hasBucket = bucket !== undefined;
    this.context = context;
    this.tagCloud.setOptions(options);
    this.updateData(table, bucket);
    this.tagCloud.resize();

    await this.renderComplete();

    if (table.columns.length !== 2) {
      this.callbacks.onFeedback({ shouldShowTruncate: false, shouldShowIncomplete: false });
      return;
    }
    this.callbacks.onLabel({ label: `${table.columns[0].name} - ${table.columns[1].name}`, shouldShowLabel: Boolean(options.showLabel) });
    this.callbacks.onFeedback({
      shouldShowTruncate: this.truncated,
      shouldShowIncomplete: this.tagCloud.getStatus() === TAG_CLOUD_STATUS.INCOMPLETE,
    });
  }

  destroy(): void {
    this.tagCloud.destroy();
  }

  private updateData(table: Table, bucket: TableColumn | undefined) {
    const made = cloudTags(table, bucket, metricColumns(table)[0], formatValue);
    if (!made) {
      this.tagCloud.setData([]);
      return;
    }
    this.truncated = made.truncated;
    this.tagCloud.setData(made.tags);
  }

  private renderComplete(): Promise<void> {
    return new Promise((resolve) => {
      const once = () => {
        this.tagCloud.off('renderComplete', once);
        resolve();
      };
      this.tagCloud.on('renderComplete', once);
    });
  }
}

function FeedbackMessage({ shouldShowTruncate, shouldShowIncomplete }: FeedbackState) {
  if (!shouldShowTruncate && !shouldShowIncomplete) return null;
  return (
    <Tooltip
      className="visTagCloud__tip"
      content={
        <>
          {shouldShowTruncate && <p>The number of tags has been truncated to avoid long draw times.</p>}
          {shouldShowIncomplete && <p>The container is too small to display the entire cloud. Tags might be cropped or omitted.</p>}
        </>
      }
    >
      <span className="visTagCloud__warning" tabIndex={0} role="img" aria-label="Info">
        <Icon name="alert" />
      </span>
    </Tooltip>
  );
}

export function TagCloudVis({ vis, data, onFilter }: VisRenderProps) {
  const chart = useRef<HTMLDivElement>(null);
  const controller = useRef<TagCloudVisualization | null>(null);
  const [label, setLabel] = useState<LabelState>({ label: '', shouldShowLabel: true });
  const [feedback, setFeedback] = useState<FeedbackState>({ shouldShowTruncate: false, shouldShowIncomplete: false });
  const filter = useRef(onFilter);
  filter.current = onFilter;
  const paramsKey = JSON.stringify(vis.params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const options = useMemo(() => withDefaults(vis.params), [paramsKey]);

  useEffect(() => {
    const node = chart.current;
    if (!node) return undefined;
    const visController = new TagCloudVisualization(node, {
      onLabel: setLabel,
      onFeedback: setFeedback,
      onFilter: (filters) => filter.current?.(filters),
    });
    controller.current = visController;
    return () => {
      visController.destroy();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    void controller.current?.render(data, options);
  }, [data, options]);

  // A new size draws the cloud again, at most every 300 ms, as the original's resize observer
  const updateChartSize = useMemo(
    () =>
      throttle(() => {
        void controller.current?.render(data, options);
      }, 300),
    [data, options]
  );
  const onResize = useRef(updateChartSize);
  onResize.current = updateChartSize;
  // Observed from when the element is put in the page, before the cloud is made, as the original
  // observes it: a size heard of before then draws nothing, and the same size again nothing more
  const observer = useRef<ResizeObserver | null>(null);
  const size = useRef({ height: 0, width: 0 });
  const observe = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(() => {
      const { height, width } = node.getBoundingClientRect();
      if (size.current.height === height && size.current.width === width) return;
      onResize.current();
      size.current = { height, width };
    });
    watcher.observe(node);
    observer.current = watcher;
  }, []);

  return (
    <div className="visTagCloud" ref={observe}>
      <div className="visTagCloud__container">
        <div className="visTagCloud__chart">
          <div className="visTagCloud__cloud" data-test-subj="tagCloudVisualization" ref={chart} />
        </div>
        <div>
          <FeedbackMessage {...feedback} />
        </div>
        <div>
          <div className="visTagCloud__label" style={{ display: label.shouldShowLabel ? 'block' : 'none' }}>
            {label.label}
          </div>
        </div>
      </div>
    </div>
  );
}
