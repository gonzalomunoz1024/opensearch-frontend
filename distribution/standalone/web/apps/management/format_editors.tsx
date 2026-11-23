/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editors of the field formats, drawn and run as the plugin index_pattern_management of
 * OpenSearch Dashboards draws and runs them: the parameters of a format, row by row, and a table
 * of sample values written with them as they are. An editor is given every parameter of the format
 * and answers with every one of them, the changed ones among them, as the original's do.
 */

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../components/basic';
import { ColorPicker } from '../../components/color_picker';
import { Icon } from '../../components/icon';
import { Portal } from '../../components/overlay';
import { createFormatter } from '../../lib/field_formats';
import { services } from '../../services';
import {
  DEFAULT_COLOR,
  paramOf,
  sampleInputsOf,
  URL_ICON_PATTERN,
  urlSampleOf,
  type UrlSample,
} from './index_pattern_model';
import { InMemoryTable, type TableColumn } from './index_pattern_table';
import { ExternalLink, FormRow, SelectBox, SmallButton } from './index_patterns';

type Params = Record<string, unknown>;

export interface FormatEditorProps {
  formatId: string;
  fieldType: string;
  /** The parameters as the original's editors are given them: the format's own, then its defaults */
  params: Params;
  /** The parameters the format has when it is given none */
  defaults: Params;
  onChange: (params: Params) => void;
  onError: (error?: string) => void;
}

const NUMERAL_DOCS = 'https://adamwdraper.github.io/Numeral-js/';
const MOMENT_DOCS = 'https://momentjs.com/';

const textOf = (value: unknown) => (value === undefined || value === null ? '' : String(value));

// --- Pieces of EUI the editors share ----------------------------------------------------------------

/** EuiCode: a word of code in a sentence */
export function Code({ children }: { children: ReactNode }) {
  return <code className="inpCode">{children}</code>;
}

/** EuiLink to another site, with the link icon the original puts after its words */
export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <ExternalLink to={href}>
      {children}
      {' '}
      <Icon name="link" className="inpLink__icon" />
    </ExternalLink>
  );
}

/** EuiLink that is a button: it opens something on this page */
export function LinkButton({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="inpLink inpLink--button" onClick={onClick} data-test-subj={testId}>
      {children}
    </button>
  );
}

/** EuiCompressedSwitch */
export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  id?: string;
}) {
  const labelId = useId();
  return (
    <div className="inpSwitch">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        className={cx('inpSwitch__button', checked && 'inpSwitch__button--on')}
        onClick={() => onChange(!checked)}
      >
        <span className="inpSwitch__body">
          <span className="inpSwitch__thumb" />
        </span>
      </button>
      <span className="inpSwitch__label" id={labelId} onClick={() => onChange(!checked)}>
        {label}
      </span>
    </div>
  );
}

/**
 * EuiFlyout as the original's help opens it: a panel at the right of the page, below the header,
 * with no title bar; the page behind is dimmed, and a click on it or Escape closes it
 */
export function HelpFlyout({ onClose, children, testId }: { onClose: () => void; children: ReactNode; testId?: string }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // EUI moves the focus to the first control of the flyout, its close button, and gives it back on closing
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (close.current ?? panel.current)?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <Portal>
      <div className="atlFlyoutMask inpFlyoutMask" onMouseDown={onClose} />
      <aside ref={panel} className="inpFlyout" role="dialog" tabIndex={-1} data-test-subj={testId}>
        <button
          ref={close}
          type="button"
          className="inpButtonIcon inpButtonIcon--text inpButtonIcon--xs inpFlyout__close"
          aria-label="Close this dialog"
          data-test-subj="euiFlyoutCloseButton"
          onClick={onClose}
        >
          <Icon name="cross" />
        </button>
        <div className="inpFlyout__body">{children}</div>
      </aside>
    </Portal>
  );
}

// --- Samples ------------------------------------------------------------------------------------

interface Sample {
  input: unknown;
  output: ReactNode;
}

const SAMPLE_COLUMNS: Array<TableColumn<Sample>> = [
  {
    field: 'input',
    name: 'Input',
    render: (input) => (typeof input === 'object' && input !== null ? JSON.stringify(input) : textOf(input)),
  },
  { field: 'output', name: 'Output', render: (output) => <div>{output as ReactNode}</div> },
];

/** The table of samples, under a row of its own; nothing when there is none */
function Samples({ samples }: { samples: Sample[] }) {
  if (samples.length === 0) return null;
  return (
    <FormRow label="Samples">
      <InMemoryTable
        className="inpSamples"
        compressed
        pagination={false}
        rows={samples}
        columns={SAMPLE_COLUMNS}
        rowKey={(_sample, index) => String(index)}
      />
    </FormRow>
  );
}

/** One value of a URL format's samples, as the HTML the original writes for it */
function UrlPart({ part }: { part: UrlSample }) {
  if (part.kind === 'image') {
    return (
      <img
        src={part.url}
        alt={part.alt}
        style={{ width: 'auto', height: 'auto', maxWidth: part.maxWidth, maxHeight: part.maxHeight }}
      />
    );
  }
  if (part.kind === 'audio') return <audio controls preload="none" src={part.url} />;
  if (part.kind === 'link') {
    return (
      <a href={part.href} target={part.target} rel="noopener noreferrer">
        {part.label}
      </a>
    );
  }
  return <>{part.label}</>;
}

function urlOutput(params: Params, input: unknown): ReactNode {
  const values = Array.isArray(input) ? input : [input];
  return (
    <span>
      {values.map((value, index) => (
        <Fragment key={index}>
          {index > 0 && ', '}
          <UrlPart part={urlSampleOf(params, value)} />
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The samples of an editor, written with the parameters as they are, again at each change; what
 * fails is told to the editor of the field, which then cannot be saved, as in the original
 */
function useSamples(formatId: string, params: Params, inputs: unknown[], onError: (error?: string) => void, html = false) {
  const result = useMemo((): { samples: Sample[]; error?: string } => {
    try {
      const write = createFormatter({ id: formatId, params }, services.formatSettings());
      return {
        samples: inputs.map((input) => ({ input, output: html ? urlOutput(params, input) : write(input).text })),
      };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      return { samples: [], error: `An error occurred while trying to use this format configuration: ${message}` };
    }
  }, [formatId, params, inputs, html]);
  const reportError = useRef(onError);
  reportError.current = onError;
  useEffect(() => {
    reportError.current(result.error);
  }, [result]);
  return result;
}

/** The sample values of a format, fixed when its editor opens: a date's are the time it opened */
function useSampleInputs(formatId: string, params: Params) {
  const [now] = useState(() => new Date());
  const type = formatId === 'url' ? textOf(params.type) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => sampleInputsOf(formatId, params, now), [formatId, type, now]);
}

// --- The editors ---------------------------------------------------------------------------------------

/** Number, bytes and percentage: a Numeral.js pattern */
function NumeralEditor({ formatId, params, defaults, onChange, onError }: FormatEditorProps) {
  const id = useId();
  const inputs = useSampleInputs(formatId, params);
  const { samples, error } = useSamples(formatId, params, inputs, onError);
  const defaultPattern = textOf(defaults.pattern);
  return (
    <>
      <FormRow
        id={id}
        label={
          <>
            Numeral.js format pattern (Default: <Code>{defaultPattern}</Code>)
          </>
        }
        help={
          <span>
            <DocLink href={NUMERAL_DOCS}>Documentation</DocLink>
          </span>
        }
        error={error}
      >
        <input
          id={id}
          type="text"
          className={cx('inpInput', error && 'inpInput--invalid')}
          value={textOf(params.pattern)}
          placeholder={defaultPattern}
          onChange={(event) => onChange({ ...params, pattern: event.target.value })}
        />
      </FormRow>
      <Samples samples={samples} />
    </>
  );
}

/** Date and date nanos: a Moment.js pattern */
function DateEditor({ formatId, params, defaults, onChange, onError }: FormatEditorProps) {
  const id = useId();
  const inputs = useSampleInputs(formatId, params);
  const { samples, error } = useSamples(formatId, params, inputs, onError);
  const defaultPattern = textOf(defaults.pattern);
  return (
    <>
      <FormRow
        id={id}
        label={
          <>
            Moment.js format pattern (Default: <Code>{defaultPattern}</Code>)
          </>
        }
        error={error}
        help={
          <span>
            <DocLink href={MOMENT_DOCS}>Documentation</DocLink>
          </span>
        }
      >
        <input
          id={id}
          type="text"
          className={cx('inpInput', error && 'inpInput--invalid')}
          data-test-subj="dateEditorPattern"
          value={textOf(params.pattern)}
          placeholder={defaultPattern}
          onChange={(event) => onChange({ ...params, pattern: event.target.value })}
        />
      </FormRow>
      <Samples samples={samples} />
    </>
  );
}

const DURATION_INPUTS = [
  { value: 'picoseconds', text: 'Picoseconds' },
  { value: 'nanoseconds', text: 'Nanoseconds' },
  { value: 'microseconds', text: 'Microseconds' },
  { value: 'milliseconds', text: 'Milliseconds' },
  { value: 'seconds', text: 'Seconds' },
  { value: 'minutes', text: 'Minutes' },
  { value: 'hours', text: 'Hours' },
  { value: 'days', text: 'Days' },
  { value: 'weeks', text: 'Weeks' },
  { value: 'months', text: 'Months' },
  { value: 'years', text: 'Years' },
];

const DURATION_OUTPUTS = [
  { value: 'humanize', text: 'Human Readable' },
  { value: 'asMilliseconds', text: 'Milliseconds' },
  { value: 'asSeconds', text: 'Seconds' },
  { value: 'asMinutes', text: 'Minutes' },
  { value: 'asHours', text: 'Hours' },
  { value: 'asDays', text: 'Days' },
  { value: 'asWeeks', text: 'Weeks' },
  { value: 'asMonths', text: 'Months' },
  { value: 'asYears', text: 'Years' },
];

const DECIMAL_ERROR = 'Decimal places must be between 0 and 20';

function DurationEditor({ formatId, params, defaults, onChange, onError }: FormatEditorProps) {
  const ids = [useId(), useId(), useId()];
  const inputs = useSampleInputs(formatId, params);
  const isHuman = paramOf(params.outputFormat, defaults.outputFormat) === 'humanize';
  // More than 20 decimal places is an error of its own, told under that row
  const hasDecimalError = !isHuman && Number(params.outputPrecision) > 20;
  const sampled = useSamples(formatId, params, inputs, (error) => onError(hasDecimalError ? DECIMAL_ERROR : error));
  const error = hasDecimalError ? DECIMAL_ERROR : sampled.error;
  return (
    <>
      <FormRow id={ids[0]} label="Input format" error={hasDecimalError ? undefined : error}>
        <SelectBox
          id={ids[0]}
          value={textOf(params.inputFormat)}
          options={DURATION_INPUTS}
          invalid={!!error}
          onChange={(inputFormat) => onChange({ ...params, inputFormat })}
        />
      </FormRow>
      <FormRow id={ids[1]} label="Output format" invalid={!!error}>
        <SelectBox
          id={ids[1]}
          value={textOf(params.outputFormat)}
          options={DURATION_OUTPUTS}
          invalid={!!error}
          onChange={(outputFormat) => onChange({ ...params, outputFormat })}
        />
      </FormRow>
      {!isHuman && (
        <>
          <FormRow id={ids[2]} label="Decimal places" error={hasDecimalError ? error : undefined} invalid={!!error}>
            <input
              id={ids[2]}
              type="number"
              className={cx('inpInput', error && 'inpInput--invalid')}
              min={0}
              max={20}
              value={textOf(params.outputPrecision)}
              onChange={(event) =>
                onChange({ ...params, outputPrecision: event.target.value ? Number(event.target.value) : null })
              }
            />
          </FormRow>
          <FormRow>
            <Switch
              label="Show suffix"
              checked={Boolean(params.showSuffix)}
              onChange={() => onChange({ ...params, showSuffix: !params.showSuffix })}
            />
          </FormRow>
        </>
      )}
      <Samples samples={sampled.samples} />
    </>
  );
}

const STRING_TRANSFORMS = [
  { value: 'false', text: '- None -' },
  { value: 'lower', text: 'Lower Case' },
  { value: 'upper', text: 'Upper Case' },
  { value: 'title', text: 'Title Case' },
  { value: 'short', text: 'Short Dots' },
  { value: 'base64', text: 'Base64 Decode' },
  { value: 'urlparam', text: 'URL Param Decode' },
];

function StringEditor({ formatId, params, onChange, onError }: FormatEditorProps) {
  const id = useId();
  const inputs = useSampleInputs(formatId, params);
  const { samples, error } = useSamples(formatId, params, inputs, onError);
  return (
    <>
      <FormRow id={id} label="Transform" error={error}>
        {/* The option "- None -" is the value false, which the original's select writes as the text 'false' */}
        <SelectBox
          id={id}
          value={textOf(params.transform)}
          options={STRING_TRANSFORMS}
          invalid={!!error}
          testId="stringEditorTransform"
          onChange={(transform) => onChange({ ...params, transform })}
        />
      </FormRow>
      <Samples samples={samples} />
    </>
  );
}

function TruncateEditor({ formatId, params, onChange, onError }: FormatEditorProps) {
  const id = useId();
  const inputs = useSampleInputs(formatId, params);
  const { samples, error } = useSamples(formatId, params, inputs, onError);
  // The field is left to itself, as the original's: a value it does not accept is not passed on
  const [initial] = useState(() => textOf(params.fieldLength));
  return (
    <>
      <FormRow id={id} label="Field length" error={error}>
        <input
          id={id}
          type="number"
          className={cx('inpInput', error && 'inpInput--invalid')}
          defaultValue={initial}
          min={1}
          onChange={(event) => {
            if (event.target.checkValidity()) {
              onChange({ ...params, fieldLength: event.target.value ? Number(event.target.value) : null });
            } else {
              onError(event.target.validationMessage);
            }
          }}
        />
      </FormRow>
      <Samples samples={samples} />
    </>
  );
}

const URL_TYPES = [
  { value: 'a', text: 'Link' },
  { value: 'img', text: 'Image' },
  { value: 'audio', text: 'Audio' },
];

/** A width or height as the field shows it: a whole number, or nothing */
const wholeNumber = (value: unknown) => {
  const parsed = parseInt(textOf(value), 10);
  return Number.isNaN(parsed) ? '' : String(parsed);
};

function UrlEditor({ formatId, params, onChange, onError }: FormatEditorProps) {
  const ids = [useId(), useId(), useId(), useId(), useId(), useId()];
  const [help, setHelp] = useState<'url' | 'label'>();
  const inputs = useSampleInputs(formatId, params);
  const { samples, error } = useSamples(formatId, params, inputs, onError, true);

  const changeType = (type: string) => {
    const patch: Params = { type };
    if (type === 'img') {
      patch.width = params.width;
      patch.height = params.height;
      if (!params.urlTemplate) patch.urlTemplate = URL_ICON_PATTERN;
    } else if (params.urlTemplate === URL_ICON_PATTERN) {
      patch.urlTemplate = undefined;
    }
    onChange({ ...params, ...patch });
  };

  return (
    <>
      {help === 'label' && <LabelTemplateFlyout onClose={() => setHelp(undefined)} />}
      {help === 'url' && <UrlTemplateFlyout onClose={() => setHelp(undefined)} />}
      <FormRow id={ids[0]} label="Type">
        <SelectBox id={ids[0]} value={textOf(params.type)} options={URL_TYPES} testId="urlEditorType" onChange={changeType} />
      </FormRow>
      {params.type === 'a' && (
        <FormRow id={ids[1]} label="Open in a new tab">
          <Switch
            id={ids[1]}
            label={params.openLinkInCurrentTab ? 'Off' : 'On'}
            checked={!params.openLinkInCurrentTab}
            onChange={(checked) => onChange({ ...params, openLinkInCurrentTab: !checked })}
          />
        </FormRow>
      )}
      <FormRow
        id={ids[2]}
        label="URL template"
        help={<LinkButton onClick={() => setHelp('url')}>URL template help</LinkButton>}
        error={error}
      >
        <input
          id={ids[2]}
          type="text"
          className={cx('inpInput', error && 'inpInput--invalid')}
          data-test-subj="urlEditorUrlTemplate"
          value={textOf(params.urlTemplate || '')}
          onChange={(event) => onChange({ ...params, urlTemplate: event.target.value })}
        />
      </FormRow>
      <FormRow
        id={ids[3]}
        label="Label template"
        help={<LinkButton onClick={() => setHelp('label')}>Label template help</LinkButton>}
        error={error}
      >
        <input
          id={ids[3]}
          type="text"
          className={cx('inpInput', error && 'inpInput--invalid')}
          data-test-subj="urlEditorLabelTemplate"
          value={textOf(params.labelTemplate || '')}
          onChange={(event) => onChange({ ...params, labelTemplate: event.target.value })}
        />
      </FormRow>
      {params.type === 'img' && (
        <>
          <FormRow id={ids[4]} label="Width">
            <input
              id={ids[4]}
              type="number"
              className="inpInput"
              data-test-subj="urlEditorWidth"
              value={wholeNumber(params.width)}
              onChange={(event) => onChange({ ...params, width: event.target.value })}
            />
          </FormRow>
          <FormRow id={ids[5]} label="Height">
            <input
              id={ids[5]}
              type="number"
              className="inpInput"
              data-test-subj="urlEditorHeight"
              value={wholeNumber(params.height)}
              onChange={(event) => onChange({ ...params, height: event.target.value })}
            />
          </FormRow>
        </>
      )}
      <Samples samples={samples} />
    </>
  );
}

/** A table of examples in a help flyout: EuiBasicTable, its cells wrapping */
function ExampleTable<Row extends Record<string, unknown>>({ rows, columns }: { rows: Row[]; columns: Array<TableColumn<Row>> }) {
  return <InMemoryTable className="inpExamples" pagination={false} rows={rows} columns={columns} rowKey={(_row, index) => String(index)} />;
}

const URL_EXAMPLES = [
  {
    input: 1234,
    template: 'http://company.net/profiles?user_id={{value}}',
    output: 'http://company.net/profiles?user_id=1234',
  },
  {
    input: 'users/admin',
    template: 'http://company.net/groups?id={{value}}',
    output: 'http://company.net/groups?id=users%2Fadmin',
  },
  {
    input: '/images/favicon.ico',
    template: 'http://www.site.com{{rawValue}}',
    output: 'http://www.site.com/images/favicon.ico',
  },
];

function UrlTemplateFlyout({ onClose }: { onClose: () => void }) {
  return (
    <HelpFlyout onClose={onClose}>
      <div className="inpText inpText--m">
        <h3>Url Template</h3>
        <p>
          If a field only contains part of a URL then a <strong>Url Template</strong> can be used to format the value as a
          complete URL. The format is a string which uses double curly brace notation <Code>{'{{ }}'}</Code> to inject
          values. The following values can be accessed:
        </p>
        <ul>
          <li>
            <Code>value</Code> &mdash;&nbsp;The URI-escaped value
          </li>
          <li>
            <Code>rawValue</Code> &mdash;&nbsp;The unescaped value
          </li>
        </ul>
        <h4>Examples</h4>
        <ExampleTable
          rows={URL_EXAMPLES}
          columns={[
            { field: 'input', name: 'Input', width: '160px' },
            { field: 'template', name: 'Template' },
            { field: 'output', name: 'Output' },
          ]}
        />
      </div>
    </HelpFlyout>
  );
}

const LABEL_EXAMPLES = [
  {
    input: 1234,
    urlTemplate: 'http://company.net/profiles?user_id={{value}}',
    labelTemplate: 'User #{{value}}',
    href: 'http://company.net/profiles?user_id=1234',
    output: 'User #1234',
  },
  {
    input: '/assets/main.css',
    urlTemplate: 'http://site.com{{rawValue}}',
    labelTemplate: 'View Asset',
    href: 'http://site.com/assets/main.css',
    output: 'View Asset',
  },
];

function LabelTemplateFlyout({ onClose }: { onClose: () => void }) {
  return (
    <HelpFlyout onClose={onClose}>
      <div className="inpText inpText--m">
        <h3>Label Template</h3>
        <p>
          If the URL in this field is large, it might be useful to provide an alternate template for the text version of the
          URL. This will be displayed instead of the url, but will still link to the URL. The format is a string which uses
          double curly brace notation <Code>{'{{ }}'}</Code> to inject values. The following values can be accessed:
        </p>
        <ul>
          <li>
            <Code>value</Code> &mdash;&nbsp;The fields value
          </li>
          <li>
            <Code>url</Code> &mdash;&nbsp;The formatted URL
          </li>
        </ul>
        <h4>Examples</h4>
        <ExampleTable
          rows={LABEL_EXAMPLES}
          columns={[
            { field: 'input', name: 'Input', width: '160px' },
            { field: 'urlTemplate', name: 'URL Template' },
            { field: 'labelTemplate', name: 'Label Template' },
            {
              field: 'output',
              name: 'Output',
              render: (output, row) => (
                <span>
                  <a href={row.href}>{output as string}</a>
                </span>
              ),
            },
          ]}
        />
      </div>
    </HelpFlyout>
  );
}

interface ColorRule {
  range?: string;
  regex?: string;
  text?: string;
  background?: string;
}

/** EuiColorPicker: the colour as text, its swatch, and the picker the swatch opens */
function ColorField({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  return (
    <div className="inpColorField">
      <span className="inpColorField__swatch">
        <ColorPicker color={color} onChange={(text) => onChange(text)} label="Select a color" />
      </span>
      <input
        type="text"
        className="inpInput inpInput--large inpColorField__input"
        value={color ? color.toUpperCase() : ''}
        aria-label="Press the down key to open a popover containing color options"
        data-test-subj="euiColorPickerAnchor"
        onChange={(event) => onChange(event.target.value)}
      />
      <Icon name="chevronDown" className="inpColorField__arrow" />
    </div>
  );
}

function ColorEditor({ fieldType, params, onChange }: FormatEditorProps) {
  // The original's editor writes the type of the field into the format as it opens
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    onChange({ ...params, fieldType });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colors = Array.isArray(params.colors) ? (params.colors as ColorRule[]) : [];
  const items = colors.map((color, index) => ({ ...color, index }));
  const changeColor = (patch: ColorRule, index: number) => {
    const next = [...colors];
    next[index] = { ...next[index], ...patch };
    onChange({ ...params, colors: next });
  };
  type Item = (typeof items)[number];

  const columns: Array<TableColumn<Item>> = [
    fieldType === 'string'
      ? {
          field: 'regex',
          name: 'Pattern (regular expression)',
          render: (value, item) => (
            <input
              type="text"
              className="inpInput"
              value={textOf(value)}
              onChange={(event) => changeColor({ regex: event.target.value }, item.index)}
            />
          ),
        }
      : {
          field: 'range',
          name: 'Range (min:max)',
          render: (value, item) => (
            <input
              type="text"
              className="inpInput"
              value={textOf(value)}
              onChange={(event) => changeColor({ range: event.target.value }, item.index)}
            />
          ),
        },
    {
      field: 'text',
      name: 'Text color',
      render: (value, item) => <ColorField color={textOf(value)} onChange={(text) => changeColor({ text }, item.index)} />,
    },
    {
      field: 'background',
      name: 'Background color',
      render: (value, item) => (
        <ColorField color={textOf(value)} onChange={(background) => changeColor({ background }, item.index)} />
      ),
    },
    {
      // A computed column, its name an element as the original's: EUI names its header after it
      name: <>Example</>,
      render: (_value, item) => <div style={{ background: item.background, color: item.text }}>123456</div>,
    },
    {
      field: 'actions',
      name: 'Actions',
      actions: [
        {
          name: 'Delete',
          description: 'Delete color format',
          icon: 'trash',
          tone: 'danger',
          available: () => items.length > 1,
          onClick: (item) => onChange({ ...params, colors: colors.filter((_color, index) => index !== item.index) }),
        },
      ],
    },
  ];

  return (
    <>
      <InMemoryTable className="inpRulesTable" pagination={false} rows={items} columns={columns} rowKey={(item) => String(item.index)} />
      <div className="inpSpacer--m" />
      <SmallButton icon="plusCircle" onClick={() => onChange({ ...params, colors: [...colors, { ...DEFAULT_COLOR }] })}>
        Add color
      </SmallButton>
      <div className="inpSpacer--l" />
    </>
  );
}

interface LookupEntry {
  key?: string;
  value?: string;
}

function StaticLookupEditor({ params, onChange }: FormatEditorProps) {
  const id = useId();
  const entries = Array.isArray(params.lookupEntries) ? (params.lookupEntries as LookupEntry[]) : [];
  const items = entries.map((entry, index) => ({ ...entry, index }));
  const changeEntry = (patch: LookupEntry, index: number) => {
    const next = [...entries];
    next[index] = { ...next[index], ...patch };
    onChange({ ...params, lookupEntries: next });
  };
  type Item = (typeof items)[number];

  const columns: Array<TableColumn<Item>> = [
    {
      field: 'key',
      name: 'Key',
      render: (value, item) => (
        <input
          type="text"
          className="inpInput"
          value={textOf(value || '')}
          onChange={(event) => changeEntry({ key: event.target.value }, item.index)}
        />
      ),
    },
    {
      field: 'value',
      name: 'Value',
      render: (value, item) => (
        <input
          type="text"
          className="inpInput"
          value={textOf(value || '')}
          onChange={(event) => changeEntry({ value: event.target.value }, item.index)}
        />
      ),
    },
    {
      field: 'actions',
      name: 'actions',
      width: '30px',
      actions: [
        {
          name: 'Delete',
          description: 'Delete entry',
          icon: 'trash',
          tone: 'danger',
          available: () => items.length > 1,
          onClick: (item) => onChange({ ...params, lookupEntries: entries.filter((_entry, index) => index !== item.index) }),
        },
      ],
    },
  ];

  return (
    <>
      <InMemoryTable
        className="inpRulesTable inpRulesTable--narrow"
        pagination={false}
        rows={items}
        columns={columns}
        rowKey={(item) => String(item.index)}
      />
      <div className="inpSpacer--m" />
      <SmallButton icon="plusCircle" onClick={() => onChange({ ...params, lookupEntries: [...entries, {}] })}>
        Add entry
      </SmallButton>
      <div className="inpSpacer--l" />
      <FormRow id={id} label="Value for unknown key">
        <input
          id={id}
          type="text"
          className="inpInput"
          value={textOf(params.unknownKeyValue || '')}
          placeholder="Leave blank to keep value as-is"
          onChange={(event) => onChange({ ...params, unknownKeyValue: event.target.value })}
        />
      </FormRow>
      <div className="inpSpacer--m" />
    </>
  );
}

/** The formats the original has an editor for, and their editors */
const EDITORS: Record<string, (props: FormatEditorProps) => ReactNode> = {
  bytes: NumeralEditor,
  color: ColorEditor,
  date: DateEditor,
  date_nanos: DateEditor,
  duration: DurationEditor,
  number: NumeralEditor,
  percent: NumeralEditor,
  static_lookup: StaticLookupEditor,
  string: StringEditor,
  truncate: TruncateEditor,
  url: UrlEditor,
};

export const hasFormatEditor = (formatId: string) => Object.prototype.hasOwnProperty.call(EDITORS, formatId);

/** The editor of a format, made anew when the format changes, as the original's is */
export function FieldFormatEditor(props: FormatEditorProps) {
  if (!hasFormatEditor(props.formatId)) return null;
  const Editor = EDITORS[props.formatId];
  return <Editor key={props.formatId} {...props} />;
}
