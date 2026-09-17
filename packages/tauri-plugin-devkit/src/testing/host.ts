import {
  AplgError,
  apiVersion,
  limits,
  protocolVersion,
  standardCapabilities,
  validateCapabilityRequest,
  validateCapabilityResult,
  validateManifest,
  type HostEvent,
  type HostOperation,
  type HostTransport,
  type JsonObject,
  type JsonValue,
  type Manifest,
  type SessionDescriptor,
  type Unsubscribe,
} from "@ai-switch/tauri-plugin-runtime/protocol";
import { cloneMemoryFiles, MemoryFileSystem } from "./filesystem.js";
import { cloneStorageRecord, createStorageState, type StorageState } from "./storage.js";

export interface TestHost {
  readonly transport: HostTransport;
  activeSessionIds(): string[];
  emit(sessionId: string, capability: string, topic: string, payload: JsonValue): void;
  disconnect(): void;
  reconnect(): void;
  dispose(): Promise<void>;
}
export interface TestHostOptions {
  manifest: Manifest;
  assetUrl: string;
  initialStorage?: Record<string, JsonValue>;
  memoryFiles?: Record<string, Uint8Array>;
}
interface SessionState { id: string; pluginId: string; subscriptions: Map<string, { id: string; capability: string; topic: string; seq: number }> }

const cloneJson = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const declared = (manifest: Manifest, capability: string) => Object.hasOwn(manifest.requires, capability) || Object.hasOwn(manifest.optional, capability);
const isLoopbackUrl = (value: string) => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(url.hostname)));
  } catch { return false; }
};
function invalidOptions(message: string): never { throw new AplgError("E_INVALID_ARGUMENT", message); }
function rethrowCapabilityError(error: unknown): never { throw error; }

/**
 * A deterministic, browser-safe host transport for tests and local preview.
 * It is intentionally memory-only: it is not an OS filesystem or an auth backend.
 */
export function createTestHost(options: TestHostOptions): TestHost {
  if (!options || typeof options !== "object" || Array.isArray(options)) invalidOptions("Test host options are required.");
  if (!validateManifest(options.manifest).ok) invalidOptions("The test host manifest is invalid.");
  if (typeof options.assetUrl !== "string" || !isLoopbackUrl(options.assetUrl)) invalidOptions("The test host asset URL must be HTTPS or loopback HTTP.");
  const manifest = cloneJson(options.manifest as unknown as JsonValue) as unknown as Manifest;
  const initialStorage = cloneStorageRecord(options.initialStorage);
  const explicitFiles = options.memoryFiles !== undefined;
  const initialFiles = cloneMemoryFiles(options.memoryFiles);
  const storageByPlugin = new Map<string, StorageState>();
  const filesByPlugin = new Map<string, MemoryFileSystem>();
  const sessions = new Map<string, SessionState>();
  const listeners = new Set<(event: HostEvent) => void>();
  let sequence = 0; let subscriptionSequence = 0; let connected = true; let disposed = false;

  function storage(pluginId: string): StorageState {
    let state = storageByPlugin.get(pluginId);
    if (!state) { state = createStorageState(initialStorage); storageByPlugin.set(pluginId, state); }
    return state;
  }
  function files(pluginId: string): MemoryFileSystem {
    let state = filesByPlugin.get(pluginId);
    if (!state) { state = new MemoryFileSystem(initialFiles); filesByPlugin.set(pluginId, state); }
    return state;
  }
  function session(sessionId: string): SessionState {
    const state = sessions.get(sessionId);
    if (!state) throw new AplgError("E_SESSION_CLOSED", "The test plugin session is closed.");
    return state;
  }
  function providedCapabilities(): Record<string, { version: string; methods: string[] }> {
    const result: Record<string, { version: string; methods: string[] }> = {};
    if (declared(manifest, "aplg.storage")) result["aplg.storage"] = { version: standardCapabilities["aplg.storage"].version, methods: [...standardCapabilities["aplg.storage"].methods] };
    if (explicitFiles && declared(manifest, "aplg.fs")) result["aplg.fs"] = { version: standardCapabilities["aplg.fs"].version, methods: [...standardCapabilities["aplg.fs"].methods] };
    return result;
  }
  function requireProvided(capability: string, capabilities = providedCapabilities()): void {
    if (!Object.hasOwn(capabilities, capability)) throw new AplgError("E_CAPABILITY_UNAVAILABLE", "The test host does not provide this capability.");
  }
  function checkConnected(): void { if (disposed) throw new AplgError("E_SESSION_CLOSED", "The test host is disposed."); if (!connected) throw new AplgError("E_HOST_UNAVAILABLE", "The test host is disconnected."); }
  function emitEvent(event: HostEvent): void { for (const listener of [...listeners]) { try { listener(cloneJson(event as unknown as JsonValue) as unknown as HostEvent); } catch { /* A test listener cannot break the transport. */ } } }
  function descriptor(sessionId: string, capabilities: Record<string, { version: string; methods: string[] }>): SessionDescriptor {
    return {
      sessionId,
      manifest: cloneJson(manifest as unknown as JsonValue) as unknown as Manifest,
      assetUrl: options.assetUrl,
      info: {
        protocol: protocolVersion,
        apiVersion,
        plugin: { id: manifest.id, version: manifest.version, packageSha256: "0".repeat(64) },
        capabilities,
        limits: { controlBytes: limits.controlBytes, fileChunkBytes: limits.fileChunkBytes, fileBytes: limits.fileBytes, fileTransfers: limits.fileTransfers },
      },
    };
  }
  function storageCall(state: SessionState, method: string, params: JsonValue): JsonValue {
    const checked = validateCapabilityRequest("aplg.storage", method, params);
    if (!checked.ok) throw new AplgError("E_INVALID_ARGUMENT", "Invalid test storage request.");
    const value = checked.value as { key: string; value?: JsonValue };
    const stateStore = storage(state.pluginId);
    if (method === "get") return stateStore.get(value.key);
    if (method === "set") { stateStore.set(value.key, value.value as JsonValue); return null; }
    if (method === "remove") { stateStore.remove(value.key); return null; }
    throw new AplgError("E_CAPABILITY_UNAVAILABLE", "The test storage method is unavailable.");
  }
  function call(operation: string, args: JsonObject): JsonValue | SessionDescriptor {
    if (operation === "session.open") {
      checkConnected();
      if (args.pluginId !== manifest.id) throw new AplgError("E_PERMISSION_DENIED", "The test host only opens its configured plugin.");
      const capabilities = providedCapabilities();
      for (const capability of Object.keys(manifest.requires)) requireProvided(capability, capabilities);
      if (sessions.size >= 64) throw new AplgError("E_LIMIT_EXCEEDED", "The test host allows at most 64 active sessions.");
      const id = `test-session-${++sequence}`;
      sessions.set(id, { id, pluginId: manifest.id, subscriptions: new Map() });
      return descriptor(id, capabilities);
    }
    if (operation === "session.close") {
      const id = typeof args.sessionId === "string" ? args.sessionId : "";
      const state = sessions.get(id);
      if (state) { if (explicitFiles) files(state.pluginId).abortSession(id); sessions.delete(id); emitEvent({ kind: "session.closed", sessionId: id, reason: "test session closed" }); }
      return null;
    }
    if (operation === "request.cancel") return null;
    checkConnected();
    const state = session(String(args.sessionId));
    if (operation === "subscription.open") {
      const capability = String(args.capability); requireProvided(capability);
      const topic = String(args.topic);
      const id = `test-subscription-${++subscriptionSequence}`;
      state.subscriptions.set(id, { id, capability, topic, seq: 0 });
      return { subscriptionId: id };
    }
    if (operation === "subscription.close") {
      const id = String(args.subscriptionId);
      if (!state.subscriptions.delete(id)) throw new AplgError("E_PERMISSION_DENIED", "The subscription belongs to another test session.");
      return null;
    }
    if (operation !== "capability.call") throw new AplgError("E_PERMISSION_DENIED", "The test host operation is unavailable.");
    const capability = String(args.capability); const method = String(args.method); const params = args.params as JsonValue;
    requireProvided(capability);
    if (capability === "aplg.storage") return storageCall(state, method, params);
    if (capability === "aplg.fs") {
      try {
        const result = files(state.pluginId).call(state.id, method, params);
        const checked = validateCapabilityResult(capability, method, result);
        if (!checked.ok) throw new AplgError("E_INVALID_MESSAGE", "The test filesystem produced an invalid result.");
        return result;
      } catch (error) { return rethrowCapabilityError(error); }
    }
    throw new AplgError("E_CAPABILITY_UNAVAILABLE", "The test host does not implement this capability.");
  }
  const transport: HostTransport = {
    async call<T>(operation: HostOperation, args: JsonObject) { return call(operation, args) as T; },
    async subscribe(handler): Promise<Unsubscribe> {
      if (disposed) throw new AplgError("E_SESSION_CLOSED", "The test host is disposed.");
      listeners.add(handler); let active = true;
      return () => { if (active) { active = false; listeners.delete(handler); } };
    },
  };
  const host: TestHost = {
    transport,
    activeSessionIds() { return [...sessions.keys()]; },
    emit(sessionId, capability, topic, payload) {
      if (disposed || !connected || typeof capability !== "string" || typeof topic !== "string") return;
      const state = sessions.get(sessionId); if (!state || !Object.hasOwn(providedCapabilities(), capability)) return;
      for (const subscription of state.subscriptions.values()) {
        if (subscription.capability !== capability || subscription.topic !== topic) continue;
        subscription.seq++;
        emitEvent({ kind: "capability.event", sessionId, subscriptionId: subscription.id, seq: subscription.seq, payload: cloneJson(payload) });
      }
    },
    disconnect() {
      if (!disposed && connected) {
        connected = false;
        emitEvent({ kind: "transport.state", state: "disconnected" });
        for (const state of sessions.values()) state.subscriptions.clear();
      }
    },
    reconnect() { if (!disposed && !connected) { connected = true; emitEvent({ kind: "transport.state", state: "connected" }); } },
    async dispose() {
      if (disposed) return;
      for (const id of [...sessions.keys()]) emitEvent({ kind: "session.closed", sessionId: id, reason: "test host disposed" });
      disposed = true; connected = false; sessions.clear(); listeners.clear(); storageByPlugin.clear(); filesByPlugin.forEach((state) => state.clear()); filesByPlugin.clear();
    },
  };
  return host;
}
