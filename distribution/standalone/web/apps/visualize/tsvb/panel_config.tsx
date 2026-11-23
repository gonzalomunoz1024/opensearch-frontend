/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The settings of each kind of TSVB panel, under the chart: its tabs (the series, the panel's
 * options and, for some, annotations or Markdown), as OpenSearch Dashboards lays them out. A
 * panel that colours by rules or draws a gauge adds what it lacks to the params when it opens.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { choice } from './agg_lists';
import { AnnotationsEditor } from './annotations';
import {
  ColorRules,
  Combo,
  Field,
  FieldSelect,
  IndexPatternOptions,
  Item,
  KEY_HELP,
  Label,
  OptionsPanel,
  PanelFilter,
  Row,
  Rule,
  Spacer,
  TextInput,
  TvbColorPicker,
  TvbTabs,
  YesNo,
  type TabSpec,
} from './controls';
import { MarkdownCssEditor, MarkdownEditor } from './markdown';
import { SERIES_LIMIT, panelAdditions, str, type Fields, type OnChange, type Panel } from './model';
import { SeriesEditor, type PanelData } from './series';

export interface PanelProps {
  model: Panel;
  fields: Fields;
  onChange: OnChange;
  /** What the chart drew last: the number of series each made, the variables of Markdown */
  visData?: PanelData;
}


const POSITIONS = [choice('Right', 'right'), choice('Left', 'left')];
const SCALES = [choice('Normal', 'normal'), choice('Log', 'log')];
const LEGEND_POSITIONS = [choice('Right', 'right'), choice('Left', 'left'), choice('Bottom', 'bottom')];
const TOOLTIP_MODES = [choice('Show all values', 'show_all'), choice('Show focused values', 'show_focused')];
const GAUGE_STYLES = [choice('Circle', 'circle'), choice('Half Circle', 'half')];
const ALIGNMENTS = [choice('Top', 'top'), choice('Middle', 'middle'), choice('Bottom', 'bottom')];

/** The data options every kind of panel starts its options with */
function DataOptions({ model, fields, onChange, before }: PanelProps & { before?: ReactNode }) {
  return (
    <OptionsPanel title="Data">
      <Spacer size="m" />
      {before}
      <IndexPatternOptions fields={fields} model={model} onChange={onChange} />
      <Rule />
      <PanelFilter model={model} onChange={onChange} />
    </OptionsPanel>
  );
}

function ItemUrl({ model, onChange }: { model: Panel; onChange: OnChange }) {
  return (
    <>
      <Field label="Item url" help={KEY_HELP}>
        <TextInput value={model.drilldown_url} onChange={(text) => onChange({ drilldown_url: text })} label="Item url" />
      </Field>
      <Rule />
    </>
  );
}

function Tabbed({ tabs, selected, onSelect, children }: { tabs: TabSpec[]; selected: string; onSelect: (id: string) => void; children: ReactNode }) {
  return (
    <>
      <TvbTabs className="tvbPanelConfig__tabs" tabs={tabs} selected={selected} onSelect={onSelect} />
      {children}
    </>
  );
}

function TimeseriesPanel(props: PanelProps) {
  const { onChange } = props;
  const [tab, setTab] = useState('data');
  const model: Panel = { axis_max: '', axis_min: '', legend_position: 'right', show_grid: 1, tooltip_mode: 'show_all', ...props.model };
  let view: ReactNode;
  if (tab === 'data') view = <SeriesEditor {...props} />;
  else if (tab === 'annotations') view = <AnnotationsEditor model={props.model} fields={props.fields} onChange={onChange} />;
  else {
    view = (
      <div className="tvbPanelConfig__container">
        <DataOptions {...props} />
        <Spacer />
        <OptionsPanel title="Style">
          <Spacer size="m" />
          <Row center wrap responsive={false}>
            <Item>
              <Field label="Axis min">
                <TextInput type="number" value={model.axis_min} onChange={(text) => onChange({ axis_min: text })} label="Axis min" />
              </Field>
            </Item>
            <Item>
              <Field label="Axis max">
                <TextInput type="number" value={model.axis_max} onChange={(text) => onChange({ axis_max: text })} label="Axis max" />
              </Field>
            </Item>
            <Item>
              <Field label="Axis position">
                <Combo options={POSITIONS} value={model.axis_position} clearable={false} onChange={(value) => onChange({ axis_position: value })} />
              </Field>
            </Item>
            <Item>
              <Field label="Axis scale">
                <Combo options={SCALES} value={model.axis_scale} clearable={false} onChange={(value) => onChange({ axis_scale: value })} />
              </Field>
            </Item>
          </Row>
          <Rule />
          <Row center wrap responsive={false}>
            <Item grow={false}>
              <Label>Background color:</Label>
            </Item>
            <Item>
              <TvbColorPicker name="background_color" value={model.background_color} onChange={onChange} />
            </Item>
            <Item grow={false}>
              <Label>Show legend?</Label>
            </Item>
            <Item>
              <YesNo name="show_legend" value={model.show_legend} onChange={onChange} />
            </Item>
            <Item grow={false}>
              <Label>Legend position</Label>
            </Item>
            <Item>
              <Combo options={LEGEND_POSITIONS} value={model.legend_position} clearable={false} narrow onChange={(value) => onChange({ legend_position: value })} />
            </Item>
            <Item grow={false}>
              <Label>Display grid</Label>
            </Item>
            <Item>
              <YesNo name="show_grid" value={model.show_grid} onChange={onChange} />
            </Item>
            <Item grow={false}>
              <Label>Tooltip</Label>
            </Item>
            <Item>
              <Combo options={TOOLTIP_MODES} value={model.tooltip_mode} clearable={false} narrow onChange={(value) => onChange({ tooltip_mode: value })} />
            </Item>
          </Row>
        </OptionsPanel>
      </div>
    );
  }
  return (
    <Tabbed
      tabs={[
        { id: 'data', label: 'Data' },
        { id: 'options', label: 'Panel options', testId: 'timeSeriesEditorPanelOptionsBtn' },
        { id: 'annotations', label: 'Annotations' },
      ]}
      selected={tab}
      onSelect={setTab}
    >
      {view}
    </Tabbed>
  );
}

function MetricPanel(props: PanelProps) {
  const { onChange } = props;
  const [tab, setTab] = useState('data');
  const view =
    tab === 'data' ? (
      <SeriesEditor {...props} colorPicker={false} limit={SERIES_LIMIT.metric} />
    ) : (
      <div className="tvbPanelConfig__container">
        <DataOptions {...props} />
        <Spacer />
        <OptionsPanel title="Color rules">
          <Spacer size="m" />
          <ColorRules model={props.model} onChange={onChange} name="background_color_rules" />
        </OptionsPanel>
      </div>
    );
  return (
    <Tabbed
      tabs={[
        { id: 'data', label: 'Data' },
        { id: 'options', label: 'Panel options', testId: 'metricEditorPanelOptionsBtn' },
      ]}
      selected={tab}
      onSelect={setTab}
    >
      {view}
    </Tabbed>
  );
}

function TopNPanel(props: PanelProps) {
  const { onChange, model } = props;
  const [tab, setTab] = useState('data');
  const view =
    tab === 'data' ? (
      <SeriesEditor {...props} />
    ) : (
      <div className="tvbPanelConfig__container">
        <DataOptions {...props} before={<ItemUrl model={model} onChange={onChange} />} />
        <Spacer />
        <OptionsPanel title="Style">
          <Spacer size="m" />
          <Row center wrap responsive={false}>
            <Item grow={false}>
              <Label>Background color:</Label>
            </Item>
            <Item grow={false}>
              <TvbColorPicker name="background_color" value={model.background_color} onChange={onChange} />
            </Item>
          </Row>
          <Rule />
          <h4 className="tvbTitle--xxs">Color rules</h4>
          <Spacer size="s" />
          <ColorRules model={model} onChange={onChange} name="bar_color_rules" primaryVarName="bar_color" primaryName="bar" hideSecondary />
        </OptionsPanel>
      </div>
    );
  return (
    <Tabbed
      tabs={[
        { id: 'data', label: 'Data' },
        { id: 'options', label: 'Panel options' },
      ]}
      selected={tab}
      onSelect={setTab}
    >
      {view}
    </Tabbed>
  );
}

function GaugePanel(props: PanelProps) {
  const { onChange } = props;
  const [tab, setTab] = useState('data');
  const model: Panel = { gauge_max: '', gauge_style: 'circle', gauge_inner_width: '', gauge_width: '', ...props.model };
  const view =
    tab === 'data' ? (
      <SeriesEditor {...props} limit={SERIES_LIMIT.gauge} />
    ) : (
      <div className="tvbPanelConfig__container">
        <DataOptions {...props} />
        <Spacer />
        <OptionsPanel title="Style">
          <Spacer size="m" />
          <Row wrap responsive={false}>
            <Item>
              <Field label="Gauge max (empty for auto)">
                <TextInput type="number" value={model.gauge_max} onChange={(text) => onChange({ gauge_max: text })} label="Gauge max (empty for auto)" />
              </Field>
            </Item>
            <Item>
              <Field label="Gauge style">
                <Combo options={GAUGE_STYLES} value={model.gauge_style} clearable={false} onChange={(value) => onChange({ gauge_style: value })} />
              </Field>
            </Item>
            <Item>
              <Field label="Inner line width">
                <TextInput type="number" value={Number(model.gauge_inner_width)} onChange={(text) => onChange({ gauge_inner_width: text })} label="Inner line width" />
              </Field>
            </Item>
            <Item>
              <Field label="Gauge line width">
                <TextInput type="number" value={Number(model.gauge_width)} onChange={(text) => onChange({ gauge_width: text })} label="Gauge line width" />
              </Field>
            </Item>
          </Row>
          <Rule />
          <Row center wrap responsive={false}>
            <Item grow={false}>
              <Label>Background color:</Label>
            </Item>
            <Item grow={false}>
              <TvbColorPicker name="background_color" value={model.background_color} onChange={onChange} />
            </Item>
            <Item grow={false}>
              <Label>Inner color:</Label>
            </Item>
            <Item grow={false}>
              <TvbColorPicker name="gauge_inner_color" value={model.gauge_inner_color} onChange={onChange} />
            </Item>
          </Row>
          <Rule />
          <h4 className="tvbTitle--xxs">Color rules</h4>
          <Spacer size="s" />
          <ColorRules
            primaryName="gauge color"
            primaryVarName="gauge"
            secondaryName="text color"
            secondaryVarName="text"
            model={model}
            onChange={onChange}
            name="gauge_color_rules"
          />
        </OptionsPanel>
      </div>
    );
  return (
    <Tabbed
      tabs={[
        { id: 'data', label: 'Data' },
        { id: 'options', label: 'Panel options' },
      ]}
      selected={tab}
      onSelect={setTab}
    >
      {view}
    </Tabbed>
  );
}

function MarkdownPanel(props: PanelProps) {
  const { onChange, model } = props;
  const [tab, setTab] = useState('markdown');
  let view: ReactNode;
  if (tab === 'markdown') view = <MarkdownEditor model={model} visData={props.visData} onChange={onChange} />;
  else if (tab === 'data') view = <SeriesEditor {...props} colorPicker={false} />;
  else {
    view = (
      <div className="tvbPanelConfig__container">
        <DataOptions {...props} />
        <Spacer />
        <OptionsPanel title="Style">
          <Spacer size="m" />
          <Row center wrap responsive={false}>
            <Item grow={false}>
              <Label>Background color:</Label>
            </Item>
            <Item>
              <TvbColorPicker name="background_color" value={model.background_color} onChange={onChange} />
            </Item>
            <Item grow={false}>
              <Label>Show scrollbars?</Label>
            </Item>
            <Item>
              <YesNo name="markdown_scrollbars" value={model.markdown_scrollbars} onChange={onChange} />
            </Item>
            <Item grow={false}>
              <Label>Open links in new tab?</Label>
            </Item>
            <Item>
              <YesNo name="markdown_openLinksInNewTab" value={model.markdown_openLinksInNewTab} onChange={onChange} />
            </Item>
            <Item grow={false}>
              <Label>Vertical alignment:</Label>
            </Item>
            <Item>
              <Combo
                options={ALIGNMENTS}
                value={model.markdown_vertical_align}
                clearable={false}
                narrow
                onChange={(value) => onChange({ markdown_vertical_align: value })}
              />
            </Item>
          </Row>
          <Rule />
          <h4 className="tvbTitle--xxs">Custom CSS (supports Less)</h4>
          <Spacer size="s" />
          <MarkdownCssEditor model={model} onChange={onChange} />
        </OptionsPanel>
      </div>
    );
  }
  return (
    <Tabbed
      tabs={[
        { id: 'markdown', label: 'Markdown', testId: 'markdown-subtab' },
        { id: 'data', label: 'Data', testId: 'data-subtab' },
        { id: 'options', label: 'Panel options', testId: 'options-subtab' },
      ]}
      selected={tab}
      onSelect={setTab}
    >
      {view}
    </Tabbed>
  );
}

function TablePanel(props: PanelProps) {
  const { onChange, fields } = props;
  const [tab, setTab] = useState('data');
  const model: Panel = { drilldown_url: '', pivot_label: '', pivot_rows: 10, pivot_type: '', ...props.model };
  // The kind of the field rows are grouped by is kept beside it
  const changePivot = (pivotId: string | null) => {
    const field = (fields[str(props.model, 'index_pattern')] ?? []).find((item) => item.name === pivotId);
    onChange({ pivot_id: pivotId, pivot_type: field ? field.type : model.pivot_type });
  };
  const view =
    tab === 'data' ? (
      <div>
        <div className="tvbPanelConfig__container">
          <section className="tvbOptions">
            <p className="tvbText">For the table visualization you need to define a field to group by using a terms aggregation.</p>
            <Spacer size="m" />
            <Row wrap responsive={false}>
              <Item testId="groupByField">
                <Field label="Group by field">
                  <FieldSelect fields={fields} indexPattern={str(props.model, 'index_pattern')} value={props.model.pivot_id} onChange={changePivot} />
                </Field>
              </Item>
              <Item>
                <Field label="Column label" full>
                  <TextInput value={model.pivot_label} onChange={(text) => onChange({ pivot_label: text })} label="Column label" testId="columnLabelName" />
                </Field>
              </Item>
              <Item grow={false}>
                <Field label="Rows">
                  <TextInput type="number" value={model.pivot_rows} onChange={(text) => onChange({ pivot_rows: text })} label="Rows" />
                </Field>
              </Item>
            </Row>
          </section>
        </div>
        <SeriesEditor {...props} />
      </div>
    ) : (
      <div className="tvbPanelConfig__container">
        <DataOptions {...props} model={model} before={<ItemUrl model={model} onChange={onChange} />} />
      </div>
    );
  return (
    <Tabbed
      tabs={[
        { id: 'data', label: 'Columns' },
        { id: 'options', label: 'Panel options' },
      ]}
      selected={tab}
      onSelect={setTab}
    >
      {view}
    </Tabbed>
  );
}

const PANELS: Record<string, (props: PanelProps) => ReactNode> = {
  timeseries: (props) => <TimeseriesPanel {...props} />,
  metric: (props) => <MetricPanel {...props} />,
  top_n: (props) => <TopNPanel {...props} />,
  gauge: (props) => <GaugePanel {...props} />,
  markdown: (props) => <MarkdownPanel {...props} />,
  table: (props) => <TablePanel {...props} />,
};

/** The settings of the panel, by its kind */
export function PanelConfig(props: PanelProps) {
  const { model, onChange } = props;
  const latest = useRef(onChange);
  latest.current = onChange;
  // What a kind of panel adds when it opens is a change like any other
  const additions = useRef<string>();
  useEffect(() => {
    if (additions.current === model.type) return;
    additions.current = model.type;
    const parts = panelAdditions(model);
    if (Object.keys(parts).length) latest.current(parts);
  }, [model]);
  const render = PANELS[model.type];
  if (!render) return <div>Missing panel config for “{model.type}”</div>;
  return (
    <div data-test-subj={`tvbPanelConfig__${model.type}`} key={model.type}>
      {render(props)}
    </div>
  );
}
