/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The icons a TSVB annotation is marked with, by the names TSVB saves (fa-…), in the order the
 * product lists them. They are drawn as the kit draws its icons: lines on a 16 pixel grid in the
 * colour around them, the star and the pin filled as the product's are.
 */

export interface IconShape {
  d: string;
  filled?: boolean;
}

export const ANNOTATION_ICONS = [
  { value: 'fa-asterisk', label: 'Asterisk' },
  { value: 'fa-bell', label: 'Bell' },
  { value: 'fa-bolt', label: 'Bolt' },
  { value: 'fa-comment', label: 'Comment' },
  { value: 'fa-map-marker', label: 'Map Marker' },
  { value: 'fa-map-pin', label: 'Map Pin' },
  { value: 'fa-star', label: 'Star' },
  { value: 'fa-tag', label: 'Tag' },
  { value: 'fa-bomb', label: 'Bomb' },
  { value: 'fa-bug', label: 'Bug' },
  { value: 'fa-exclamation-circle', label: 'Exclamation Circle' },
  { value: 'fa-exclamation-triangle', label: 'Exclamation Triangle' },
  { value: 'fa-fire', label: 'Fire' },
  { value: 'fa-flag', label: 'Flag' },
  { value: 'fa-heart', label: 'Heart' },
];

// Both exclamations are the same warning sign, as they are in the product
const ALERT: IconShape = { d: 'M8 2.5l6 10.5H2zM8 6.5v3M8 11.3v.1' };

const SHAPES: Record<string, IconShape> = {
  'fa-asterisk': { d: 'M8 2.5v11M3.24 5.25l9.52 5.5M3.24 10.75l9.52-5.5' },
  'fa-bell': { d: 'M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 13.5a1.5 1.5 0 0 0 3 0' },
  'fa-bolt': { d: 'M9 2L3.5 9H8l-1 5 5.5-7H8z', filled: true },
  'fa-comment': { d: 'M2.5 3.5h11v7.5H7.5l-3 2.5V11h-2z' },
  'fa-map-marker': { d: 'M8 14.5s4.5-4.3 4.5-8a4.5 4.5 0 0 0-9 0c0 3.7 4.5 8 4.5 8zM8 8.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z' },
  'fa-map-pin': { d: 'M9.5 2l4.5 4.5-2 .5-2.5 2.5.3 3-1.3 1.3-6-6L3.8 6.5l3 .3L9.3 4.3zM5.5 10.5l-3 3', filled: true },
  'fa-star': { d: 'M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z', filled: true },
  'fa-tag': { d: 'M2.5 2.5h5l6 6-5 5-6-6zM5.5 5.5h.1' },
  'fa-bomb': { d: 'M7 14a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.2 6.3L11.5 5M11.5 5c.4-1.4 1.3-2.1 2.5-2' },
  'fa-bug': { d: 'M5.5 6.5a2.5 2.5 0 0 1 5 0V10a2.5 2.5 0 0 1-5 0zM8 7.5v5M5.5 8.5H3M13 8.5h-2.5M5.5 11.5l-2 1.5M10.5 11.5l2 1.5M6 4.5L4.5 3M10 4.5L11.5 3' },
  'fa-exclamation-circle': ALERT,
  'fa-exclamation-triangle': ALERT,
  'fa-fire': { d: 'M8 14c-2.5 0-4.5-1.8-4.5-4.3 0-2.2 1.5-3.2 2.5-5.2.7 1.2 1.2 1.7 2 2 .3-2 .5-3.5 2-5 .5 2.5 3.5 4.5 3.5 8.2 0 2.5-2.5 4.3-5.5 4.3z' },
  'fa-flag': { d: 'M3.5 14V2.5M3.5 3h9l-2 3 2 3h-9' },
  'fa-heart': { d: 'M8 13.5c-2.5-1.7-6-4.1-6-7.3A3 3 0 0 1 8 5a3 3 0 0 1 6 1.2c0 3.2-3.5 5.6-6 7.3z' },
};

/** The shape of an annotation's icon: an asterisk for one the product does not know */
export const annotationIcon = (name: unknown): IconShape => SHAPES[String(name)] ?? SHAPES['fa-asterisk'];

/** An annotation's icon, the size of the kit's icons */
export function AnnotationIcon({ name }: { name: unknown }) {
  const shape = annotationIcon(name);
  return (
    <svg className="atlIcon" viewBox="0 0 16 16" aria-hidden style={shape.filled ? { fill: 'currentcolor' } : undefined}>
      <path d={shape.d} />
    </svg>
  );
}
