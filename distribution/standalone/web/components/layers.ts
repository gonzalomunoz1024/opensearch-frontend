/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What lies over the page, one over the other: popovers, dialogs and flyouts. As with the original's
 * focus traps, only the one on top hears Escape, and a popover that holds the focus keeps Tab in it.
 */

export interface Layer {
  /** What Escape does to it: it closes */
  escape: () => void;
}

/** The part of a key event the stack reads */
export interface EscapeEvent {
  key: string;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

export interface LayerStack {
  /** Puts a layer on top; what it returns takes that layer away, wherever it is by then */
  push: (layer: Layer) => () => void;
  top: () => Layer | undefined;
  size: () => number;
  /** Escape closes the layer on top, unless what had the key has used it */
  onKeyDown: (event: EscapeEvent) => void;
}

export function createLayerStack(): LayerStack {
  const layers: Layer[] = [];
  return {
    push(layer) {
      layers.push(layer);
      return () => {
        const index = layers.lastIndexOf(layer);
        if (index >= 0) layers.splice(index, 1);
      };
    },
    top: () => layers[layers.length - 1],
    size: () => layers.length,
    onKeyDown(event) {
      if ((event.key !== 'Escape' && event.key !== 'Esc') || event.defaultPrevented) return;
      const top = layers[layers.length - 1];
      if (!top) return;
      event.preventDefault();
      top.escape();
    },
  };
}

/**
 * Where Tab sends the focus when it must stay among `items`, what takes the focus in a popover in
 * order (the panel first, then what it holds): from the last to the first, from the first back to
 * the last, and in from anything else. Undefined when the browser's own step stays among them.
 */
export function wrapTab<T>(items: readonly T[], current: T | null | undefined, backwards: boolean): T | undefined {
  if (items.length === 0) return undefined;
  const index = current === null || current === undefined ? -1 : items.indexOf(current);
  if (index < 0) return backwards ? items[items.length - 1] : items[0];
  if (backwards && index === 0) return items[items.length - 1];
  if (!backwards && index === items.length - 1) return items[0];
  return undefined;
}

// The inputs nothing is typed in
const NOT_TYPED = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** The part of an element `isTextField` reads */
export interface FieldLike {
  tagName: string;
  getAttribute: (name: string) => string | null;
  isContentEditable?: boolean;
}

/**
 * A field text is typed in. A popover opened from one leaves the focus in it, as the original's
 * input popovers and its colour picker opened by a click in its field do.
 */
export function isTextField(element: FieldLike | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !NOT_TYPED.has((element.getAttribute('type') ?? 'text').toLowerCase());
  return element.isContentEditable === true;
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** What Tab goes to inside an element, in order: enabled, drawn, and not taken out of the order */
export function tabbablesIn(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (element.tabIndex < 0) return false;
    if ((element as HTMLButtonElement).disabled) return false;
    if (element instanceof HTMLInputElement && element.type === 'hidden') return false;
    if (element.closest('[inert]')) return false;
    if (element.getClientRects().length === 0) return false;
    return getComputedStyle(element).visibility !== 'hidden';
  });
}
