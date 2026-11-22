/* SPDX-License-Identifier: Apache-2.0 */

/* Markdown: text someone wrote, on a dashboard beside the charts. */

import { Markdown } from '../lib/markdown';
import type { Vis } from '../lib/vis';

interface MarkdownParams {
  markdown?: string;
  fontSize?: number;
  openLinksInNewTab?: boolean;
}

export function MarkdownVis({ vis }: { vis: Vis }) {
  const params = vis.params as MarkdownParams;
  return (
    <div className="visMarkdown" style={{ fontSize: `${params.fontSize ?? 12}pt` }} data-test-subj="markdownBody">
      <Markdown text={params.markdown ?? ''} openLinksInNewTab={params.openLinksInNewTab} />
    </div>
  );
}
