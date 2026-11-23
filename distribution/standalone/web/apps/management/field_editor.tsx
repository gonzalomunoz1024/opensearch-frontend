/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editor of a field of an index pattern, drawn and run as the plugin index_pattern_management
 * of OpenSearch Dashboards draws and runs it: the format of a field and its popularity, and for a
 * scripted field its name, language, type and script, with the help on scripts and a preview of
 * what one gives. What it saves is what the original saves.
 */

import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { CodeEditor, type CodeToken } from '../../components/code_editor';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { Icon } from '../../components/icon';
import { tokenizeJson } from '../../lib/json_text';
import { buildQuery } from '../../lib/query';
import type { IndexPattern } from '../../lib/types';
import { navigate } from '../../router';
import { services } from '../../services';
import { errorMessage, HttpFetchError } from '../../services/http';
import { defaultQueryLanguage, QueryBar } from '../../shell/query_bar';
import { useBreadcrumbs } from '../../shell/state';
import { Code, DocLink, FieldFormatEditor, hasFormatEditor, HelpFlyout, LinkButton } from './format_editors';
import {
  defaultFormatId,
  editorParamsOf,
  FIELD_TYPES_BY_LANG,
  formatInstance,
  formatsForFieldType,
  formatToJson,
  formatType,
  OSD_FIELD_TYPES,
  patternName,
  SUPPORTED_SCRIPTING_LANGUAGES,
  TAB_INDEXED_FIELDS,
  TAB_SCRIPTED_FIELDS,
  type FieldRecord,
  type FormatInstance,
  type ManagedPattern,
} from './index_pattern_model';
import { pageMetaParams, savePattern, setting } from './index_pattern_store';
import { Confirm, InMemoryTable } from './index_pattern_table';
import {
  CallOut,
  FormRow,
  IndexHeader,
  LIST_CRUMB,
  MANAGEMENT_CRUMB,
  patternPath,
  SelectBox,
  SmallButton,
  tabPath,
  usePattern,
} from './index_patterns';

/** The pages the original's help on scripts links to */
const SCRIPTED_FIELDS_DOCS = 'https://opensearch.org/docs/latest';

const LANGUAGES_ERROR = 'Error getting available scripting languages from OpenSearch';

export function FieldEditor({ patternId, fieldName }: { patternId: string; fieldName?: string }) {
  const [pattern] = usePattern(patternId);
  const editing = fieldName !== undefined;
  const field = pattern && editing ? pattern.fields.find((candidate) => candidate.name === fieldName) : undefined;
  const missing = !!pattern && editing && !field;

  useBreadcrumbs(
    pattern
      ? [
          MANAGEMENT_CRUMB,
          LIST_CRUMB,
          { text: patternName(pattern), to: patternPath(pattern.id) },
          { text: editing ? fieldName : 'Create field' },
        ]
      : [MANAGEMENT_CRUMB, LIST_CRUMB]
  );
  // The tab's title is the field's, then the pattern's, as the original names it
  const titleName = field?.name || 'New Scripted Field';
  useEffect(() => {
    if (!pattern || missing) return;
    document.title = [titleName, patternName(pattern), services.boot.name].join(' - ');
  }, [pattern, missing, titleName]);

  // A field the pattern does not have: said, and back to the pattern
  useEffect(() => {
    if (!pattern || !missing) return;
    services.toasts.warning(`'${patternName(pattern)}' index pattern doesn't have a scripted field called '${fieldName}'`);
    navigate(patternPath(pattern.id));
  }, [pattern, missing, fieldName]);

  if (!pattern || missing) return null;
  return (
    <div className="inpPanel">
      <div className="inpStack">
        <IndexHeader pattern={pattern} />
        <FieldForm pattern={pattern} original={field} />
      </div>
    </div>
  );
}

/** The field as the editor changes it: a copy of the pattern's, or a new scripted field */
type Spec = FieldRecord & { format?: FormatInstance };

interface Ready {
  scriptingLangs: string[];
  fieldTypes: string[];
  isCreating: boolean;
  existingFieldNames: string[];
}

/** What the page to create a field starts from, as the original's */
const NEW_FIELD: Spec = { scripted: true, type: 'number', name: '' };

const fieldTypesOf = (lang: string | undefined) => FIELD_TYPES_BY_LANG[lang ?? ''] ?? OSD_FIELD_TYPES;

/** The formats a field of a type can have, after "- Default -", which stands for the default one */
function formatOptionsOf(spec: Spec) {
  const defaultId = defaultFormatId(spec.type, spec.esTypes, setting('format:defaultTypeMap'));
  return {
    defaultId,
    defaultTitle: formatType(defaultId)?.title,
    options: [
      { value: '', text: '- Default -' },
      ...formatsForFieldType(spec.type).map((type) => ({ value: type.id, text: type.title })),
    ],
  };
}

function FieldForm({ pattern, original }: { pattern: ManagedPattern; original?: FieldRecord }) {
  const nameId = useId();
  const langId = useId();
  const typeId = useId();
  const formatId = useId();
  const countId = useId();
  const [spec, setSpec] = useState<Spec>(() => (original ? { ...original } : NEW_FIELD));
  const [ready, setReady] = useState<Ready>();
  // The format chosen here; none while the field keeps the one it was saved with, or the default
  const [fieldFormatId, setFieldFormatId] = useState<string | undefined>(() =>
    original ? pattern.fieldFormatMap[original.name]?.id : undefined
  );
  const [format, setFormat] = useState<FormatInstance>(() => {
    const stored = original ? pattern.fieldFormatMap[original.name] : undefined;
    return stored ?? formatInstance(defaultFormatId(original?.type ?? 'number', original?.esTypes, setting('format:defaultTypeMap')), null, pageMetaParams());
  });
  const [formatParams, setFormatParams] = useState(() => editorParamsOf(format, setting));
  // Whether the format was changed here: a format left as it was is written back as it was stored
  const [formatTouched, setFormatTouched] = useState(false);
  const [hasFormatError, setHasFormatError] = useState(false);
  const [hasScriptError, setHasScriptError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  // The languages OpenSearch runs, of those the original supports; a scripted field is given one
  useEffect(() => {
    let live = true;
    services.http
      .get<unknown>('/api/opensearch-dashboards/scripts/languages')
      .catch(() => {
        services.toasts.danger(LANGUAGES_ERROR);
        return [];
      })
      .then((enabled) => {
        if (!live) return;
        const enabledLangs = Array.isArray(enabled) ? enabled.filter((lang): lang is string => typeof lang === 'string') : [];
        const scriptingLangs = [...new Set(enabledLangs)].filter((lang) => SUPPORTED_SCRIPTING_LANGUAGES.includes(lang));
        // Nothing can be changed before this: the form is drawn once the languages are known
        const initial: Spec = original ? { ...original } : NEW_FIELD;
        let lang = initial.lang && scriptingLangs.includes(initial.lang) ? initial.lang : undefined;
        if (initial.scripted && !lang) lang = scriptingLangs[0];
        const fieldTypes = fieldTypesOf(lang);
        setSpec({ ...initial, lang, type: fieldTypes.includes(initial.type) ? initial.type : fieldTypes[0] });
        setReady({
          scriptingLangs,
          fieldTypes,
          isCreating: !pattern.fields.some((candidate) => candidate.name === initial.name),
          existingFieldNames: pattern.fields.map((candidate) => candidate.name),
        });
      });
    return () => {
      live = false;
    };
  }, [pattern, original]);

  if (!ready) return null;
  const change = (patch: Partial<Spec>) => setSpec((current) => ({ ...current, ...patch }));

  /** A format chosen, or its parameters changed: a new instance of it; "- Default -" is the default format */
  const changeFormat = (id: string, params?: Record<string, unknown> | null) => {
    const next = formatInstance(id || formatOptionsOf(spec).defaultId, params, pageMetaParams());
    setFormat(next);
    setFieldFormatId(next.id);
    setFormatParams(editorParamsOf(next, setting));
    setFormatTouched(true);
  };
  const { scriptingLangs, fieldTypes, isCreating, existingFieldNames } = ready;
  const { defaultTitle, options: formatOptions } = formatOptionsOf(spec);
  const name = spec.name ?? '';
  const nameInvalid = !name || !name.trim();
  const script = spec.script ?? '';
  const scriptInvalid = !script || !script.trim() || hasScriptError;
  const isDuplicateName = isCreating && existingFieldNames.includes(name);
  const savingDisabled = isSaving || hasFormatError || hasScriptError || nameInvalid || (!!spec.scripted && (!script || !script.trim()));
  const backToPattern = () => navigate(tabPath(pattern.id, original?.scripted ?? true ? TAB_SCRIPTED_FIELDS : TAB_INDEXED_FIELDS));

  const changeType = (type: string) => {
    // A new type starts with its default format, chosen
    const next = formatInstance(defaultFormatId(type, undefined, setting('format:defaultTypeMap')), null, pageMetaParams());
    change({ type });
    setFormat(next);
    setFieldFormatId(next.id);
    setFormatParams(editorParamsOf(next, setting));
    setFormatTouched(true);
  };

  const changeLang = (lang: string) => {
    const types = fieldTypesOf(lang);
    setReady({ ...ready, fieldTypes: types });
    change({ lang, type: types.includes(spec.type) ? spec.type : types[0] });
  };

  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    const field: FieldRecord = { ...spec };
    delete field.format;
    if (field.scripted) {
      const valid = await previewScript({ name: field.name, script: field.script ?? '', index: pattern.title });
      if (valid.status !== 200) {
        setHasScriptError(true);
        setIsSaving(false);
        return;
      }
    }
    const previousFields = pattern.fields;
    const previousFormats = pattern.fieldFormatMap;
    const previousStored = pattern.storedFormats;
    const at = pattern.fields.findIndex((candidate) => candidate.name === field.name);
    pattern.fields = at >= 0 ? pattern.fields.map((candidate, index) => (index === at ? field : candidate)) : [...pattern.fields, field];
    let saved: FormatInstance | undefined;
    if (fieldFormatId) {
      // A format left as it was is written back as the field was given it, as the original writes it
      const stored = pattern.storedFormats[field.name];
      saved = !formatTouched && original && stored !== undefined ? { ...format, raw: stored } : format;
      pattern.storedFormats = { ...pattern.storedFormats, [field.name]: formatToJson(saved, setting) };
    }
    pattern.fieldFormatMap = { ...pattern.fieldFormatMap, [field.name]: saved };
    try {
      await savePattern(pattern);
      services.toasts.success(`Saved '${field.name}'`);
      backToPattern();
    } catch (failure) {
      pattern.fields = previousFields;
      pattern.fieldFormatMap = previousFormats;
      pattern.storedFormats = previousStored;
      services.toasts.error(failure, `The field '${field.name}' could not be saved`);
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setShowDelete(false);
    const previousFields = pattern.fields;
    pattern.fields = pattern.fields.filter((candidate) => candidate.name !== spec.name);
    try {
      await savePattern(pattern);
      services.toasts.success(`Deleted '${spec.name}'`);
      backToPattern();
    } catch (failure) {
      pattern.fields = previousFields;
      services.toasts.error(failure, `The field '${spec.name}' could not be deleted`);
    }
  };

  const conflicts =
    spec.conflictDescriptions && typeof spec.conflictDescriptions === 'object'
      ? Object.entries(spec.conflictDescriptions).map(([type, indices]) => ({
          type,
          indices: Array.isArray(indices) ? indices.join(', ') : 'Index names unavailable',
        }))
      : undefined;

  return (
    <div>
      <h3 className="inpTitle inpTitle--s">{isCreating ? 'Create scripted field' : `Edit ${spec.name}`}</h3>
      <div className="inpSpacer--m" />
      <div className="inpForm">
        {spec.scripted && (
          <>
            {scriptingLangs.length === 0 && (
              <>
                <CallOut title="Scripting disabled" tone="danger" icon="warning">
                  <p>
                    All inline scripting has been disabled in OpenSearch. You must enable inline scripting for at least one
                    language in order to use scripted fields in OpenSearch Dashboards.
                  </p>
                </CallOut>
                <div className="inpSpacer--m" />
              </>
            )}
            <CallOut title="Proceed with caution" tone="warning" icon="warning">
              <p>
                Please familiarize yourself with <DocLink href={SCRIPTED_FIELDS_DOCS}>script fields</DocLink> and with{' '}
                <DocLink href={SCRIPTED_FIELDS_DOCS}>scripts in aggregations</DocLink> before using scripted fields.
              </p>
              <p>
                Scripted fields can be used to display and aggregate calculated values. As such, they can be very slow, and
                if done incorrectly, can cause OpenSearch Dashboards to be unusable. There&apos;s no safety net here. If you
                make a typo, unexpected exceptions will be thrown all over the place!
              </p>
            </CallOut>
            <div className="inpSpacer--m" />
            {showHelp && (
              <ScriptingHelpFlyout
                pattern={pattern}
                name={spec.name}
                script={spec.script}
                onClose={() => setShowHelp(false)}
              />
            )}
          </>
        )}
        {isCreating && (
          <FormRow
            id={nameId}
            label="Name"
            error={nameInvalid ? 'Name is required' : undefined}
            help={
              isDuplicateName ? (
                <span>
                  <Icon name="warning" className="inpWarningIcon" />
                  &nbsp;<strong>Mapping Conflict:</strong> You already have a field with the name <Code>{name}</Code>.
                  Naming your scripted field with the same name means you won&apos;t be able to query both fields at the
                  same time.
                </span>
              ) : undefined
            }
          >
            <input
              id={nameId}
              type="text"
              className={nameInvalid ? 'inpInput inpInput--invalid' : 'inpInput'}
              value={name}
              placeholder="New scripted field"
              data-test-subj="editorFieldName"
              onChange={(event) => change({ name: event.target.value })}
            />
          </FormRow>
        )}
        {spec.scripted && (
          <FormRow id={langId} label="Language">
            <SelectBox
              id={langId}
              value={spec.lang ?? ''}
              options={scriptingLangs.map((lang) => ({ value: lang, text: lang }))}
              testId="editorFieldLang"
              onChange={changeLang}
            />
          </FormRow>
        )}
        <FormRow id={typeId} label="Type">
          <SelectBox
            id={typeId}
            value={spec.type}
            disabled={!spec.scripted}
            options={fieldTypes.map((type) => ({ value: type, text: type }))}
            testId="editorFieldType"
            onChange={changeType}
          />
        </FormRow>
        {conflicts && (
          <div>
            <div className="inpSpacer--m" />
            <CallOut title="Field type conflict" tone="warning" icon="warning" size="s">
              The type of this field changes across indices. It is unavailable for many analysis functions. The indices per
              type are as follows:
            </CallOut>
            <div className="inpSpacer--m" />
            <InMemoryTable
              pagination={false}
              rows={conflicts}
              rowKey={(row) => row.type}
              columns={[
                { field: 'type', name: 'Type', width: '100px' },
                { field: 'indices', name: 'Index names' },
              ]}
            />
            <div className="inpSpacer--m" />
          </div>
        )}
        <FormRow
          id={formatId}
          label={
            defaultTitle ? (
              <>
                Format (Default: <Code>{defaultTitle}</Code>)
              </>
            ) : (
              'Format'
            )
          }
          help="Formatting allows you to control the way that specific values are displayed. It can also cause values to be completely changed and prevent highlighting in Discover from working."
        >
          <SelectBox
            id={formatId}
            value={fieldFormatId ?? ''}
            options={formatOptions}
            testId="editorSelectedFormatId"
            onChange={(id) => changeFormat(id)}
          />
        </FormRow>
        {fieldFormatId && hasFormatEditor(fieldFormatId) && (
          <FieldFormatEditor
            formatId={fieldFormatId}
            fieldType={spec.type}
            params={formatParams}
            defaults={formatType(fieldFormatId)?.defaults(setting) ?? {}}
            onChange={(params) => changeFormat(fieldFormatId, params)}
            onError={(error) => setHasFormatError(!!error)}
          />
        )}
        <FormRow id={countId} label="Popularity">
          <input
            id={countId}
            type="number"
            className="inpInput"
            value={spec.count === undefined || spec.count === null ? '' : String(spec.count)}
            data-test-subj="editorFieldCount"
            onChange={(event) => change({ count: event.target.value ? Number(event.target.value) : '' })}
          />
        </FormRow>
        {spec.scripted && (
          <>
            <FormRow
              wide
              label="Script"
              invalid={scriptInvalid}
              error={
                scriptInvalid ? (
                  hasScriptError ? (
                    <span data-test-subj="invalidScriptError">Script is invalid. View script preview for details</span>
                  ) : (
                    'Script is required'
                  )
                ) : undefined
              }
            >
              <CodeEditor
                className="inpScriptEditor"
                value={script}
                height="300px"
                tokenize={tokenizeScript}
                ariaLabel="Script"
                testId="editorFieldScript"
                onChange={(value) => {
                  setHasScriptError(false);
                  change({ script: value });
                }}
              />
            </FormRow>
            <FormRow>
              <>
                <div className="inpText">
                  Access fields with <code>{`doc['some_field'].value`}</code>.
                </div>
                <br />
                <div className="inpText">
                  <LinkButton onClick={() => setShowHelp(true)} testId="scriptedFieldsHelpLink">
                    Get help with the syntax and preview the results of your script.
                  </LinkButton>
                </div>
              </>
            </FormRow>
          </>
        )}
        <FormRow>
          <div className="inpFieldActions">
            <SmallButton fill onClick={save} disabled={savingDisabled} loading={isSaving} testId="fieldSaveButton">
              {isCreating ? 'Create field' : 'Save field'}
            </SmallButton>
            <button type="button" className="inpButtonEmpty inpButtonEmpty--primary" onClick={backToPattern} data-test-subj="fieldCancelButton">
              <span className="inpButtonEmpty__text">Cancel</span>
            </button>
            {!isCreating && spec.scripted && (
              <span className="inpFieldActions__end">
                <button type="button" className="inpButtonEmpty inpButtonEmpty--danger" onClick={() => setShowDelete(true)}>
                  <span className="inpButtonEmpty__text">Delete</span>
                </button>
              </span>
            )}
          </div>
        </FormRow>
        {showDelete && (
          <Confirm
            title={`Delete field '${spec.name}'`}
            confirmLabel="Delete"
            danger
            onCancel={() => setShowDelete(false)}
            onConfirm={remove}
          >
            <p>
              You can&apos;t recover a deleted field.
              <span>
                <br />
                <br />
              </span>
              Are you sure you want to do this?
            </p>
          </Confirm>
        )}
      </div>
      <div className="inpSpacer--l" />
    </div>
  );
}

// --- The script ----------------------------------------------------------------------------------

const GROOVY_KEYWORDS = new Set(
  (
    'assert with abstract continue for new switch default goto package synchronized boolean do if private this ' +
    'break double implements protected throw byte else import public throws case enum instanceof return transient ' +
    'catch extends int short try char final interface static void class finally long strictfp volatile def float ' +
    'native super while true false null in as'
  ).split(' ')
);

/** A script in the colours of the original's editor, in its mode for Groovy */
export function tokenizeScript(text: string): CodeToken[][] {
  let inComment = false;
  return text.split('\n').map((line) => {
    const tokens: CodeToken[] = [];
    let plain = '';
    const flush = () => {
      if (plain) tokens.push({ text: plain });
      plain = '';
    };
    let at = 0;
    while (at < line.length) {
      if (inComment) {
        const end = line.indexOf('*/', at);
        const stop = end < 0 ? line.length : end + 2;
        flush();
        tokens.push({ text: line.slice(at, stop), kind: 'Comment' });
        if (end >= 0) inComment = false;
        at = stop;
        continue;
      }
      const rest = line.slice(at);
      if (rest.startsWith('//')) {
        flush();
        tokens.push({ text: rest, kind: 'Comment' });
        break;
      }
      if (rest.startsWith('/*')) {
        flush();
        const end = line.indexOf('*/', at + 2);
        const stop = end < 0 ? line.length : end + 2;
        tokens.push({ text: line.slice(at, stop), kind: 'Comment' });
        inComment = end < 0;
        at = stop;
        continue;
      }
      const char = rest[0];
      if (char === '"' || char === "'") {
        let end = 1;
        while (end < rest.length && rest[end] !== char) end += rest[end] === '\\' ? 2 : 1;
        flush();
        tokens.push({ text: rest.slice(0, end + 1), kind: 'String' });
        at += end + 1;
        continue;
      }
      const word = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (word) {
        if (GROOVY_KEYWORDS.has(word[0])) {
          flush();
          tokens.push({ text: word[0], kind: 'Keyword' });
        } else plain += word[0];
        at += word[0].length;
        continue;
      }
      const number = /^(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[lLfFdDgG]?/.exec(rest);
      if (number) {
        flush();
        tokens.push({ text: number[0], kind: 'Number' });
        at += number[0].length;
        continue;
      }
      plain += char;
      at += 1;
    }
    flush();
    return tokens;
  });
}

interface PreviewAnswer {
  status: number;
  hits?: { hits?: Array<{ _id?: string; _source?: Record<string, unknown>; fields?: Record<string, unknown> }> };
  error?: unknown;
}

/** Runs a script on ten documents, as the original's preview does: its status, and the hits or the error */
async function previewScript(request: {
  name: string;
  script: string;
  index: string;
  query?: unknown;
  additionalFields?: string[];
}): Promise<PreviewAnswer> {
  const { index, name, script, query, additionalFields = [] } = request;
  try {
    const answer = await services.http.post<{ statusCode?: number; body?: { hits?: PreviewAnswer['hits'] } }>(
      '/internal/index-pattern-management/preview_scripted_field',
      { body: { index, name, script, query, additionalFields } }
    );
    return { status: answer.statusCode ?? 200, hits: answer.body?.hits };
  } catch (failure) {
    if (failure instanceof HttpFetchError) {
      const body = failure.body as { attributes?: { error?: unknown } } | undefined;
      return { status: failure.status, error: body?.attributes?.error ?? failure.body ?? failure.message };
    }
    return { status: 0, error: errorMessage(failure) };
  }
}

// --- The help on scripts --------------------------------------------------------------------------

function ScriptingHelpFlyout({
  pattern,
  name,
  script,
  onClose,
}: {
  pattern: ManagedPattern;
  name?: string;
  script?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'syntax' | 'test'>('syntax');
  const tabs = [
    { id: 'syntax' as const, name: 'Syntax', testId: 'syntaxTab' },
    { id: 'test' as const, name: 'Preview results', testId: 'testTab' },
  ];
  return (
    <HelpFlyout onClose={onClose} testId="scriptedFieldsHelpFlyout">
      <div className="inpTabs inpTabs--small" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === tab}
            className={item.id === tab ? 'inpTab inpTab--selected' : 'inpTab'}
            data-test-subj={item.testId}
            onClick={() => setTab(item.id)}
          >
            <span className="inpTab__content">{item.name}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'syntax' ? <ScriptingSyntax /> : <TestScript pattern={pattern} name={name} script={script} />}
      </div>
    </HelpFlyout>
  );
}

function ScriptingSyntax() {
  return (
    <>
      <div className="inpSpacer--l" />
      <div className="inpText inpText--m">
        <h3>Syntax</h3>
        <p>
          By default, OpenSearch Dashboards scripted fields use <DocLink href={SCRIPTED_FIELDS_DOCS}>Painless</DocLink>, a
          simple and secure scripting language designed specifically for use with OpenSearch, to access values in the
          document use the following format:
        </p>
        <p>
          <Code>doc[&apos;some_field&apos;].value</Code>
        </p>
        <p>
          Painless is powerful but easy to use. It provides access to many{' '}
          <DocLink href={SCRIPTED_FIELDS_DOCS}>native Java APIs</DocLink>. Read up on its{' '}
          <DocLink href={SCRIPTED_FIELDS_DOCS}>syntax</DocLink> and you&apos;ll be up to speed in no time!
        </p>
        <p>
          OpenSearch Dashboards currently imposes one special limitation on the painless scripts you write. They cannot
          contain named functions.
        </p>
        <p>
          Coming from an older version of OpenSearch Dashboards? The{' '}
          <DocLink href={SCRIPTED_FIELDS_DOCS}>Lucene Expressions</DocLink> you know and love are still available. Lucene
          expressions are a lot like JavaScript, but limited to basic arithmetic, bitwise and comparison operations.
        </p>
        <p>There are a few limitations when using Lucene Expressions:</p>
        <ul>
          <li>Only numeric, boolean, date, and geo_point fields may be accessed</li>
          <li>Stored fields are not available</li>
          <li>If a field is sparse (only some documents contain a value), documents missing the field will have a value of 0</li>
        </ul>
        <p>Here are all the operations available to lucene expressions:</p>
        <ul>
          <li>
            Arithmetic operators: <code>+ - * / %</code>
          </li>
          <li>
            Bitwise operators: <code>| &amp; ^ ~ &lt;&lt; &gt;&gt; &gt;&gt;&gt;</code>
          </li>
          <li>
            Boolean operators (including the ternary operator): <code>&amp;&amp; || ! ?:</code>
          </li>
          <li>
            Comparison operators: <code>&lt; &lt;= == &gt;= &gt;</code>
          </li>
          <li>
            Common mathematic functions: <code>abs ceil exp floor ln log10 logn max min sqrt pow</code>
          </li>
          <li>
            Trigonometric library functions: <code>acosh acos asinh asin atanh atan atan2 cosh cos sinh sin tanh tan</code>
          </li>
          <li>
            Distance functions: <code>haversin</code>
          </li>
          <li>
            Miscellaneous functions: <code>min, max</code>
          </li>
        </ul>
      </div>
    </>
  );
}

/** The fields a preview may show beside the script, by type: neither meta fields, multi-fields nor scripted ones */
function additionalFieldOptions(pattern: ManagedPattern): ComboOption[] {
  const byType = new Map<string, string[]>();
  for (const field of pattern.fields) {
    const subType = field.subType as { multi?: unknown } | undefined;
    if (field.name.startsWith('_') || (subType && subType.multi) || field.scripted) continue;
    byType.set(field.type, [...(byType.get(field.type) ?? []), field.name]);
  }
  return [...byType.keys()]
    .sort()
    .flatMap((type) => (byType.get(type) ?? []).sort().map((name) => ({ value: name, label: name, group: type })));
}

function TestScript({ pattern, name, script }: { pattern: ManagedPattern; name?: string; script?: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const [additionalFields, setAdditionalFields] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<{ rows?: unknown[]; error?: unknown }>();
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState(defaultQueryLanguage);
  const [indexPattern, setIndexPattern] = useState<IndexPattern>();
  const options = useMemo(() => additionalFieldOptions(pattern), [pattern]);

  useEffect(() => {
    let live = true;
    services.indexPatterns
      .get(pattern.id)
      .then((loaded) => live && setIndexPattern(loaded))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pattern.id]);

  const run = async (searchQuery?: { query: string; language: string }) => {
    if (!script) return;
    setIsLoading(true);
    const answer = await previewScript({
      // The original means to preview a field without a name as myScriptedField
      name: name || 'myScriptedField',
      script,
      index: pattern.title,
      query: searchQuery ? buildQuery(indexPattern, searchQuery, [], services.queryConfig()) : undefined,
      additionalFields,
    });
    setIsLoading(false);
    if (answer.status !== 200) setPreviewData({ error: answer.error });
    else {
      setPreviewData({
        rows: (answer.hits?.hits ?? []).map((hit) => ({ _id: hit._id, ...hit._source, ...hit.fields })),
      });
    }
  };

  // A script is run as the preview opens, as in the original
  useEffect(() => {
    if (script) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="inpSpacer--l" />
      <div className="inpText inpText--m">
        <h3>Preview results</h3>
        <p>
          Run your script to preview the first 10 results. You can also select some additional fields to include in your
          results to gain more context or add a query to filter on specific documents.
        </p>
      </div>
      <div className="inpSpacer--l" />
      <FormRow label="Additional fields" wide>
        <ComboBox
          options={options}
          selected={additionalFields}
          onChange={setAdditionalFields}
          placeholder="Select..."
          testId="additionalFieldsSelect"
          fullWidth
        />
      </FormRow>
      <div className="inpTestScript__searchBar">
        <QueryBar
          appName="indexPatternManagement"
          value={query}
          language={language}
          onChange={setQuery}
          onLanguageChange={setLanguage}
          onSubmit={(text) => void run({ query: text, language })}
          indexPatterns={indexPattern ? [indexPattern] : []}
        />
        <SmallButton
          disabled={!script}
          loading={isLoading}
          testId="runScriptButton"
          onClick={() => void run({ query, language })}
        >
          Run script
        </SmallButton>
      </div>
      <div className="inpSpacer--l" />
      {previewData && <PreviewResult data={previewData} />}
    </>
  );
}

/** The text between the coloured runs of a line, its brackets and commas greyed as EuiCodeBlock greys them */
function PlainRun({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/([[\]{},])/)
        .filter((piece) => piece !== '')
        .map((piece, index) =>
          /^[[\]{},]$/.test(piece) ? (
            <span key={index} className="inpCodeBlock__punctuation">
              {piece}
            </span>
          ) : (
            <Fragment key={index}>{piece}</Fragment>
          )
        )}
    </>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  const lines = tokenizeJson(JSON.stringify(value, null, ' ') ?? '');
  return (
    <div className="inpCodeBlock">
      <pre className="inpCodeBlock__pre">
        <code data-test-subj="scriptedFieldPreview">
          {lines.map((tokens, index) => (
            <span key={index} className="inpCodeBlock__line">
              {tokens.map((token, at) =>
                token.kind ? (
                  <span key={at} className={`tok${token.kind}`}>
                    {token.text}
                  </span>
                ) : (
                  <PlainRun key={at} text={token.text} />
                )
              )}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function PreviewResult({ data }: { data: { rows?: unknown[]; error?: unknown } }): ReactNode {
  if (data.error !== undefined) {
    return (
      <CallOut title="There's an error in your script" tone="danger" icon="cross">
        <JsonBlock value={data.error} />
      </CallOut>
    );
  }
  return (
    <>
      <p className="inpTitle inpTitle--xs">First 10 results</p>
      <div className="inpSpacer--s" />
      <JsonBlock value={data.rows} />
    </>
  );
}
