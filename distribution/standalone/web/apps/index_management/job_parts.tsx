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
import { Modal } from '../../components/overlay';
import { Pagination } from '../../components/table';
import { LocalTable, ism, toasts, type Answer, type TableColumn } from './common';
import { useSpaced } from './index_select';
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
      <Icon name="external" size="s" className="ismDocs__icon" />
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
export function JobsPanel({ title, actions, children }: { title: ReactNode; actions: ReactNode; children: ReactNode }) {
  return (
    <section className="atlPanel ismJp">
      <div className="ismJp__header">
        <h1 className="ismJp__title atlTitleL">{title}</h1>
        <div className="ismJp__actions">{actions}</div>
      </div>
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
  children,
  testId,
}: {
  title: ReactNode;
  optional?: boolean | 'title';
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="atlPanel ismTp" data-test-subj={testId}>
      <div className={cx('ismTp__header', optional && 'ismTp__header--optional')}>
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
  /** What a screen reader calls the box: the component library's search bar says what it does */
  ariaLabel?: string;
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
      aria-label={ariaLabel}
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

/** The steps of a form at its left: the ones not reached yet are pale */
export function Steps({ titles, step }: { titles: string[]; step: number }) {
  return (
    <ol className="ismSteps">
      {titles.map((title, at) => (
        <li
          key={title}
          className={cx('ismSteps__step', at + 1 > step && 'ismSteps__step--disabled')}
          aria-current={at + 1 === step ? 'step' : undefined}
        >
          <span className="ismSteps__number">{at + 1}</span>
          <span className="ismSteps__title">{title}</span>
        </li>
      ))}
    </ol>
  );
}

/** A form in steps: the steps, the step that is open, and the buttons that move between them */
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
    <div className="ismPage ismPage--form">
      <div className="ismWizard">
        <aside className="ismWizard__steps">
          <Steps titles={titles} step={step} />
        </aside>
        <div className="ismWizard__body">
          <h1 className="ismPageTitle">{headings[step - 1]}</h1>
          {children}
        </div>
      </div>
      <div className="ismButtons">{buttons}</div>
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
}: {
  jobId: string;
  jobIdError?: string;
  placeholder: string;
  description: string;
  isEdit?: boolean;
  onChangeName?: (name: string) => void;
  onChangeDescription: (description: string) => void;
}) {
  return (
    <FormPanel title="Job name and description">
      <FieldRow title="Name" help="Specify a unique, descriptive name." error={jobIdError}>
        <TextField
          compact
          value={jobId}
          onChange={(name) => onChangeName?.(name)}
          placeholder={placeholder}
          invalid={Boolean(jobIdError)}
          disabled={isEdit}
        />
      </FieldRow>
      <FieldRow title="Description" optional>
        <TextArea value={description} onChange={onChangeDescription} rows={3} testId="description" />
      </FieldRow>
    </FormPanel>
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
      wide
      footer={
        <>
          <Button variant="empty" size="s" onClick={onClose} testId={cancelTestId}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="s"
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
        />
      </div>
    </Modal>
  );
}
