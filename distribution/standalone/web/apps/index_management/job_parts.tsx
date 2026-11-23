/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the pages of policies, managed indexes, rollup jobs and transform jobs are made of: the
 * panels, titles and spaces of the plugin's pages, and the parts the two kinds of job share.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Panel, cx } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { SearchField, TextArea, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { ContextMenu, Modal, Popover, Portal, copyText, type ContextMenuItem } from '../../components/overlay';
import { Pagination } from '../../components/table';
import { LocalTable, ism, toasts, type Answer, type TableColumn } from './common';
import { useSpaced } from './index_select';
import { JsonBlock } from './json_block';
import { leadingDebounce } from './jobs';
import { ModalButtons, PluginModal } from './plugin_modal';
import { aceActiveLine, aceEditorTokens, aceGutterWidth, aceLineRange } from './policy_model';
import { wildcardOption, type FieldItem } from './rollup_model';

// --- The panels and spaces of the plugin's pages ------------------------------------------------------

/** An empty space between two parts, of the sizes the component library has */
export function Spacer({ size = 'l' }: { size?: 'xs' | 's' | 'm' | 'l' | 'xl' }) {
  return <div className={`ismSpacer ismSpacer--${size}`} />;
}

/** The thin line under a panel's title, with the 8 px above and below it the plugin gives it */
export function Rule() {
  return <hr className="ismRuleXs" />;
}

/** A link to the documentation, opened in a new tab, with the small arrow the component library puts after it */
export function DocsLink({ href, children = 'Learn more' }: { href: string; children?: ReactNode }) {
  return (
    <a className="ismDocs" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" size="s" className="ismDocs__icon" title="External link" />
      <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
    </a>
  );
}

/**
 * A radio button as the component library draws it: a circle of 16 px at the left of its label, on
 * a line of 24 px, filled with the accent around a dot when it is chosen. As the original's, only the
 * circle and the label take a click, and the test id is on what holds them.
 */
export function Radio({
  id,
  label,
  checked,
  onChange,
  name,
  disabled,
  testId,
}: {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  name?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div className="ismRadio" data-test-subj={testId}>
      <input
        className="ismRadio__input"
        type="radio"
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label className="ismRadio__label" htmlFor={id}>
        {label}
      </label>
    </div>
  );
}

/**
 * A dialog that opens with the focus on itself, as the component library's does, and not on its
 * first field: the reference goes on anything the dialog holds.
 */
export function useDialogFocus<T extends HTMLElement>() {
  const inside = useRef<T>(null);
  useEffect(() => {
    inside.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  }, []);
  return inside;
}

/**
 * The panel of a list as the plugin's ContentPanel draws it: the title at 28 px with the count
 * of what is listed, the buttons at its right, a line, and the list across the whole panel.
 */
export function ListPanel({
  title,
  count = 0,
  actions,
  children,
  testId,
}: {
  title: ReactNode;
  count?: number;
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="ismLp" data-test-subj={testId}>
      <div className="ismLp__header">
        <h1 className="ismLp__title atlTitleL">
          {title}
          <span className="panel-header-count"> {count > 0 ? `(${count})` : null} </span>
        </h1>
        {actions && <div className="ismLp__actions">{actions}</div>}
      </div>
      <Rule />
      {children && <div>{children}</div>}
    </section>
  );
}

/** The panel of the lists of rollup jobs and transform jobs: the title and the buttons in one row */
export function JobsPanel({
  title,
  titleSize = 'l',
  actions,
  children,
}: {
  title: ReactNode;
  /**
   * 'm': as the list of transform jobs, a smaller title that is a third-level heading, a line
   * under it, and nothing at the panel's sides, so that the lines and the table reach its edges
   */
  titleSize?: 'l' | 'm';
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cx('atlPanel ismJp', titleSize === 'm' && 'ismJp--wide')}>
      <div className="ismJp__header">
        {titleSize === 'm' ? (
          <h3 className="ismJp__title atlTitleM">{title}</h3>
        ) : (
          <h1 className="ismJp__title atlTitleL">{title}</h1>
        )}
        <div className="ismJp__actions">{actions}</div>
      </div>
      {titleSize === 'm' && <hr className="ismRuleXs ismJp__rule" />}
      <div>{children}</div>
    </section>
  );
}

/**
 * A panel of a form or of a page of details: the title at 17 px, "– optional" after it when the
 * panel may be left empty, a line of what it is for, a line, and what it holds. `optional="title"`
 * sets "– optional" as tight as a title, where the plugin wraps it in one.
 */
export function TitledPanel({
  title,
  optional,
  description,
  actions,
  itemTitle,
  children,
  testId,
}: {
  title: ReactNode;
  optional?: boolean | 'title';
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * The title in an item of the plugin's row, as the pages of one job have it: the row's -2 px and
   * the item's 2 px cancel out, and the title is level with the top of the buttons beside it
   */
  itemTitle?: boolean;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="atlPanel ismTp" data-test-subj={testId}>
      <div className={cx('ismTp__header', optional && 'ismTp__header--optional', itemTitle && 'ismTp__header--item')}>
        <h2 className="atlTitleS ismTp__title">{title}</h2>
        {optional && <i className={cx('ismTp__optional', optional === 'title' && 'ismTp__optional--title')}>– optional</i>}
        {actions && <div className="ismTp__actions">{actions}</div>}
      </div>
      {description && <p className="ismTp__description">{description}</p>}
      <Rule />
      {children}
    </section>
  );
}

/**
 * The name of a field at 17 px over what it is for, as the plugin's own form labels are drawn,
 * each 5 px over what follows it.
 */
export function CustomLabel({
  title,
  help,
  optional,
  invalid,
}: {
  title: ReactNode;
  help?: ReactNode;
  optional?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="ismLabel">
      <h3 className={cx('ismLabel__title', invalid && 'ismLabel__title--invalid')}>
        {title}
        {optional && (
          <span className="ismLabel__optional">
            <em>– optional</em>
          </span>
        )}
      </h3>
      {help ? (
        <p className="ismLabel__help">
          <span>{help}</span>
        </p>
      ) : (
        <p className="ismLabel__help" />
      )}
    </div>
  );
}

/**
 * A field as the plugin's compressed form rows lay it out with an `EuiText size="s"` h3 for its
 * name: the name at 17 px, 4 px over the field, at most 400 px wide, then what is wrong with it and
 * what it is for, each 4 px under what is above it; two rows 16 px apart.
 */
export function PluginRow({
  title,
  help,
  error,
  children,
}: {
  title?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ismPr">
      {title && (
        <div className="ismPr__label">
          <h3 className="ismPr__title">{title}</h3>
        </div>
      )}
      <div className="ismPr__field">{children}</div>
      {error && <div className="ismPr__error">{error}</div>}
      {help && <div className="ismPr__help">{help}</div>}
    </div>
  );
}

/**
 * The plugin's ConfirmationModal: its title, what it asks in a line, Cancel and the action, as wide
 * as what it says up to 1000 px. The action is run and the dialog closed at once, as there.
 */
export function PluginConfirmationModal({
  title,
  bodyMessage,
  actionMessage,
  onClose,
  onAction,
}: {
  title: string;
  bodyMessage: ReactNode;
  actionMessage: string;
  onClose: () => void;
  onAction: () => void | Promise<void>;
}) {
  const body = useDialogFocus<HTMLParagraphElement>();
  return (
    <PluginModal
      title={title}
      onClose={onClose}
      className="ismWideModal ismMasked"
      footer={
        <ModalButtons
          label={actionMessage}
          onCancel={onClose}
          onConfirm={() => {
            void onAction();
            onClose();
          }}
          cancelTestId="confirmationModalCloseButton"
          confirmTestId="confirmationModalActionButton"
        />
      }
    >
      <p ref={body}>{bodyMessage}</p>
    </PluginModal>
  );
}

/**
 * The "Actions" button of a list of jobs and its small context menu, hung from the button's left
 * edge as the plugin hangs it: each item after an empty icon, the first one that can be chosen with
 * the focus.
 */
export function JobActionsMenu({
  items,
  disabled,
  plain,
}: {
  items: ContextMenuItem[];
  disabled?: boolean;
  /** As the page of a transform job: the menu at its usual size, with nothing around it */
  plain?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="ismActions" data-test-subj="actionPopover">
      <Popover
        open={open}
        onClose={close}
        position="downLeft"
        offset={8}
        className={cx('ismActionsPopover', plain && 'ismActionsPopover--plain')}
        button={
          <Button icon="chevronDown" iconSide="right" disabled={disabled} onClick={() => setOpen(!open)} testId="actionButton">
            Actions
          </Button>
        }
      >
        <ContextMenu small={!plain} panels={[{ id: 'actions', items }]} onDone={close} />
      </Popover>
    </div>
  );
}

/**
 * The plugin's dialog that deletes jobs: the component library's confirmation in a mask of the
 * plugin's own, as wide as what it says up to 768 px, then a field where "delete" is typed, Cancel
 * and Delete. It opens with the focus on itself, as Delete cannot take it yet.
 */
export function DeleteJobsModal({
  children,
  onClose,
  onDelete,
}: {
  children: ReactNode;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const body = useDialogFocus<HTMLDivElement>();
  return (
    <PluginModal
      title="Delete job(s)"
      titleTestId="confirmModalTitleText"
      onClose={onClose}
      className="ismMasked ismConfirmModal"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="confirmModalCancelButton">
            Cancel
          </Button>
          <Button variant="dangerFill" disabled={typed !== 'delete'} onClick={() => void onDelete()} testId="confirmModalConfirmButton">
            Delete
          </Button>
        </>
      }
    >
      <div ref={body} data-test-subj="confirmModalBodyText">
        <p>{children}</p>
        <Spacer size="s" />
        <PluginRow help="To confirm deletion, enter delete in the text field">
          <TextField compact value={typed} onChange={setTyped} placeholder="delete" testId="deleteTextField" />
        </PluginRow>
      </div>
    </PluginModal>
  );
}

/** The buttons under a form, at its right: the one that leaves it and the one that saves it */
export function FormButtons({ children }: { children: ReactNode }) {
  return <div className="ismFormButtons">{children}</div>;
}

/**
 * JSON in an editor drawn as the plugin's code editor: the light theme of Ace the plugin picks,
 * with its grey gutter, or its dark one in the dark theme, and the line of the cursor on a band.
 * The cursor starts where the plugin's editor leaves it: at the start of a text that arrives after
 * the editor is drawn, at the end of one it is drawn with (`cursorAtEnd`).
 *
 * As the plugin's, the Tab key reaches the text through a hint that lies under it and comes over it
 * while it has the focus: Enter or a click there starts the editing where the cursor was left, and
 * hides the hint until the text loses the focus. A click on the text itself goes to the text, at
 * the place clicked. Escape goes back to the hint without closing what the editor is in.
 */
export function AceJsonEditor({
  value,
  onChange,
  height,
  testId,
  cursorAtEnd,
}: {
  value: string;
  onChange?: (value: string) => void;
  height: number;
  testId?: string;
  cursorAtEnd?: boolean;
}) {
  const [cursor, setCursor] = useState<[number, number]>(() =>
    cursorAtEnd ? [value.length, value.length] : [0, 0]
  );
  // The hint is put away by the editing it starts, and back once the text loses the focus
  const [hintActive, setHintActive] = useState(true);
  const [scrolled, setScrolled] = useState(0);
  const [lineHeight, setLineHeight] = useState(16);
  const box = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLButtonElement>(null);
  const area = () => box.current?.querySelector<HTMLTextAreaElement>('textarea');
  useEffect(() => {
    // The Tab key stops at the hint, never in the text
    const text = area();
    if (text) text.tabIndex = -1;
    const line = box.current?.querySelector('.atlCodeEditor__line');
    if (line) setLineHeight(line.getBoundingClientRect().height || 16);
  }, []);
  const start = () => {
    setHintActive(false);
    const text = area();
    if (!text) return;
    text.focus({ preventScroll: true });
    text.setSelectionRange(Math.min(cursor[0], value.length), Math.min(cursor[1], value.length));
  };
  const active = aceActiveLine(value, cursor[0], cursor[1]);
  const gutter = aceGutterWidth(value.split('\n').length, height, lineHeight, scrolled);
  // The marks to fold blocks, and the box around the bracket that pairs with the one at the cursor
  const lead = cursor[1];
  const tokenize = useCallback((text: string) => aceEditorTokens(text, lead), [lead]);
  return (
    <div
      ref={box}
      className="ismAceBox"
      style={{ '--ace-gutter-width': `${gutter}px` } as CSSProperties}
      onBlur={(event) => {
        if (event.target instanceof HTMLTextAreaElement) setHintActive(true);
      }}
      onClick={(event) => {
        // As Ace's: a click on a line's number selects the line, a double click there everything
        const text = area();
        const left = box.current?.getBoundingClientRect().left ?? 0;
        if (!text || event.target !== text || event.clientX - left >= gutter) return;
        const [from, to] = event.detail >= 2 ? [0, value.length] : aceLineRange(value, text.selectionStart);
        text.setSelectionRange(from, to);
      }}
      data-test-subj="codeEditorContainer"
    >
      <button
        ref={hint}
        type="button"
        className={cx('ismAceHint', !hintActive && 'ismAceHint--inactive')}
        onClick={start}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          start();
        }}
        data-test-subj="codeEditorHint"
      >
        <p>Press Enter to start editing.</p>
        <p>When you&apos;re done, press Escape to stop editing.</p>
      </button>
      <CodeEditor
        value={value}
        onChange={onChange}
        height={height}
        tokenize={tokenize}
        ariaLabel="Code Editor"
        testId={testId}
        className="ismAce"
        markedLines={active === undefined ? undefined : [active, active]}
        onCursor={(from, to) => setCursor([from, to])}
        onScroll={setScrolled}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          // The key leaves the text and nothing else hears it
          event.preventDefault();
          event.stopPropagation();
          setHintActive(true);
          // Once React has shown the hint again
          setTimeout(() => hint.current?.focus(), 0);
        }}
      />
    </div>
  );
}

/**
 * The search box over a list, and the pages of the list beside it when there is more than one,
 * as the plugin's list controls have them. `filters` are the search bar's own filters, 8 px after
 * the box; `children` come after the search bar, 24 px apart.
 */
export function ListSearch({
  search,
  onSearch,
  placeholder = 'Search',
  page,
  pages = 1,
  onPage,
  paginationTestId,
  filters,
  className,
  ariaLabel = placeholder,
  children,
}: {
  search: string;
  onSearch: (text: string) => void;
  placeholder?: string;
  page?: number;
  pages?: number;
  onPage?: (page: number) => void;
  paginationTestId?: string;
  filters?: ReactNode;
  className?: string;
  /**
   * What a screen reader calls the box: the component library's search bar says what it does;
   * `null` names it nothing, as the plugin's boxes that have only a placeholder
   */
  ariaLabel?: string | null;
  children?: ReactNode;
}) {
  // As the component library's search field, a button clears what is typed and puts the focus back
  const clear =
    search === '' ? undefined : (
      <button
        type="button"
        className="ismLs__clear"
        aria-label="Clear input"
        onClick={(event) => {
          event.currentTarget.parentElement?.querySelector('input')?.focus();
          onSearch('');
        }}
      >
        <Icon name="cross" />
      </button>
    );
  const box = (
    <SearchField
      compact
      value={search}
      onChange={onSearch}
      placeholder={placeholder}
      aria-label={ariaLabel ?? undefined}
      append={clear}
    />
  );
  return (
    <div className={cx('ismLs', className)}>
      <div className="ismLs__search">
        {filters ? (
          <div className="ismLs__bar">
            <div className="ismLs__box">{box}</div>
            {filters}
          </div>
        ) : (
          box
        )}
      </div>
      {children}
      {pages > 1 && page !== undefined && onPage && (
        <div className="ismLs__pages" data-test-subj={paginationTestId}>
          <Pagination page={page} pages={pages} onPage={onPage} />
        </div>
      )}
    </div>
  );
}

/** What a list says in place of its rows when it has none, and what it offers to do then */
export function ListEmptyPrompt({ body, actions }: { body: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ismPrompt">
      <p>{body}</p>
      {actions && (
        <>
          <Spacer />
          <div className="ismPrompt__actions">{actions}</div>
        </>
      )}
    </div>
  );
}

/**
 * Loads a list when the page opens and whenever what it shows changes, at most once in half a
 * second after the first time, as the plugin's lists do: the first change is asked for at once,
 * the last of those that follow it half a second after it was made.
 */
export function useListLoad(load: () => Promise<void> | void, deps: unknown[]) {
  const latest = useRef(load);
  latest.current = load;
  const debounced = useRef<ReturnType<typeof leadingDebounce<[]>>>();
  if (!debounced.current) {
    debounced.current = leadingDebounce(() => void latest.current(), 500, {
      setTimeout: (run, ms) => window.setTimeout(run, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    });
  }
  useEffect(() => {
    debounced.current?.call();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => () => debounced.current?.cancel(), []);
  // Asking again by hand goes the same way, as the plugin's Refresh does
  return useCallback(() => debounced.current?.call(), []);
}

/**
 * The steps of a form at its left, as the plugin's small steps: a numbered circle and a 15 px title
 * each, a line down to the next one, the steps not reached yet grey, and what a screen reader says
 * of each number
 */
export function Steps({ titles, step }: { titles: string[]; step: number }) {
  return (
    <div className="ismJobSteps">
      {titles.map((title, at) => {
        const disabled = at + 1 > step;
        return (
          <div key={title} className={cx('ismJobStep', disabled && 'ismJobStep--disabled')}>
            <div className="ismJobStep__titleWrapper">
              <span className="ismJobStep__number">
                <span className="atlScreenReaderOnly">{disabled ? `Step ${at + 1} is disabled` : `Step ${at + 1}`}</span>
                <span aria-hidden="true">{at + 1}</span>
              </span>
              <h6 className="ismJobStep__title">{title}</h6>
            </div>
            <div className="ismJobStep__content" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A form in steps as the plugin lays it out: padded 5 px and 50 px, the steps at the left as wide as
 * their titles, the open step beside them under its 28 px title, and the buttons under both at the
 * right. The steps' panels bring their own spacers.
 */
export function Wizard({
  titles,
  headings = titles,
  step,
  children,
  buttons,
}: {
  titles: string[];
  /** What each step is called over its fields, where that is not what the list of steps calls it */
  headings?: string[];
  step: number;
  children: ReactNode;
  buttons: ReactNode;
}) {
  return (
    <div className="ismJobForm">
      <div className="ismJobWizard">
        <div className="ismJobWizard__row">
          <div className="ismJobWizard__steps">
            <Steps titles={titles} step={step} />
          </div>
          <div className="ismJobWizard__body">
            <h1 className="atlTitleL">{headings[step - 1]}</h1>
            <Spacer />
            {children}
          </div>
        </div>
        <Spacer />
      </div>
      <div className="ismJobWizard__buttons">{buttons}</div>
    </div>
  );
}

// --- The page of one job -----------------------------------------------------------------------------

/** The page of one rollup or transform job, padded 5 px and 50 px as the plugin pads it */
export function JobDetailsPage({ children }: { children: ReactNode }) {
  return <div className="ismJd">{children}</div>;
}

/** The page that changes a job, padded 25 px and 50 px, its title at 28 px 24 px over the panels */
export function JobEditPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ismJobEdit">
      <h1 className="atlTitleL">{title}</h1>
      <Spacer />
      {children}
    </div>
  );
}

/**
 * The row over a job's details, as the plugin's: its name at 28 px, whether it is enabled, and its
 * buttons, 10 px in from the panels' edges and 24 px over the first of them
 */
export function JobDetailsHeader({ title, health, actions }: { title: string; health?: ReactNode; actions: ReactNode }) {
  return (
    <>
      <div className="ismJdHeader">
        <h1 className="ismJdHeader__title atlTitleL">{title}</h1>
        <div className="ismJdHeader__health">{health}</div>
        <div className="ismJdHeader__actions">{actions}</div>
      </div>
      <Spacer />
    </>
  );
}

export interface InfoItem {
  term: string;
  value: ReactNode;
  /** What stands under the term as it is, where the plugin puts it there without a `dd` */
  bare?: boolean;
}

/**
 * Terms over their values in the plugin's grid of three or four columns 24 px apart (an
 * EuiFlexGrid of EuiText): a long word widens its column, and what no longer fits in the row moves
 * to the next, as there. `xs` is the smaller text of the time aggregation's terms.
 */
export function InfoGrid({ items, columns = 4, size = 's' }: { items: InfoItem[]; columns?: 3 | 4; size?: 's' | 'xs' }) {
  return (
    <div className={`ismInfoGrid ismInfoGrid--${columns} ismInfoGrid--${size}`}>
      {items.map((item, index) => (
        <div className="ismInfoGrid__item" key={`${item.term}-${index}`}>
          <dt>{item.term}</dt>
          {item.bare ? item.value : <dd>{item.value}</dd>}
        </div>
      ))}
    </div>
  );
}

/**
 * JSON as the plugin's EuiCodeBlock with `isCopyable` and `overflowHeight={600}` shows it: the
 * code at 14 px, 16 px in, at most 600 px high, and two round buttons at its top right: full
 * screen and copy. Full screen covers the window with the code, 32 px in, until Collapse or Escape
 * (which leaves the dialog under it open).
 */
function CopyableJson({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setFull(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [full]);
  const block = (
    <div className={cx('ismJobJson', full && 'ismJobJson--full')}>
      <JsonBlock text={text} />
      <div className="ismJobJson__controls">
        <button
          type="button"
          className="ismJobJson__control"
          aria-label={full ? 'Collapse' : 'Expand'}
          onClick={() => setFull(!full)}
        >
          <Icon name={full ? 'fullScreenExit' : 'fullScreen'} />
        </button>
        <button type="button" className="ismJobJson__control" aria-label="Copy" onClick={() => copyText(text)}>
          <Icon name="copyClipboard" />
        </button>
      </div>
    </div>
  );
  return full ? (
    <Portal>
      <div className="ismJobJsonFull">{block}</div>
    </Portal>
  ) : (
    block
  );
}

/**
 * "View JSON" of a job as the plugin's: its EuiModal in an EuiOverlayMask (two masks), the title
 * in EuiText s, the code block, and Close
 */
export function JobJsonModal({
  title,
  json,
  onClose,
  small,
}: {
  title: string;
  json: unknown;
  onClose: () => void;
  /** As a transform job's: the code at 12 px, in a dialog as wide as it up to 768 px */
  small?: boolean;
}) {
  const body = useDialogFocus<HTMLDivElement>();
  return (
    <PluginModal
      title={title}
      onClose={onClose}
      className={small ? 'ismFitModal ismJsonSmall ismMasked' : 'ismWideModal ismMasked'}
      footer={
        <Button variant="empty" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div ref={body}>
        <CopyableJson text={JSON.stringify(json, null, 4)} />
      </div>
    </PluginModal>
  );
}

/** A title of a part of a panel and how many it holds, the number apart, as the plugin sets them */
export function CountedTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="ismCounted">
      <h3>{title}</h3>
      <h3>({count})</h3>
    </div>
  );
}

/** A panel of a form: its title over a line, and its fields */
export function FormPanel({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <div className="ismFormPanel__header">
        <h2 className="ismPanel__heading">{title}</h2>
        {actions}
      </div>
      <hr className="ismRule" />
      <div className="ismFormPanel__body">{children}</div>
    </Panel>
  );
}

/** A field under its name, with what is wrong with it and what it means below it */
export function FieldRow({
  title,
  optional,
  help,
  error,
  wide,
  small,
  minor,
  children,
}: {
  title?: ReactNode;
  optional?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  /** Takes the width it is given instead of that of a field */
  wide?: boolean;
  /** The name is a small label, not a heading */
  small?: boolean;
  /** The name is a heading under those of the other rows */
  minor?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx('ismRow', wide && 'ismRow--wide')}>
      {title && small && <div className="ismRow__label">{title}</div>}
      {title && !small && minor && <h4 className="ismRow__title ismRow__title--minor">{title}</h4>}
      {title && !small && !minor && (
        <h3 className="ismRow__title">
          {title}
          {optional && <i> – optional</i>}
        </h3>
      )}
      <div className="ismRow__field">{children}</div>
      {error && <div className="ismLabeled__error">{error}</div>}
      {help && <div className="ismLabeled__help">{help}</div>}
    </div>
  );
}

/** The name of a job and what it is for; the name of a job that exists cannot be changed */
export function ConfigureJob({
  jobId,
  jobIdError,
  placeholder,
  description,
  isEdit,
  onChangeName,
  onChangeDescription,
  transform,
}: {
  jobId: string;
  jobIdError?: string;
  placeholder: string;
  description: string;
  isEdit?: boolean;
  onChangeName?: (name: string) => void;
  onChangeDescription: (description: string) => void;
  /**
   * The transform's panel: its title straight in the panel, and "– optional" a subdued heading
   * beside "Description", where the rollup's is a small subdued line centred on it
   */
  transform?: boolean;
}) {
  return (
    <TitledPanel title="Job name and description" itemTitle={transform}>
      {/* The page that edits a transform has 8 px more over the name */}
      {transform && isEdit && <Spacer size="s" />}
      <PluginRow title="Name" help="Specify a unique, descriptive name." error={jobIdError}>
        <TextField
          compact
          value={jobId}
          onChange={(name) => onChangeName?.(name)}
          placeholder={placeholder}
          invalid={Boolean(jobIdError)}
          disabled={isEdit}
        />
      </PluginRow>
      <Spacer />
      <div className={cx('ismOptional', transform && 'ismOptional--heading')}>
        <h3 className="ismPr__title">Description</h3>
        {transform ? (
          <h3 className="ismPr__title ismOptional__text">
            <i> – optional</i>
          </h3>
        ) : (
          <div className="ismOptional__text">
            <i> – optional</i>
          </div>
        )}
      </div>
      <Spacer size="xs" />
      <div className="ismPr">
        <div className="ismPr__field ismPr__field--area">
          <TextArea
            className="ismJobTextArea"
            value={description}
            onChange={onChangeDescription}
            rows={3}
            testId="description"
          />
        </div>
      </div>
    </TitledPanel>
  );
}

/** A number and the unit it counts, side by side */
export function Paired({ children }: { children: ReactNode }) {
  return <div className="ismPaired">{children}</div>;
}

export interface FoundNames {
  dataStreams: string[];
  indices: string[];
}

/** The data streams and the first ten indexes whose names hold the text */
export async function loadNames(search: string): Promise<Answer<FoundNames>> {
  const [indices, dataStreams] = await Promise.all([
    ism.get<{ indices: Array<{ index: string }> }>('_indices', {
      from: 0,
      size: 10,
      search,
      terms: search,
      sortDirection: 'desc',
      sortField: 'index',
      showDataStreams: true,
    }),
    ism.get<{ dataStreams: Array<{ name: string }> }>('_data_streams', { search }),
  ]);
  if (!indices.ok) return { ok: false, error: indices.error };
  if (!dataStreams.ok) return { ok: false, error: dataStreams.error };
  return {
    ok: true,
    response: {
      dataStreams: (dataStreams.response?.dataStreams ?? []).map((stream) => stream.name),
      indices: (indices.response?.indices ?? []).map((index) => index.index),
    },
  };
}

/**
 * The names a job can read from and write to, looked for again half a second after the typing
 * stops: what was typed as a pattern, the data streams and the indexes to read from; the
 * indexes to write to.
 */
export function useIndexNames(): {
  sources: string[];
  targets: string[];
  loading: boolean;
  onSearch: (text: string) => void;
} {
  const [sources, setSources] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const turn = useRef(0);

  const search = useCallback((text: string) => {
    const mine = (turn.current += 1);
    setLoading(true);
    setSources([]);
    void loadNames(text).then((answer) => {
      if (mine !== turn.current) return;
      if (answer.ok && answer.response) {
        const { dataStreams, indices } = answer.response;
        setSources([...(text.trim() ? [wildcardOption(text)] : []), ...dataStreams, ...indices]);
        setTargets(indices);
      } else if (answer.error?.startsWith('[index_not_found_exception]')) {
        toasts.danger('No index available');
      } else {
        toasts.danger(answer.error);
      }
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    search('');
    return () => {
      turn.current += 1;
    };
  }, [search]);
  return { sources, targets, loading, onSearch: useSpaced(search, 500) };
}

/** Names as the options of a field, each once */
export const nameOptions = (names: string[]) => [...new Set(names)].map((name) => ({ value: name, label: name }));

const FIELD_COLUMNS: Array<TableColumn<FieldItem>> = [
  { field: 'label', name: 'Field name', render: (field) => field.label },
  { field: 'type', name: 'Field type', render: (field) => field.type ?? '-' },
];

/** The fields of the source, to tick the ones to add */
export function AddFieldsModal({
  fields,
  ticked,
  selectable,
  empty,
  onClose,
  onAdd,
  cancelTestId,
  addTestId,
}: {
  fields: FieldItem[];
  /** The fields that are ticked as the dialog opens */
  ticked: FieldItem[];
  selectable?: (field: FieldItem) => boolean;
  empty?: ReactNode;
  onClose: () => void;
  onAdd: (chosen: FieldItem[]) => void;
  cancelTestId: string;
  addTestId: string;
}) {
  const [chosen, setChosen] = useState<FieldItem[]>(() =>
    fields.filter((field) => ticked.some((other) => other.label === field.label))
  );
  return (
    <Modal
      title="Add fields"
      onClose={onClose}
      className="ismAddFieldsModal ismMasked"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId={cancelTestId}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onAdd(chosen);
            }}
            testId={addTestId}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="ismAddFields">
        <LocalTable
          columns={FIELD_COLUMNS}
          rows={fields}
          rowId={(field) => field.label}
          paged={false}
          selected={chosen}
          onSelect={setChosen}
          selectable={selectable}
          empty={empty}
          fixed
        />
      </div>
    </Modal>
  );
}
