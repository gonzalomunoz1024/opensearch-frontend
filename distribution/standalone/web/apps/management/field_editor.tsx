/* SPDX-License-Identifier: Apache-2.0 */

/*
 * One field of an index pattern: how its values are written (its format) and how often it is
 * picked, and for a scripted field its name, language, type and script.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, CallOut, EmptyPrompt, IconButton, Loading, PageHeader, Panel } from '../../components/basic';
import { FormRow, NumberField, Select, Switch, TextArea, TextField } from '../../components/form';
import { FormattedText } from '../../components/formatted';
import { ConfirmModal } from '../../components/overlay';
import { createFormatter, formatSpecOf } from '../../lib/field_formats';
import type { Field, FieldFormatSpec, IndexPattern } from '../../lib/types';
import { navigate } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import { patternName } from '../../services/index_patterns';
import { useBreadcrumbs } from '../../shell/state';

const ROOT = '/app/management/opensearch-dashboards/indexPatterns';

interface FormatDefinition {
  id: string;
  title: string;
  /** The kinds of field it can write */
  types: string[];
}

export const FIELD_FORMATS: FormatDefinition[] = [
  { id: 'boolean', title: 'Boolean', types: ['boolean', 'number', 'string'] },
  { id: 'bytes', title: 'Bytes', types: ['number'] },
  { id: 'color', title: 'Color', types: ['number', 'string'] },
  { id: 'date', title: 'Date', types: ['date'] },
  { id: 'date_nanos', title: 'Date nanos', types: ['date'] },
  { id: 'duration', title: 'Duration', types: ['number'] },
  { id: 'ip', title: 'IP address', types: ['ip'] },
  { id: 'number', title: 'Number', types: ['number'] },
  { id: 'percent', title: 'Percentage', types: ['number'] },
  { id: 'relative_date', title: 'Relative date', types: ['date'] },
  { id: 'static_lookup', title: 'Static lookup', types: ['string', 'number', 'ip', 'boolean'] },
  {
    id: 'string',
    title: 'String',
    types: ['number', 'boolean', 'date', 'ip', 'attachment', 'geo_point', 'geo_shape', 'string', 'murmur3', 'unknown', 'conflict'],
  },
  { id: 'truncate', title: 'Truncated string', types: ['string'] },
  { id: 'url', title: 'Url', types: ['number', 'boolean', 'date', 'ip', 'string', 'murmur3', 'unknown', 'conflict'] },
];

const formatTitle = (id: string) => FIELD_FORMATS.find((format) => format.id === id)?.title ?? id;

const DURATION_INPUTS = ['picoseconds', 'nanoseconds', 'microseconds', 'milliseconds', 'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'];
const DURATION_OUTPUTS = [
  { value: 'humanize', label: 'Human Readable' },
  { value: 'asMilliseconds', label: 'Milliseconds' },
  { value: 'asSeconds', label: 'Seconds' },
  { value: 'asMinutes', label: 'Minutes' },
  { value: 'asHours', label: 'Hours' },
  { value: 'asDays', label: 'Days' },
  { value: 'asWeeks', label: 'Weeks' },
  { value: 'asMonths', label: 'Months' },
  { value: 'asYears', label: 'Years' },
];
const STRING_TRANSFORMS = [
  { value: '', label: '- None -' },
  { value: 'lower', label: 'Lower Case' },
  { value: 'upper', label: 'Upper Case' },
  { value: 'title', label: 'Title Case' },
  { value: 'short', label: 'Short Dots' },
  { value: 'base64', label: 'Base64 Decode' },
  { value: 'urlparam', label: 'URL Param Decode' },
];

const SAMPLES: Record<string, unknown[]> = {
  number: [10000, 12.345678, -1, -999, 0.52],
  bytes: [256, 1024, 5150000, 1990000000],
  percent: [0.1, 0.99999, 1, 100, 1000],
  duration: [-123, 1, 12, 123, 658, 1988, 3857, 123292, 923528271],
  truncate: ['Scottish haggis and kippers with a neep of tatties, before the bagpipes are played.'],
  boolean: [true, false, 1, 'no'],
  ip: [3232235521, 2130706433],
};
const STRING_SAMPLES: Record<string, unknown[]> = {
  '': ['A Quick Brown Fox.', 'STAY CALM!', 'com.organizations.project.ClassName'],
  lower: ['A Quick Brown Fox.', 'STAY CALM!'],
  upper: ['A Quick Brown Fox.', 'stay calm!'],
  title: ['A Quick Brown Fox.', 'STAY CALM!'],
  short: ['com.organizations.project.ClassName'],
  base64: ['SGVsbG8gd29ybGQ='],
  urlparam: ['%EC%95%88%EB%85%95%20%ED%82%A4%EB%B0%94%EB%82%98', '%F0%9F%98%81%F0%9F%8E%89'],
};

type Params = Record<string, unknown>;

interface ParamsEditorProps {
  format: string;
  fieldType: string;
  params: Params;
  onChange: (params: Params) => void;
}

interface LookupEntry {
  key: string;
  value: string;
}

interface ColorRule {
  range?: string;
  regex?: string;
  text?: string;
  background?: string;
}

function FormatParams({ format, fieldType, params, onChange }: ParamsEditorProps) {
  const set = (patch: Params) => onChange({ ...params, ...patch });
  const settings = services.formatSettings();
  const text = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : '');

  if (format === 'number' || format === 'bytes' || format === 'percent') {
    const fallback = services.uiSettings.get<string>(`format:${format}:defaultPattern`, '');
    return (
      <FormRow label={`Numeral.js format pattern (Default: "${fallback}")`}>
        <TextField value={text('pattern')} onChange={(pattern) => set({ pattern: pattern || undefined })} placeholder={fallback} testId="numberEditorFormatPattern" />
      </FormRow>
    );
  }
  if (format === 'date' || format === 'date_nanos') {
    const fallback = format === 'date' ? settings.dateFormat : services.uiSettings.get<string>('dateNanosFormat', '');
    return (
      <FormRow label={`Moment.js format pattern (Default: "${fallback}")`}>
        <TextField value={text('pattern')} onChange={(pattern) => set({ pattern: pattern || undefined })} placeholder={fallback} testId="dateEditorPattern" />
      </FormRow>
    );
  }
  if (format === 'duration') {
    const output = text('outputFormat') || 'humanize';
    return (
      <>
        <FormRow label="Input format">
          <Select
            value={text('inputFormat') || 'seconds'}
            onChange={(inputFormat) => set({ inputFormat })}
            options={DURATION_INPUTS.map((unit) => ({ value: unit, label: unit[0].toUpperCase() + unit.slice(1) }))}
          />
        </FormRow>
        <FormRow label="Output format">
          <Select value={output} onChange={(outputFormat) => set({ outputFormat })} options={DURATION_OUTPUTS} />
        </FormRow>
        {output !== 'humanize' && (
          <FormRow label="Decimal places">
            <NumberField
              min={0}
              max={20}
              value={typeof params.outputPrecision === 'number' ? params.outputPrecision : 2}
              onChange={(outputPrecision) => set({ outputPrecision: outputPrecision ?? 2 })}
            />
          </FormRow>
        )}
      </>
    );
  }
  if (format === 'string') {
    return (
      <FormRow label="Transform">
        <Select value={text('transform')} onChange={(transform) => set({ transform: transform || undefined })} options={STRING_TRANSFORMS} />
      </FormRow>
    );
  }
  if (format === 'truncate') {
    return (
      <FormRow label="Field length">
        <NumberField min={1} value={typeof params.fieldLength === 'number' ? params.fieldLength : ''} onChange={(fieldLength) => set({ fieldLength })} />
      </FormRow>
    );
  }
  if (format === 'static_lookup') {
    const entries = Array.isArray(params.lookupEntries) ? (params.lookupEntries as LookupEntry[]) : [];
    const change = (index: number, patch: Partial<LookupEntry>) =>
      set({ lookupEntries: entries.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)) });
    return (
      <div className="atlStack">
        <div className="mgtRules">
          {entries.length > 0 && (
            <div className="mgtRules__row mgtRules__row--head">
              <span>Key</span>
              <span>Value</span>
              <span />
            </div>
          )}
          {entries.map((entry, index) => (
            <div className="mgtRules__row" key={index}>
              <TextField value={String(entry.key ?? '')} onChange={(key) => change(index, { key })} aria-label="Key" />
              <TextField value={String(entry.value ?? '')} onChange={(value) => change(index, { value })} aria-label="Value" />
              <IconButton icon="trash" label="Delete entry" size="s" variant="danger" onClick={() => set({ lookupEntries: entries.filter((_, at) => at !== index) })} />
            </div>
          ))}
        </div>
        <div>
          <Button size="s" icon="plus" onClick={() => set({ lookupEntries: [...entries, { key: '', value: '' }] })}>
            Add entry
          </Button>
        </div>
        <FormRow label="Value for unknown key" help="Leave blank to keep the value as it is.">
          <TextField value={text('unknownKeyValue')} onChange={(unknownKeyValue) => set({ unknownKeyValue: unknownKeyValue || undefined })} />
        </FormRow>
      </div>
    );
  }
  if (format === 'color') {
    const rules = Array.isArray(params.colors) ? (params.colors as ColorRule[]) : [];
    const byRegex = fieldType === 'string';
    const change = (index: number, patch: Partial<ColorRule>) =>
      onChange({ ...params, fieldType, colors: rules.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)) });
    return (
      <div className="atlStack">
        <div className="mgtRules mgtRules--colors">
          {rules.length > 0 && (
            <div className="mgtRules__row mgtRules__row--head">
              <span>{byRegex ? 'Pattern (regular expression)' : 'Range (min:max)'}</span>
              <span>Text color</span>
              <span>Background color</span>
              <span>Example</span>
              <span />
            </div>
          )}
          {rules.map((rule, index) => (
            <div className="mgtRules__row" key={index}>
              <TextField
                value={(byRegex ? rule.regex : rule.range) ?? ''}
                onChange={(value) => change(index, byRegex ? { regex: value } : { range: value })}
                aria-label={byRegex ? 'Pattern' : 'Range'}
              />
              <input type="color" className="mgtColor" value={rule.text ?? '#000000'} onChange={(event) => change(index, { text: event.target.value })} aria-label="Text color" />
              <input
                type="color"
                className="mgtColor"
                value={rule.background ?? '#ffffff'}
                onChange={(event) => change(index, { background: event.target.value })}
                aria-label="Background color"
              />
              <span className="mgtColorExample" style={{ color: rule.text, background: rule.background }}>
                123456
              </span>
              <IconButton
                icon="trash"
                label="Delete color format"
                size="s"
                variant="danger"
                onClick={() => onChange({ ...params, fieldType, colors: rules.filter((_, at) => at !== index) })}
              />
            </div>
          ))}
        </div>
        <div>
          <Button
            size="s"
            icon="plus"
            onClick={() =>
              onChange({
                ...params,
                fieldType,
                colors: [...rules, { ...(byRegex ? { regex: '<insert regex>' } : { range: `${Number.NEGATIVE_INFINITY}:${Number.POSITIVE_INFINITY}` }), text: '#000000', background: '#ffffff' }],
              })
            }
          >
            Add color
          </Button>
        </div>
      </div>
    );
  }
  if (format === 'url') {
    const kind = text('type') || 'a';
    return (
      <>
        <FormRow label="Type">
          <Select
            value={kind}
            onChange={(type) => set({ type })}
            options={[
              { value: 'a', label: 'Link' },
              { value: 'img', label: 'Image' },
              { value: 'audio', label: 'Audio' },
            ]}
          />
        </FormRow>
        {kind === 'a' && (
          <Switch checked={params.openLinkInCurrentTab !== true} onChange={(inNewTab) => set({ openLinkInCurrentTab: !inNewTab })} label="Open in a new tab" />
        )}
        <FormRow label="URL template" help="{{value}} is the value, URL-encoded; {{rawValue}} is the value as it is.">
          <TextField value={text('urlTemplate')} onChange={(urlTemplate) => set({ urlTemplate: urlTemplate || undefined })} placeholder="https://www.example.org/?q={{value}}" />
        </FormRow>
        <FormRow label="Label template" help="{{value}} is the value; {{url}} is the address the template above makes.">
          <TextField value={text('labelTemplate')} onChange={(labelTemplate) => set({ labelTemplate: labelTemplate || undefined })} />
        </FormRow>
        {kind === 'img' && (
          <div className="atlRow">
            <FormRow label="Width">
              <NumberField min={1} value={Number(params.width) || ''} onChange={(width) => set({ width })} />
            </FormRow>
            <FormRow label="Height">
              <NumberField min={1} value={Number(params.height) || ''} onChange={(height) => set({ height })} />
            </FormRow>
          </div>
        )}
      </>
    );
  }
  return null;
}

function Samples({ spec }: { spec: FieldFormatSpec }) {
  const inputs = useMemo(() => {
    if (spec.id === 'string') return STRING_SAMPLES[String(spec.params?.transform ?? '')] ?? STRING_SAMPLES[''];
    if (spec.id === 'date' || spec.id === 'date_nanos' || spec.id === 'relative_date') {
      const now = new Date();
      return [now.getTime(), new Date(now.getFullYear(), 0, 1).getTime(), new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999).getTime()];
    }
    return SAMPLES[spec.id];
  }, [spec]);
  const format = useMemo(() => createFormatter(spec, services.formatSettings()), [spec]);
  if (!inputs) return null;
  return (
    <FormRow label="Samples" full>
      <table className="mgtSamples">
        <thead>
          <tr>
            <th>Input</th>
            <th>Output</th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((input) => (
            <tr key={String(input)}>
              <td className="atlMono">{String(input)}</td>
              <td>
                <FormattedText formatted={format(input)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </FormRow>
  );
}

const SCRIPT_TYPES = ['number', 'string', 'date', 'boolean'];

export function FieldEditor({ patternId, fieldName }: { patternId: string; fieldName?: string }) {
  const [pattern, setPattern] = useState<IndexPattern>();
  const [error, setError] = useState<string>();
  const [field, setField] = useState<Field>();
  const [formatId, setFormatId] = useState('');
  const [params, setParams] = useState<Params>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const creating = fieldName === undefined;
  const back = `${ROOT}/patterns/${encodeURIComponent(patternId)}#/?_a=(tab:${creating || field?.scripted ? 'scriptedFields' : 'indexedFields'})`;

  useBreadcrumbs([
    { text: 'Dashboards Management', to: '/app/management' },
    { text: 'Index patterns', to: ROOT },
    { text: pattern ? patternName(pattern) : 'Index pattern', to: `${ROOT}/patterns/${encodeURIComponent(patternId)}` },
    { text: creating ? 'Create field' : (fieldName ?? '') },
  ]);

  useEffect(() => {
    let live = true;
    services.indexPatterns
      .get(patternId)
      .then((loaded) => {
        if (!live) return;
        setPattern(loaded);
        if (creating) {
          setField({ name: '', type: 'number', searchable: true, aggregatable: true, scripted: true, script: '', lang: 'painless', count: 0 });
          return;
        }
        const existing = loaded.fields.find((candidate) => candidate.name === fieldName);
        if (!existing) {
          setError(`The index pattern has no field named "${fieldName}".`);
          return;
        }
        setField({ ...existing });
        const own = loaded.fieldFormatMap[existing.name];
        setFormatId(own?.id ?? '');
        setParams((own?.params as Params | undefined) ?? {});
      })
      .catch((failure) => live && setError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, [patternId, fieldName, creating]);

  if (error) {
    return (
      <div className="mgtPage">
        <Panel>
          <EmptyPrompt icon="warning" title="This field could not be opened" actions={<Button to={back}>Back to the index pattern</Button>}>
            {error}
          </EmptyPrompt>
        </Panel>
      </div>
    );
  }
  if (!pattern || !field) {
    return (
      <div className="mgtPage">
        <Loading />
      </div>
    );
  }

  const scripted = field.scripted === true;
  const formats = FIELD_FORMATS.filter((format) => format.types.includes(field.type));
  const defaultSpec = formatSpecOf({ name: '', type: field.type, esTypes: field.esTypes }, undefined, services.formatSettings());
  const spec: FieldFormatSpec = formatId ? { id: formatId, params } : defaultSpec;
  const name = field.name.trim();
  const nameTaken = creating && pattern.fields.some((other) => other.name === name);
  const invalid: string | undefined = scripted
    ? !name
      ? 'A scripted field needs a name.'
      : nameTaken
        ? `The index pattern already has a field named "${name}".`
        : !field.script?.trim()
          ? 'A scripted field needs a script.'
          : undefined
    : undefined;

  const save = async () => {
    setSaving(true);
    try {
      const saved: Field = { ...field, name, count: field.count ?? 0 };
      const fields = creating ? [...pattern.fields, saved] : pattern.fields.map((other) => (other.name === fieldName ? saved : other));
      const fieldFormatMap = { ...pattern.fieldFormatMap };
      if (formatId) fieldFormatMap[name] = { id: formatId, params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) };
      else delete fieldFormatMap[name];
      await services.indexPatterns.save({ ...pattern, fields, fieldFormatMap });
      services.toasts.success(`Saved '${name}'`);
      navigate(back);
    } catch (failure) {
      services.toasts.error(failure, 'The field could not be saved');
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const fieldFormatMap = { ...pattern.fieldFormatMap };
      delete fieldFormatMap[field.name];
      await services.indexPatterns.save({ ...pattern, fields: pattern.fields.filter((other) => other.name !== fieldName), fieldFormatMap });
      services.toasts.success(`Deleted '${field.name}'`);
      navigate(back);
    } catch (failure) {
      services.toasts.error(failure, 'The field could not be deleted');
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  let scriptHelp: ReactNode = null;
  if (scripted) {
    scriptHelp = (
      <>
        Access a field's value with <code>doc['some_field'].value</code>. A script in the <strong>expression</strong> language can only read
        numbers; <strong>painless</strong> reads every kind of field.
      </>
    );
  }

  return (
    <div className="mgtPage" data-test-subj="fieldEditor">
      <Panel>
        <PageHeader title={creating ? 'Create scripted field' : `Edit ${field.name}`} />
        <div className="atlStack mgtForm">
          {scripted && (
            <CallOut tone="warning" title="Proceed with caution">
              Please familiarize yourself with scripted fields and with scripts in aggregations before using scripted fields. Scripted fields can be
              used to display and aggregate calculated values. As such, they can be very slow, and if done incorrectly, can cause {services.boot.name}{' '}
              to be unusable.
            </CallOut>
          )}
          {scripted && (
            <FormRow label="Name" error={nameTaken ? invalid : undefined}>
              <TextField
                value={field.name}
                onChange={(next) => setField({ ...field, name: next })}
                disabled={!creating}
                placeholder="New scripted field"
                invalid={nameTaken}
                testId="editorFieldName"
              />
            </FormRow>
          )}
          {scripted && (
            <FormRow label="Language">
              <Select
                value={field.lang ?? 'painless'}
                onChange={(lang) => setField({ ...field, lang })}
                options={[
                  { value: 'painless', label: 'painless' },
                  { value: 'expression', label: 'expression' },
                ]}
                testId="editorFieldLang"
              />
            </FormRow>
          )}
          <FormRow label="Type">
            {scripted ? (
              <Select
                value={field.type}
                onChange={(type) => {
                  setField({ ...field, type });
                  setFormatId('');
                  setParams({});
                }}
                options={SCRIPT_TYPES.map((type) => ({ value: type, label: type }))}
                testId="editorFieldType"
              />
            ) : (
              <TextField value={field.type} onChange={() => undefined} disabled />
            )}
          </FormRow>
          <FormRow
            label={`Format (Default: ${formatTitle(defaultSpec.id)})`}
            help="Formatting allows you to control the way that specific values are displayed. It can also cause values to be completely changed and prevent highlighting in Discover from working."
          >
            <Select
              value={formatId}
              onChange={(next) => {
                setFormatId(next);
                setParams({});
              }}
              options={[{ value: '', label: '- Default -' }, ...formats.map((format) => ({ value: format.id, label: format.title }))]}
              testId="editorSelectedFormatId"
            />
          </FormRow>
          {formatId && <FormatParams format={formatId} fieldType={field.type} params={params} onChange={setParams} />}
          <Samples spec={spec} />
          <FormRow label="Popularity" help="How often the field is picked in Discover: the most popular fields are listed first.">
            <NumberField min={0} value={field.count ?? 0} onChange={(count) => setField({ ...field, count: count ?? 0 })} testId="editorFieldCount" />
          </FormRow>
          {scripted && (
            <FormRow label="Script" help={scriptHelp} full>
              <TextArea
                code
                rows={6}
                value={field.script ?? ''}
                onChange={(script) => setField({ ...field, script })}
                placeholder="doc['some_field'].value"
                testId="editorFieldScript"
              />
            </FormRow>
          )}
          {invalid && !nameTaken && (name || field.script) && <p className="atlSubdued atlSmall">{invalid}</p>}
          <div className="atlRow mgtFormFooter">
            <Button variant="primary" loading={saving} disabled={Boolean(invalid)} onClick={save} testId="fieldSaveButton">
              {creating ? 'Create field' : 'Save field'}
            </Button>
            <Button variant="empty" to={back}>
              Cancel
            </Button>
            <span className="atlGrow" />
            {scripted && !creating && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </Panel>
      {confirmDelete && (
        <ConfirmModal title={`Delete field '${field.name}'?`} confirmLabel="Delete" danger busy={saving} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
          Visualizations that use the field will stop working.
        </ConfirmModal>
      )}
    </div>
  );
}
