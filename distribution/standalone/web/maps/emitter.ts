/* SPDX-License-Identifier: Apache-2.0 */

/* The few methods of Node's EventEmitter the map code of OpenSearch Dashboards uses. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

export class Emitter {
  private readonly handlers = new Map<string, Listener[]>();

  on(name: string, listener: Listener): this {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), listener]);
    return this;
  }

  once(name: string, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.removeListener(name, wrapped);
      listener(...args);
    };
    return this.on(name, wrapped);
  }

  removeListener(name: string, listener: Listener): this {
    const list = this.handlers.get(name);
    if (list) {
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    }
    return this;
  }

  off(name: string, listener: Listener): this {
    return this.removeListener(name, listener);
  }

  removeAllListeners(name?: string): this {
    if (name === undefined) this.handlers.clear();
    else this.handlers.delete(name);
    return this;
  }

  emit(name: string, ...args: unknown[]): boolean {
    const list = this.handlers.get(name);
    if (!list?.length) return false;
    for (const listener of [...list]) listener.call(this, ...args);
    return true;
  }
}
