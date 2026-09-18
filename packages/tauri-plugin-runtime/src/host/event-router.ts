import { AplgError } from "../protocol/errors.js";
import { protocolVersion } from "../protocol/limits.js";
import type { HostEvent } from "../protocol/generated/types.generated.js";
import type { JsonValue } from "../protocol/types.js";
import type { HostTransport } from "../protocol/wire.js";
import type { PortEvent } from "../bridge/rpc-types.js";
import type { SessionRequests } from "./requests.js";
import { bounded, randomId } from "./policy.js";

type BackendEvent = Extract<HostEvent, { kind: "capability.event" }>;
interface Subscription { id: string; capability: string; topic: string; backend?: string; backendSeq: number; seq: number }
export interface EventRouter {
  open(capability: string, topic: string, signal?: AbortSignal): Promise<string>;
  close(id: string): Promise<void>;
  accept(event: HostEvent): void;
  isConnected(): boolean;
  setConnected(connected: boolean): Promise<void>;
  dispose(): Promise<void>;
}

export function createEventRouter(options: {
  transport: HostTransport; requests: SessionRequests; sessionId: string; timeoutMs: number;
  send(event: PortEvent): void;
}): EventRouter {
  const subscriptions = new Map<string, Subscription>();
  const backendIds = new Map<string, Subscription>();
  const buffered: Array<{ event: BackendEvent; expires: number }> = [];
  let bufferTimer: ReturnType<typeof setTimeout> | undefined;
  let online = true; let ready = true; let disposed = false; let generation = 0; let opening = 0;
  let cleanup: Promise<void> | undefined;
  let reconnecting: Promise<void> | undefined;

  function status(state: "connected" | "disconnected") { if (!disposed) options.send({ protocol: protocolVersion, kind: "connection", state }); }
  function release(id: string) {
    return bounded(() => options.transport.call("subscription.close", { sessionId: options.sessionId, subscriptionId: id }), options.timeoutMs).then(() => {});
  }
  function resultId(value: JsonValue): string {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.subscriptionId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(value.subscriptionId)) {
      throw new AplgError("E_INVALID_MESSAGE", "Invalid backend subscription identifier.");
    }
    return value.subscriptionId;
  }
  function lateRelease(value: JsonValue) { try { void release(resultId(value)).catch(() => {}); } catch { /* Invalid replies cannot name a subscription to release. */ } }
  function expire() {
    clearTimeout(bufferTimer); bufferTimer = undefined;
    const now = Date.now();
    for (let index = buffered.length - 1; index >= 0; index--) if (buffered[index].expires <= now) buffered.splice(index, 1);
    if (buffered.length) bufferTimer = setTimeout(expire, Math.max(1, buffered[0].expires - now));
  }
  function clearBuffer() { buffered.length = 0; clearTimeout(bufferTimer); bufferTimer = undefined; }
  function deliver(subscription: Subscription, event: BackendEvent) {
    if (event.seq <= subscription.backendSeq) return;
    const delta = event.seq - subscription.backendSeq;
    if (!Number.isSafeInteger(subscription.seq + delta)) { void router.setConnected(false); return; }
    if (delta > 1) { status("disconnected"); status("connected"); }
    subscription.backendSeq = event.seq; subscription.seq += delta;
    options.send({ protocol: protocolVersion, kind: "event", subscriptionId: subscription.id, seq: subscription.seq, payload: event.payload });
  }
  function flush() {
    expire();
    if (!ready || disposed) return;
    for (let index = 0; index < buffered.length;) {
      const item = buffered[index]; const subscription = backendIds.get(item.event.subscriptionId);
      if (subscription) { buffered.splice(index, 1); deliver(subscription, item.event); } else index++;
    }
    if (opening === 0) clearBuffer();
  }
  async function attach(subscription: Subscription, signal?: AbortSignal, restoring = false) {
    const epoch = generation; opening++;
    try {
      const value = await options.requests.run("subscription.open", { capability: subscription.capability, topic: subscription.topic }, signal, lateRelease);
      const id = resultId(value);
      if (restoring && !subscriptions.has(subscription.id)) { void release(id).catch(() => {}); return; }
      if (disposed || !online || epoch !== generation || !subscriptions.has(subscription.id) || signal?.aborted) {
        void release(id).catch(() => {});
        throw new AplgError(disposed ? "E_SESSION_CLOSED" : "E_HOST_UNAVAILABLE", "The subscription session changed while opening.");
      }
      if (backendIds.has(id)) throw new AplgError("E_INVALID_MESSAGE", "The backend reused an active subscription identifier.");
      subscription.backend = id; subscription.backendSeq = 0; backendIds.set(id, subscription);
    } finally { opening--; }
    flush();
  }

  const router: EventRouter = {
    async open(capability, topic, signal) {
      if (disposed) throw new AplgError("E_SESSION_CLOSED", "The plugin session is closed.");
      if (!ready) throw new AplgError("E_HOST_UNAVAILABLE", "The plugin host is disconnected.");
      if (subscriptions.size >= 64) throw new AplgError("E_LIMIT_EXCEEDED", "Too many subscriptions for this plugin session.");
      const subscription: Subscription = { id: randomId("subscription-"), capability, topic, backendSeq: 0, seq: 0 };
      subscriptions.set(subscription.id, subscription);
      try { await attach(subscription, signal); return subscription.id; }
      catch (error) { subscriptions.delete(subscription.id); if (opening === 0) clearBuffer(); throw error; }
    },
    async close(id) {
      const subscription = subscriptions.get(id);
      if (!subscription) throw new AplgError("E_PERMISSION_DENIED", "This session does not own the requested subscription.");
      subscriptions.delete(id);
      if (subscription.backend) { backendIds.delete(subscription.backend); await release(subscription.backend); }
    },
    accept(event) {
      if (disposed || !online || event.kind !== "capability.event" || event.sessionId !== options.sessionId) return;
      const subscription = backendIds.get(event.subscriptionId);
      if (ready && subscription) { deliver(subscription, event); return; }
      if (opening > 0 && buffered.length < 32) {
        buffered.push({ event, expires: Date.now() + 2000 });
        if (!bufferTimer) bufferTimer = setTimeout(expire, 2000);
      }
    },
    isConnected() { return ready && !disposed; },
    async setConnected(connected) {
      if (disposed) return;
      if (!connected) {
        if (!online && !ready) return;
        online = false; ready = false; generation++; reconnecting = undefined;
        options.requests.abortAll(new AplgError("E_HOST_UNAVAILABLE", "The host transport disconnected."));
        clearBuffer();
        for (const subscription of subscriptions.values()) {
          if (subscription.backend) void release(subscription.backend).catch(() => {});
          subscription.backend = undefined; subscription.backendSeq = 0;
        }
        backendIds.clear(); status("disconnected"); return;
      }
      if (ready) return;
      if (reconnecting) return reconnecting;
      online = true; const epoch = generation;
      reconnecting = (async () => {
        try {
          await Promise.all([...subscriptions.values()].map((subscription) => attach(subscription, undefined, true)));
          if (disposed || epoch !== generation || !online) return;
          ready = true; status("connected"); flush();
        } catch (error) {
          if (disposed || epoch !== generation) return;
          await router.setConnected(false);
          throw error;
        } finally { if (epoch === generation) reconnecting = undefined; }
      })();
      return reconnecting;
    },
    dispose() {
      if (cleanup) return cleanup;
      disposed = true; online = false; ready = false; generation++;
      options.requests.abortAll(new AplgError("E_SESSION_CLOSED", "The plugin session is closed."));
      clearBuffer();
      const closing = [...backendIds.keys()].map((id) => release(id));
      subscriptions.clear(); backendIds.clear();
      cleanup = Promise.allSettled(closing).then(() => {});
      return cleanup;
    },
  };
  return router;
}
