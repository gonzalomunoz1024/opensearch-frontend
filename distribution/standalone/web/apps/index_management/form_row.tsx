/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The plugin's row of a form: a field under its label, with what the label means above the field or
 * under it, 400 px wide at most; or, `across`, the field beside its title and what the title means,
 * as the theme's described form group puts a setting of what is being edited.
 */

import { useId, type ReactNode } from 'react';
import { cx } from '../../components/basic';

export interface FormRowProps {
  /** A title, drawn as the plugin's small heading */
  title?: ReactNode;
  /** The title a size smaller, as the plugin's fourth heading of a small text (15 px on 20) */
  small?: boolean;
  /** A label, drawn as the theme's label of a field, for a row without a title */
  label?: ReactNode;
  /** Beside the label, at its right: the theme's extra small text, a link mostly */
  labelAppend?: ReactNode;
  help?: ReactNode;
  /** Where the help is: above the field (the plugin's default), or under it */
  helpAt?: 'top' | 'bottom';
  optional?: boolean;
  error?: ReactNode;
  /** The field beside its title, as an edit of what there is shows it */
  across?: boolean;
  fullWidth?: boolean;
  /** In a row as wide as the page, a field of the theme's own width, 400 px at most */
  narrow?: boolean;
  testId?: string;
  className?: string;
  children?: ReactNode;
}

function Optional({ optional }: { optional?: boolean }) {
  return optional ? <i> – optional</i> : null;
}

export function FormRow({
  title,
  small,
  label,
  labelAppend,
  help,
  helpAt = 'top',
  optional,
  error,
  across,
  fullWidth,
  narrow,
  testId,
  className,
  children,
}: FormRowProps) {
  const row = cx('ismCustomRow', fullWidth && 'ismCustomRow--full', narrow && 'ismCustomRow--narrow');
  if (across) {
    return (
      <div className={cx('ismDescribed', className)}>
        <div className="ismDescribed__text">
          {small ? (
            <h4 className="ismDescribed__title ismCustomRow__title--s">
              {title ?? label}
              <Optional optional={optional} />
            </h4>
          ) : (
            <h3 className="ismDescribed__title">
              {title ?? label}
              <Optional optional={optional} />
            </h3>
          )}
          {help && <div className="ismDescribed__help">{help}</div>}
        </div>
        <div className="ismDescribed__fields">
          {children && (
            <div className={row} data-test-subj={testId}>
              <div className="ismCustomRow__field">{children}</div>
              {error && <div className="ismCustomRow__error">{error}</div>}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={cx(row, className)} data-test-subj={testId}>
      {title ? (
        <div className={cx('ismCustomRow__label', Boolean(error) && 'ismCustomRow__label--invalid')}>
          {small ? (
            <h4 className="ismCustomRow__title ismCustomRow__title--s">
              {title}
              <Optional optional={optional} />
            </h4>
          ) : (
            <h3 className="ismCustomRow__title">
              {title}
              <Optional optional={optional} />
            </h3>
          )}
        </div>
      ) : label && labelAppend ? (
        <div
          className={cx(
            'ismCustomRow__label',
            'ismCustomRow__label--append',
            Boolean(error) && 'ismCustomRow__label--invalid'
          )}
        >
          <span>
            {label}
            <Optional optional={optional} />
          </span>
          <div className="ismCustomRow__append">{labelAppend}</div>
        </div>
      ) : label ? (
        <div className={cx('ismCustomRow__label', Boolean(error) && 'ismCustomRow__label--invalid')}>
          {label}
          <Optional optional={optional} />
        </div>
      ) : null}
      <div className="ismCustomRow__field">
        {help && helpAt === 'top' && <div className="ismCustomRow__help ismCustomRow__help--top">{help}</div>}
        {children}
      </div>
      {error && <div className="ismCustomRow__error">{error}</div>}
      {help && helpAt === 'bottom' && <div className="ismCustomRow__help">{help}</div>}
    </div>
  );
}

/**
 * The theme's compressed radios, a row of 24 px each, with the plugin's title of a field as their
 * legend when there is one. Each radio has the id of its option, as the theme gives it.
 */
export function Radios<T extends string>({
  options,
  value,
  onChange,
  legend,
  name,
  testId,
}: {
  options: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  legend?: ReactNode;
  name?: string;
  testId?: string;
}) {
  const fallback = useId();
  const radios = options.map((option) => (
    <label key={option.id} className="atlRadio">
      <input
        type="radio"
        id={option.id}
        name={name ?? fallback}
        checked={option.id === value}
        onChange={() => onChange(option.id)}
      />
      <span>{option.label}</span>
    </label>
  ));
  // As the theme's radio group: a fieldset when it has a legend, a plain group when not
  if (!legend) {
    return (
      <div className="ismRadios" data-test-subj={testId}>
        {radios}
      </div>
    );
  }
  return (
    <fieldset className="ismRadios" data-test-subj={testId}>
      <legend className="ismRadios__legend">
        <h3 className="ismCustomRow__title">{legend}</h3>
      </legend>
      {radios}
    </fieldset>
  );
}
