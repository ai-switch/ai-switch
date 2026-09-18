import { afterEach, expect, test } from "vitest";
import { createRpcPeer, type RpcPeer } from "../src/bridge/rpc-peer.js";
import { createPluginClient } from "../src/plugin/client.js";
import { makeSession } from "./fixtures/session.js";
import type { JsonValue } from "../src/protocol/types.js";

const peers: RpcPeer[] = [];
afterEach(() => peers.splice(0).forEach((peer) => peer.close()));
function setup() {
  const channel = new MessageChannel(); const plugin = createRpcPeer(channel.port1); const host = createRpcPeer(channel.port2); peers.push(plugin, host);
  const info = makeSession().info;
  info.capabilities = {
    "aplg.storage": { version: "1.0.0", methods: ["get", "set", "remove"] },
    "aplg.dialog": { version: "1.0.0", methods: ["pickDirectory"] },
    "example.feed": { version: "2.0.0", methods: ["echo"] },
  };
  return { plugin, host, info };
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("storage wrappers roundtrip JSON through the standard capability", async () => {
  const { plugin, host, info } = setup(); const state = new Map<string, JsonValue>();
  host.onRequest(async (request) => {
    if (request.operation !== "capability.call" || request.args.capability !== "aplg.storage") throw new Error("Wrong routing");
    const params = request.args.params as { key: string; value?: JsonValue };
    if (request.args.method === "set") { state.set(params.key, params.value!); return null; }
    if (request.args.method === "remove") { state.delete(params.key); return null; }
    return state.get(params.key) ?? null;
  });
  const client = createPluginClient(plugin, info);
  await client.storage.set("note", { text: "hello" });
  expect(await client.storage.get("note")).toEqual({ text: "hello" });
  await client.storage.remove("note"); expect(await client.storage.get("note")).toBeNull();
  expect(client.capabilities.supports("example.feed", "^2.0.0")).toBe(true);
  expect(client.capabilities.supports("example.feed", "^3.0.0")).toBe(false);
});

test("capability and method checks happen before a request is dispatched", async () => {
  const { plugin, host, info } = setup(); let calls = 0; host.onRequest(async () => { calls++; return "ok"; });
  const client = createPluginClient(plugin, info);
  await expect(client.call("aplg.fs", "stat", { path: "/data/a" })).rejects.toMatchObject({ code: "E_CAPABILITY_UNAVAILABLE" });
  await expect(client.call("example.feed", "exec", null)).rejects.toMatchObject({ code: "E_CAPABILITY_UNAVAILABLE" });
  await expect(client.storage.get("" )).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toBe(0);
  expect(await client.call("example.feed", "echo", "hello")).toBe("ok"); expect(calls).toBe(1);
});

test("ready snapshots cannot be mutated into additional permissions", async () => {
  const { plugin, host, info } = setup(); host.onRequest(async () => null);
  const client = createPluginClient(plugin, info); const ready = await client.ready();
  expect(Object.isFrozen(ready)).toBe(true); expect(Object.isFrozen(ready.capabilities["aplg.storage"].methods)).toBe(true);
  info.capabilities["aplg.fs"] = { version: "1.0.0", methods: ["stat"] };
  expect(client.capabilities.supports("aplg.fs")).toBe(false);
  expect((ready as unknown as Record<string, unknown>).sessionId).toBeUndefined();
});

test("dialog results cannot return host filesystem paths", async () => {
  const { plugin, host, info } = setup(); host.onRequest(async () => ({ path: "C:/secret", access: "read" }));
  const client = createPluginClient(plugin, info);
  await expect(client.dialog.pickDirectory()).rejects.toMatchObject({ code: "E_INVALID_MESSAGE" });
});

test("an event arriving before subscription reply is delivered once in order", async () => {
  const { plugin, host, info } = setup(); const seen: JsonValue[] = []; const closed = deferred<void>();
  host.onRequest(async (request) => {
    if (request.operation === "subscription.open") {
      host.sendEvent({ protocol: "aplg/1", kind: "event", subscriptionId: "logical-1", seq: 1, payload: "early" });
      return { subscriptionId: "logical-1" };
    }
    if (request.operation === "subscription.close") { closed.resolve(); return null; }
    return "barrier";
  });
  const client = createPluginClient(plugin, info);
  const remove = await client.subscribe("example.feed", "changed", (value) => { seen.push(value); });
  expect(seen).toEqual(["early"]);
  host.sendEvent({ protocol: "aplg/1", kind: "event", subscriptionId: "logical-1", seq: 1, payload: "duplicate" });
  host.sendEvent({ protocol: "aplg/1", kind: "event", subscriptionId: "logical-1", seq: 2, payload: "next" });
  await client.call("example.feed", "echo"); expect(seen).toEqual(["early", "next"]);
  remove(); remove(); await closed.promise;
  host.sendEvent({ protocol: "aplg/1", kind: "event", subscriptionId: "logical-1", seq: 3, payload: "removed" });
  await client.call("example.feed", "echo"); expect(seen).toEqual(["early", "next"]);
});

test("disconnect rejects calls without replay and reconnect restores readiness", async () => {
  const { plugin, host, info } = setup(); let calls = 0; host.onRequest(async () => { calls++; return null; });
  const client = createPluginClient(plugin, info); const offline = deferred<void>(); const online = deferred<void>(); const states: string[] = [];
  client.onConnectionChange((state) => { states.push(state); if (state === "disconnected") offline.resolve(); if (state === "connected") online.resolve(); });
  host.sendEvent({ protocol: "aplg/1", kind: "connection", state: "disconnected" }); await offline.promise;
  await expect(client.call("example.feed", "echo")).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
  expect(calls).toBe(0);
  host.sendEvent({ protocol: "aplg/1", kind: "connection", state: "connected" }); await online.promise;
  await client.call("example.feed", "echo"); expect(calls).toBe(1); expect(states).toEqual(["disconnected", "connected"]);
});

test("closed peers invalidate capability discovery and pending operations", async () => {
  const { plugin, host, info } = setup(); const client = createPluginClient(plugin, info); const closed = deferred<void>();
  client.onConnectionChange((state) => { if (state === "closed") closed.resolve(); }); host.close(); await closed.promise;
  expect(client.capabilities.supports("aplg.storage")).toBe(false);
  await expect(client.ready()).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
  await expect(client.storage.get("note")).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
});

test("disconnected events cannot silently restore a connected state", async () => {
  const { plugin, host, info } = setup(); const client = createPluginClient(plugin, info); const seen: JsonValue[] = []; const offline = deferred<void>(); const barrier = deferred<void>();
  host.onRequest(async (request) => request.operation === "subscription.open" ? { subscriptionId: "logical-1" } : "barrier");
  await client.subscribe("example.feed", "changed", (payload) => seen.push(payload));
  client.onConnectionChange((state) => { if (state === "disconnected") offline.resolve(); });
  const remove = plugin.onEvent((event) => { if (event.kind === "event" && event.seq === 3) barrier.resolve(); });
  host.sendEvent({ protocol: "aplg/1", kind: "connection", state: "disconnected" }); await offline.promise;
  host.sendEvent({ protocol: "aplg/1", kind: "event", subscriptionId: "logical-1", seq: 3, payload: "stale" }); await barrier.promise; remove();
  await expect(client.ready()).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
  expect(seen).toEqual([]);
});

test("directory options reject unsupported fields rather than ignoring them", async () => {
  const { plugin, host, info } = setup(); let calls = 0; host.onRequest(async () => { calls++; return null; });
  const client = createPluginClient(plugin, info);
  await expect(client.dialog.pickDirectory({ access: "read", silentGrant: true } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toBe(0);
});

test("session loss while subscribe is pending closes the late subscription", async () => {
  const { plugin, host, info } = setup();
  const reply = deferred<JsonValue>(); const started = deferred<void>(); const offline = deferred<void>(); const released = deferred<void>();
  host.onRequest(async (request) => {
    if (request.operation === "subscription.open") { started.resolve(); return reply.promise; }
    if (request.operation === "subscription.close") { released.resolve(); return null; }
    return null;
  });
  const client = createPluginClient(plugin, info);
  client.onConnectionChange((state) => { if (state === "disconnected") offline.resolve(); });
  const subscribing = client.subscribe("example.feed", "changed", () => {});
  const rejected = expect(subscribing).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
  await started.promise;
  host.sendEvent({ protocol: "aplg/1", kind: "connection", state: "disconnected" }); await offline.promise;
  reply.resolve({ subscriptionId: "late-1" });
  await rejected; await released.promise;
});
