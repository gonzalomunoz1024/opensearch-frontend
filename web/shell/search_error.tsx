/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A failed search, told as OpenSearch Dashboards tells it (data.search.showError): "Search Error"
 * with the error's message and its whole text behind "See the full error", or, for a Painless
 * script that failed, the script, its stack and a button to the index patterns.
 */

import { Button, CodeBlock } from '../components/basic';
import { services } from '../services';
import { HttpFetchError } from '../services/http';
import { searchFailure } from '../services/search';
import { navigate } from '../router';

const TITLE = 'Search Error';

/** The original's id for a message: the same message is not shown twice at once */
export function simpleHash(text: string): string {
  return text
    .split('')
    .reduce((hash, char) => (hash << 5) + hash + char.charCodeAt(0), 5381)
    .toString();
}

interface FailedShardReason {
  lang?: string;
  script?: string;
  script_stack?: string[];
}

/** The reason of the first failed shard, when the search was refused by OpenSearch */
function rootCause(failure: Error): FailedShardReason | undefined {
  if (!(failure instanceof HttpFetchError)) return undefined;
  const answer = (failure.body as { error?: Record<string, unknown> } | undefined)?.error;
  if (!answer || typeof answer !== 'object') return undefined;
  const shards = (answer.failed_shards ?? (answer.caused_by as Record<string, unknown> | undefined)?.failed_shards) as
    | Array<{ reason?: FailedShardReason }>
    | undefined;
  return shards?.[0]?.reason;
}

/** Tells of a failed search, as the original's search service does; an aborted one is not told */
export function showSearchError(failure: unknown) {
  if (!(failure instanceof Error) || failure.name === 'AbortError') return;
  const cause = rootCause(failure);
  if (cause?.lang === 'painless') {
    services.toasts.danger(
      TITLE,
      <div className="shlPainlessError">
        <div>{`Error executing Painless script: '${cause.script}'.`}</div>
        {cause.script_stack && <CodeBlock>{cause.script_stack.join('\n')}</CodeBlock>}
        <div className="atlToast__actions">
          <Button variant="dangerOutline" onClick={() => navigate('/app/management/opensearch-dashboards/indexPatterns')}>
            Edit script
          </Button>
        </div>
      </div>
    );
    return;
  }
  const shown = searchFailure(failure);
  services.toasts.addError(shown, { title: TITLE, id: simpleHash(shown.message) });
}
