/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The panel the plugin puts around its lists and around the parts of its pages (its
 * ContentPanel): the title in the theme's largest heading with the count of what is listed, the
 * buttons at its right 24 px apart, a rule, and what it holds 16 px from its sides. Its buttons
 * (ContentPanelActions) are the theme's small buttons, each with the test id its text gives it.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Button, cx, type ButtonProps } from '../../components/basic';

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
  testId?: string;
}) {
  const header = (
    <div className={cx('ismContentPanel__header', ghost && 'ismContentPanel__header--ghost')}>
      {title ? (
        <div className="ismContentPanel__titles">
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
      ) : null}
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
        <div className={cx(!ghost && 'ismContentPanel__body')} style={bodyStyles}>
          {children}
        </div>
      ) : null}
    </>
  );
  if (ghost) return <div data-test-subj={testId}>{content}</div>;
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
