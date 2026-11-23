/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The "Data" tab of the editor, as the original's `DefaultEditorDataTab`: a panel per group,
 * "Metrics" and "Buckets", each aggregation of it a row that opens on its editor, with its part
 * in the chart and, closed, what it is. Its buttons switch it off or on, take it to another
 * place by dragging, and remove it; "Add" offers the parts of the group, those already full
 * shown but not offered.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Popover, Tooltip } from '../../components/overlay';
import { aggTypeLabel, type AggConfig, type AggContext } from '../../lib/aggs';
import type { IndexPattern } from '../../lib/types';
import { visType } from '../../lib/vis';
import { services } from '../../services';
import { AggEditor } from './agg_editor';
import { addAgg, allowedAggs, lastParentPipelineTitle, mustBeFirst, removeAgg, reorderAggs, type Schema } from './defaults';
import { AddButton, ButtonGroup, ParamRow, RangeControl, SmallIconButton, TipLabel } from './editor_controls';

export interface DataTabProps {
  type: string;
  aggs: AggConfig[];
  onChange: (aggs: AggConfig[]) => void;
  indexPattern?: IndexPattern;
  context: AggContext;
  /** What is wrong, by aggregation */
  problems: Record<string, string>;
  /** Someone tried to apply the changes: every error is shown */
  showProblems: boolean;
  /** The settings of the visualization: the split and the dot size write theirs */
  params?: Record<string, unknown>;
  setParams?: (params: Record<string, unknown>) => void;
  /** Whether every aggregation in error has been touched: the editor's "Update" turns to an error */
  onTouched?: (touched: boolean) => void;
}

const GROUPS = [
  { id: 'metrics', title: 'Metrics', one: 'metric' },
  { id: 'buckets', title: 'Buckets', one: 'bucket' },
] as const;

interface Drag {
  id: string;
  group: string;
  startY: number;
  dy: number;
  moving: boolean;
  /** Where it would go: an index in its group */
  target: number;
}

export function DataTab({ type, aggs, onChange, indexPattern, context, problems, showProblems, params = {}, setParams, onTouched }: DataTabProps) {
  const schemas: Schema[] = visType(type)?.schemas ?? [];
  const disabledBuckets = (services.uiSettings.get('visualize:disableBucketAgg', []) ?? []) as string[];
  // Aggregations added here open by themselves; the ones a visualization came with stay closed
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // An aggregation closed, or all of whose errors were touched, shows its errors
  const [closedTouched, setClosedTouched] = useState<Record<string, boolean>>({});
  const [paramsTouched, setParamsTouched] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const rows = useRef<Record<string, HTMLDivElement | null>>({});
  const context2 = { ...context, aggs };

  const schemaOf = (agg: AggConfig) => schemas.find((schema) => schema.name === agg.schema);
  const groupOf = (agg: AggConfig) => schemaOf(agg)?.group;
  const metricAggs = aggs.filter((agg) => agg.enabled !== false && agg.type && groupOf(agg) === 'metrics');
  const pipelineTitle = lastParentPipelineTitle(aggs, schemas);

  // As the original, the last bucket under a parent pipeline keeps its empty buckets: a date
  // histogram asks for all of them, a histogram turns "Show empty buckets" on (and off limits)
  const bucketAggs = aggs.filter((agg) => groupOf(agg) === 'buckets');
  const lastBucket = pipelineTitle ? bucketAggs[bucketAggs.length - 1] : undefined;
  const emptyBuckets = lastBucket?.type === 'histogram' ? true : lastBucket?.type === 'date_histogram' ? 0 : undefined;
  useEffect(() => {
    if (!lastBucket || emptyBuckets === undefined || lastBucket.params?.min_doc_count === emptyBuckets) return;
    onChange(aggs.map((agg) => (agg.id === lastBucket.id ? { ...agg, params: { ...agg.params, min_doc_count: emptyBuckets } } : agg)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBucket?.id, lastBucket?.type, emptyBuckets]);

  // A split chart is in rows until someone says columns; a dot size is half of the largest
  const hasSplit = aggs.some((agg) => agg.schema === 'split');
  const hasRadius = aggs.some((agg) => agg.schema === 'radius');
  useEffect(() => {
    if (!setParams) return;
    if (hasSplit && params.row === undefined) setParams({ ...params, row: true });
    else if (hasRadius && !params.radiusRatio) setParams({ ...params, radiusRatio: 50 });
  }, [hasSplit, hasRadius, params, setParams]);

  const aggTouched = (id: string) => showProblems || Boolean(closedTouched[id]) || Boolean(paramsTouched[id]);
  const invalidIds = aggs.filter((agg) => problems[agg.id]).map((agg) => agg.id);
  const allTouched = invalidIds.length > 0 && invalidIds.every(aggTouched);
  useEffect(() => {
    onTouched?.(allTouched);
  }, [allTouched, onTouched]);

  const touchedCallbacks = useRef<Record<string, (touched: boolean) => void>>({});
  const onParamsTouched = useCallback((id: string) => {
    touchedCallbacks.current[id] ??= (touched: boolean) => setParamsTouched((current) => (Boolean(current[id]) === touched ? current : { ...current, [id]: touched }));
    return touchedCallbacks.current[id];
  }, []);

  const replace = (next: AggConfig) => onChange(aggs.map((agg) => (agg.id === next.id ? next : agg)));
  const toggleOpen = (id: string, isOpen: boolean) => {
    setOpen({ ...open, [id]: !isOpen });
    if (isOpen) setClosedTouched({ ...closedTouched, [id]: true });
  };

  // Dragging by the buttons of a row, as the original's handle: the row follows the pointer
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, agg: AggConfig, group: string, members: AggConfig[]) => {
    if (members.length < 2 || event.button !== 0) return;
    setDrag({ id: agg.id, group, startY: event.clientY, dy: 0, moving: false, target: members.findIndex((member) => member.id === agg.id) });
  };
  useEffect(() => {
    if (!drag) return undefined;
    const members = aggs.filter((agg) => groupOf(agg) === drag.group);
    const source = members.findIndex((agg) => agg.id === drag.id);
    const onMove = (event: PointerEvent) => {
      const dy = event.clientY - drag.startY;
      if (!drag.moving && Math.abs(dy) < 5) return;
      const box = rows.current[drag.id]?.getBoundingClientRect();
      const middle = box ? box.top + box.height / 2 : event.clientY;
      let target = source;
      members.forEach((agg, index) => {
        if (agg.id === drag.id) return;
        const other = rows.current[agg.id]?.getBoundingClientRect();
        if (!other) return;
        const center = other.top + other.height / 2;
        if (index > source && middle > center) target = Math.max(target, index);
        if (index < source && middle < center) target = Math.min(target, index);
      });
      setDrag({ ...drag, dy, moving: true, target });
    };
    const onUp = () => {
      if (drag.moving && drag.target !== source) onChange(reorderAggs(aggs, drag.id, members[drag.target].id));
      if (drag.moving) {
        // The click that ends a drag is not a click on a button
        const swallow = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  // With the keyboard: space lifts the row, the arrows move it, space puts it down
  const onHandleKey = (event: ReactKeyboardEvent<HTMLDivElement>, agg: AggConfig, members: AggConfig[]) => {
    if (event.target !== event.currentTarget || members.length < 2) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setLifted(lifted === agg.id ? null : agg.id);
    } else if (event.key === 'Escape') setLifted(null);
    else if (lifted === agg.id && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const index = members.findIndex((member) => member.id === agg.id);
      const target = members[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) onChange(reorderAggs(aggs, agg.id, target.id));
    }
  };

  const shiftOf = (agg: AggConfig, index: number, members: AggConfig[]): number => {
    if (!drag?.moving || drag.group !== groupOf(agg)) return 0;
    if (agg.id === drag.id) return drag.dy;
    const source = members.findIndex((member) => member.id === drag.id);
    const height = (rows.current[drag.id]?.getBoundingClientRect().height ?? 48) + 12;
    if (source < drag.target && index > source && index <= drag.target) return -height;
    if (source > drag.target && index < source && index >= drag.target) return height;
    return 0;
  };

  return (
    <>
      {GROUPS.map((group) => {
        const groupSchemas = schemas.filter((schema) => schema.group === group.id);
        if (groupSchemas.length === 0) return null;
        const members = aggs.filter((agg) => groupOf(agg) === group.id);
        const max = groupSchemas.reduce((total, schema) => total + (schema.max ?? Infinity), 0);
        const enabledMetrics = aggs.filter((agg) => agg.schema === 'metric' && agg.enabled !== false).length;
        const bucketsError = pipelineTitle && group.id === 'buckets' && members.length === 0 ? 'Add a bucket with "Date Histogram" or "Histogram" aggregation.' : undefined;
        return (
          <section className="vzePanel vzeAggGroup" key={group.id} data-test-subj={`${group.id}AggGroup`}>
            <h3 className="vzePanel__title">{group.title}</h3>
            <div className="vzeSpacer vzeSpacer--s" />
            {bucketsError && (
              <>
                <div className="vzeRow__error" data-test-subj="bucketsError">
                  {bucketsError}
                </div>
                <div className="vzeSpacer vzeSpacer--s" />
              </>
            )}
            <div className="vzeAggList">
              {members.map((agg, index) => {
                const schema = schemaOf(agg);
                const schemaTitle = schema?.title || agg.schema || '';
                const sameSchema = members.filter((other) => other.schema === agg.schema).length;
                const removable = sameSchema > (schema?.min ?? 0);
                const isOpen = open[agg.id] ?? false;
                const valid = !problems[agg.id];
                const enabled = agg.enabled !== false;
                const isLast = group.id === 'buckets' && index === members.length - 1;
                const lastBucketType = isLast && pipelineTitle && agg.type;
                const aggError =
                  lastBucketType && agg.type !== 'date_histogram' && agg.type !== 'histogram'
                    ? `Last bucket aggregation must be "Date Histogram" or "Histogram" when using "${pipelineTitle}" metric aggregation.`
                    : undefined;
                const firstOther = members.findIndex((other) => other.schema !== agg.schema);
                const tooLow = mustBeFirst(type, agg.schema) && firstOther !== -1 && index > firstOther;
                const description = agg.type ? safeLabel(agg, context2) : '';
                const draggable = members.length > 1;
                const shift = shiftOf(agg, index, members);
                return (
                  <div
                    key={agg.id}
                    ref={(element) => {
                      rows.current[agg.id] = element;
                    }}
                    className={cx('vzeAgg', drag?.moving && drag.id === agg.id && 'vzeAgg--dragging', lifted === agg.id && 'vzeAgg--lifted')}
                    style={shift ? { transform: `translateY(${shift}px)`, transition: drag?.id === agg.id ? 'none' : undefined } : undefined}
                    data-test-subj={`visEditorAggAccordion${agg.id}`}
                    id={`visEditorAggAccordion${agg.id}`}
                  >
                    <div className="vzeAgg__trigger">
                      <button
                        type="button"
                        className="vzeAgg__button"
                        aria-expanded={isOpen}
                        aria-controls={`visEditorAggAccordion${agg.id}__content`}
                        aria-label={`Toggle ${schemaTitle} editor`}
                        onClick={() => toggleOpen(agg.id, isOpen)}
                      >
                        <span className={cx('vzeArrow', isOpen && 'vzeArrow--open')}>
                          <Icon name="chevronRight" />
                        </span>
                        <span className="vzeAgg__title atlTruncate">
                          {schemaTitle} {!isOpen && valid && <span className="vzeAgg__description">{description}</span>}
                        </span>
                      </button>
                      <div
                        className="vzeAgg__actions"
                        tabIndex={draggable ? 0 : undefined}
                        role={draggable ? 'button' : undefined}
                        aria-roledescription={draggable ? 'Draggable item. Press space bar to lift' : undefined}
                        onPointerDown={(event) => startDrag(event, agg, group.id, members)}
                        onKeyDown={(event) => onHandleKey(event, agg, members)}
                      >
                        {!isOpen && !valid && (
                          <Tooltip content="Aggregation has errors" position="bottom">
                            <SmallIconButton icon="warning" danger label="Aggregation has errors" testId="hasErrorsAggregationIcon" />
                          </Tooltip>
                        )}
                        {enabled && removable && (
                          <Tooltip content="Disable aggregation" position="bottom">
                            <SmallIconButton
                              icon="eye"
                              label="Disable aggregation"
                              disabled={agg.schema === 'metric' && group.id === 'metrics' && enabledMetrics === 1}
                              onClick={() => replace({ ...agg, enabled: false })}
                              testId="toggleDisableAggregationBtn disable"
                            />
                          </Tooltip>
                        )}
                        {!enabled && (
                          <Tooltip content="Enable aggregation" position="bottom">
                            <SmallIconButton icon="eyeClosed" label="Enable aggregation" onClick={() => replace({ ...agg, enabled: true })} testId="toggleDisableAggregationBtn enable" />
                          </Tooltip>
                        )}
                        {draggable && (
                          <Tooltip content="Modify priority by dragging" position="bottom">
                            <span className="vzeAgg__grab" tabIndex={0}>
                              <svg className="atlIcon vzeAgg__grabIcon" viewBox="0 0 16 16" role="img" aria-label="Modify priority by dragging" data-test-subj="dragHandleBtn">
                                <path
                                  fillRule="evenodd"
                                  d="M13.5 6c.276 0 .5.232.5.5 0 .276-.229.5-.5.5h-11a.505.505 0 0 1-.5-.5c0-.276.229-.5.5-.5h11Zm0 3c.276 0 .5.232.5.5 0 .276-.229.5-.5.5h-11a.505.505 0 0 1-.5-.5c0-.276.229-.5.5-.5h11Z"
                                />
                              </svg>
                            </span>
                          </Tooltip>
                        )}
                        {removable && (
                          <Tooltip content="Remove dimension" position="bottom">
                            <SmallIconButton icon="cross" danger label="Remove dimension" onClick={() => onChange(removeAgg(aggs, agg.id, schemas))} testId="removeDimensionBtn" />
                          </Tooltip>
                        )}
                      </div>
                    </div>
                    <div id={`visEditorAggAccordion${agg.id}__content`} role="region" className="vzeAgg__content" hidden={!isOpen}>
                      {isOpen && (
                        <>
                          <div className="vzeSpacer vzeSpacer--m" />
                          {agg.schema === 'split' && group.id === 'buckets' && (
                            <>
                              <ParamRow>
                                <ButtonGroup
                                  legend="Split chart by rows or columns."
                                  options={[
                                    { id: 'visEditorSplitBy__true', label: 'Rows' },
                                    { id: 'visEditorSplitBy__false', label: 'Columns' },
                                  ]}
                                  selected={`visEditorSplitBy__${String(params.row)}`}
                                  onChange={(id) => setParams?.({ ...params, row: id === 'visEditorSplitBy__true' })}
                                  testId="visEditorSplitBy"
                                />
                              </ParamRow>
                              <div className="vzeSpacer vzeSpacer--m" />
                            </>
                          )}
                          {agg.schema === 'radius' && (
                            <>
                              <ParamRow label={<TipLabel label="Dot size ratio" position="right" tip="Change the ratio of the radius of the smallest point to the largest point." />}>
                                <RangeControl
                                  min={1}
                                  max={100}
                                  value={Number(params.radiusRatio) || 50}
                                  showRange
                                  valueAppend="%"
                                  onChange={(radiusRatio) => setParams?.({ ...params, radiusRatio })}
                                />
                              </ParamRow>
                              <div className="vzeSpacer vzeSpacer--m" />
                            </>
                          )}
                          <AggEditor
                            agg={agg}
                            types={schema ? allowedAggs(type, schema, disabledBuckets) : []}
                            indexPattern={indexPattern}
                            aggs={aggs}
                            context={context2}
                            onChange={replace}
                            showProblems={aggTouched(agg.id)}
                            visType={type}
                            subAggregation={group.id === 'buckets' && index >= 1}
                            aggError={aggError}
                            formError={tooLow ? `"${schemaTitle}" aggs must run before all other buckets!` : undefined}
                            disabledParams={lastBucketType && (agg.type === 'date_histogram' || agg.type === 'histogram') ? ['min_doc_count'] : undefined}
                            metricAggs={metricAggs}
                            onTouched={onParamsTouched(agg.id)}
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {max > members.length && (
              <AddMenu
                group={group}
                schemas={groupSchemas}
                members={members}
                onAdd={(schema) => {
                  const next = addAgg(aggs, schema);
                  const added = next[next.length - 1];
                  setOpen({ ...open, [added.id]: true });
                  onChange(next);
                }}
              />
            )}
          </section>
        );
      })}
    </>
  );
}

/** What an aggregation is, as the original's description: its type's label, or nothing it cannot make */
function safeLabel(agg: AggConfig, context: AggContext): string {
  try {
    return aggTypeLabel(agg, context);
  } catch {
    return '';
  }
}

function AddMenu({
  group,
  schemas,
  members,
  onAdd,
}: {
  group: (typeof GROUPS)[number];
  schemas: Schema[];
  members: AggConfig[];
  onAdd: (schema: Schema) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const items = useRef<HTMLDivElement>(null);
  const title = group.id === 'buckets' && members.length > 0 ? 'Add sub-bucket' : `Add ${group.one}`;
  const enabledItems = () => Array.from(items.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  // As the original's menu: the first part it offers has the focus, the arrows go from one to the next
  useEffect(() => {
    if (!isOpen) return undefined;
    // Once the menu is placed and shown: a hidden button takes no focus
    const frame = requestAnimationFrame(() => enabledItems()[0]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);
  const onItemsKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const list = enabledItems();
    const at = list.findIndex((item) => item === document.activeElement);
    const next = list[(at + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length];
    next?.focus();
  };
  return (
    <div className="vzeAddRow">
      <Popover
        open={isOpen}
        onClose={() => setIsOpen(false)}
        align="center"
        offset={8}
        className="vzeAddMenu"
        button={
          <AddButton onClick={() => setIsOpen(!isOpen)} testId={`visEditorAdd_${group.id}`} ariaExpanded={isOpen}>
            Add
          </AddButton>
        }
      >
        <div className="vzeAddMenu__title">{title}</div>
        <div className="vzeAddMenu__items" ref={items} onKeyDown={onItemsKey}>
          {schemas.map((schema) => {
            const count = members.filter((agg) => agg.schema === schema.name).length;
            return (
              <button
                key={`${schema.name}_${schema.title}`}
                type="button"
                className="vzeAddMenu__item"
                disabled={count >= (schema.max ?? Infinity)}
                onClick={() => {
                  setIsOpen(false);
                  onAdd(schema);
                }}
                data-test-subj={`visEditorAdd_${group.id}_${schema.title}`}
              >
                {schema.title}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
