/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A value as the original's HTML formats write it where a visualization shows one (a cell of the
 * data table, the value of a metric): in a span; a link, a picture, a player or a coloured span
 * inside it for the formats that make one, and for a list each of its values so.
 */

import { Fragment } from 'react';
import type { Formatted } from '../lib/field_formats';

/** A formatted value; `bare` writes its text alone, with no span around it */
export interface FormattedContent extends Formatted {
  bare?: boolean;
}

/** What a format draws for one value: a list value by value, a player, a picture, a link, a colour */
function Drawn({ content }: { content: Formatted }) {
  if (content.parts) {
    return (
      <>
        {content.parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? content.separator : null}
            <Drawn content={part} />
          </Fragment>
        ))}
      </>
    );
  }
  // A player that loads nothing until it is played, as the URL format's Audio type draws one
  if (content.audio) return <audio controls preload="none" src={content.audio.src} />;
  if (content.image) {
    const { src, alt, width, height } = content.image;
    return (
      <img
        src={src}
        alt={alt ?? content.text}
        style={{ width: 'auto', height: 'auto', maxWidth: width ? `${width}px` : 'none', maxHeight: height ? `${height}px` : 'none' }}
      />
    );
  }
  if (content.href) {
    return (
      <a href={content.href} target={content.newTab ? '_blank' : undefined} rel="noopener noreferrer">
        {content.text}
      </a>
    );
  }
  if (content.color || content.background) {
    return <span style={{ color: content.color, backgroundColor: content.background }}>{content.text}</span>;
  }
  return <>{content.text}</>;
}

export function FormattedValue({ content }: { content: FormattedContent }) {
  if (content.bare) return <>{content.text}</>;
  return (
    <span>
      <Drawn content={content} />
    </span>
  );
}
