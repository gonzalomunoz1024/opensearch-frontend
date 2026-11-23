/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the canvas shows while nothing can be drawn, as OpenSearch Dashboards shows it: a prompt
 * over its picture of the fields at the left, the parts of a chart at the right, and a field
 * carried from one to the other. The two pictures are the original's own files.
 */

import { href } from '../../router';

export function EmptyCanvas() {
  return (
    <div className="vbdEmpty" data-test-subj="emptyWorkspace">
      <div className="vbdEmpty__prompt">
        <h2 className="vbdEmpty__title">Add a field to start</h2>
        <div className="vbdEmpty__body">
          <p>Drag a field to the configuration panel to generate a visualization.</p>
          <div className="vbdEmpty__picture">
            <img className="vbdEmpty__fields" src={href('/plugins/visBuilder/assets/fields_bg.svg')} alt="" aria-hidden="true" />
            <img className="vbdEmpty__hand" src={href('/plugins/visBuilder/assets/hand_field.svg')} alt="" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
