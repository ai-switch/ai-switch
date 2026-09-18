import { unsupportedSync } from "./errors.js";
import type { FsPromises } from "./types.js";
import type { CallbackFs } from "./callback-types.js";

export function createCallbackFs(promises: FsPromises): CallbackFs {
  const methods = ["readFile", "writeFile", "appendFile", "readdir", "stat", "mkdir", "rename", "copyFile", "rm"] as const;
  const wrappers: Record<string, unknown> = { promises };
  for (const method of methods) {
    wrappers[method] = (...args: unknown[]) => {
      const callback = args.pop();
      if (typeof callback !== "function") throw new TypeError("A filesystem callback function is required.");
      const deliver = (...values: unknown[]) => {
        try { callback(...values); }
        catch (error) { setTimeout(() => { throw error; }, 0); }
      };
      // Start the promise immediately so mutable write buffers are snapshotted now;
      // .then still delivers the callback asynchronously and exactly once.
      let result: Promise<unknown>;
      try { result = Reflect.apply(promises[method], promises, args); }
      catch (error) { result = Promise.reject(error); }
      void result.then((value) => {
        if (method === "writeFile" || method === "appendFile" || method === "rename" || method === "copyFile" || method === "rm") deliver(null);
        else deliver(null, value);
      }, (error: unknown) => {
        if (method === "readFile" || method === "readdir" || method === "stat" || method === "mkdir") deliver(error, undefined);
        else deliver(error);
      });
    };
    wrappers[`${method}Sync`] = unsupportedSync;
  }
  return Object.freeze(wrappers) as unknown as CallbackFs;
}
