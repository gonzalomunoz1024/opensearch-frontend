/* SPDX-License-Identifier: Apache-2.0 */

/* What a visualization with nothing to show says, as the original's VisualizationNoResults. */

import { Icon } from '../components/icon';
import '../styles/vis_basic.css';

export function VisNoResults() {
  return (
    <div className="visNoResults" data-test-subj="visNoResult">
      <div className="visNoResults__item visNoResults__item--top" />
      <div className="visNoResults__item visNoResults__text">
        <Icon name="visualizeApp" />
        <div className="visNoResults__spacer" />
        <p>No results found</p>
      </div>
      <div className="visNoResults__item visNoResults__item--bottom" />
    </div>
  );
}
