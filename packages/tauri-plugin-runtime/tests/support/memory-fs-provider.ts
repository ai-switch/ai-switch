import { Buffer } from "../../src/node/buffer.js";
import { standardCapabilities } from "../../src/protocol/capabilities.js";
import type { JsonObject, JsonValue } from "../../src/protocol/types.js";
import type { SessionInfo, Unsubscribe } from "../../src/protocol/wire.js";
import type { CallOptions } from "../../src/bridge/rpc-types.js";
import type { ConnectionState } from "../../src/plugin/types.js";
import { makeSession } from "../fixtures/session.js";

type Entry = { kind: "directory" } | { kind: "file"; data: Uint8Array };
type Transfer = { direction: "read" | "write"; path: string; data: Uint8Array; offset: number; size: number; mode?: string };
type Intercept = (params: JsonObject, perform: () => JsonValue) => JsonValue | Promise<JsonValue>;
function failure(code: string) { return Object.assign(new Error(`Fixture failure: ${code}`), { code }); }

/** In-memory test backend only. No OS filesystem or production permission claims. */
export function createMemoryFsProvider(options: { files?: Record<string, Uint8Array | string>; limits?: Partial<SessionInfo["limits"]>; available?: boolean } = {}) {
  const entries = new Map<string, Entry>([["/data", { kind: "directory" }], ["/app", { kind: "directory" }], ["/mounts/grant", { kind: "directory" }]]);
  const transfers = new Map<string, Transfer>();
  const observers = new Set<(state: ConnectionState) => void>();
  const hooks = new Map<string, Intercept[]>();
  const calls: Array<{ method: string; params: JsonObject }> = [];
  const info = makeSession().info as SessionInfo;
  info.capabilities = options.available === false ? {} : { "aplg.fs": { version: "1.0.0", methods: [...standardCapabilities["aplg.fs"].methods] } };
  Object.assign(info.limits, options.limits);
  let connected: ConnectionState = "connected"; let next = 0; let maxTransfers = 0;
  const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
  function get(path: string) { const entry = entries.get(path); if (!entry) throw failure("ENOENT"); return entry; }
  function directory(path: string) { if (get(path).kind !== "directory") throw failure("ENOTDIR"); }
  function writable(path: string) { if (path === "/app" || path.startsWith("/app/")) throw failure("EACCES"); }
  function put(path: string, data: Uint8Array) { writable(path); directory(parent(path)); entries.set(path, { kind: "file", data: data.slice() }); }
  for (const [path, value] of Object.entries(options.files ?? {})) {
    const parts = path.split("/").filter(Boolean); let at = "";
    for (const segment of parts.slice(0, -1)) { at += `/${segment}`; entries.set(at, { kind: "directory" }); }
    entries.set(path, { kind: "file", data: typeof value === "string" ? Buffer.from(value, "utf8") : value.slice() });
  }
  function transfer(handle: string) { const entry = transfers.get(handle); if (!entry) throw failure("EBADF"); return entry; }
  function perform(method: string, params: JsonObject): JsonValue {
    const path = params.path as string;
    if (method === "transfer.openRead") {
      const entry = get(path); if (entry.kind !== "file") throw failure("EISDIR");
      const handle = `handle-${++next}`;
      transfers.set(handle, { direction: "read", path, data: entry.data.slice(), size: entry.data.length, offset: 0 });
      maxTransfers = Math.max(maxTransfers, transfers.size); return { handle, size: entry.data.length };
    }
    if (method === "transfer.openWrite") {
      writable(path); directory(parent(path));
      const prior = entries.get(path); const mode = params.mode as string;
      if (prior?.kind === "directory") throw failure("EISDIR");
      if (mode.endsWith("x") && prior) throw failure("EEXIST");
      const handle = `handle-${++next}`; const size = params.size as number;
      transfers.set(handle, { direction: "write", path, data: new Uint8Array(size), size, mode, offset: 0 });
      maxTransfers = Math.max(maxTransfers, transfers.size); return { handle };
    }
    if (method === "transfer.abort") { transfers.delete(params.handle as string); return null; }
    if (method === "transfer.pull") {
      const entry = transfer(params.handle as string); const offset = params.offset as number; const length = params.length as number;
      if (entry.direction !== "read" || offset !== entry.offset || length < 1 || offset + length > entry.size) throw failure("EINVAL");
      entry.offset += length; return { offset, dataBase64: Buffer.from(entry.data.subarray(offset, offset + length)).toString("base64") };
    }
    if (method === "transfer.push") {
      const entry = transfer(params.handle as string); const offset = params.offset as number; const bytes = Buffer.from(params.dataBase64 as string, "base64");
      if (entry.direction !== "write" || offset !== entry.offset || offset + bytes.length > entry.size) throw failure("EINVAL");
      entry.data.set(bytes, offset); entry.offset += bytes.length; return { written: bytes.length };
    }
    if (method === "transfer.finish") {
      const handle = params.handle as string; const entry = transfer(handle);
      if (entry.offset !== entry.size) throw failure("EINVAL");
      if (entry.direction === "write") {
        const prior = entries.get(entry.path);
        if (entry.mode!.endsWith("x") && prior) throw failure("EEXIST");
        if (entry.mode!.startsWith("a") && prior?.kind === "file") put(entry.path, Buffer.concat([prior.data, entry.data]));
        else put(entry.path, entry.data);
      }
      transfers.delete(handle); return null;
    }
    if (method === "stat") { const entry = get(path); return { kind: entry.kind, size: entry.kind === "file" ? entry.data.length : 0, mtimeMs: -1000 }; }
    if (method === "readdir") {
      directory(path);
      return [...entries.entries()].filter(([name]) => parent(name) === path).map(([name, entry]) => ({ name: name.slice(path.length + 1), kind: entry.kind }));
    }
    if (method === "mkdir") {
      writable(path);
      const existing = entries.get(path);
      if (existing) { if (existing.kind === "file" || !params.recursive) throw failure("EEXIST"); return { createdPath: null }; }
      if (!params.recursive) { directory(parent(path)); entries.set(path, { kind: "directory" }); return { createdPath: null }; }
      let current = ""; let created: string | null = null;
      for (const segment of path.split("/").filter(Boolean)) {
        current += `/${segment}`;
        const entry = entries.get(current);
        if (entry && entry.kind !== "directory") throw failure("ENOTDIR");
        if (!entry) { entries.set(current, { kind: "directory" }); created ??= current; }
      }
      return { createdPath: created };
    }
    if (method === "copyFile" || method === "rename") {
      const from = params.from as string; const to = params.to as string; writable(to); directory(parent(to)); const entry = get(from);
      if (entry.kind !== "file") throw failure("EISDIR");
      put(to, entry.data); if (method === "rename") { writable(from); entries.delete(from); } return null;
    }
    if (method === "rm") {
      writable(path); const entry = entries.get(path);
      if (!entry) { if (params.force) return null; throw failure("ENOENT"); }
      if (entry.kind === "directory" && !params.recursive) throw failure("EISDIR");
      for (const name of [...entries.keys()]) if (name === path || name.startsWith(path + "/")) entries.delete(name);
      return null;
    }
    throw failure("ENOSYS");
  }
  const provider = {
    async call<T extends JsonValue>(capability: string, method: string, value: JsonValue = null, _options?: CallOptions): Promise<T> {
      if (capability !== "aplg.fs") throw failure("E_CAPABILITY_UNAVAILABLE");
      if (connected === "closed") throw failure("E_SESSION_CLOSED");
      if (connected === "disconnected") throw failure("E_HOST_UNAVAILABLE");
      const params = value as JsonObject; calls.push({ method, params: structuredClone(params) });
      const hook = hooks.get(method)?.shift();
      return (hook ? await hook(params, () => perform(method, params)) : perform(method, params)) as T;
    },
    async session(): Promise<SessionInfo> {
      if (connected !== "connected") throw failure(connected === "closed" ? "E_SESSION_CLOSED" : "E_HOST_UNAVAILABLE");
      return info;
    },
    onConnectionChange(callback: (state: ConnectionState) => void): Unsubscribe {
      if (connected === "closed") { callback("closed"); return () => {}; }
      observers.add(callback); return () => { observers.delete(callback); };
    },
    setState(state: ConnectionState) {
      connected = state;
      if (state !== "connected") transfers.clear();
      for (const observer of [...observers]) observer(state);
    },
    interceptNext(method: string, callback: Intercept) { const list = hooks.get(method) ?? []; list.push(callback); hooks.set(method, list); },
    failNext(method: string, code: string) { provider.interceptNext(method, () => { throw failure(code); }); },
    readCommitted(path: string) { const entry = entries.get(path); return entry?.kind === "file" ? entry.data.slice() : undefined; },
    activeTransfers() { return transfers.size; },
    maxTransfers() { return maxTransfers; },
    observerCount() { return observers.size; },
    calls,
  };
  return provider;
}
