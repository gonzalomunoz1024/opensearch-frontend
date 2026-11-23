/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The filters a click on a chart stands for, applied as OpenSearch Dashboards applies them: when
 * there are more than one, "Select filters to apply" offers each on a switch, all of them on;
 * then a range on the index pattern's time field sets the time range instead of filtering, and
 * the others join the page's filters.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Button } from '../components/basic';
import { Switch } from '../components/form';
import { Modal } from '../components/overlay';
import type { TimeRange } from '../lib/dates';
import { fieldFormatter } from '../lib/field_formats';
import { describeFilter } from '../lib/query';
import type { Filter, IndexPattern } from '../lib/types';
import { services } from '../services';
import { splitTimeFilter } from './types';

/** A filter as the original's label writes it: the field, then its value */
function FilterText({ filter, indexPattern }: { filter: Filter; indexPattern?: IndexPattern }) {
  const { meta } = filter;
  const description = describeFilter(filter, (name, value) =>
    indexPattern?.fields.some((field) => field.name === name)
      ? fieldFormatter(indexPattern, name, services.formatSettings())(value).text
      : String(value)
  );
  const prefix = meta.negate ? <span className="visFilterChoice__negate"> NOT </span> : null;
  if (meta.alias) {
    return (
      <>
        {prefix}
        {meta.alias}
      </>
    );
  }
  return (
    <>
      {prefix}
      {description.key}:{' '}
      <span className="visFilterChoice__value">
        {meta.type === 'phrases' ? `is one of ${description.value}` : description.value}
      </span>
    </>
  );
}

function FilterChoiceDialog({
  filters,
  indexPattern,
  onCancel,
  onApply,
}: {
  filters: Filter[];
  indexPattern?: IndexPattern;
  onCancel: () => void;
  onApply: (chosen: Filter[]) => void;
}) {
  const [chosen, setChosen] = useState(() => filters.map(() => true));
  return (
    <Modal
      title="Select filters to apply"
      titleSize="l"
      className="visFilterChoice"
      onClose={onCancel}
      footer={
        <>
          <Button variant="empty" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId="applyFiltersPopoverButton"
            onClick={() => onApply(filters.filter((_filter, index) => chosen[index]))}
          >
            Apply
          </Button>
        </>
      }
    >
      {filters.map((filter, index) => (
        <div key={index} className="visFilterChoice__row">
          <Switch
            checked={chosen[index]}
            onChange={(on) => setChosen((current) => current.map((was, at) => (at === index ? on : was)))}
            label={<FilterText filter={filter} indexPattern={indexPattern} />}
          />
        </div>
      ))}
    </Modal>
  );
}

export interface FilterChoice {
  /** Takes the filters of a click, offering them first when there are more than one */
  apply: (filters: Filter[]) => void;
  /** The dialog that offers them, while it is open */
  dialog: ReactNode;
}

export function useFilterChoice({
  onFilter,
  onTimeChange,
  indexPattern,
}: {
  onFilter?: (filters: Filter[]) => void;
  onTimeChange?: (range: TimeRange) => void;
  indexPattern?: IndexPattern;
}): FilterChoice {
  const [offered, setOffered] = useState<Filter[]>();
  const timeFieldName = indexPattern?.timeFieldName;
  const finish = useCallback(
    (chosen: Filter[]) => {
      const { timeRange, rest } = onTimeChange ? splitTimeFilter(chosen, timeFieldName) : { timeRange: undefined, rest: chosen };
      if (rest.length) onFilter?.(rest);
      if (timeRange) onTimeChange?.(timeRange);
    },
    [onFilter, onTimeChange, timeFieldName]
  );
  const apply = useCallback(
    (filters: Filter[]) => {
      if (filters.length > 1) setOffered(filters);
      else finish(filters);
    },
    [finish]
  );
  const dialog = offered ? (
    <FilterChoiceDialog
      filters={offered}
      indexPattern={indexPattern}
      onCancel={() => setOffered(undefined)}
      onApply={(chosen) => {
        setOffered(undefined);
        finish(chosen);
      }}
    />
  ) : null;
  return { apply, dialog };
}
