import { describe, expect, test } from "vitest";
import { createMemoryTransport } from "../../../examples/aplg-plain-host/src/memory-transport.js";
import { validateSessionDescriptor, type SessionDescriptor, type JsonValue } from "@ai-switch/tauri-plugin-runtime/protocol";

const asset = "http://127.0.0.1:43182/plugin/index.html";
const pluginId = "io.github.ai-switch.memory-notes";
async function open(backend: ReturnType<typeof createMemoryTransport>) {
  return backend.transport.call<SessionDescriptor>("session.open", { pluginId });
}
async function call(backend: ReturnType<typeof createMemoryTransport>, sessionId: string, method: string, params: object) {
  return backend.transport.call<JsonValue>("capability.call", { sessionId, capability: "aplg.storage", method, params: params as Record<string, JsonValue>, requestId: "test-request" });
}

describe("plain host's explicitly simulated storage transport", () => {
  test("opens a protocol-valid storage-only session without any OS/network permissions", async () => {
    const backend = createMemoryTransport(asset);
    const session = await open(backend);
    expect(validateSessionDescriptor(session).ok).toBe(true);
    expect(session.manifest.requires).toEqual({ "aplg.storage": "^1.0.0" });
    expect(session.manifest.permissions).toEqual({ filesystem: [], network: [], native: false });
    expect(Object.keys(session.info.capabilities)).toEqual(["aplg.storage"]);
    expect(session.assetUrl).toBe(asset);
  });

  test("storage values are snapshots isolated to each open view", async () => {
    const backend = createMemoryTransport(asset);
    const a = await open(backend); const b = await open(backend);
    const value = { text: "hello" };
    await call(backend, a.sessionId, "set", { key: "note", value }); value.text = "mutated";
    const first = await call(backend, a.sessionId, "get", { key: "note" }) as { text: string };
    expect(first).toEqual({ text: "hello" }); first.text = "returned mutation";
    expect(await call(backend, a.sessionId, "get", { key: "note" })).toEqual({ text: "hello" });
    expect(await call(backend, b.sessionId, "get", { key: "note" })).toBeNull();
    await call(backend, a.sessionId, "remove", { key: "note" });
    expect(await call(backend, a.sessionId, "get", { key: "note" })).toBeNull();
  });

  test("closing releases memory and listener cleanup is idempotent", async () => {
    const snapshots: unknown[] = [];
    const backend = createMemoryTransport(asset, (state) => snapshots.push(state));
    const remove = await backend.transport.subscribe(() => {});
    const a = await open(backend);
    await call(backend, a.sessionId, "set", { key: "note", value: "temporary" });
    expect(backend.snapshot()).toEqual({ sessions: 1, listeners: 1, entries: 1 });
    await backend.transport.call("session.close", { sessionId: a.sessionId }); remove(); remove();
    expect(backend.snapshot()).toEqual({ sessions: 0, listeners: 0, entries: 0 });
    expect(snapshots.at(-1)).toEqual(backend.snapshot());
    await expect(call(backend, a.sessionId, "get", { key: "note" })).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
    const b = await open(backend);
    expect(await call(backend, b.sessionId, "get", { key: "note" })).toBeNull();
  });

  test("rejects undeclared plugins, capabilities, methods and invalid payloads", async () => {
    const backend = createMemoryTransport(asset);
    await expect(backend.transport.call("session.open", { pluginId: "io.other.plugin" })).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
    const a = await open(backend);
    await expect(backend.transport.call("capability.call", { sessionId: a.sessionId, capability: "aplg.fs", method: "stat", params: { path: "/data/a" } })).rejects.toMatchObject({ code: "E_CAPABILITY_UNAVAILABLE" });
    await expect(call(backend, a.sessionId, "clear", {})).rejects.toMatchObject({ code: "E_CAPABILITY_UNAVAILABLE" });
    await expect(call(backend, a.sessionId, "set", { key: "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(backend.transport.call("subscription.open", { sessionId: a.sessionId })).rejects.toMatchObject({ code: "E_CAPABILITY_UNAVAILABLE" });
  });

  test("caps in-memory demo data instead of accepting unbounded writes", async () => {
    const backend = createMemoryTransport(asset); const a = await open(backend);
    await expect(call(backend, a.sessionId, "set", { key: "large", value: "x".repeat(65536) })).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
    expect(backend.snapshot().entries).toBe(0);
    for (let i = 0; i < 32; i++) await call(backend, a.sessionId, "set", { key: `note-${i}`, value: "a" });
    await expect(call(backend, a.sessionId, "set", { key: "one-more", value: "a" })).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  });
});
