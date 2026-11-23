/* SPDX-License-Identifier: Apache-2.0 */

/* The short messages in the corner: something was saved, something failed. */

import type { ReactNode } from 'react';
import { errorMessage } from './http';

export interface Toast {
  id: number;
  /** 'plain': no colour and no icon, as the original's toasts.add of a text */
  kind: 'healthy' | 'warning' | 'critical' | 'info' | 'plain';
  title: ReactNode;
  text?: ReactNode;
  /** While a message with a key shows, the same key adds no other */
  key?: string;
  /** An error whose whole text the message offers to show: "See the full error" */
  error?: Error;
  /** The message's `data-test-subj`, as the original's toasts take one */
  testId?: string;
}

export interface ToastOptions {
  /** Kept longer than its kind keeps a message: the news of work that takes hours */
  lifetime?: number;
  /** The message's `data-test-subj`, as the original's (`saveVisualizationSuccess`) */
  testId?: string;
}

export interface ErrorToastOptions {
  title: string;
  /** What the message says, when not the error's own message */
  toastMessage?: string;
  /** While a message with this id shows, the same error adds no other (the original's toast id) */
  id?: string;
  /** The message's `data-test-subj` */
  testId?: string;
}

/** A lifetime alone, or the options of a message */
const optionsOf = (options?: number | ToastOptions): ToastOptions =>
  typeof options === 'number' ? { lifetime: options } : (options ?? {});

export class Toasts {
  private items: Toast[] = [];
  private next = 1;
  private readonly listeners = new Set<() => void>();
  /** How long a message of each kind stays, in milliseconds: the settings notifications:lifetime:* */
  lifetimes = { healthy: 5000, info: 5000, warning: 10000, critical: 300000 };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  get = () => this.items;

  private change(items: Toast[]) {
    this.items = items;
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * A message of a kind. The last argument is how long it stays when longer than its kind keeps
   * one, or its options: that, and its test id
   */
  add(kind: Toast['kind'], title: ReactNode, text?: ReactNode, options?: number | ToastOptions) {
    const { lifetime, testId } = optionsOf(options);
    return this.push({ kind, title, text, ...(testId !== undefined && { testId }) }, lifetime);
  }

  private push(toast: Omit<Toast, 'id'>, lifetime?: number) {
    if (toast.key !== undefined) {
      const showing = this.items.find((item) => item.key === toast.key);
      if (showing) return showing.id;
    }
    const id = this.next;
    this.next += 1;
    // The same message again replaces the one still showing
    const others = this.items.filter((item) => !(item.title === toast.title && item.text === toast.text));
    this.change([...others, { ...toast, id }].slice(-5));
    // A plain message stays as long as one for information, as the original's. A timer cannot
    // wait longer than some 24 days.
    const kept = lifetime ?? this.lifetimes[toast.kind === 'plain' ? 'info' : toast.kind];
    window.setTimeout(() => this.dismiss(id), Math.min(kept, 2 ** 31 - 1));
    return id;
  }
  dismiss(id: number) {
    if (this.items.some((item) => item.id === id)) {
      this.change(this.items.filter((item) => item.id !== id));
    }
  }

  /** A message with no colour and no icon, as the original's toasts.add of a text */
  plain(title: ReactNode, text?: ReactNode, options?: number | ToastOptions) {
    return this.add('plain', title, text, options);
  }
  success(title: ReactNode, text?: ReactNode, options?: number | ToastOptions) {
    return this.add('healthy', title, text, options);
  }
  info(title: ReactNode, text?: ReactNode, options?: number | ToastOptions) {
    return this.add('info', title, text, options);
  }
  warning(title: ReactNode, text?: ReactNode, options?: number | ToastOptions) {
    return this.add('warning', title, text, options);
  }
  /** A failure told in a few words: it stays as long as a warning, as the original's addDanger */
  danger(title: ReactNode, text?: ReactNode, options?: number | ToastOptions) {
    const { lifetime, testId } = optionsOf(options);
    return this.add('critical', title, text, { lifetime: lifetime ?? this.lifetimes.warning, testId });
  }
  error(error: unknown, title = 'Something went wrong') {
    if ((error as Error)?.name === 'AbortError') return 0;
    return this.add('critical', title, errorMessage(error));
  }
  /**
   * An error with a button that shows its whole text, as the original's addError: the message
   * of the error (or `toastMessage`), kept as long as errors are.
   */
  addError(error: Error, options: ErrorToastOptions) {
    return this.push({
      kind: 'critical',
      title: options.title,
      text: options.toastMessage ?? error.message,
      key: options.id,
      error,
      ...(options.testId !== undefined && { testId: options.testId }),
    });
  }
}
