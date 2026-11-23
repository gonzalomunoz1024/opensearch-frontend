/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The size of a text as the browser draws it in SVG, which is what vislib measures its labels and
 * titles by (getBBox): their widths decide how wide an axis is and which labels are left out.
 * Measured on an SVG text outside the page's view, in the page's own face; outside a browser (the
 * tests) a close guess.
 */

export interface TextFont {
  /** As CSS writes it: '8pt', '12px' */
  size: string;
  weight?: number;
}

export interface TextSize {
  /** The width of its box */
  width: number;
  /** Where its box starts, from where the text starts */
  left: number;
  /** How far the text runs, by which it is anchored: a little less or more than its box */
  advance: number;
  /** From the baseline to the top of the face's box */
  ascent: number;
  /** From the baseline to the bottom of the face's box */
  descent: number;
}

/** The axis labels of vislib: 8pt, as it writes them */
export const LABEL_FONT: TextFont = { size: '8pt' };
/** Its axis titles: the theme's extra small size, bold */
export const TITLE_FONT: TextFont = { size: '12px', weight: 600 };

let holder: SVGTextElement | undefined;
const sizes = new Map<string, TextSize>();

export function pixels(size: string): number {
  const value = parseFloat(size);
  return size.endsWith('pt') ? (value * 4) / 3 : value;
}

function guess(text: string, font: TextFont): TextSize {
  const size = pixels(font.size);
  const width = text.length * size * 0.56;
  return { width, left: 0, advance: width, ascent: Math.round(size * 0.97), descent: Math.round(size * 0.24) };
}

function measurer(): SVGTextElement | undefined {
  if (holder?.isConnected) return holder;
  if (typeof document === 'undefined' || !document.body) return undefined;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.style.left = '-10000px';
  svg.style.top = '-10000px';
  svg.style.visibility = 'hidden';
  holder = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  svg.appendChild(holder);
  document.body.appendChild(svg);
  return holder;
}

/** The box of a line of text in a font, as SVG lays it out */
export function measureText(text: string, font: TextFont): TextSize {
  const key = `${font.size}|${font.weight ?? 400}|${text}`;
  const known = sizes.get(key);
  if (known) return known;
  const element = measurer();
  let size: TextSize;
  if (!element) size = guess(text, font);
  else {
    element.setAttribute('style', `font-size: ${font.size}; font-weight: ${font.weight ?? 400};`);
    element.textContent = text;
    const box = element.getBBox();
    size =
      text === ''
        ? { width: 0, left: 0, advance: 0, ascent: 0, descent: 0 }
        : { width: box.width, left: box.x, advance: element.getComputedTextLength(), ascent: -box.y, descent: box.height + box.y };
  }
  if (sizes.size > 20000) sizes.clear();
  sizes.set(key, size);
  return size;
}
