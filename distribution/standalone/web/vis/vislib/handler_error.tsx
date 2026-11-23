/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What vislib's handler shows when its charts cannot be drawn (its error): the message as a
 * heading in place of the charts, in the middle of their room, in a box as wide as the message's
 * longest word at least, which runs past the room on the right when that is narrower. The legend
 * stays beside it. The charts stay in the page out of sight, so that they keep measuring their room.
 */

/** What a pie shows when its room is too small, and a split of pies when one of them is */
export const TOO_SMALL = 'This container is too small to render the visualization';

export function HandlerError({ message }: { message: string }) {
  return (
    <div className="visError chart error" role="alert" data-test-subj="visLibVisualizeError">
      <h4>{message}</h4>
    </div>
  );
}
