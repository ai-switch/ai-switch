import { AplgError } from "../protocol/errors.js";
import { validateJson } from "../protocol/json-safety.js";
import type { JsonObject, JsonValue } from "../protocol/types.js";
import type { HostTransport } from "../protocol/wire.js";
import { checkedTimeout, randomId } from "./policy.js";

type Operation = "capability.call" | "subscription.open";
export interface SessionRequests {
  run(operation: Operation, args: JsonObject, signal?: AbortSignal, onLate?: (result: JsonValue) => void | Promise<void>): Promise<JsonValue>;
  abortAll(reason: Error): void;
}

export function createSessionRequests(options: { transport: HostTransport; sessionId: string; timeoutMs: number }): SessionRequests {
  const timeoutMs = checkedTimeout(options.timeoutMs);
  const active = new Map<string, (reason: Error) => void>();
  return {
    async run(operation, args, signal, onLate) {
      if (signal?.aborted) throw new AplgError("E_CANCELLED", "The request was cancelled.");
      if (!validateJson(args).ok || ["sessionId", "requestId", "principal", "pluginId", "token"].some((key) => Object.hasOwn(args, key))) {
        throw new AplgError("E_INVALID_ARGUMENT", "Backend identity must come from the bound host session.");
      }
      if (active.size >= 64) throw new AplgError("E_LIMIT_EXCEEDED", "Too many active host requests.");
      const requestId = randomId("request-");
      const payload = { ...args, sessionId: options.sessionId, requestId };
      return new Promise<JsonValue>((resolve, reject) => {
        let settled = false;
        let sent = false;
        const timer = setTimeout(() => stop(new AplgError("E_TIMEOUT", "The host request timed out.")), timeoutMs);
        const abort = () => stop(new AplgError("E_CANCELLED", "The request was cancelled."));
        function cleanup() { active.delete(requestId); clearTimeout(timer); signal?.removeEventListener("abort", abort); }
        function stop(reason: Error) {
          if (settled) return;
          settled = true; cleanup(); reject(reason);
          if (sent) void Promise.resolve().then(() => options.transport.call("request.cancel", { sessionId: options.sessionId, requestId })).catch(() => {});
        }
        active.set(requestId, stop);
        signal?.addEventListener("abort", abort, { once: true });
        void Promise.resolve().then(() => {
          if (settled) return;
          sent = true;
          return options.transport.call<JsonValue>(operation, payload);
        }).then((result) => {
          if (!sent) return;
          if (settled) {
            if (onLate) void Promise.resolve().then(() => onLate(result as JsonValue)).catch(() => {});
            return;
          }
          settled = true; cleanup();
          if (!validateJson(result).ok) reject(new AplgError("E_INVALID_MESSAGE", "The backend returned an invalid JSON value."));
          else resolve(result as JsonValue);
        }, (error: unknown) => { if (!settled) { settled = true; cleanup(); reject(error); } });
      });
    },
    abortAll(reason) { for (const cancel of [...active.values()]) cancel(reason); },
  };
}
