/* SPDX-License-Identifier: Apache-2.0 */

/*
 * "Base layer settings" of a coordinate or region map: WmsOptions and WmsInternalOptions of
 * maps_legacy. Without a WMS server, the base map is one of the maps service's (the "Layers"
 * select); with one, its address and parameters.
 */

import { useEffect, useMemo, useState } from 'react';
import { FormRow, Select, Switch, TextField } from '../../../components/form';
import { getServiceSettings, type TmsService } from '../../../maps/service_settings';
import { services } from '../../../services';

export interface WmsParams {
  enabled?: boolean;
  url?: string;
  options?: {
    version?: string;
    layers?: string;
    format?: string;
    transparent?: boolean;
    attribution?: string;
    styles?: string;
  };
  selectedTmsLayer?: TmsService;
}

/** The setting visualization:tileMap:WMSdefaults, as the original's default */
export const WMS_DEFAULTS: WmsParams = {
  enabled: false,
  url: '',
  options: { version: '', layers: '', format: 'image/png', transparent: true, attribution: '', styles: '' },
};

/** What `wms` of a new coordinate or region map starts as: the advanced setting */
export function wmsDefaults(): WmsParams {
  const value = services.uiSettings.get<unknown>('visualization:tileMap:WMSdefaults', undefined);
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as WmsParams;
    } catch {
      return WMS_DEFAULTS;
    }
  }
  return value !== null && typeof value === 'object' ? (value as WmsParams) : WMS_DEFAULTS;
}

/** The base maps the maps service offers, once it has answered (the editor's tmsLayers) */
export function useTmsLayers(): TmsService[] {
  const [layers, setLayers] = useState<TmsService[]>([]);
  useEffect(() => {
    let live = true;
    getServiceSettings(services.boot.map, services.boot.version)
      .getTMSServices()
      .then((found) => live && setLayers(found))
      .catch(() => live && setLayers([]));
    return () => {
      live = false;
    };
  }, []);
  return layers;
}

export interface WmsOptionsProps {
  /** The visualization's params; this panel reads and writes `params.wms` only */
  params: Record<string, unknown>;
  /** Called with the whole params, `wms` replaced */
  setParams: (params: Record<string, unknown>) => void;
  /** The base maps to choose from; when left out, they are asked of the maps service */
  tmsLayers?: TmsService[];
}

/** The panel "Base layer settings", as the coordinate map and the region map show it */
export function WmsOptions({ params, setParams, tmsLayers }: WmsOptionsProps) {
  const fetched = useTmsLayers();
  const layers = tmsLayers ?? fetched;
  const wms: WmsParams = (params.wms as WmsParams | undefined) ?? WMS_DEFAULTS;
  const setWms = (patch: Partial<WmsParams>) => setParams({ ...params, wms: { ...wms, ...patch } });
  const options = useMemo(() => layers.map(({ id }) => ({ value: id, label: id })), [layers]);
  const selected = wms.selectedTmsLayer?.id ?? layers[0]?.id ?? '';

  return (
    <section className="vzePanel" data-test-subj="wmsOptions">
      <h3 className="vzePanel__title">Base layer settings</h3>
      <div className="vzeFields">
        <span title="Use WMS compliant map tile server. For advanced users only.">
          <Switch checked={Boolean(wms.enabled)} onChange={(enabled) => setWms({ enabled })} label="WMS map server" />
        </span>
        {!wms.enabled && (
          <FormRow label="Layers" full>
            <Select
              compact
              value={selected}
              options={options.length ? options : selected ? [{ value: selected, label: selected }] : []}
              onChange={(id) => {
                const layer = layers.find((each) => each.id === id);
                if (layer) setWms({ selectedTmsLayer: layer });
              }}
              testId="wmsOptionsSelectTmsLayer"
            />
          </FormRow>
        )}
        {wms.enabled && <WmsInternalOptions wms={wms} setWms={setWms} />}
      </div>
    </section>
  );
}

const FOOTNOTE = 'If this parameter is incorrect, maps will fail to load.';

function WmsInternalOptions({ wms, setWms }: { wms: WmsParams; setWms: (patch: Partial<WmsParams>) => void }) {
  const wmsOptions = wms.options ?? {};
  const setOption = (name: keyof NonNullable<WmsParams['options']>, value: string) => setWms({ options: { ...wmsOptions, [name]: value } });
  const field = (label: string, help: string, value: string | undefined, onChange: (value: string) => void, required: boolean, testId: string) => (
    <FormRow
      full
      label={
        <>
          {label}
          {required && <span aria-hidden="true">*</span>}
        </>
      }
      help={help}
    >
      <TextField compact value={value ?? ''} onChange={onChange} testId={testId} />
    </FormRow>
  );
  return (
    <>
      <p className="atlXs">
        WMS is an{' '}
        <a href="http://www.opengeospatial.org/standards/wms" target="_blank" rel="noreferrer">
          OGC standard
        </a>{' '}
        for map image services.
      </p>
      {field('WMS url', 'The URL of the WMS web service.', wms.url, (url) => setWms({ url }), true, 'wmsUrl')}
      {field('WMS layers', 'A comma separated list of layers to use.', wmsOptions.layers, (value) => setOption('layers', value), true, 'wmsLayers')}
      {field('WMS version', 'The version of WMS the server supports.', wmsOptions.version, (value) => setOption('version', value), true, 'wmsVersion')}
      {field(
        'WMS format',
        'Usually image/png or image/jpeg. Use png if the server will return transparent layers.',
        wmsOptions.format,
        (value) => setOption('format', value),
        true,
        'wmsFormat'
      )}
      {field('WMS attribution', 'Attribution string for the lower right corner.', wmsOptions.attribution, (value) => setOption('attribution', value), false, 'wmsAttribution')}
      {field(
        'WMS styles',
        'A comma separated list of WMS server supported styles to use. Blank in most cases.',
        wmsOptions.styles,
        (value) => setOption('styles', value),
        true,
        'wmsStyles'
      )}
      <p className="atlXs" aria-hidden="true">
        *{FOOTNOTE}
      </p>
    </>
  );
}
