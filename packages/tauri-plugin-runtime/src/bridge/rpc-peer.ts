import { AplgError, toErrorPayload } from "../protocol/errors.js";
import { limits, protocolVersion } from "../protocol/limits.js";
import type { JsonObject, JsonValue } from "../protocol/types.js";
import type { PluginOperation, PluginRequest } from "../protocol/wire.js";
import type { WireMessage } from "../protocol/generated/types.generated.js";
import { fromErrorPayload } from "../plugin/errors.js";
import { checkedByteLimit, decodeWireMessage, encodeWireMessage } from "./json-codec.js";
import type { CallOptions, IncomingRequest, PortEvent, RpcPeer } from "./rpc-types.js";

export type { CallOptions, IncomingRequest, PortEvent, RpcPeer } from "./rpc-types.js";

interface PendingRequest {
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener(): void;
  resolve(value: JsonValue): void;
  reject(error: Error): void;
}

function validTimeout(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new AplgError("E_INVALID_ARGUMENT", "RPC timeout must be a positive timer-safe integer.");
  }
  return value;
}
function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createRpcPeer(port: MessagePort, options: { timeoutMs?: number; maxInflight?: number; maxBytes?: number } = {}): RpcPeer {
  const timeoutMs = validTimeout(options.timeoutMs ?? 30_000);
  const maxInflight = options.maxInflight ?? 64;
  const maxBytes = checkedByteLimit(options.maxBytes ?? limits.controlBytes);
  if (!Number.isSafeInteger(maxInflight) || maxInflight < 1 || maxInflight > 64) {
    throw new AplgError("E_INVALID_ARGUMENT", "RPC concurrency must be between 1 and 64.");
  }
  const pending = new Map<string, PendingRequest>();
  const incoming = new Map<string, AbortController>();
  const recentIds = new Set<string>();
  const events = new Set<(event: PortEvent) => void>();
  let handler: ((request: IncomingRequest) => Promise<JsonValue>) | undefined;
  let closed: Error | undefined;

  function settle(id: string, action: (entry: PendingRequest) => void) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.removeAbortListener();
    action(entry);
  }
  function emit(event: PortEvent) {
    for (const callback of [...events]) {
      try { callback(event); } catch { /* A consumer callback cannot break peer cleanup or other listeners. */ }
    }
  }
  function terminate(reason: Error, notify: boolean) {
    if (closed) return;
    closed = reason;
    if (notify) {
      try { port.postMessage(encodeWireMessage({ protocol: protocolVersion, kind: "connection", state: "closed" }, maxBytes)); } catch { /* Best effort during shutdown. */ }
    }
    port.removeEventListener("message", receive);
    port.removeEventListener("messageerror", messageError);
    port.removeEventListener("close", portClosed);
    for (const id of pending.keys()) settle(id, (entry) => entry.reject(reason));
    for (const controller of incoming.values()) controller.abort(reason);
    incoming.clear(); recentIds.clear(); handler = undefined;
    emit({ protocol: protocolVersion, kind: "connection", state: "closed" });
    events.clear();
    port.close();
  }
  function post(message: unknown) {
    if (closed) throw closed;
    const frame = encodeWireMessage(message, maxBytes);
    try { port.postMessage(frame); } catch {
      const error = new AplgError("E_SESSION_CLOSED", "The RPC port is unavailable.");
      terminate(error, false);
      throw error;
    }
  }
  function reply(message: WireMessage) {
    if (closed) return;
    try { post(message); } catch (error) {
      if (closed) return;
      try { post({ protocol: protocolVersion, kind: "error", id: "id" in message ? message.id : requestId(), error: toErrorPayload(error) }); }
      catch { terminate(new AplgError("E_INVALID_MESSAGE", "The RPC reply could not be encoded."), true); }
    }
  }
  function cancelRemote(id: string) {
    if (closed) return;
    try { post({ protocol: protocolVersion, kind: "request", id: requestId(), operation: "request.cancel", args: { requestId: id } }); }
    catch { /* Caller cancellation is already settled locally. */ }
  }
  function dispatch(request: PluginRequest) {
    if (request.operation === "request.cancel") {
      const controller = incoming.get(request.args.requestId);
      if (controller) {
        incoming.delete(request.args.requestId);
        controller.abort(new AplgError("E_CANCELLED", "The request was cancelled."));
      }
      reply({ protocol: protocolVersion, kind: "result", id: request.id, value: null });
      return;
    }
    if (incoming.has(request.id) || recentIds.has(request.id)) {
      terminate(new AplgError("E_INVALID_MESSAGE", "Duplicate RPC request identifier."), true);
      return;
    }
    recentIds.add(request.id);
    if (recentIds.size > 1024) recentIds.delete(recentIds.values().next().value!);
    if (incoming.size >= maxInflight) {
      reply({ protocol: protocolVersion, kind: "error", id: request.id, error: toErrorPayload(new AplgError("E_LIMIT_EXCEEDED", "Too many incoming RPC requests.")) });
      return;
    }
    const controller = new AbortController();
    const currentHandler = handler;
    incoming.set(request.id, controller);
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!currentHandler) throw new AplgError("E_HOST_UNAVAILABLE", "No handler is registered for this RPC peer.");
      return currentHandler({ ...request, signal: controller.signal });
    }).then(
      (value) => { if (!controller.signal.aborted) reply({ protocol: protocolVersion, kind: "result", id: request.id, value }); },
      (error: unknown) => { if (!controller.signal.aborted) reply({ protocol: protocolVersion, kind: "error", id: request.id, error: toErrorPayload(error) }); },
    ).finally(() => { if (incoming.get(request.id) === controller) incoming.delete(request.id); });
  }
  function receive(event: MessageEvent) {
    if (closed) return;
    let message: WireMessage;
    try { message = decodeWireMessage(event.data, maxBytes); }
    catch { terminate(new AplgError("E_INVALID_MESSAGE", "The remote RPC frame was invalid."), true); return; }
    if (message.kind === "request") { dispatch(message); return; }
    if (message.kind === "result") { settle(message.id, (entry) => entry.resolve(message.value)); return; }
    if (message.kind === "error") { settle(message.id, (entry) => entry.reject(fromErrorPayload(message.error))); return; }
    if (message.kind === "connection" && message.state === "closed") {
      terminate(new AplgError("E_SESSION_CLOSED", "The remote RPC peer closed."), false); return;
    }
    emit(message);
  }
  const messageError = () => terminate(new AplgError("E_INVALID_MESSAGE", "The RPC frame could not be deserialized."), true);
  const portClosed = () => terminate(new AplgError("E_SESSION_CLOSED", "The RPC port closed."), false);
  port.addEventListener("message", receive);
  port.addEventListener("messageerror", messageError);
  port.addEventListener("close", portClosed);
  port.start();

  return {
    async request(operation: PluginOperation, args: JsonObject, callOptions: CallOptions = {}): Promise<JsonValue> {
      if (closed) throw closed;
      if (callOptions.signal?.aborted) throw new AplgError("E_CANCELLED", "The request was cancelled.");
      const deadline = validTimeout(callOptions.timeoutMs ?? timeoutMs);
      if (pending.size >= maxInflight) throw new AplgError("E_LIMIT_EXCEEDED", "Too many pending RPC requests.");
      const id = requestId();
      const frame = encodeWireMessage({ protocol: protocolVersion, kind: "request", id, operation, args }, maxBytes);
      return new Promise<JsonValue>((resolve, reject) => {
        const abort = () => {
          settle(id, (entry) => entry.reject(new AplgError("E_CANCELLED", "The request was cancelled.")));
          cancelRemote(id);
        };
        const timer = setTimeout(() => {
          settle(id, (entry) => entry.reject(new AplgError("E_TIMEOUT", "The RPC request timed out.")));
          cancelRemote(id);
        }, deadline);
        pending.set(id, { timer, removeAbortListener: () => callOptions.signal?.removeEventListener("abort", abort), resolve, reject });
        callOptions.signal?.addEventListener("abort", abort, { once: true });
        try { port.postMessage(frame); }
        catch { terminate(new AplgError("E_SESSION_CLOSED", "The RPC port is unavailable."), false); }
      });
    },
    onRequest(callback) {
      if (closed) throw closed;
      if (handler) throw new AplgError("E_INVALID_ARGUMENT", "An RPC request handler is already registered.");
      handler = callback;
      return () => { if (handler === callback) handler = undefined; };
    },
    onEvent(callback) {
      if (closed) { try { callback({ protocol: protocolVersion, kind: "connection", state: "closed" }); } catch { /* Isolate consumer callbacks. */ } return () => {}; }
      events.add(callback);
      return () => { events.delete(callback); };
    },
    sendEvent(event) {
      if (event.kind === "connection" && event.state === "closed") { terminate(new AplgError("E_SESSION_CLOSED", "The RPC peer closed."), true); return; }
      post(event);
    },
    close(reason = new AplgError("E_SESSION_CLOSED", "The RPC peer closed.")) { terminate(reason, true); },
  };
}
