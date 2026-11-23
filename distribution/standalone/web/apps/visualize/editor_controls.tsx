/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The controls of the editor's sidebar as the original draws them, compressed: a row with its
 * label, what is appended to it, its error and its help; a switch, a select, a number, a text,
 * a group of buttons, a slider with its value; the "Add" button and the "Advanced" toggle.
 */

import { useId, useState, type ReactNode } from 'react';
import { cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';

export function ParamRow({
  label,
  labelAppend,
  labelFor,
  help,
  error,
  invalid,
  className,
  children,
  testId,
}: {
  label?: ReactNode;
  labelAppend?: ReactNode;
  /** The id of the control the label names */
  labelFor?: string;
  help?: ReactNode;
  /** Shown under the control: the row is invalid */
  error?: ReactNode;
  /** The row is invalid, with or without a text: its label turns to the critical colour */
  invalid?: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const hasError = Array.isArray(error) ? error.length > 0 : Boolean(error);
  return (
    <div className={cx('vzeRow', (invalid || hasError) && 'vzeRow--invalid', className)} data-test-subj={testId}>
      {(label || labelAppend) && (
        <div className="vzeRow__labels">
          {label ? (
            <label className="vzeRow__label" htmlFor={labelFor}>
              {label}
            </label>
          ) : (
            <span />
          )}
          {labelAppend}
        </div>
      )}
      <div className="vzeRow__field">{children}</div>
      {hasError && (Array.isArray(error) ? error : [error]).map((text, index) => (
        <div className="vzeRow__error" key={index}>
          {text}
        </div>
      ))}
      {help && <div className="vzeRow__help">{help}</div>}
    </div>
  );
}

/** A question mark that says more on hover: the original's `EuiIconTip` */
export function IconTip({ content, position = 'top' }: { content: ReactNode; position?: 'top' | 'bottom' | 'right' }) {
  return (
    <Tooltip content={content} position={position}>
      <span className="vzeIconTip" tabIndex={0}>
        <Icon name="help" title="Info" />
      </span>
    </Tooltip>
  );
}

/** A label with its question mark */
export function TipLabel({ label, tip, position }: { label: ReactNode; tip: ReactNode; position?: 'top' | 'bottom' | 'right' }) {
  return (
    <>
      {label} <IconTip content={tip} position={position} />
    </>
  );
}

/** A compressed switch, its label after it */
export function SwitchControl({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <span className={cx('vzeSwitch', disabled && 'vzeSwitch--disabled')}>
      <button
        id={id}
        type="button"
        role="switch"
        className="vzeSwitch__button"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-test-subj={testId}
      >
        <span className="vzeSwitch__body">
          <span className="vzeSwitch__thumb" />
        </span>
      </button>
      <label className="vzeSwitch__label" id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
    </span>
  );
}

/** A switch on a row of its own, with what it does said on the right after a while */
export function SwitchRow({
  tooltip,
  ...props
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
  tooltip?: ReactNode;
}) {
  const control = <SwitchControl {...props} />;
  return (
    <ParamRow className="vzeRow--switch">
      {tooltip ? (
        <Tooltip content={tooltip} position="right">
          {control}
        </Tooltip>
      ) : (
        control
      )}
    </ParamRow>
  );
}

export interface ChoiceOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A compressed select. With no initial selection it starts on an empty, hidden choice */
export function SelectControl({
  id,
  value,
  options,
  onChange,
  invalid,
  disabled,
  testId,
  noInitialSelection,
  onBlur,
}: {
  id?: string;
  value: string | undefined;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  testId?: string;
  noInitialSelection?: boolean;
  onBlur?: () => void;
}) {
  const known = options.some((option) => option.value === value);
  return (
    <span className={cx('vzeSelect', disabled && 'vzeSelect--disabled')}>
      <select
        id={id}
        className={cx('atlField', 'vzeControl', invalid && 'vzeControl--invalid')}
        value={known ? value : ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        data-test-subj={testId}
      >
        {(noInitialSelection || !known) && <option value="" disabled hidden style={{ display: 'none' }} />}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" className="vzeSelect__arrow" />
    </span>
  );
}

/** A compressed number field; something written before it, as the original's `prepend` */
export function NumberControl({
  id,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  invalid,
  disabled,
  prepend,
  ariaLabel,
  testId,
  onBlur,
}: {
  id?: string;
  value: number | string | undefined | null;
  /** The number written, or '' when the field is emptied */
  onChange: (value: number | '') => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  prepend?: ReactNode;
  ariaLabel?: string;
  testId?: string;
  onBlur?: () => void;
}) {
  const input = (
    <input
      id={id}
      type="number"
      className={cx(!prepend && 'atlField', !prepend && 'vzeControl', !prepend && invalid && 'vzeControl--invalid')}
      value={value === undefined || value === null ? '' : value}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => {
        const text = event.target.value;
        onChange(text === '' || Number.isNaN(Number(text)) ? '' : Number(text));
      }}
      onBlur={onBlur}
      data-test-subj={testId}
    />
  );
  if (!prepend) return input;
  return (
    <span className={cx('atlField', 'vzeControl', 'vzeGroup', invalid && 'vzeControl--invalid', disabled && 'vzeGroup--disabled')}>
      <span className="vzeGroup__prepend">{prepend}</span>
      {input}
    </span>
  );
}

/** A compressed text field */
export function TextControl({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  disabled,
  ariaLabel,
  testId,
  onBlur,
  prepend,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
  onBlur?: () => void;
  prepend?: ReactNode;
}) {
  const input = (
    <input
      id={id}
      type="text"
      className={cx(!prepend && 'atlField', !prepend && 'vzeControl', !prepend && invalid && 'vzeControl--invalid')}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      data-test-subj={testId}
    />
  );
  if (!prepend) return input;
  return (
    <span className={cx('atlField', 'vzeControl', 'vzeGroup', invalid && 'vzeControl--invalid')}>
      <span className="vzeGroup__prepend">{prepend}</span>
      {input}
    </span>
  );
}

/** Buttons of which one is chosen, as wide as the row: the original's compressed `EuiButtonGroup` */
export function ButtonGroup({
  legend,
  options,
  selected,
  onChange,
  disabled,
  testId,
}: {
  legend: string;
  options: Array<{ id: string; label: string; testId?: string }>;
  selected: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cx('vzeButtonGroup', disabled && 'vzeButtonGroup--disabled')} data-test-subj={testId} disabled={disabled}>
      <legend className="atlScreenReaderOnly">{legend}</legend>
      <div className="vzeButtonGroup__buttons">
        {options.map((option) => (
          <label key={option.id} className={cx('vzeButtonGroup__button', option.id === selected && 'vzeButtonGroup__button--selected')}>
            <input
              className="atlScreenReaderOnly"
              type="radio"
              name={name}
              checked={option.id === selected}
              onChange={() => onChange(option.id)}
              data-test-subj={option.testId ?? option.id}
            />
            <span title={option.label}>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A compressed slider: a line filled up to the value, and the value in a bubble beside the handle */
export function RangeControl({
  min,
  max,
  step = 1,
  value,
  onChange,
  valueAppend = '',
  showValue = true,
  showRange,
  showLabels,
  showInput,
  onValidity,
  disabled,
  ariaLabel,
  testId,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  valueAppend?: string;
  showValue?: boolean;
  /** The line filled up to the value; without it the line is all of one colour */
  showRange?: boolean;
  /** The least and the most value at the ends of the line */
  showLabels?: boolean;
  /** A field to write the value in, after the line */
  showInput?: boolean;
  /** Whether what is typed in the field is within the range; only then is it a change */
  onValidity?: (valid: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
}) {
  // What is typed in the field while it is out of the range, kept as typed as the original keeps it
  const [typed, setTyped] = useState<string>();
  const share = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  if (showLabels || showInput) {
    return (
      <div className="vzeRangeField">
        {showLabels && <span className="vzeRangeField__label">{min}</span>}
        <RangeControl
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          showValue={showValue}
          showRange={showRange}
          valueAppend={valueAppend}
          disabled={disabled}
          ariaLabel={ariaLabel}
          testId={testId}
        />
        {showLabels && <span className="vzeRangeField__label">{max}</span>}
        {showInput && (
          <input
            type="number"
            className={cx('atlField', 'vzeControl', 'vzeRangeField__input', typed !== undefined && 'vzeControl--invalid')}
            min={min}
            max={max}
            step={step}
            value={typed ?? value}
            disabled={disabled}
            aria-label={ariaLabel}
            onChange={(event) => {
              const next = event.target.valueAsNumber;
              const valid = !Number.isNaN(next) && next >= min && next <= max;
              setTyped(valid ? undefined : event.target.value);
              onValidity?.(valid);
              if (valid) onChange(next);
            }}
          />
        )}
      </div>
    );
  }
  return (
    <div className={cx('vzeRange', showRange && 'vzeRange--hasRange', disabled && 'vzeRange--disabled')}>
      {showRange && <div className="vzeRange__highlight" style={{ width: `${share * 100}%` }} />}
      <input
        type="range"
        className="vzeRange__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        data-test-subj={testId}
      />
      {showValue && (
        <output className="vzeRange__value" style={{ left: `calc(${share} * (100% - 16px) + 32px)` }}>
          {value}
          {valueAppend}
        </output>
      )}
    </div>
  );
}

/**
 * "Add" as the original's extra small empty button with a filled plus. Under a list it is as wide
 * as the list, its text in the middle (`block`); a date range adds with a plain plus.
 */
export function AddButton({
  children,
  onClick,
  disabled,
  testId,
  ariaExpanded,
  block,
  icon = 'plusInCircleFilled',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  ariaExpanded?: boolean;
  block?: boolean;
  icon?: 'plusInCircleFilled' | 'plus';
}) {
  return (
    <button
      type="button"
      className={cx('vzeAddButton', block && 'vzeAddButton--block')}
      onClick={onClick}
      disabled={disabled}
      data-test-subj={testId}
      aria-expanded={ariaExpanded}
    >
      <Icon name={icon} />
      <span>{children}</span>
    </button>
  );
}

/** A section that opens under its title: the original's `EuiAccordion` with its arrow on the left */
export function Disclosure({
  title,
  initiallyOpen = false,
  children,
  testId,
  ariaLabel,
}: {
  title: ReactNode;
  initiallyOpen?: boolean;
  children: ReactNode;
  testId?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return (
    <div className="vzeDisclosure" data-test-subj={testId}>
      <button type="button" className="vzeDisclosure__button" aria-expanded={open} aria-controls={id} aria-label={ariaLabel} onClick={() => setOpen(!open)}>
        <span className={cx('vzeArrow', open && 'vzeArrow--open')}>
          <Icon name="chevronRight" />
        </span>
        <span className="vzeDisclosure__title">{title}</span>
      </button>
      <div id={id} role="region" className="vzeDisclosure__content" hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}

/** A small icon button: the original's `EuiSmallButtonIcon` */
export function SmallIconButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
  primary,
  testId,
  ariaExpanded,
  ariaPressed,
  title,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  testId?: string;
  ariaExpanded?: boolean;
  ariaPressed?: boolean;
  /** Said by the browser on hover, as the original's remove buttons of a list */
  title?: string;
}) {
  return (
    <button
      type="button"
      className={cx('vzeIconButton', danger && 'vzeIconButton--danger', primary && 'vzeIconButton--primary')}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-pressed={ariaPressed}
      data-test-subj={testId}
    >
      <Icon name={icon} />
    </button>
  );
}
