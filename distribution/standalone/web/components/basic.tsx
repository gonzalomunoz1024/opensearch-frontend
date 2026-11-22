/* SPDX-License-Identifier: Apache-2.0 */

/* The plain parts of a page: buttons, badges, panels, tabs, messages. */

import {
  Component,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { href as toHref } from '../router';
import { Icon, type IconName } from './icon';

export const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ');

export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'tint'
  | 'danger'
  | 'dangerFill'
  | 'empty'
  | 'ghost';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: 's' | 'm';
  icon?: IconName;
  iconSide?: 'left' | 'right';
  full?: boolean;
  loading?: boolean;
  /** A path of this product (`/app/...`): the button is then a link */
  to?: string;
  type?: 'button' | 'submit';
  testId?: string;
}

export function Button({
  variant = 'default',
  size = 'm',
  icon,
  iconSide = 'left',
  full,
  loading,
  to,
  type = 'button',
  className,
  children,
  testId,
  ...rest
}: ButtonProps) {
  const classes = cx(
    'atlButton',
    variant !== 'default' && `atlButton--${variant}`,
    size === 's' && 'atlButton--s',
    full && 'atlButton--full',
    !children && 'atlButton--icon',
    className
  );
  const mark = loading ? <span className="atlSpinner" /> : icon ? <Icon name={icon} /> : null;
  const content = (
    <>
      {iconSide === 'left' && mark}
      {children}
      {iconSide === 'right' && mark}
    </>
  );
  if (to !== undefined && !rest.disabled) {
    return (
      <a className={classes} href={toHref(to)} data-test-subj={testId} title={rest.title} aria-label={rest['aria-label']}>
        {content}
      </a>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      data-test-subj={testId}
      {...rest}
      disabled={rest.disabled || loading}
    >
      {content}
    </button>
  );
}

/** A button that is only an icon; `label` is what a screen reader and a hover say */
export function IconButton({
  icon,
  label,
  ...rest
}: Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string }) {
  return <Button variant="ghost" {...rest} icon={icon} aria-label={label} title={rest.title ?? label} />;
}

/** A link to a path of this product */
export function Link({
  to,
  children,
  className,
  testId,
  title,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  testId?: string;
  title?: string;
}) {
  return (
    <a href={toHref(to)} className={className} data-test-subj={testId} title={title}>
      {children}
    </a>
  );
}

export type Tone = 'accent' | 'healthy' | 'warning' | 'critical';

export function Badge({
  tone,
  children,
  title,
  onClick,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  const className = cx('atlBadge', tone && `atlBadge--${tone}`);
  if (onClick) {
    return (
      <button type="button" className={className} title={title} onClick={onClick} style={{ border: 0, cursor: 'pointer' }}>
        {children}
      </button>
    );
  }
  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}

export function Health({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('atlHealth', tone && `atlHealth--${tone}`)}>{children}</span>;
}

const CALLOUT_ICONS: Record<string, IconName> = {
  accent: 'info',
  healthy: 'checkCircle',
  warning: 'warning',
  critical: 'error',
};

export function CallOut({
  tone = 'accent',
  title,
  children,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx('atlCallOut', tone !== 'accent' && `atlCallOut--${tone}`)} role="status">
      <Icon name={CALLOUT_ICONS[tone]} />
      <div className="atlGrow">
        {title && <div className="atlCallOut__title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyPrompt({
  icon,
  title,
  children,
  actions,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="atlEmpty">
      {icon && <Icon name={icon} size="xl" />}
      <h2 className="atlTitleS atlEmpty__title">{title}</h2>
      {children && <div className="atlEmpty__body">{children}</div>}
      {actions}
    </div>
  );
}

export function Spinner({ size }: { size?: 'l' }) {
  return <span className={cx('atlSpinner', size && `atlSpinner--${size}`)} role="progressbar" />;
}

export function Loading({ children = 'Loading' }: { children?: ReactNode }) {
  return (
    <div className="atlLoading">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

export function Panel({
  children,
  flush,
  subdued,
  plain,
  className,
  style,
}: {
  children: ReactNode;
  flush?: boolean;
  subdued?: boolean;
  plain?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cx(
        'atlPanel',
        flush && 'atlPanel--flush',
        subdued && 'atlPanel--subdued',
        plain && 'atlPanel--plain',
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export interface TabItem {
  id: string;
  label: ReactNode;
  to?: string;
}

export function Tabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: TabItem[];
  selected: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="atlTabs" role="tablist">
      {tabs.map((tab) =>
        tab.to !== undefined ? (
          <a
            key={tab.id}
            role="tab"
            className="atlTab"
            aria-selected={tab.id === selected}
            href={toHref(tab.to)}
          >
            {tab.label}
          </a>
        ) : (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="atlTab"
            aria-selected={tab.id === selected}
            onClick={() => onSelect?.(tab.id)}
          >
            {tab.label}
          </button>
        )
      )}
    </div>
  );
}

/** One of a few, side by side */
export function Segments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="atlSegments">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="atlSegment"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Accordion({
  title,
  children,
  initiallyOpen = true,
  extra,
}: {
  title: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="atlAccordion">
      <div className="atlRow">
        <button
          type="button"
          className="atlAccordion__button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} />
          <span className="atlGrow">{title}</span>
        </button>
        {extra}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

const TOKEN_LETTERS: Record<string, string> = {
  string: 't',
  number: '#',
  date: 'd',
  boolean: 'b',
  ip: 'ip',
  geo_point: 'g',
  geo_shape: 'g',
  _source: '{}',
  conflict: '!',
  nested: 'n',
  object: '{}',
  unknown: '?',
};

/** The small mark that says what kind of field a field is */
export function FieldToken({ type }: { type: string }) {
  return (
    <span className={`atlToken atlToken--${type}`} title={type} aria-label={type}>
      {TOKEN_LETTERS[type] ?? '?'}
    </span>
  );
}

export function CodeBlock({ children, style }: { children: string; style?: CSSProperties }) {
  return (
    <pre className="atlCode" style={style}>
      {children}
    </pre>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="atlPageHeader">
      <div className="atlGrow">
        <h1 className="atlTitleL">{title}</h1>
        {description && <p className="atlSubdued atlPageHeader__description">{description}</p>}
      </div>
      {actions && <div className="atlRow">{actions}</div>}
    </div>
  );
}

interface BoundaryState {
  error?: Error;
}

/** Keeps one part's failure from blanking the page around it */
export class ErrorBoundary extends Component<
  { children: ReactNode; compact?: boolean; resetKey?: unknown },
  BoundaryState
> {
  state: BoundaryState = {};

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(error, info.componentStack);
  }

  componentDidUpdate(previous: { resetKey?: unknown }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.compact) {
      return (
        <div className="atlEmpty" style={{ padding: 'var(--space-3)' }}>
          <Icon name="warning" />
          <span className="atlXs">{error.message}</span>
        </div>
      );
    }
    return (
      <EmptyPrompt icon="warning" title="This page could not be drawn">
        <CodeBlock>{error.message}</CodeBlock>
      </EmptyPrompt>
    );
  }
}
