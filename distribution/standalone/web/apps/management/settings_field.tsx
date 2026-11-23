/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A row of the advanced settings page, as the original's field: its name, description and
 * default at the left; at the right its key, the control of its type, and a way back to its
 * default. A change is kept by the page until it is saved with the others.
 */

import { memo, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { cx } from '../../components/basic';
import { CodeEditor, type CodeToken } from '../../components/code_editor';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { tokenizeJson } from '../../lib/json_text';
import {
  codeEditorChange,
  displayedDefault,
  editableValue,
  isDefaultValue,
  type FieldSetting,
  type FieldState,
} from './settings_model';

// The code editors are as tall as their text, from 6 to 30 lines of 15 px, as the original's
const CODE_LINE_HEIGHT = 15;
const CODE_MIN_LINES = 6;
const CODE_MAX_LINES = 30;

export interface FieldProps {
  setting: FieldSetting;
  /** What is changed and not saved yet */
  unsaved?: FieldState;
  onChange: (name: string, change: FieldState) => void;
}

/** An icon with a tip, which a keyboard reaches: the original's icon tips */
function IconTip({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span className={cx('mgtField__iconTip', className)}>
      <Tooltip content={label}>
        <span tabIndex={0} role="img" aria-label={label} className="mgtField__iconTipAnchor">
          {children}
        </span>
      </Tooltip>
    </span>
  );
}

function AsteriskIcon() {
  return (
    <svg className="atlIcon" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.5v11M3.2 5.25l9.6 5.5M3.2 10.75l9.6-5.5" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg className="atlIcon mgtField__dot" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}

/** The default of a JSON setting as its library's code block colours it */
function jsonDefaultTokens(text: string): CodeToken[][] {
  return tokenizeJson(text).map((line) =>
    line.map((token) => {
      if (!token.kind) return token.text.trim() ? { text: token.text, kind: 'Punctuation' } : token;
      // true and false are coloured as numbers, null as a keyword
      if (token.kind === 'Keyword') return { text: token.text, kind: token.text === 'null' ? 'Keyword' : 'Number' };
      return token;
    })
  );
}

function DefaultValue({ setting }: { setting: FieldSetting }) {
  const { type, defVal, optionLabels } = setting;
  const text = displayedDefault(type, defVal, optionLabels);
  return (
    <>
      <div className="mgtField__spacer" />
      <div className="mgtField__default">
        {'Default: '}
        {type === 'json' ? (
          <pre
            className={cx('mgtField__defaultBlock', String(defVal).length >= 500 && 'mgtField__defaultBlock--tall')}
            tabIndex={String(defVal).length >= 500 ? 0 : undefined}
          >
            <code>
              {jsonDefaultTokens(text).map((line, index) => (
                <span key={index} className="mgtField__defaultLine">
                  {line.map((token, at) =>
                    token.kind ? (
                      <span key={at} className={`tok${token.kind}`}>
                        {token.text}
                      </span>
                    ) : (
                      token.text
                    )
                  )}
                </span>
              ))}
            </code>
          </pre>
        ) : (
          <code className="mgtField__defaultCode">{text}</code>
        )}
      </div>
    </>
  );
}

function CodeField({
  setting,
  value,
  readOnly,
  ariaLabel,
  onChange,
}: {
  setting: FieldSetting;
  value: string;
  readOnly: boolean;
  ariaLabel: string;
  onChange: (text: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [line, setLine] = useState(0);
  const lines = value.split('\n').length;
  const height = Math.min(CODE_MAX_LINES, Math.max(CODE_MIN_LINES, lines)) * CODE_LINE_HEIGHT;
  return (
    <div
      className="mgtField__codeWrap"
      data-test-subj={`advancedSetting-editField-${setting.name}`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <CodeEditor
        className="mgtField__code"
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        height={height}
        gutter={false}
        ariaLabel={ariaLabel}
        tokenize={setting.type === 'json' ? tokenizeJson : undefined}
        onCursor={(offset) => setLine(value.slice(0, offset).split('\n').length - 1)}
        markedLines={focused && !readOnly ? [line, line] : undefined}
      />
    </div>
  );
}

function Control({
  setting,
  current,
  unsaved,
  ariaDescribedBy,
  controlId,
  onChange,
}: {
  setting: FieldSetting;
  current: unknown;
  unsaved?: FieldState;
  ariaDescribedBy?: string;
  controlId: string;
  onChange: (change: FieldState) => void;
}) {
  const { name, type, options, optionLabels = {}, ariaName } = setting;
  const locked = setting.isOverridden || setting.isPermissionControlled || setting.preferBrowserSetting;
  const testId = `advancedSetting-editField-${name}`;
  const a11y = { 'aria-label': ariaName, 'aria-describedby': ariaDescribedBy };
  const onEvent = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ value: type === 'number' ? Number(event.target.value) : event.target.value });

  switch (type) {
    case 'boolean': {
      const on = Boolean(current);
      return (
        <span className={cx('atlSwitch', 'mgtField__switch', locked && 'mgtField__switch--disabled')}>
          <button
            type="button"
            role="switch"
            id={controlId}
            className="atlSwitch__track"
            aria-checked={on}
            disabled={locked}
            onClick={() => onChange({ value: !on })}
            data-test-subj={testId}
            {...a11y}
          />
          <span className="mgtField__switchLabel" onClick={() => !locked && onChange({ value: !on })}>
            {on ? 'On' : 'Off'}
          </span>
        </span>
      );
    }
    case 'markdown':
    case 'json':
      return (
        <CodeField
          setting={setting}
          value={String(current ?? '')}
          readOnly={locked}
          ariaLabel={ariaName}
          onChange={(text) => onChange(codeEditorChange(type, setting.defVal, text))}
        />
      );
    case 'select':
      return (
        <span className="mgtField__selectWrap">
          <select
            id={controlId}
            className="atlField mgtField__select"
            value={String(current ?? '')}
            disabled={locked}
            onChange={onEvent}
            data-test-subj={testId}
            {...a11y}
          >
            {(options ?? []).map((option) => {
              const key = String(option);
              return (
                <option key={key} value={key}>
                  {Object.prototype.hasOwnProperty.call(optionLabels, key) ? optionLabels[key] : key}
                </option>
              );
            })}
          </select>
          {/* The theme's arrow: in the colour of the text, thinner than this product's */}
          <svg className="atlIcon mgtField__selectArrow" viewBox="0 0 16 16" aria-hidden>
            <path d="M2.5 5.5L8 11l5.5-5.5" />
          </svg>
        </span>
      );
    case 'number':
      return (
        <input
          id={controlId}
          type="number"
          className={cx('atlField', 'mgtField__input', unsaved?.isInvalid && 'atlField--invalid')}
          // A number that is not one shows nothing, as in the original
          value={typeof current === 'number' && !Number.isNaN(current) ? current : ''}
          disabled={locked}
          onChange={onEvent}
          data-test-subj={testId}
          {...a11y}
        />
      );
    default:
      return (
        <input
          id={controlId}
          type="text"
          className={cx('atlField', 'mgtField__input', unsaved?.isInvalid && 'atlField--invalid')}
          value={String(current ?? '')}
          disabled={locked}
          onChange={onEvent}
          data-test-subj={testId}
          {...a11y}
        />
      );
  }
}

/** What is said under the control: why it cannot be changed, or the way back to the default */
function helpText(setting: FieldSetting, unsaved: FieldState | undefined, onReset: () => void): ReactNode {
  if (setting.isOverridden) {
    return 'This setting is overridden by the OpenSearch Dashboards server and can not be changed.';
  }
  if (setting.preferBrowserSetting) return 'This setting is overridden by user or browser preferences.';
  if (setting.isPermissionControlled) return 'This setting is controlled by dashboard admin only.';
  // Back to the default: not while the change is the default, nor while the default is shown
  if (setting.defVal === unsaved?.value || isDefaultValue(setting)) return null;
  return (
    <span className="mgtField__helpItem">
      <button
        type="button"
        className="mgtField__reset"
        aria-label={`Reset ${setting.ariaName} to default`}
        onClick={onReset}
        data-test-subj={`advancedSetting-resetField-${setting.name}`}
      >
        Reset to default
      </button>
    </span>
  );
}

export const Field = memo(function Field({ setting, unsaved, onChange }: FieldProps) {
  const { name, type, value, defVal } = setting;
  const groupId = `${name}-group`;
  const unsavedId = `${name}-unsaved`;
  const controlId = `${name}-control`;
  const isInvalid = Boolean(unsaved?.isInvalid);
  const current = unsaved ? unsaved.value : editableValue(type, value, defVal);
  const describedBy = unsaved ? `${groupId} ${unsavedId}` : undefined;
  const change = (next: FieldState) => onChange(name, next);
  const help = helpText(setting, unsaved, () => change({ value: editableValue(type, defVal) }));
  const description = useMemo(() => ({ __html: setting.description || '' }), [setting.description]);

  return (
    <div
      id={groupId}
      role="group"
      className={cx('mgtField', unsaved && 'mgtField--unsaved', isInvalid && 'mgtField--invalid')}
      data-test-subj={`advancedSetting-${name}`}
    >
      <div className="mgtField__about">
        <h3 className="mgtField__heading">
          <span className="mgtField__title">{setting.displayName || setting.name}</span>
          {setting.isCustom && (
            <IconTip label="Custom setting" className="mgtField__custom">
              <AsteriskIcon />
            </IconTip>
          )}
          {unsaved && (
            <IconTip
              label={isInvalid ? 'Invalid' : 'Unsaved'}
              className={cx('mgtField__unsavedIcon', isInvalid && 'mgtField__unsavedIcon--invalid')}
            >
              {isInvalid ? <Icon name="warning" /> : <DotIcon />}
            </IconTip>
          )}
        </h3>
        <div className="mgtField__description">
          {setting.deprecation && (
            <>
              <Tooltip content={setting.deprecation.message}>
                <span className="atlBadge atlBadge--warning" tabIndex={0}>
                  Deprecated
                </span>
              </Tooltip>
              <div className="mgtField__spacer" />
            </>
          )}
          {/* A description is written in HTML, with its links to the documentation */}
          <div className="mgtField__text" dangerouslySetInnerHTML={description} />
          {!isDefaultValue(setting) && <DefaultValue setting={setting} />}
        </div>
      </div>
      <div className="mgtField__fields">
        <div className="mgtField__labelWrap">
          {type === 'boolean' ? (
            <span className={cx('mgtField__label', isInvalid && 'mgtField__label--invalid')}>{name}</span>
          ) : (
            <label htmlFor={controlId} className={cx('mgtField__label', isInvalid && 'mgtField__label--invalid')}>
              {name}
            </label>
          )}
        </div>
        <div className="mgtField__control">
          <Control
            setting={setting}
            current={current}
            unsaved={unsaved}
            ariaDescribedBy={describedBy}
            controlId={controlId}
            onChange={change}
          />
          {unsaved && (
            <span className="atlScreenReaderOnly">
              <span id={unsavedId}>{unsaved.error ?? 'Setting is currently not saved.'}</span>
            </span>
          )}
        </div>
        {isInvalid && unsaved?.error && <div className="mgtField__error">{unsaved.error}</div>}
        {help !== null && <div className="mgtField__help">{help}</div>}
      </div>
    </div>
  );
});
