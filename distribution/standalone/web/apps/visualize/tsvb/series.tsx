/* SPDX-License-Identifier: Apache-2.0 */

/* The series of a TSVB panel: each a row with its metrics, its split and its options. */

import type { TsvbData, TsvbTableData } from '../../../vis/tsvb/data';
import type { PanelProps } from './panel_config';

/** What the chart drew last, as the editor reads it */
export type PanelData = TsvbData | TsvbTableData;

export function SeriesEditor(props: PanelProps & { colorPicker?: boolean }) {
  return <div className="tvbSeriesEditor" data-series={props.model.series.length} />;
}
