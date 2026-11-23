/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A colour chosen from a swatch: a field for its text, a square of saturation and brightness,
 * a strip of hues, a few ready colours and, when it may be see-through, its opacity. The text is
 * read as the product's colour picker reads it: a hex colour, or its red, green, blue and alpha
 * separated by commas; whatever else is typed is no colour.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from './basic';
import { Popover } from './overlay';
import { arrowPopoverPlace } from './popover_place';

/** The colours offered under the square: the palette the charts start with */
export const SWATCHES = ['#54B399', '#6092C0', '#D36086', '#9170B8', '#CA8EAE', '#D6BF57', '#B9A888', '#DA8B45', '#AA6556', '#E7664C'];

export type Rgba = [number, number, number, number];

export interface ColorOutput {
  /** Red, green and blue from 0 to 255, and alpha from 0 to 1 */
  rgba: Rgba;
  /** `#rrggbb`, with the alpha as two more digits when it is below 1; empty for no colour */
  hex: string;
  isValid: boolean;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const byte = (value: number) => Math.round(clamp(value, 0, 255));
const twoDigits = (value: number) => byte(value).toString(16).padStart(2, '0');

/** The colour a text names, or undefined when it names none */
export function parseColor(text: string | null | undefined): Rgba | undefined {
  const input = (text ?? '').trim();
  if (!input) return undefined;
  if (input.indexOf(',') > 0) {
    if (!/^[\s,.0-9]*$/.test(input)) return undefined;
    const parts = input
      .split(',')
      .filter((part) => part !== '')
      .map(Number);
    if (parts.length < 3 || parts.length > 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
    return [byte(parts[0]), byte(parts[1]), byte(parts[2]), parts.length === 4 ? clamp(parts[3], 0, 1) : 1];
  }
  const match = HEX.exec(input);
  if (!match) return undefined;
  let digits = match[1];
  if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join('');
  const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4), digits.length === 8 ? Math.round((channel(6) / 255) * 100) / 100 : 1];
}

/** Whether a typed opacity is one: a number from 0 to 100, as the original's range checks it */
export function isPercent(text: string): boolean {
  if (text === '') return false;
  const value = Number(text);
  return value >= 0 && value <= 100;
}

export function toHex([red, green, blue, alpha]: Rgba): string {
  return `#${twoDigits(red)}${twoDigits(green)}${twoDigits(blue)}${alpha < 1 ? twoDigits(alpha * 255) : ''}`;
}

/** What a text says as a colour: its channels, its hex and whether it is one */
export function colorOutput(text: string): ColorOutput {
  const rgba = parseColor(text);
  return rgba ? { rgba, hex: toHex(rgba), isValid: true } : { rgba: [NaN, NaN, NaN, 1], hex: '', isValid: false };
}

/** A colour as CSS can draw it, from text the picker reads; transparent for none */
export function cssColor(text: string | null | undefined): string {
  const rgba = parseColor(text);
  return rgba ? `rgba(${rgba.join(',')})` : 'transparent';
}

type Hsv = [number, number, number];

function rgbToHsv([red, green, blue]: Rgba): Hsv {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  let hue = 0;
  if (spread !== 0) {
    if (max === r) hue = ((g - b) / spread) % 6;
    else if (max === g) hue = (b - r) / spread + 2;
    else hue = (r - g) / spread + 4;
  }
  return [(hue * 60 + 360) % 360, max === 0 ? 0 : spread / max, max];
}

function hsvToRgb([hue, saturation, value]: Hsv): [number, number, number] {
  const chroma = value * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = value - chroma;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] =
    sector === 0 ? [chroma, second, 0] : sector === 1 ? [second, chroma, 0] : sector === 2 ? [0, chroma, second] : sector === 3 ? [0, second, chroma] : sector === 4 ? [second, 0, chroma] : [chroma, 0, second];
  return [byte((r + base) * 255), byte((g + base) * 255), byte((b + base) * 255)];
}

export interface ColorPickerProps {
  /** The colour as text */
  color: string;
  /** The new text, and the colour it reads as */
  onChange: (text: string, output: ColorOutput) => void;
  showAlpha?: boolean;
  swatches?: string[];
  /** What the swatch that opens it says to a screen reader */
  label?: string;
  testId?: string;
  /**
   * Opens as EuiColorPicker opens from a `button`, as TSVB's picker does: a panel with an arrow
   * hung from the swatch where the component library hangs it, its text field focused
   */
  fromSwatch?: boolean;
}

/**
 * Where the original's picker hangs from its swatch: under it and along its left edge, as
 * EuiPopover hangs a panel with an arrow from a button, over it when there is no room below
 */
const underSwatch = (anchor: DOMRect, panel: { width: number; height: number }) =>
  arrowPopoverPlace(
    anchor,
    panel,
    { width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight },
    'bottom',
    'left'
  );

/** A swatch that opens a colour picker, its field first and in focus */
export function ColorPicker({ color, onChange, showAlpha, swatches = SWATCHES, label, testId, fromSwatch }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placeAt={fromSwatch ? underSwatch : undefined}
      className={fromSwatch ? 'atlColorPicker__popover' : undefined}
      anchorClassName={fromSwatch ? 'atlColorPicker__anchor' : undefined}
      button={
        <button
          type="button"
          className="atlColorSwatch"
          style={{ background: cssColor(color) }}
          aria-label={label}
          onClick={() => setOpen(!open)}
          data-test-subj={testId}
        />
      }
    >
      <ColorPickerPanel
        color={color}
        onChange={onChange}
        showAlpha={showAlpha}
        swatches={swatches}
        focusInput={fromSwatch}
        onPicked={() => setOpen(false)}
      />
    </Popover>
  );
}

export interface ColorPickerPanelProps {
  /** The colour as text */
  color: string;
  /** The new text, and the colour it reads as */
  onChange: (text: string, output: ColorOutput) => void;
  showAlpha?: boolean;
  swatches?: string[];
  /** Without a field for the text, when it is typed in the field the picker opens from */
  showInput?: boolean;
  /** The field for the text in focus once the panel shows, as the original's popover focuses what comes first */
  focusInput?: boolean;
  /** A ready colour was chosen, and the picker may close */
  onPicked?: () => void;
}

/** What a colour picker holds: the text, the square, the hues, the ready colours and the opacity */
export function ColorPickerPanel({ color, onChange, showAlpha, swatches = SWATCHES, showInput = true, focusInput, onPicked }: ColorPickerPanelProps) {
  const current = parseColor(color);
  const input = useRef<HTMLInputElement>(null);
  // A frame later: the panel is placed, and shown, only once it is laid out
  useEffect(() => {
    if (!focusInput) return undefined;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusInput]);
  // The hue is kept apart: a grey has none, and the strip should not jump back to red
  const [hsv, setHsv] = useState<Hsv>(() => (current ? rgbToHsv(current) : [0, 0, 0]));
  const alpha = current ? current[3] : 1;
  // Text with commas is answered with commas, any other with a hex colour
  const asChannels = color.indexOf(',') > 0;

  const emit = (text: string) => onChange(text, colorOutput(text));
  const pickHsv = (next: Hsv) => {
    setHsv(next);
    const [red, green, blue] = hsvToRgb(next);
    const rgba: Rgba = [red, green, blue, alpha];
    emit(asChannels ? (alpha < 1 ? rgba : rgba.slice(0, 3)).join(', ') : toHex(rgba));
  };
  const typed = (text: string) => {
    emit(text);
    const rgba = parseColor(text);
    if (rgba) setHsv(rgbToHsv(rgba));
  };
  // The opacity as the original keeps it: as typed, and a colour only once it is a percent from 0
  // to 100; with no colour, it is no colour still
  const [alphaText, setAlphaText] = useState(() => (alpha * 100).toFixed());
  useEffect(() => setAlphaText((alpha * 100).toFixed()), [alpha]);
  const pickAlpha = (typedAlpha: string) => {
    setAlphaText(typedAlpha);
    if (!isPercent(typedAlpha)) return;
    if (!current) {
      onChange('', { rgba: [NaN, NaN, NaN, 1], hex: '', isValid: false });
      return;
    }
    const rgba: Rgba = [current[0], current[1], current[2], Number.parseInt(typedAlpha, 10) / 100];
    const text = asChannels ? (rgba[3] < 1 ? rgba : rgba.slice(0, 3)).join(', ') : toHex(rgba);
    onChange(text, { rgba, hex: toHex(rgba), isValid: true });
  };

  const square = useRef<HTMLDivElement>(null);
  const fromSquare = (event: PointerEvent<HTMLDivElement>) => {
    const box = square.current?.getBoundingClientRect();
    if (!box) return;
    const saturation = clamp((event.clientX - box.left) / box.width, 0, 1);
    // Brightness is read over the original's layer of shades, which starts a pixel above the square
    const value = 1 - clamp((event.clientY - box.top + 1) / (box.height + 1), 0, 1);
    pickHsv([hsv[0], saturation, value]);
  };
  const squareKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    // A hundredth of the square for each press, as the original's
    const step = 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    pickHsv([hsv[0], clamp(hsv[1] + move[0], 0, 1), clamp(hsv[2] + move[1], 0, 1)]);
  };
  const shownHsv: Hsv = current && hsvToRgb(hsv).join() !== current.slice(0, 3).join() ? rgbToHsv(current) : hsv;

  return (
    <div className="atlColorPicker" data-test-subj="colorPickerPopover">
      {showInput && (
        <div className="atlColorPicker__text">
          <input
            ref={input}
            className={cx('atlField', color !== '' && !current && 'atlField--invalid')}
            value={color.toUpperCase()}
            placeholder={color ? undefined : 'Transparent'}
            autoComplete="off"
            aria-label="Color value"
            onChange={(event) => typed(event.target.value)}
            data-test-subj="colorPickerInput"
          />
          {color !== '' && !current && <div className="atlFormRow__error">Invalid color value</div>}
        </div>
      )}
      <div
        ref={square}
        className="atlColorPicker__square"
        style={{ backgroundColor: `hsl(${shownHsv[0]}, 100%, 50%)` }}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(shownHsv[1] * 100)}%, brightness ${Math.round(shownHsv[2] * 100)}%`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          fromSquare(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromSquare(event);
        }}
        onKeyDown={squareKeys}
      >
        <span
          className="atlColorPicker__thumb"
          style={{ left: `${shownHsv[1] * 100}%`, top: `calc(${(1 - shownHsv[2]) * 100}% + ${1 - shownHsv[2]}px)` }}
        />
      </div>
      <div className="atlColorPicker__hue">
        <input
          type="range"
          min={0}
          max={359}
          value={Math.round(shownHsv[0])}
          aria-label="Hue"
          onChange={(event) => pickHsv([Number(event.target.value), shownHsv[1], shownHsv[2]])}
        />
      </div>
      <div className="atlColorPicker__swatches">
        {swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="atlColorSwatch"
            style={{ background: swatch }}
            aria-label={`Select ${swatch} as the color`}
            onClick={() => {
              typed(swatch);
              onPicked?.();
            }}
          />
        ))}
      </div>
      {showAlpha && (
        <div className="atlColorPicker__alpha">
          <input
            type="range"
            className="atlColorPicker__alphaRange"
            min={0}
            max={100}
            value={alphaText}
            aria-label="Alpha channel (opacity) value"
            onChange={(event) => pickAlpha(event.target.value)}
          />
          <span className="atlColorPicker__spacer" />
          <span className="atlColorPicker__percent">
            <input
              type="number"
              min={0}
              max={100}
              value={alphaText}
              aria-label="Alpha channel (opacity) value"
              onChange={(event) => pickAlpha(event.target.value)}
            />
            <span>%</span>
          </span>
        </div>
      )}
    </div>
  );
}
