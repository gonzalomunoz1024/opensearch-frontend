/* SPDX-License-Identifier: Apache-2.0 */

/* What a form is made of. */

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './basic';
import { Icon, type IconName } from './icon';

export function FormRow({
  label,
  help,
  error,
  full,
  children,
}: {
  label?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cx('atlFormRow', full && 'atlFormRow--full')}>
      {label && <span className={cx('atlFormRow__label', Boolean(error) && 'atlFormRow__label--invalid')}>{label}</span>}
      {children}
      {error && <span className="atlFormRow__error">{error}</span>}
      {help && <span className="atlFormRow__help">{help}</span>}
    </label>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  compact?: boolean;
  icon?: IconName;
  append?: ReactNode;
  testId?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { value, onChange, invalid, compact, icon, append, className, testId, ...rest },
  ref
) {
  const classes = cx('atlField', invalid && 'atlField--invalid', compact && 'atlField--s', className);
  if (icon || append) {
    return (
      <span className={cx(classes, 'atlFieldGroup')}>
        {/* As the original's: a compressed field draws its icon small */}
        {icon && <Icon name={icon} size={compact ? 's' : 'm'} />}
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          data-test-subj={testId}
          {...rest}
        />
        {append}
      </span>
    );
  }
  return (
    <input
      ref={ref}
      type="text"
      className={classes}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      data-test-subj={testId}
      {...rest}
    />
  );
});

export function SearchField(props: Omit<TextFieldProps, 'icon'>) {
  return <TextField icon="search" type="search" {...props} />;
}

export function NumberField({
  value,
  onChange,
  invalid,
  compact,
  className,
  testId,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> & {
  value: number | '' | undefined;
  onChange: (value: number | undefined) => void;
  invalid?: boolean;
  compact?: boolean;
  testId?: string;
}) {
  return (
    <input
      type="number"
      className={cx('atlField', invalid && 'atlField--invalid', compact && 'atlField--s', className)}
      value={value ?? ''}
      onChange={(event) => {
        const text = event.target.value;
        onChange(text === '' || Number.isNaN(Number(text)) ? undefined : Number(text));
      }}
      data-test-subj={testId}
      {...rest}
    />
  );
}

export function TextArea({
  value,
  onChange,
  invalid,
  className,
  code,
  testId,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  /** Set in the fixed-width face */
  code?: boolean;
  testId?: string;
}) {
  return (
    <textarea
      className={cx('atlField', invalid && 'atlField--invalid', className)}
      style={code ? { fontFamily: 'var(--font-family-code)', fontSize: 'var(--font-size-xs)' } : undefined}
      value={value}
      spellCheck={code ? false : undefined}
      onChange={(event) => onChange(event.target.value)}
      data-test-subj={testId}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  value,
  onChange,
  options,
  compact,
  className,
  placeholder,
  testId,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'size'> & {
  value: string;
  onChange: (value: string) => void;
  options: Array<SelectOption | string>;
  compact?: boolean;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <select
      className={cx('atlField', compact && 'atlField--s', className)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      data-test-subj={testId}
      {...rest}
    >
      {placeholder !== undefined && (
        <option value="" disabled={rest.required}>
          {placeholder}
        </option>
      )}
      {options.map((option) => {
        const item = typeof option === 'string' ? { value: option, label: option } : option;
        return (
          <option key={item.value} value={item.value} disabled={item.disabled}>
            {item.label}
          </option>
        );
      })}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  indeterminate,
  ariaLabel,
  title,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  /** What a screen reader calls a box without a label */
  ariaLabel?: string;
  title?: string;
  testId?: string;
}) {
  return (
    <label className="atlCheckbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(input) => {
          if (input) input.indeterminate = Boolean(indeterminate) && !checked;
        }}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel ?? (typeof label === 'string' ? undefined : 'Select')}
        title={title}
        data-test-subj={testId}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <div className="atlStack" style={{ gap: 'var(--space-2)' }}>
      {options.map((option) => (
        <label key={option.id} className="atlRadio">
          <input
            type="radio"
            name={name}
            checked={option.id === value}
            onChange={() => onChange(option.id)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  compressed,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  /** The original's compressed switch, 28 by 16 pixels, in forms and popovers */
  compressed?: boolean;
  testId?: string;
}) {
  return (
    <span className={cx('atlSwitch', compressed && 'atlSwitch--compressed')}>
      <button
        type="button"
        role="switch"
        className="atlSwitch__track"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-test-subj={testId}
      />
      {label && <span onClick={() => !disabled && onChange(!checked)}>{label}</span>}
    </span>
  );
}

/** A slider with two ends: a range of numbers */
export function RangeField({
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="range"
      className="atlRange"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
