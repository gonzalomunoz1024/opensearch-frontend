/* SPDX-License-Identifier: Apache-2.0 */

import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';

/**
 * A panel's heading, marked up as the original's panel header (panel_header.tsx): what a screen
 * reader calls the panel, then the title in a span of its own (or "[No Title]" in its place while
 * the dashboard is edited) inside the span that cuts it short, and a description told by an icon
 * after it. A panel without a bar has no heading, only what a screen reader calls it.
 */
export function PanelTitle({
  labelId,
  title,
  showTitle,
  showBar,
  description,
}: {
  labelId: string;
  title: string;
  showTitle: boolean;
  showBar: boolean;
  description: string;
}) {
  const label = (
    <span id={labelId} className="atlScreenReaderOnly">
      {showBar && title ? `Dashboard panel: ${title}` : 'Dashboard panel'}
    </span>
  );
  if (!showBar) return label;
  const text = showTitle && (
    <span className={title ? 'dshPanel__titleText' : 'dshPanel__noTitle'}>{title || '[No Title]'}</span>
  );
  return (
    <h2 className="dshPanel__title atlTruncate" title={showTitle ? title : undefined} data-test-subj="dashboardPanelTitle">
      {label}
      {description ? (
        <Tooltip content={description}>
          <span className="dshPanel__titleInner">
            {text} <Icon name="info" className="dshPanel__info" />
          </span>
        </Tooltip>
      ) : (
        <span className="dshPanel__titleInner">{text}</span>
      )}
    </h2>
  );
}
