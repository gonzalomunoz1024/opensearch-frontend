/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The panel the plugin puts around its lists and around the parts of its pages (its
 * ContentPanel): the title in the theme's largest heading with the count of what is listed, the
 * buttons at its right 24 px apart, a rule, and what it holds 16 px from its sides. Its buttons
 * (ContentPanelActions) are the theme's small buttons, each with the test id its text gives it.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Button, IconButton, Panel, cx, type ButtonProps } from '../../components/basic';
import { Icon } from '../../components/icon';

export function ContentPanel({
  title,
  itemCount = 0,
  subTitleText,
  actions,
  children,
  bodyStyles,
  panelStyles,
  noExtraPadding,
  ghost,
  accordion,
  testId,
}: {
  /** Text is drawn as the plugin draws it; anything else stands as it is */
  title?: ReactNode;
  /** Shown after the title when there is something to count */
  itemCount?: number;
  subTitleText?: ReactNode;
  /** One element, or several that each take a place in the row */
  actions?: ReactNode | ReactNode[];
  children?: ReactNode;
  bodyStyles?: CSSProperties;
  panelStyles?: CSSProperties;
  /** No room above and below the title, and none around the rule */
  noExtraPadding?: boolean;
  /** No panel: the title, the rule and what it holds on the page itself */
  ghost?: boolean;
  /** The title opens and closes what the panel holds, which is closed at first */
  accordion?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const titles = title ? (
    <div className={cx('ismContentPanel__titles', accordion && 'ismContentPanel__titles--toggle')}>
      {typeof title === 'string' ? (
        <h1 className="ismContentPanel__title">
          {title}
          <span className="panel-header-count">
            {' '}
            {itemCount > 0 ? `(${itemCount})` : null}{' '}
          </span>
        </h1>
      ) : (
        title
      )}
      {typeof subTitleText === 'string'
        ? subTitleText && <div className="ismContentPanel__subtitle">{subTitleText}</div>
        : subTitleText}
    </div>
  ) : null;
  // As the theme's accordion, the title is the button and its arrow turns down when open
  const header = accordion ? (
    <button
      type="button"
      className="ismContentPanel__toggle"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <Icon name="chevronRight" className="ismContentPanel__arrow" />
      {titles}
    </button>
  ) : (
    <div className={cx('ismContentPanel__header', ghost && 'ismContentPanel__header--ghost')}>
      {titles}
      {actions ? (
        <div className="ismContentPanel__actions">
          {Array.isArray(actions) ? (
            actions.map((action, index) => <div key={index}>{action}</div>)
          ) : (
            <div>{actions}</div>
          )}
        </div>
      ) : null}
    </div>
  );
  const content = (
    <>
      {header}
      {!ghost && (
        <hr
          className={cx('ismContentPanel__rule', noExtraPadding && 'ismContentPanel__rule--none')}
        />
      )}
      {children ? (
        <div
          className={cx(!ghost && 'ismContentPanel__body')}
          style={accordion && !open ? { ...bodyStyles, display: 'none' } : bodyStyles}
        >
          {children}
        </div>
      ) : null}
    </>
  );
  if (ghost) {
    return (
      <div className={cx(noExtraPadding && 'ismContentPanel--ghostFlush')} data-test-subj={testId}>
        {content}
      </div>
    );
  }
  return (
    <div
      className={cx('ismContentPanel', noExtraPadding && 'ismContentPanel--flush')}
      style={panelStyles}
      data-test-subj={testId}
    >
      {content}
    </div>
  );
}

export interface PanelAction {
  text: string;
  buttonProps?: Omit<ButtonProps, 'children' | 'testId'>;
  /** Stands in the place of the button */
  children?: ReactNode;
}

/** The buttons of a panel: the theme's small ones, a test id from each text, 24 px apart */
export function ContentPanelActions({ actions }: { actions: PanelAction[] }) {
  return (
    <div className="ismContentPanel__buttons">
      {actions.map(({ text, buttonProps, children }, index) => (
        <div key={index}>
          {children ?? (
            <Button {...buttonProps} testId={`${text}Button`}>
              {text}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The title of a part of an operation's page that opens: the theme's small icon button with its
 * arrow, then the panel's small title, as the plugin's advanced settings have it.
 */
export function FoldTitle({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="ismFoldTitle">
      {/* The theme's icon button says what it is to a screen reader only: no hover */}
      <IconButton
        icon={open ? 'chevronDown' : 'chevronRight'}
        label="drop down icon"
        title=""
        testId="advanceOptionToggle"
        onClick={onToggle}
      />
      <h2 className="ismPanelTitle">{children}</h2>
    </div>
  );
}

/**
 * What a list is for, under its title: the plugin's form row with no field, of which only the help
 * text shows. `half` keeps the text to half the width, as the list of aliases has it.
 */
export function TitleHelp({ children, half }: { children: ReactNode; half?: boolean }) {
  return (
    <div className="ismCustomRow__help">
      <div className={half ? 'ismContentPanel__half' : undefined}>{children}</div>
    </div>
  );
}

/**
 * The plugin's panel of one part of a page: the theme's panel, its small title (`large`: the
 * heading of a small text, 22 px), what it is for in small grey text, a rule 8 px under them, and
 * what it holds. The plugin often puts the title in a flex group (`grouped`), which draws it 2 px up
 * and to the left and the rule 2 px closer.
 */
export function TitledPanel({
  title,
  large,
  grouped,
  subtitle,
  children,
}: {
  title: ReactNode;
  large?: boolean;
  grouped?: boolean;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Panel className="ismTitledPanel">
      <h2 className={cx('ismPanelTitle', large && 'ismPanelTitle--l', grouped && 'ismPanelTitle--grouped')}>{title}</h2>
      {subtitle && (
        <div className="ismTitledPanel__subtitle">
          <p>{subtitle}</p>
        </div>
      )}
      <hr className="ismRule" />
      {children}
    </Panel>
  );
}

/**
 * What something is, as the plugin's grid of descriptions: a name over each value, four to a row,
 * 24 px apart. `headings`: each name is the fourth heading of a small text, 15 px on 20, as in the
 * plugin's horizontal description lists.
 */
export function FactGrid({
  items,
  columns = 4,
  headings,
}: {
  items: Array<[string, ReactNode]>;
  columns?: number;
  headings?: boolean;
}) {
  return (
    <div className="ismFactGrid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map(([title, value]) => (
        <dl key={title} className="ismFactGrid__item">
          <dt>{headings ? <h4 className="ismFactGrid__h4">{title}</h4> : title}</dt>
          <dd>{value}</dd>
        </dl>
      ))}
    </div>
  );
}

/**
 * What a list says when it has nothing to show: the theme's empty prompt as the plugin fills it,
 * a small text and, under it, what to do next. `wide` is the Indexes list's, 45 em at most.
 */
export function ListEmpty({ text, children, wide }: { text: string; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('ismListEmpty', wide && 'ismListEmpty--wide')}>
      <div className="ismListEmpty__text">
        <p>{text}</p>
      </div>
      {children ? <div className="ismListEmpty__actions">{children}</div> : null}
    </div>
  );
}
