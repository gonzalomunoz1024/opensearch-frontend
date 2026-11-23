/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Markdown: text someone wrote, on a dashboard beside the charts, drawn as OpenSearch Dashboards
 * 3.9.0 draws it (vis_type_markdown: MarkdownVisComponent in its VisualizationContainer): a box
 * over the visualization's area that scrolls when the text is longer, and in it a plain panel 8px
 * in, in the base size the visualization sets in points, that holds the text.
 */

import { Markdown } from '../lib/markdown';
import type { Vis } from '../lib/vis';
import '../styles/vis_basic.css';

interface MarkdownParams {
  markdown?: string;
  fontSize?: number;
  openLinksInNewTab?: boolean;
}

export function MarkdownVis({ vis }: { vis: Vis }) {
  const params = vis.params as MarkdownParams;
  return (
    <div className="visMarkdownVis">
      <div className="visMarkdownVis__panel" style={{ fontSize: `${params.fontSize ?? 12}pt` }} data-test-subj="markdownBody">
        <Markdown className="visMarkdownBody" text={params.markdown ?? ''} openLinksInNewTab={params.openLinksInNewTab} />
      </div>
    </div>
  );
}
