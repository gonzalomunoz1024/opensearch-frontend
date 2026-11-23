/* SPDX-License-Identifier: Apache-2.0 */

/* Markdown: text someone wrote, on a dashboard beside the charts. */

import { Markdown } from '../lib/markdown';
import type { Vis } from '../lib/vis';
import '../styles/vis_basic.css';

interface MarkdownParams {
  markdown?: string;
  fontSize?: number;
  openLinksInNewTab?: boolean;
}

/** As the original draws it: a panel 8px in, in the base size the visualization sets in points */
export function MarkdownVis({ vis }: { vis: Vis }) {
  const params = vis.params as MarkdownParams;
  return (
    <div className="visMarkdownVis" style={{ fontSize: `${params.fontSize ?? 12}pt` }} data-test-subj="markdownBody">
      <Markdown className="visMarkdownBody" text={params.markdown ?? ''} openLinksInNewTab={params.openLinksInNewTab} />
    </div>
  );
}
