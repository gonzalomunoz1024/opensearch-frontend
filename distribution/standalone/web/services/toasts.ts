/* SPDX-License-Identifier: Apache-2.0 */

/* The short messages in the corner: something was saved, something failed. */

import { errorMessage } from './http';

export interface Toast {
  id: number;
  kind: 'healthy' | 'warning' | 'critical' | 'info';
  title: string;
  text?: string;
}

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

  add(kind: Toast['kind'], title: string, text?: string) {
    const id = this.next;
    this.next += 1;
    // The same message again replaces the one still showing
    const others = this.items.filter((item) => !(item.title === title && item.text === text));
    this.change([...others, { id, kind, title, text }].slice(-5));
    window.setTimeout(() => this.dismiss(id), this.lifetimes[kind]);
    return id;
  }
  dismiss(id: number) {
    if (this.items.some((item) => item.id === id)) {
      this.change(this.items.filter((item) => item.id !== id));
    }
  }

  success(title: string, text?: string) {
    return this.add('healthy', title, text);
  }
  info(title: string, text?: string) {
    return this.add('info', title, text);
  }
  warning(title: string, text?: string) {
    return this.add('warning', title, text);
  }
  danger(title: string, text?: string) {
    return this.add('critical', title, text);
  }
  error(error: unknown, title = 'Something went wrong') {
    if ((error as Error)?.name === 'AbortError') return 0;
    return this.add('critical', title, errorMessage(error));
  }
}
