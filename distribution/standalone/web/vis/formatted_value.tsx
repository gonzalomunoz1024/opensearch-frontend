/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A value as the original's HTML formats write it where a visualization shows one (a cell of the
 * data table, the value of a metric): in a span; a link, a picture or a coloured span inside it
 * for the formats that make one.
 */

import type { Formatted } from '../lib/field_formats';

/** A formatted value; `bare` writes its text alone, with no span around it */
export interface FormattedContent extends Formatted {
  bare?: boolean;
}

export function FormattedValue({ content }: { content: FormattedContent }) {
  if (content.bare) return <>{content.text}</>;
  if (content.image) {
    const { src, width, height } = content.image;
    return (
      <span>
        <img src={src} alt={content.text} style={{ width: 'auto', height: 'auto', maxWidth: width ? `${width}px` : 'none', maxHeight: height ? `${height}px` : 'none' }} />
      </span>
    );
  }
  if (content.href) {
    return (
      <span>
        <a href={content.href} target={content.newTab ? '_blank' : undefined} rel="noopener noreferrer">
          {content.text}
        </a>
      </span>
    );
  }
  if (content.color || content.background) {
    return (
      <span>
        <span style={{ color: content.color, backgroundColor: content.background }}>{content.text}</span>
      </span>
    );
  }
  return <span>{content.text}</span>;
}
