import { AplgError } from "../protocol/errors.js";
import { validateJson } from "../protocol/json-safety.js";
import { validateCapabilityRequest, validateCapabilityResult } from "../protocol/capabilities.js";
import type { JsonObject, JsonValue } from "../protocol/types.js";
import type { HostTransport } from "../protocol/wire.js";
import type { SessionRequests } from "./requests.js";
import { bounded, randomId } from "./policy.js";

/** Owns file handles at the host boundary, including replies the plugin no longer sees. */
export function createFileHandleGuard(options: {
  transport: HostTransport; requests: SessionRequests; sessionId: string; timeoutMs: number; maxTransfers: number;
}) {
  const handles = new Set<string>();
  const opening = new Set<symbol>();
  const releasing = new Map<string, Promise<void>>();
  let disposed = false;
  let cleanup: Promise<void> | undefined;
  function handleOf(value: unknown): string | undefined {
    if (!validateJson(value).ok || !value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const handle = (value as Record<string, unknown>).handle;
    return typeof handle === "string" && /^[\x21-\x7e]{1,128}$/.test(handle) ? handle : undefined;
  }
  function release(handle: string): Promise<void> {
    const previous = releasing.get(handle); if (previous) return previous;
    const work = bounded(() => options.transport.call<JsonValue>("capability.call", {
      sessionId: options.sessionId, requestId: randomId("file-cleanup-"),
      capability: "aplg.fs", method: "transfer.abort", params: { handle },
    }), Math.min(options.timeoutMs, 1000)).then((result) => {
      if (result === null) handles.delete(handle);
    }).catch(() => { /* The session close is the final cleanup boundary if abort is unconfirmed. */ }).finally(() => releasing.delete(handle));
    releasing.set(handle, work); return work;
  }
  async function releaseUnclaimed(value: JsonValue) {
    const handle = handleOf(value);
    if (handle && !handles.has(handle)) { handles.add(handle); await release(handle); }
  }
  return {
    async call(method: string, params: JsonValue, signal: AbortSignal): Promise<JsonValue> {
      if (disposed) throw new AplgError("E_SESSION_CLOSED", "The file transfer session is closed.");
      if (signal.aborted) throw new AplgError("E_CANCELLED", "The file transfer request was cancelled.");
      if (!validateCapabilityRequest("aplg.fs", method, params).ok) throw new AplgError("E_INVALID_ARGUMENT", "Invalid filesystem request.");
      const isOpen = method === "transfer.openRead" || method === "transfer.openWrite";
      const reservation = Symbol("file-open"); let received = false;
      if (isOpen) {
        if (handles.size + opening.size >= options.maxTransfers) throw new AplgError("E_LIMIT_EXCEEDED", "Too many file transfers in this session.");
        opening.add(reservation);
      } else if (method.startsWith("transfer.")) {
        if (!handles.has((params as JsonObject).handle as string)) throw new AplgError("E_PERMISSION_DENIED", "This session does not own the file transfer handle.");
      }
      try {
        const result = await options.requests.run("capability.call", { capability: "aplg.fs", method, params }, signal, isOpen ? async (late) => {
          opening.delete(reservation); await releaseUnclaimed(late);
        } : undefined);
        received = true; opening.delete(reservation);
        if (isOpen) {
          const handle = handleOf(result);
          if (handle && handles.has(handle)) throw new AplgError("E_INVALID_MESSAGE", "The backend reused an active file transfer handle.");
          if (!validateCapabilityResult("aplg.fs", method, result).ok || disposed || signal.aborted) {
            await releaseUnclaimed(result);
            throw new AplgError(disposed || signal.aborted ? "E_SESSION_CLOSED" : "E_INVALID_MESSAGE", "The file transfer could not be opened safely.");
          }
          handles.add(handle!);
        } else {
          if (!validateCapabilityResult("aplg.fs", method, result).ok) throw new AplgError("E_INVALID_MESSAGE", "The backend returned an invalid filesystem result.");
          if (method === "transfer.finish" || method === "transfer.abort") handles.delete((params as JsonObject).handle as string);
        }
        return result;
      } catch (error) {
        const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
        // An unconfirmed open still reserves capacity until its late reply arrives
        // or this session closes. Never turn a timeout into permission to leak more handles.
        if (received || !["E_TIMEOUT", "E_CANCELLED", "E_HOST_UNAVAILABLE", "E_SESSION_CLOSED"].includes(code ?? "")) opening.delete(reservation);
        throw error;
      }
    },
    async restore(): Promise<void> {
      if (disposed) return;
      if (opening.size) throw new AplgError("E_HOST_UNAVAILABLE", "An interrupted file open is still unconfirmed.");
      // New calls remain gated by the view while recovery confirms cleanup of
      // handles from interrupted transfers. Never simply forget reservations.
      const previous = [...handles];
      await Promise.all(previous.map(release));
      if (!disposed && previous.some((handle) => handles.has(handle))) {
        throw new AplgError("E_HOST_UNAVAILABLE", "Interrupted file transfers could not be released after reconnect.");
      }
    },    dispose(): Promise<void> {
      if (cleanup) return cleanup;
      disposed = true; opening.clear();
      cleanup = Promise.allSettled([...handles].map(release)).then(() => {});
      return cleanup;
    },
  };
}
