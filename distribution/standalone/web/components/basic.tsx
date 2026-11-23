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

export { FieldToken } from './field_token';

export const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ');

export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'tint'
  | 'danger'
  | 'dangerFill'
  | 'dangerOutline'
  | 'dangerEmpty'
  | 'healthyOutline'
  | 'empty'
  | 'ghost';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  /**
   * 'm' is the original's small button (32 px), 's' the kit's own of 28 px, 'xs' the original's
   * smallest empty button and icon button (24 px)
   */
  size?: 'xs' | 's' | 'm';
  icon?: IconName;
  /** 's' for the 12 px icon the original's smallest buttons draw */
  iconSize?: 's' | 'm';
  iconSide?: 'left' | 'right';
  full?: boolean;
  loading?: boolean;
  /** A path of this product (`/app/...`): the button is then a link */
  to?: string;
  /** An address outside the product: the button is then a link to it, as the original's with `href` */
  href?: string;
  /**
   * Where the link opens: `_blank` for a new tab, which, as the original's, does not let the page
   * it opens reach this one (`rel="noopener noreferrer"`)
   */
  target?: '_blank';
  type?: 'button' | 'submit';
  testId?: string;
}

export function Button({
  variant = 'default',
  size = 'm',
  icon,
  iconSize = 'm',
  iconSide = 'left',
  full,
  loading,
  to,
  href,
  target,
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
    size === 'xs' && 'atlButton--xs',
    full && 'atlButton--full',
    !children && 'atlButton--icon',
    className
  );
  const mark = loading ? <span className="atlSpinner" /> : icon ? <Icon name={icon} size={iconSize} /> : null;
  const content = (
    <>
      {iconSide === 'left' && mark}
      {children}
      {iconSide === 'right' && mark}
    </>
  );
  const link = href ?? (to === undefined ? undefined : toHref(to));
  if (link !== undefined && !rest.disabled) {
    return (
      <a
        className={classes}
        href={link}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        data-test-subj={testId}
        title={rest.title}
        aria-label={rest['aria-label']}
      >
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

/**
 * A button that is only an icon, as the original's icon button: round in the theme, and pressed as
 * a button is; `label` is what a screen reader and a hover say. An icon in a `Button` without text
 * is the original's empty button instead, with its corners.
 */
export function IconButton({
  icon,
  label,
  className,
  ...rest
}: Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string }) {
  return (
    <Button
      variant="ghost"
      {...rest}
      className={cx('atlButton--round', className)}
      icon={icon}
      aria-label={label}
      title={rest.title ?? label}
    />
  );
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

/** A state and its word, as the original's: OUI's dot in the state's colour */
export function Health({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('atlHealth', tone && `atlHealth--${tone}`)}>
      <Icon name="dot" />
      {children}
    </span>
  );
}

/**
 * As the original's call-out: the icon and the title on a line in the colour of the kind, and the
 * text under them from the same edge. As there, the icon is the one the page names, and a call-out
 * without a title has neither.
 */
export function CallOut({
  tone = 'accent',
  size = 'm',
  icon,
  title,
  children,
}: {
  tone?: Tone;
  /** 's': the original's small call-out, a line in less padding */
  size?: 's' | 'm';
  /** The icon before the title, where the original gives one */
  icon?: IconName;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx('atlCallOut', tone !== 'accent' && `atlCallOut--${tone}`, size === 's' && 'atlCallOut--s')} role="status">
      {title && (
        <div className="atlCallOut__header">
          {icon && <Icon name={icon} />}
          <div className="atlCallOut__title">{title}</div>
        </div>
      )}
      {children && <div className="atlCallOut__body">{children}</div>}
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
      {icon && <Icon name={icon} size="xxl" />}
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
  testId?: string;
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
            data-test-subj={tab.testId}
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
            data-test-subj={tab.testId}
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
          <Icon name="chevronRight" className="atlAccordion__arrow" />
          <span className="atlGrow">{title}</span>
        </button>
        {extra}
      </div>
      {open && <div>{children}</div>}
    </div>
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
