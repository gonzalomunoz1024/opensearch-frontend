/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A value of a field, drawn the way the field's format says: text, a link, a picture, a sound, a
 * colour; a list value by value.
 */

import { Fragment } from 'react';
import type { Formatted } from '../lib/field_formats';
import { fieldFormatter } from '../lib/field_formats';
import { highlightsOf, splitHighlights, type RawHit } from '../lib/docs';
import type { IndexPattern } from '../lib/types';
import { services } from '../services';

export function FormattedText({ formatted, highlights }: { formatted: Formatted; highlights?: string[] }) {
  if (formatted.parts) {
    return (
      <>
        {formatted.parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? formatted.separator : null}
            <FormattedText formatted={part} highlights={highlights} />
          </Fragment>
        ))}
      </>
    );
  }
  // A player that loads nothing until it is played, as the original draws one
  if (formatted.audio) return <audio controls preload="none" src={formatted.audio.src} />;
  if (formatted.image) {
    const { src, alt, width, height } = formatted.image;
    return (
      <img
        src={src}
        alt={alt ?? formatted.text}
        style={{ width: 'auto', height: 'auto', maxWidth: width ?? 'none', maxHeight: height ?? 'none' }}
      />
    );
  }
  const text =
    highlights && highlights.length > 0
      ? splitHighlights(formatted.text, highlights).map((part, index) =>
          part.marked ? <mark key={index}>{part.text}</mark> : part.text
        )
      : formatted.text;
  if (formatted.href) {
    return (
      <a href={formatted.href} target={formatted.newTab === false ? '_self' : '_blank'} rel="noopener noreferrer">
        {text}
      </a>
    );
  }
  if (formatted.color || formatted.background) {
    return (
      <span style={{ color: formatted.color, backgroundColor: formatted.background, padding: formatted.background ? '0 4px' : undefined, borderRadius: 4 }}>
        {text}
      </span>
    );
  }
  return <>{text}</>;
}

/** The value of one field of one document */
export function FieldValue({
  indexPattern,
  fieldName,
  value,
  hit,
}: {
  indexPattern: IndexPattern | undefined;
  fieldName: string;
  value: unknown;
  hit?: RawHit;
}) {
  const formatted = fieldFormatter(indexPattern, fieldName, services.formatSettings())(value);
  const highlights =
    hit && services.uiSettings.get('doc_table:highlight', true) ? highlightsOf(hit, fieldName) : undefined;
  return <FormattedText formatted={formatted} highlights={highlights} />;
}
