import {
  AplgError, limits, parseManifest, validateCapabilityRequest,
  type HostEvent, type HostTransport, type JsonObject, type JsonValue, type SessionDescriptor,
} from "@ai-switch/tauri-plugin-runtime/protocol";
import inputManifest from "../plugin/aplg.json";

export const manifest = parseManifest(inputManifest);
export interface MemorySnapshot { sessions: number; listeners: number; entries: number }

/** Demonstration only: view-scoped volatile storage, not a disk/OS provider or auth backend. */
export function createMemoryTransport(assetUrl: string, changed: (state: MemorySnapshot) => void = () => {}) {
  const sessions = new Map<string, Map<string, JsonValue>>();
  const listeners = new Set<(event: HostEvent) => void>();
  const snapshot = (): MemorySnapshot => ({ sessions: sessions.size, listeners: listeners.size, entries: [...sessions.values()].reduce((count, values) => count + values.size, 0) });
  const notify = () => changed(snapshot());
  const unavailable = () => new AplgError("E_CAPABILITY_UNAVAILABLE", "The demo only provides aplg.storage get/set/remove.");
  const transport: HostTransport = {
    async call<T>(operation: string, args: JsonObject): Promise<T> {
      if (operation === "session.open") {
        if (args.pluginId !== manifest.id) throw new AplgError("E_PERMISSION_DENIED", "This demo opens only its bundled plugin.");
        if (sessions.size >= 4) throw new AplgError("E_LIMIT_EXCEEDED", "The demo allows at most four open views.");
        const sessionId = `demo-${crypto.randomUUID()}`;
        sessions.set(sessionId, new Map()); notify();
        const descriptor: SessionDescriptor = {
          sessionId, manifest: structuredClone(manifest), assetUrl,
          info: {
            protocol: "aplg/1", apiVersion: "1.0.0",
            // An explicit mock identity, NOT an archive digest or a signature.
            plugin: { id: manifest.id, version: manifest.version, packageSha256: "0".repeat(64) },
            capabilities: { "aplg.storage": { version: "1.0.0", methods: ["get", "set", "remove"] } },
            limits: { controlBytes: limits.controlBytes, fileChunkBytes: limits.fileChunkBytes, fileBytes: limits.fileBytes, fileTransfers: limits.fileTransfers },
          },
        };
        return descriptor as T;
      }
      if (operation === "session.close") { sessions.delete(String(args.sessionId)); notify(); return null as T; }
      const values = typeof args.sessionId === "string" ? sessions.get(args.sessionId) : undefined;
      if (!values) throw new AplgError("E_SESSION_CLOSED", "The demo view is closed.");
      if (operation === "request.cancel") return null as T; // All work is synchronous in memory; nothing is retried.
      if (operation !== "capability.call" || args.capability !== "aplg.storage" || !["get", "set", "remove"].includes(String(args.method))) throw unavailable();
      const checked = validateCapabilityRequest("aplg.storage", args.method as string, args.params);
      if (!checked.ok) throw new AplgError("E_INVALID_ARGUMENT", "Invalid demo storage request.");
      const params = checked.value as JsonObject;
      const key = params.key as string;
      if (args.method === "get") return structuredClone(values.get(key) ?? null) as T;
      if (args.method === "remove") { values.delete(key); notify(); return null as T; }
      const next = structuredClone(params.value);
      const bytes = new TextEncoder().encode(JSON.stringify(next)).byteLength;
      if (bytes > 65536 || !values.has(key) && values.size >= 32) throw new AplgError("E_LIMIT_EXCEEDED", "Demo storage allows 32 keys with at most 64 KiB per value.");
      values.set(key, next); notify(); return null as T;
    },
    async subscribe(handler) {
      listeners.add(handler); notify();
      return () => { listeners.delete(handler); notify(); };
    },
  };
  return { transport, snapshot };
}
