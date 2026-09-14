import { AplgError } from "../../protocol/errors.js";
import { validatePublicSessionInfo } from "../../bridge/handshake.js";
import type { SessionInfo, Unsubscribe } from "../../protocol/wire.js";
import type { FsClientOptions } from "./types.js";

export function checkSignal(signal: AbortSignal) { if (signal.aborted) throw signal.reason; }
export function boundedOperation<T>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 30_000, onLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController(); let settled = false;
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const stop = (error: unknown) => { if (!settled) { settled = true; finish(); controller.abort(error); reject(error); } };
    const abort = () => stop(signal!.reason);
    const timer = setTimeout(() => stop(new AplgError("E_TIMEOUT", "The filesystem operation timed out.")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    void Promise.resolve().then(() => { checkSignal(controller.signal); return action(controller.signal); }).then((value) => {
      if (settled) { try { onLate?.(value); } catch { /* Late cleanup cannot affect an already settled operation. */ } return; }
      settled = true; finish(); resolve(value);
    }, (error: unknown) => { if (!settled) { settled = true; finish(); reject(error); } });
  });
}
export interface FileContext { info: SessionInfo; signal: AbortSignal }
export function createLifecycle(session: () => Promise<SessionInfo>, options: FsClientOptions) {
  const active = new Set<AbortController>(); let remove: Unsubscribe | undefined; let closed = false;
  return {
    async run<T>(action: (context: FileContext) => Promise<T>): Promise<T> {
      if (closed) throw new AplgError("E_SESSION_CLOSED", "The filesystem session is closed.");
      if (active.size >= 64) throw new AplgError("E_LIMIT_EXCEEDED", "Too many queued filesystem operations.");
      const controller = new AbortController(); active.add(controller);
      try {
        // Let readiness report its own initial handshake failure (for example,
        // no browser host), rather than masking it with its subsequent close event.
        const info = validatePublicSessionInfo(await boundedOperation(() => session(), controller.signal));
        if (!Object.hasOwn(info.capabilities, "aplg.fs")) throw new AplgError("E_CAPABILITY_UNAVAILABLE", "The host does not provide filesystem access.");
        if (!remove && options.onConnectionChange) remove = options.onConnectionChange((state) => {
          if (state === "connected") return;
          if (state === "closed") closed = true;
          for (const pending of [...active]) pending.abort(new AplgError(state === "closed" ? "E_SESSION_CLOSED" : "E_HOST_UNAVAILABLE", "The filesystem connection is unavailable."));
        });
        checkSignal(controller.signal);
        return await action({ info, signal: controller.signal });
      } finally {
        active.delete(controller);
        if (!active.size) { const unsubscribe = remove; remove = undefined; try { unsubscribe?.(); } catch { /* Cleanup cannot hide operation errors. */ } }
      }
    },
  };
}
