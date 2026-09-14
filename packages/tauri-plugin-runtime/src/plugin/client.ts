import { AplgError } from "../protocol/errors.js";
import { satisfiesApiRange } from "../protocol/manifest.js";
import { standardCapabilities, validateCapabilityRequest, validateCapabilityResult } from "../protocol/capabilities.js";
import { validateJson } from "../protocol/json-safety.js";
import type { SessionInfo, Unsubscribe } from "../protocol/wire.js";
import type { JsonValue } from "../protocol/types.js";
import type { RpcPeer, PortEvent, CallOptions } from "../bridge/rpc-types.js";
import type { ConnectionState, DirectorySelection, PluginApi } from "./types.js";

type Subscription = { seq: number; callback: (payload: JsonValue) => void };
type CapabilityEvent = Extract<PortEvent, { kind: "event" }>;

function frozenSnapshot<T>(input: T): T {
  const copy: T = JSON.parse(JSON.stringify(input));
  const freeze = (value: unknown) => {
    if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(copy);
  return copy;
}

export function createPluginClient(peer: RpcPeer, sessionInfo: SessionInfo): PluginApi {
  if (!validateJson(sessionInfo).ok) throw new AplgError("E_INVALID_MESSAGE", "Invalid public session information.");
  const info = frozenSnapshot(sessionInfo);
  let state: ConnectionState = "connected";
  let opening = 0;
  const subscriptions = new Map<string, Subscription>();
  const listeners = new Set<(state: ConnectionState) => void>();
  const earlyEvents: Array<{ event: CapabilityEvent; expires: number }> = [];
  let bufferTimer: ReturnType<typeof setTimeout> | undefined;
  let removePeerListener: Unsubscribe = () => {};

  function setState(next: ConnectionState) {
    if (state === "closed" || state === next) return;
    state = next;
    if (next === "closed") {
      subscriptions.clear(); earlyEvents.length = 0;
      clearTimeout(bufferTimer); bufferTimer = undefined;
      removePeerListener();
    }
    for (const callback of [...listeners]) { try { callback(next); } catch { /* Isolate consumer callbacks. */ } }
    if (next === "closed") listeners.clear();
  }
  function assertConnected() {
    if (state === "closed") throw new AplgError("E_SESSION_CLOSED", "The plugin session is closed.");
    if (state === "disconnected") throw new AplgError("E_HOST_UNAVAILABLE", "The plugin host is disconnected.");
  }
  function supports(name: string, range?: string) {
    const capability = Object.hasOwn(info.capabilities, name) ? info.capabilities[name] : undefined;
    return state !== "closed" && Boolean(capability && (range === undefined || satisfiesApiRange(capability.version, range)));
  }
  function requireCapability(name: string, method?: string) {
    assertConnected();
    if (!supports(name) || method !== undefined && !info.capabilities[name].methods.includes(method)) {
      throw new AplgError("E_CAPABILITY_UNAVAILABLE", "The requested capability or method is unavailable.");
    }
  }
  async function call<T extends JsonValue>(capability: string, method: string, params: JsonValue = null, options?: CallOptions): Promise<T> {
    requireCapability(capability, method);
    const standard = Object.hasOwn(standardCapabilities, capability);
    if (standard && !validateCapabilityRequest(capability, method, params).ok) {
      throw new AplgError("E_INVALID_ARGUMENT", "The capability request is invalid.");
    }
    const value = await peer.request("capability.call", { capability, method, params }, options);
    if (state === "closed") throw new AplgError("E_SESSION_CLOSED", "The plugin session is closed.");
    if (standard && !validateCapabilityResult(capability, method, value).ok) {
      throw new AplgError("E_INVALID_MESSAGE", "The host returned an invalid capability result.");
    }
    return value as T;
  }
  function deliver(event: CapabilityEvent, subscription: Subscription) {
    if (event.seq <= subscription.seq) return;
    if (event.seq !== subscription.seq + 1) { setState("disconnected"); setState("connected"); }
    subscription.seq = event.seq;
    try { subscription.callback(event.payload); } catch { /* Callback failures cannot disrupt subscriptions. */ }
  }
  function clearExpired() {
    const now = Date.now();
    for (let index = earlyEvents.length - 1; index >= 0; index--) if (earlyEvents[index].expires <= now) earlyEvents.splice(index, 1);
    clearTimeout(bufferTimer); bufferTimer = undefined;
    if (earlyEvents.length) bufferTimer = setTimeout(clearExpired, Math.max(1, earlyEvents[0].expires - now));
  }
  removePeerListener = peer.onEvent((event) => {
    if (event.kind === "connection") { setState(event.state); return; }
    if (state !== "connected") return;
    const subscription = subscriptions.get(event.subscriptionId);
    if (subscription) { deliver(event, subscription); return; }
    if (opening > 0 && earlyEvents.length < 32) {
      earlyEvents.push({ event, expires: Date.now() + 2000 });
      if (!bufferTimer) bufferTimer = setTimeout(clearExpired, 2000);
    }
  });

  return {
    async ready() { assertConnected(); return info; },
    capabilities: { supports },
    call,
    async subscribe(capability, topic, callback) {
      requireCapability(capability);
      if (typeof callback !== "function") throw new AplgError("E_INVALID_ARGUMENT", "An event callback is required.");
      if (subscriptions.size + opening >= 64) throw new AplgError("E_LIMIT_EXCEEDED", "Too many plugin subscriptions.");
      opening++;
      try {
        const value = await peer.request("subscription.open", { capability, topic });
        if (state === "closed") throw new AplgError("E_SESSION_CLOSED", "The plugin session is closed.");
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.subscriptionId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(value.subscriptionId) || subscriptions.has(value.subscriptionId)) {
          peer.close(new AplgError("E_INVALID_MESSAGE", "Invalid subscription reply."));
          throw new AplgError("E_INVALID_MESSAGE", "Invalid subscription reply.");
        }
        const id = value.subscriptionId;
        if (state !== "connected") {
          void peer.request("subscription.close", { subscriptionId: id }).catch(() => {});
          assertConnected();
        }
        const subscription: Subscription = { seq: 0, callback };
        subscriptions.set(id, subscription);
        clearExpired();
        for (let index = 0; index < earlyEvents.length;) {
          const item = earlyEvents[index];
          if (item.event.subscriptionId === id) { earlyEvents.splice(index, 1); deliver(item.event, subscription); } else index++;
        }
        return () => {
          if (!subscriptions.delete(id)) return;
          void peer.request("subscription.close", { subscriptionId: id }).catch(() => {});
        };
      } finally {
        opening--;
        if (opening === 0) { earlyEvents.length = 0; clearTimeout(bufferTimer); bufferTimer = undefined; }
      }
    },
    onConnectionChange(callback) {
      if (state === "closed") { callback("closed"); return () => {}; }
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
    storage: {
      get: (key) => call("aplg.storage", "get", { key }),
      async set(key, value) { await call("aplg.storage", "set", { key, value }); },
      async remove(key) { await call("aplg.storage", "remove", { key }); },
    },
    dialog: {
      async pickDirectory(options = {}) {
        if (!validateCapabilityRequest("aplg.dialog", "pickDirectory", options).ok) {
          throw new AplgError("E_INVALID_ARGUMENT", "The directory picker options are invalid.");
        }
        return call<DirectorySelection>("aplg.dialog", "pickDirectory", { access: options.access ?? "read" });
      },
    },
  };
}
