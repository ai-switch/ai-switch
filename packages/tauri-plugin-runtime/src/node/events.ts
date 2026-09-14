/// <reference path="./events-vendor.d.ts" />
import BrowserEventEmitter from "events/events.js";

export type EventName = string | symbol;
export type EventListener = (this: EventEmitter, ...args: any[]) => void;
type Registration = { listener: EventListener; invoke: (...args: unknown[]) => void };

function checkEvent(event: EventName): void {
  if (typeof event !== "string" && typeof event !== "symbol") throw new TypeError("Event names must be strings or symbols.");
}
function checkListener(listener: EventListener): void {
  if (typeof listener !== "function") throw new TypeError("Event listeners must be functions.");
}

/** Intentionally exposes only the portable five-method listener/emit subset. */
export class EventEmitter {
  #emitter = new BrowserEventEmitter();
  #registrations = new Map<EventName, Registration[]>();

  #remove(event: EventName, registration: Registration) {
    const entries = this.#registrations.get(event);
    if (!entries) return;
    const index = entries.indexOf(registration);
    if (index !== -1) entries.splice(index, 1);
    if (!entries.length) this.#registrations.delete(event);
  }
  #add(event: EventName, listener: EventListener, once: boolean): this {
    checkEvent(event); checkListener(listener);
    const registration: Registration = {
      listener,
      invoke: (...args) => {
        if (once) this.#remove(event, registration);
        listener.apply(this, args);
      },
    };
    const entries = this.#registrations.get(event) ?? [];
    entries.push(registration); this.#registrations.set(event, entries);
    try {
      if (once) this.#emitter.once(event, registration.invoke);
      else this.#emitter.on(event, registration.invoke);
    } catch (error) {
      this.#remove(event, registration);
      throw error;
    }
    return this;
  }
  on(event: EventName, listener: EventListener): this { return this.#add(event, listener, false); }
  once(event: EventName, listener: EventListener): this { return this.#add(event, listener, true); }
  off(event: EventName, listener: EventListener): this {
    checkEvent(event); checkListener(listener);
    const entries = this.#registrations.get(event);
    let registration: Registration | undefined;
    if (entries) for (let index = entries.length - 1; index >= 0; index--) {
      if (entries[index].listener === listener) { registration = entries[index]; break; }
    }
    if (registration) {
      this.#remove(event, registration);
      this.#emitter.off(event, registration.invoke);
    }
    return this;
  }
  emit(event: EventName, ...args: unknown[]): boolean {
    checkEvent(event);
    return this.#emitter.emit(event, ...args);
  }
  removeAllListeners(event?: EventName): this {
    if (event === undefined) {
      this.#registrations.clear(); this.#emitter.removeAllListeners();
    } else {
      checkEvent(event); this.#registrations.delete(event); this.#emitter.removeAllListeners(event);
    }
    return this;
  }
}

export default EventEmitter;
