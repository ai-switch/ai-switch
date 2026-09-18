import { TextDecoder, TextEncoder } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { createTestHost } from "../src/testing/index.js";
import type { HostEvent, JsonObject, JsonValue, SessionDescriptor } from "@ai-switch/tauri-plugin-runtime/protocol";
import { validManifest } from "./support/test-host-fixture.js";

const assetUrl = "http://127.0.0.1:43272/plugin/index.html";
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const hosts: ReturnType<typeof createTestHost>[] = [];

afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.dispose())); });
async function open(host: ReturnType<typeof createTestHost>, pluginId = "io.github.example.notes") {
  return host.transport.call<SessionDescriptor>("session.open", { pluginId });
}
async function call(host: ReturnType<typeof createTestHost>, sessionId: string, capability: string, method: string, params: JsonValue) {
  return host.transport.call<JsonValue>("capability.call", { sessionId, capability, method, params: params as JsonObject });
}

describe("createTestHost", () => {
  test("does not advertise memory filesystem unless memoryFiles is explicit", async () => {
    const host = createTestHost({ manifest: validManifest({ requires: {} }), assetUrl }); hosts.push(host);
    const session = await open(host);
    expect(session.info.capabilities["aplg.storage"]).toBeUndefined();
    expect(session.info.capabilities["aplg.fs"]).toBeUndefined();
    await host.dispose();
    expect(host.activeSessionIds()).toEqual([]);
  });

  test("intersects declared storage with the manifest and shares snapshots by plugin id", async () => {
    const host = createTestHost({ manifest: validManifest(), assetUrl, initialStorage: { greeting: { text: "hello" } } }); hosts.push(host);
    const first = await open(host); const second = await open(host);
    expect(first.info.capabilities["aplg.storage"].methods).toEqual(["get", "set", "remove"]);
    const value = { text: "changed" };
    await call(host, first.sessionId, "aplg.storage", "set", { key: "shared", value });
    value.text = "mutated after call";
    expect(await call(host, second.sessionId, "aplg.storage", "get", { key: "shared" })).toEqual({ text: "changed" });
    expect(await call(host, first.sessionId, "aplg.storage", "get", { key: "greeting" })).toEqual({ text: "hello" });
    await host.transport.call("session.close", { sessionId: first.sessionId });
    expect(host.activeSessionIds()).toEqual([second.sessionId]);
    await host.dispose();
    expect(host.activeSessionIds()).toEqual([]);
  });

  test("only explicitly declared memory files expose the standard filesystem contract", async () => {
    const manifest = validManifest({ requires: { "aplg.fs": "^1.0.0" }, permissions: { filesystem: [{ root: "plugin-data", access: ["read", "write"] }], network: [], native: false } });
    const host = createTestHost({ manifest, assetUrl, memoryFiles: { "/data/note.txt": encoder.encode("hello") } }); hosts.push(host);
    const session = await open(host);
    expect(session.info.capabilities["aplg.fs"].methods).toEqual(expect.arrayContaining(["stat", "readdir", "transfer.openRead", "transfer.openWrite", "transfer.pull", "transfer.push", "transfer.finish", "transfer.abort"]));
    const stat = await call(host, session.sessionId, "aplg.fs", "stat", { path: "/data/note.txt" });
    expect(stat).toMatchObject({ kind: "file", size: 5 });
    const listed = await call(host, session.sessionId, "aplg.fs", "readdir", { path: "/data" });
    expect(listed).toEqual([{ name: "note.txt", kind: "file" }]);
    const opened = await call(host, session.sessionId, "aplg.fs", "transfer.openRead", { path: "/data/note.txt" }) as { handle: string; size: number };
    const pulled = await call(host, session.sessionId, "aplg.fs", "transfer.pull", { handle: opened.handle, offset: 0, length: opened.size }) as { offset: number; dataBase64: string };
    expect(decoder.decode(Buffer.from(pulled.dataBase64, "base64"))).toBe("hello");
    await call(host, session.sessionId, "aplg.fs", "transfer.finish", { handle: opened.handle });
    const write = await call(host, session.sessionId, "aplg.fs", "transfer.openWrite", { path: "/data/new.txt", size: 3, mode: "w" }) as { handle: string };
    await call(host, session.sessionId, "aplg.fs", "transfer.push", { handle: write.handle, offset: 0, dataBase64: Buffer.from("new").toString("base64") });
    await call(host, session.sessionId, "aplg.fs", "transfer.finish", { handle: write.handle });
    expect(await call(host, session.sessionId, "aplg.fs", "stat", { path: "/data/new.txt" })).toMatchObject({ size: 3 });
  });

  test("file transfer handles and sessions cannot be used across owners", async () => {
    const manifest = validManifest({ requires: { "aplg.fs": "^1.0.0" }, permissions: { filesystem: [{ root: "plugin-data", access: ["read"] }], network: [], native: false } });
    const host = createTestHost({ manifest, assetUrl, memoryFiles: { "/data/note": encoder.encode("x") } }); hosts.push(host);
    const first = await open(host); const second = await open(host);
    const opened = await call(host, first.sessionId, "aplg.fs", "transfer.openRead", { path: "/data/note" }) as { handle: string; size: number };
    await expect(call(host, second.sessionId, "aplg.fs", "transfer.pull", { handle: opened.handle, offset: 0, length: 1 })).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
    await expect(call(host, first.sessionId, "aplg.fs", "transfer.pull", { handle: "foreign", offset: 0, length: 1 })).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
    await call(host, first.sessionId, "aplg.fs", "transfer.abort", { handle: opened.handle });
  });

  test("subscriptions emit only to matching session/capability/topic and reconnect gates calls", async () => {
    const manifest = validManifest();
    const host = createTestHost({ manifest, assetUrl }); hosts.push(host);
    const first = await open(host); const second = await open(host);
    const received: JsonValue[] = [];
    const remove = await host.transport.subscribe((event: HostEvent) => { if (event.kind === "capability.event") received.push(event.payload); });
    await host.transport.call("subscription.open", { sessionId: first.sessionId, capability: "aplg.storage", topic: "changed" });
    host.emit(first.sessionId, "aplg.storage", "changed", { value: 1 });
    host.emit(second.sessionId, "aplg.storage", "changed", { value: 2 });
    host.emit(first.sessionId, "aplg.storage", "other", { value: 3 });
    expect(received).toEqual([{ value: 1 }]);
    host.disconnect();
    await expect(call(host, first.sessionId, "aplg.storage", "get", { key: "missing" })).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
    host.reconnect();
    expect(host.activeSessionIds()).toEqual([first.sessionId, second.sessionId]);
    remove();
  });

  test("reconnect restores logical subscriptions and rejects the previous backend id", async () => {
    const manifest = validManifest();
    const host = createTestHost({ manifest, assetUrl }); hosts.push(host);
    const session = await open(host);
    const events: HostEvent[] = [];
    const remove = await host.transport.subscribe((event) => events.push(event));
    const first = await host.transport.call<{ subscriptionId: string }>("subscription.open", { sessionId: session.sessionId, capability: "aplg.storage", topic: "changed" });
    host.disconnect();
    host.reconnect();
    const second = await host.transport.call<{ subscriptionId: string }>("subscription.open", { sessionId: session.sessionId, capability: "aplg.storage", topic: "changed" });
    expect(second.subscriptionId).not.toBe(first.subscriptionId);
    await expect(host.transport.call("subscription.close", { sessionId: session.sessionId, subscriptionId: first.subscriptionId })).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
    host.emit(session.sessionId, "aplg.storage", "changed", { value: "after-reconnect" });
    expect(events.filter((event) => event.kind === "capability.event").map((event) => event.payload)).toEqual([{ value: "after-reconnect" }]);
    remove();
  });

  test("closing a session invalidates its transfer handles and session id", async () => {
    const manifest = validManifest({ requires: { "aplg.fs": "^1.0.0" }, permissions: { filesystem: [{ root: "plugin-data", access: ["read"] }], network: [], native: false } });
    const host = createTestHost({ manifest, assetUrl, memoryFiles: { "/data/note": encoder.encode("x") } }); hosts.push(host);
    const session = await open(host);
    const opened = await call(host, session.sessionId, "aplg.fs", "transfer.openRead", { path: "/data/note" }) as { handle: string; size: number };
    await host.transport.call("session.close", { sessionId: session.sessionId });
    await expect(call(host, session.sessionId, "aplg.fs", "transfer.pull", { handle: opened.handle, offset: 0, length: 1 })).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
  });

  test("disposing the host invalidates every session and transfer handle", async () => {
    const manifest = validManifest({ requires: { "aplg.fs": "^1.0.0" }, permissions: { filesystem: [{ root: "plugin-data", access: ["read"] }], network: [], native: false } });
    const host = createTestHost({ manifest, assetUrl, memoryFiles: { "/data/note": encoder.encode("x") } }); hosts.push(host);
    const session = await open(host);
    const opened = await call(host, session.sessionId, "aplg.fs", "transfer.openRead", { path: "/data/note" }) as { handle: string; size: number };
    await host.dispose();
    expect(host.activeSessionIds()).toEqual([]);
    await expect(call(host, session.sessionId, "aplg.fs", "transfer.pull", { handle: opened.handle, offset: 0, length: 1 })).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
    await expect(host.transport.call("session.open", { pluginId: manifest.id })).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
  });

  test("rejects undeclared capabilities, invalid sessions and malformed memory paths", async () => {
    const host = createTestHost({ manifest: validManifest(), assetUrl }); hosts.push(host);
    await expect(open(host, "io.github.other.plugin")).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
    const session = await open(host);
    await expect(call(host, session.sessionId, "aplg.fs", "stat", { path: "/data/a" })).rejects.toMatchObject({ code: "E_CAPABILITY_UNAVAILABLE" });
    await expect(host.transport.call("capability.call", { sessionId: "foreign", capability: "aplg.storage", method: "get", params: { key: "a" } })).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
    await expect(host.transport.call("capability.call", { sessionId: session.sessionId, capability: "aplg.storage", method: "get", params: { key: "" } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  });
});
