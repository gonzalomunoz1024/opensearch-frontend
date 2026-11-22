/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A label keeps the colour the first chart to draw it gave it (see assignColors), so the order
 * in which the charts of a page are drawn decides their colours. Their data comes back in any
 * order; turns make them take their colours in the order of the page all the same: a chart
 * holds what it received until the charts before it have drawn, or until it has waited long
 * enough for them.
 */

export interface Turn {
  /** Settles when every chart before this one has drawn or given up */
  before: Promise<void>;
  /** Called by the chart when it has handed its data to be drawn, or has none to draw */
  done: () => void;
}

export function makeTurns(ids: string[]): Map<string, Turn> {
  const turns = new Map<string, Turn>();
  let before: Promise<void> = Promise.resolve();
  for (const id of ids) {
    let done: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      done = resolve;
    });
    turns.set(id, { before, done });
    before = Promise.all([before, settled]).then(() => undefined);
  }
  return turns;
}

/** Wait for the charts before, but not for long: a slow chart must not hold the page up */
export function waitTurn(turn: Turn | undefined, limit = 800): Promise<void> {
  if (!turn) return Promise.resolve();
  return Promise.race([turn.before, new Promise<void>((resolve) => setTimeout(resolve, limit))]);
}
