/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The plugin's row of a form: a field under its label, with what the label means above the field or
 * under it, 400 px wide at most; or, `across`, the field beside its title and what the title means,
 * as the theme's described form group puts a setting of what is being edited.
 */

import type { ReactNode } from 'react';
import { cx } from '../../components/basic';

export interface FormRowProps {
  /** A title, drawn as the plugin's small heading */
  title?: ReactNode;
  /** The title a size smaller, as the plugin's fourth heading of a small text (15 px on 20) */
  small?: boolean;
  /** A label, drawn as the theme's label of a field, for a row without a title */
  label?: ReactNode;
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
