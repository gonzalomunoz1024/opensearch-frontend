/* SPDX-License-Identifier: Apache-2.0 */

/*
 * An icon of the frame: one of the kit's drawings, sized by its class, and named as the
 * original names it, with a title inside the drawing, which a browser shows on hover.
 */

import { useId } from 'react';
import { iconDrawing, type IconName } from '../components/icon';

export function HeaderIcon({
  name,
  className,
  title,
}: {
  name: IconName;
  className: string;
  /** What the drawing is called; left out for one that only decorates */
  title?: string;
}) {
  const drawing = iconDrawing(name);
  const titleId = useId();
  return (
    <svg
      className={className}
      viewBox={drawing?.viewBox ?? '0 0 16 16'}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      focusable="false"
      aria-hidden={title === undefined ? true : undefined}
      aria-labelledby={title === undefined ? undefined : titleId}
    >
      {title !== undefined && <title id={titleId}>{title}</title>}
      {drawing?.paths.map((shape, index) =>
        typeof shape === 'string' ? (
          <path key={index} d={shape} />
        ) : (
          <path key={index} d={shape.d} fillRule={shape.evenOdd ? 'evenodd' : undefined} />
        )
      )}
    </svg>
  );
}
