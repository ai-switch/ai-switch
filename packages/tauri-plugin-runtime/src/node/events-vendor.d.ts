/** Upstream @types/events omits symbol event keys; this local shape models the used browser API. */
declare module "events/events.js" {
  export default class BrowserEventEmitter {
    on(event: string | symbol, listener: (...args: unknown[]) => void): this;
    once(event: string | symbol, listener: (...args: unknown[]) => void): this;
    off(event: string | symbol, listener: (...args: unknown[]) => void): this;
    emit(event: string | symbol, ...args: unknown[]): boolean;
    removeAllListeners(event?: string | symbol): this;
  }
}
