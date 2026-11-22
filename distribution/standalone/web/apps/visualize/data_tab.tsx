/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The "Data" tab of the editor: the metrics and the buckets of a visualization, each under the
 * part it plays in the chart (Y-axis, X-axis, Split series…), to add, change, switch off,
 * reorder and remove.
 */

import { useState } from 'react';
import { Button, IconButton, Segments, cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { MenuButton } from '../../components/overlay';
import { aggLabel, isMetricAgg, type AggConfig, type AggContext } from '../../lib/aggs';
import type { IndexPattern } from '../../lib/types';
import { visType } from '../../lib/vis';
import { AggEditor } from './agg_editor';
import { addAgg, allowedAggs, type Schema } from './defaults';

export interface DataTabProps {
  type: string;
  aggs: AggConfig[];
  onChange: (aggs: AggConfig[]) => void;
  indexPattern?: IndexPattern;
  context: AggContext;
  problems: Record<string, string>;
  /** Problems are named once someone has tried to update the chart */
  showProblems: boolean;
}

const GROUPS = [
  { id: 'metrics', title: 'Metrics', one: 'metric' },
  { id: 'buckets', title: 'Buckets', one: 'bucket' },
] as const;

export function DataTab({ type, aggs, onChange, indexPattern, context, problems, showProblems }: DataTabProps) {
  const schemas = visType(type)?.schemas ?? [];
  // Aggregations added here open by themselves; the ones a visualization came with stay closed
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const schemaOf = (agg: AggConfig): Schema | undefined =>
    schemas.find((schema) => schema.name === agg.schema) ??
    schemas.find((schema) => schema.group === (isMetricAgg(agg) && agg.type ? 'metrics' : 'buckets'));
  const groupOf = (agg: AggConfig) => schemaOf(agg)?.group ?? (isMetricAgg(agg) ? 'metrics' : 'buckets');

  const replace = (next: AggConfig) => onChange(aggs.map((agg) => (agg.id === next.id ? next : agg)));
  const remove = (id: string) => onChange(aggs.filter((agg) => agg.id !== id));
  const move = (id: string, by: number) => {
    const buckets = aggs.filter((agg) => groupOf(agg) === 'buckets');
    const index = buckets.findIndex((agg) => agg.id === id);
    const target = index + by;
    if (index === -1 || target < 0 || target >= buckets.length) return;
    const reordered = [...buckets];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChange([...aggs.filter((agg) => groupOf(agg) !== 'buckets'), ...reordered]);
  };

  return (
    <>
      {GROUPS.map((group) => {
        const groupSchemas = schemas.filter((schema) => schema.group === group.id);
        if (groupSchemas.length === 0) return null;
        const members = aggs.filter((agg) => groupOf(agg) === group.id);
        const countOf = (schema: Schema) => aggs.filter((agg) => agg.schema === schema.name).length;
        const addable = groupSchemas.filter((schema) => schema.max === undefined || countOf(schema) < schema.max);
        const firstSplit = members.findIndex((agg) => agg.schema === 'split');
        return (
          <section className="vzePanel" key={group.id} data-test-subj={`${group.id}AggGroup`}>
            <h3 className="vzePanel__title">{group.title}</h3>
            {members.map((agg, index) => {
              const schema = schemaOf(agg);
              const sameSchema = members.filter((other) => other.schema === agg.schema).length;
              const removable = !schema?.min || sameSchema > schema.min;
              const problem = problems[agg.id];
              const isOpen = open[agg.id] ?? false;
              const off = agg.enabled === false;
              const splitLate = agg.schema === 'split' && firstSplit > 0 && group.id === 'buckets';
              return (
                <div className={cx('vzeAgg', off && 'vzeAgg--off', showProblems && problem && 'vzeAgg--error')} key={agg.id} data-test-subj={`visEditorAggAccordion${agg.id}`}>
                  <div className="vzeAgg__head">
                    <button
                      type="button"
                      className="vzeAgg__toggle"
                      aria-expanded={isOpen}
                      aria-label={`Toggle ${schema?.title ?? 'aggregation'} editor`}
                      onClick={() => setOpen({ ...open, [agg.id]: !isOpen })}
                      data-test-subj={`visEditorAggAccordion${agg.id}Toggle`}
                    >
                      <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} />
                      <strong>{schema?.title ?? 'Aggregation'}</strong>
                      <span className="vzeAgg__label atlTruncate">{agg.type && !problem ? aggLabel(agg, context) : ''}</span>
                    </button>
                    {showProblems && problem && (
                      <span className="vzeAgg__warn" title={problem}>
                        <Icon name="warning" />
                      </span>
                    )}
                    {(group.id === 'buckets' || members.length > 1) && (
                      <IconButton
                        icon={off ? 'eyeClosed' : 'eye'}
                        size="s"
                        label={off ? 'Enable aggregation' : 'Disable aggregation'}
                        onClick={() => replace({ ...agg, enabled: off })}
                        testId={`toggleDisableAggregationBtn ${off ? 'enable' : 'disable'}`}
                      />
                    )}
                    {group.id === 'buckets' && members.length > 1 && (
                      <>
                        <IconButton icon="arrowUp" size="s" label="Move up: asked for earlier" disabled={index === 0} onClick={() => move(agg.id, -1)} />
                        <IconButton icon="arrowDown" size="s" label="Move down: asked for later" disabled={index === members.length - 1} onClick={() => move(agg.id, 1)} />
                      </>
                    )}
                    {removable && (
                      <IconButton icon="cross" size="s" className="vzeAgg__remove" label="Remove dimension" onClick={() => remove(agg.id)} testId="removeDimensionBtn" />
                    )}
                  </div>
                  {splitLate && <p className="atlFormRow__error">"{schema?.title}" aggs must run before all other buckets!</p>}
                  {isOpen && (
                    <div className="vzeAgg__body">
                      {agg.schema === 'split' && (
                        <div className="atlFormRow atlFormRow--full">
                          <Segments
                            options={[
                              { id: 'rows', label: 'Rows' },
                              { id: 'columns', label: 'Columns' },
                            ]}
                            value={agg.params?.row === false ? 'columns' : 'rows'}
                            onChange={(layout) => replace({ ...agg, params: { ...agg.params, row: layout === 'rows' } })}
                          />
                        </div>
                      )}
                      <AggEditor
                        agg={agg}
                        types={schema ? allowedAggs(type, schema) : []}
                        indexPattern={indexPattern}
                        aggs={aggs}
                        context={context}
                        onChange={replace}
                        showProblems={showProblems}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {showProblems &&
              groupSchemas.map((schema) =>
                problems[`schema:${schema.name}`] ? (
                  <p className="atlFormRow__error" key={schema.name}>
                    {problems[`schema:${schema.name}`]}
                  </p>
                ) : null
              )}
            <div className="vzePanel__add">
              <MenuButton
                title={`Add ${group.id === 'buckets' && members.length > 0 ? 'sub-' : ''}${group.one}`}
                items={addable.map((schema) => ({
                  id: schema.name,
                  label: schema.title,
                  testId: `visEditorAdd_${group.id}_${schema.title}`,
                  onClick: () => {
                    const next = addAgg(aggs, schema);
                    const added = next.find((agg) => !aggs.some((other) => other.id === agg.id));
                    if (added) setOpen({ ...open, [added.id]: true });
                    onChange(next);
                  },
                }))}
                button={(toggle) => (
                  <Button variant="empty" size="s" icon="plusCircle" onClick={toggle} disabled={addable.length === 0} testId={`visEditorAdd_${group.id}`}>
                    Add
                  </Button>
                )}
              />
            </div>
          </section>
        );
      })}
    </>
  );
}
