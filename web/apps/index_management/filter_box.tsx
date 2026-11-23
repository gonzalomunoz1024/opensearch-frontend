/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A filter of a list as the plugin's pages draw it: the theme's filter group around one filter
 * button, whose popover lists the values to tick and stays open while they are ticked. The plugin's
 * own group (`own`, the component templates' "Types") says how many values there are until some are
 * ticked, marks the others with a cross and names each value with a test id; the search bar's filter
 * (the data streams of the Indexes list) says only how many are ticked, leaves the others unmarked
 * and opens a popover 300 px wide.
 */

import { useCallback, useState } from 'react';
import { cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Popover } from '../../components/overlay';

export function FilterBox({
  name,
  options,
  selected,
  onChange,
  own,
  empty,
}: {
  name: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** The plugin's own filter group, rather than the search bar's */
  own?: boolean;
  /** What the popover says when there is nothing to tick */
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const active = selected.length > 0;
  const count = active ? selected.length : own ? options.length : undefined;
  return (
    <div className="ismFilterBox">
      <Popover
        open={open}
        onClose={close}
        align="center"
        offset={8}
        className={cx('ismFilterSelect', !own && 'ismFilterSelect--wide')}
        button={
          <button
            type="button"
            className="ismFilterBox__button"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            {/* As wide as its bold self, so that ticking a value does not move what follows */}
            <span
              className={cx('ismFilterBox__name', count === undefined && 'ismFilterBox__name--alone')}
              data-text={name}
            >
              {name}
            </span>
            {count !== undefined && (
              <span className={cx('ismFilterBox__count', active && 'ismFilterBox__count--active')}>{count}</span>
            )}
            <Icon name="chevronDown" />
          </button>
        }
      >
        {options.length === 0 && empty ? (
          <p className="ismFilterSelect__empty">{empty}</p>
        ) : (
          options.map((option) => {
            const on = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                className="ismFilterSelect__item"
                aria-pressed={on}
                data-test-subj={own ? `FilterGroupSelectItem-${option}` : undefined}
                onClick={() => onChange(on ? selected.filter((item) => item !== option) : [...selected, option])}
              >
                {on || own ? <Icon name={on ? 'check' : 'cross'} /> : <span className="ismFilterSelect__blank" />}
                <span className="ismFilterSelect__text">{option}</span>
              </button>
            );
          })
        )}
      </Popover>
    </div>
  );
}
