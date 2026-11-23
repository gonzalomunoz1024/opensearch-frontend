/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The annotations of a time series: data sources whose documents are marked on the chart, each
 * with its index, time field, query, icon and the text shown for a document. A change writes the
 * whole annotation with the defaults the product's editor reads it with, as that editor does.
 */

import { Button } from '../../../components/basic';
import { defaultQueryLanguage } from '../../../shell/query_bar';
import { ANNOTATION_ICONS, AnnotationIcon } from '../../../vis/tsvb/icons';
import { AddDeleteButtons, Combo, Field, FieldSelect, Item, Label, QueryBarWrapper, Row, Spacer, TextInput, TvbColorPicker, YesNo, type Choice } from './controls';
import { collection, list, uuid, type Doc, type Fields, type OnChange, type Panel } from './model';

type Annotation = Doc & { id: string };

export const newAnnotation = (): Annotation => ({
  id: uuid(),
  color: '#F00',
  index_pattern: '*',
  time_field: '@timestamp',
  icon: 'fa-tag',
  ignore_global_filters: 1,
  ignore_panel_filters: 1,
});

const DATE_FIELDS = ['date'];

const ICON_CHOICES: Choice[] = ANNOTATION_ICONS.map((icon) => ({ ...icon, prepend: <AnnotationIcon name={icon.value} /> }));

const INDEX_HELP = 'Use an asterisk (*) to match multiple indices. Spaces and the characters , /, ?, ", <, >, | are not allowed.';

/** The icon of an annotation: the first of the list when it has none the product knows */
function IconSelect({ value, onChange }: { value: unknown; onChange: (value: string | null) => void }) {
  const known = ANNOTATION_ICONS.some((icon) => icon.value === value);
  return <Combo options={ICON_CHOICES} value={known ? value : ANNOTATION_ICONS[0].value} clearable={false} onChange={onChange} />;
}

function AnnotationRow({ row, fields, onChange, onAdd, onDelete }: { row: Annotation; fields: Fields; onChange: (doc: Annotation) => void; onAdd: () => void; onDelete: () => void }) {
  const model: Annotation = {
    fields: '',
    template: '',
    index_pattern: '*',
    query_string: { query: '', language: defaultQueryLanguage() },
    ...row,
  };
  const change = (part: Doc) => onChange({ ...model, ...part });
  // A list cleared, or a time field the index does not have, leaves the key out, as in the product
  const pick = (name: string) => (value: string | null) => change({ [name]: value ?? undefined });
  const query = (model.query_string && typeof model.query_string === 'object' ? model.query_string : {}) as Doc;
  const indexPattern = typeof model.index_pattern === 'string' ? model.index_pattern : '';
  return (
    <div className="tvbAnnotationsEditor">
      <Row gap="l" responsive={false}>
        <Item grow={false}>
          <TvbColorPicker disableTrash name="color" value={model.color} onChange={change} />
        </Item>
        <Item className="tvbAggRow__children">
          <Row gap="m" wrap responsive={false}>
            <Item>
              <Field label="Index name (required)" help={INDEX_HELP} full>
                <TextInput value={model.index_pattern} label="Index name (required)" onChange={(text) => change({ index_pattern: text })} />
              </Field>
            </Item>
            <Item>
              <Field label="Time field (required)" full>
                <FieldSelect fields={fields} restrict={DATE_FIELDS} indexPattern={indexPattern} value={model.time_field} onChange={pick('time_field')} />
              </Field>
            </Item>
          </Row>
          <Spacer size="m" />
          <Row gap="m" wrap responsive={false}>
            <Item>
              <Field label="Query string" full>
                <QueryBarWrapper
                  query={{
                    language: typeof query.language === 'string' && query.language ? query.language : defaultQueryLanguage(),
                    query: typeof query.query === 'string' ? query.query : '',
                  }}
                  onChange={(next) => change({ query_string: next })}
                  indexPatterns={[indexPattern]}
                />
              </Field>
            </Item>
            <Item grow={false}>
              <Label>Ignore global filters?</Label>
              <Spacer size="m" />
              <YesNo name="ignore_global_filters" value={model.ignore_global_filters} onChange={change} />
            </Item>
            <Item grow={false}>
              <Label>Ignore panel filters?</Label>
              <Spacer size="xs" />
              <YesNo name="ignore_panel_filters" value={model.ignore_panel_filters} onChange={change} />
            </Item>
          </Row>
          <Spacer size="m" />
          <Row gap="m" wrap responsive={false}>
            <Item>
              <Field label="Icon (required)">
                <IconSelect value={model.icon} onChange={pick('icon')} />
              </Field>
            </Item>
            <Item>
              <Field label="Fields (required - comma separated paths)" full>
                <TextInput value={model.fields} label="Fields (required - comma separated paths)" onChange={(text) => change({ fields: text })} />
              </Field>
            </Item>
            <Item>
              <Field
                label="Row template (required)"
                help={
                  <>
                    eg.
                    <span className="tvbCode">
                      <code>{'{{field}}'}</code>
                    </span>
                  </>
                }
                full
              >
                <TextInput value={model.template} label="Row template (required)" onChange={(text) => change({ template: text })} />
              </Field>
            </Item>
          </Row>
        </Item>
        <Item grow={false}>
          <AddDeleteButtons onAdd={onAdd} onDelete={onDelete} togglePanelActivation={() => change({ hidden: !model.hidden })} isPanelActive={!model.hidden} />
        </Item>
      </Row>
    </div>
  );
}

export function AnnotationsEditor({ model, fields, onChange }: { model: Panel; fields: Fields; onChange: OnChange }) {
  const rows = list<Annotation>(model, 'annotations');
  const save = (annotations: Annotation[]) => onChange({ annotations });
  const add = () => save(collection.add(rows, newAnnotation()));
  return (
    <div className="tvbAnnotationsEditor__container">
      {rows.length === 0 ? (
        <div className="tvbText tvbText--center">
          <p className="tvbAnnotationsEditor__empty">Click the button below to create an annotation data source.</p>
          <Button variant="primary" size="s" onClick={add}>
            Add data source
          </Button>
        </div>
      ) : (
        <div>
          <h2 className="tvbTitle--s">Data sources</h2>
          <Spacer size="m" />
          {rows.map((row) => (
            <AnnotationRow
              key={row.id}
              row={row}
              fields={fields}
              onChange={(doc) => save(collection.change(rows, doc))}
              onAdd={add}
              onDelete={() => save(collection.remove(rows, row))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
