/* SPDX-License-Identifier: Apache-2.0 */

/* The "Options" tab of a Timeline visualization: the interval above the expression. */

import { useCallback } from 'react';
import { ExpressionInput } from './expression_input';
import { IntervalInput } from './interval_input';

export interface TimelineOptionsProps {
  params: Record<string, unknown>;
  setParams: (params: Record<string, unknown>) => void;
  /** Told whether the interval can be used, as upstream's editor is to disable "Update" */
  setValidity?: (valid: boolean) => void;
}

export function TimelineOptions({ params, setParams, setValidity }: TimelineOptionsProps) {
  const interval = typeof params.interval === 'string' ? params.interval : 'auto';
  const expression = typeof params.expression === 'string' ? params.expression : '.es(*)';
  const setInterval = useCallback((value: string) => setParams({ ...params, interval: value }), [params, setParams]);
  const setExpression = useCallback(
    (value: string) => setParams({ ...params, expression: value }),
    [params, setParams]
  );

  return (
    <section className="vzePanel vzePanel--fill tlvOptions visEditorSidebar__timelineOptions">
      <IntervalInput value={interval} setValue={setInterval} setValidity={setValidity} />
      <ExpressionInput value={expression} setValue={setExpression} />
    </section>
  );
}
