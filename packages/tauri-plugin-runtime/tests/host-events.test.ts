import { afterEach, expect, test } from "vitest";
import { createEventRouter } from "../src/host/event-router.js";
import { createSessionRequests } from "../src/host/requests.js";
import type { HostTransport } from "../src/protocol/wire.js";
import type { HostEvent } from "../src/protocol/generated/types.generated.js";
import type { JsonObject, JsonValue } from "../src/protocol/types.js";
import type { PortEvent } from "../src/bridge/rpc-types.js";

const routers: ReturnType<typeof createEventRouter>[] = [];
afterEach(async () => { await Promise.all(routers.splice(0).map((router) => router.dispose())); });
function setup(early = false) {
  let nextId = 0; const closed: string[] = []; const events: PortEvent[] = [];
  let router!: ReturnType<typeof createEventRouter>;
  const transport = {
    async call(operation: string, args: JsonObject) {
      if (operation === "subscription.open") {
        const id = `backend-${++nextId}`;
        if (early) router.accept({ kind: "capability.event", sessionId: "session-a", subscriptionId: id, seq: 1, payload: "early" });
        return { subscriptionId: id };
      }
      if (operation === "subscription.close") closed.push(args.subscriptionId as string);
      return null;
    },
    async subscribe() { return () => {}; },
  } as HostTransport;
  const requests = createSessionRequests({ transport, sessionId: "session-a", timeoutMs: 1000 });
  router = createEventRouter({ transport, requests, sessionId: "session-a", timeoutMs: 1000, send: (event) => events.push(event) });
  routers.push(router);
  const emit = (subscriptionId: string, seq: number, payload: JsonValue, sessionId = "session-a") => router.accept({ kind: "capability.event", sessionId, subscriptionId, seq, payload });
  return { router, events, closed, emit };
}

test("early backend events are delivered using a host-owned logical id", async () => {
  const { router, events } = setup(true);
  const id = await router.open("example.feed", "changed");
  expect(id).not.toBe("backend-1");
  expect(events).toContainEqual({ protocol: "aplg/1", kind: "event", subscriptionId: id, seq: 1, payload: "early" });
});

test("foreign sessions and duplicated sequence numbers are never delivered", async () => {
  const { router, events, emit } = setup(); await router.open("example.feed", "changed");
  emit("backend-1", 1, "foreign", "session-b"); emit("unknown", 1, "unknown");
  emit("backend-1", 1, "first"); emit("backend-1", 1, "duplicate");
  expect(events.filter((event) => event.kind === "event").map((event) => event.payload)).toEqual(["first"]);
});

test("reconnect keeps logical ids and monotonic sequence while replacing backend ids", async () => {
  const { router, events, emit, closed } = setup(); const id = await router.open("example.feed", "changed");
  emit("backend-1", 1, "first"); await router.setConnected(false); await router.setConnected(true);
  emit("backend-1", 2, "stale"); emit("backend-2", 1, "second");
  expect(events.filter((event) => event.kind === "event")).toEqual([
    { protocol: "aplg/1", kind: "event", subscriptionId: id, seq: 1, payload: "first" },
    { protocol: "aplg/1", kind: "event", subscriptionId: id, seq: 2, payload: "second" },
  ]);
  await router.close(id);
  expect(closed).toContain("backend-2");
  await expect(router.close("someone-else")).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
});

test("events received while disconnected never simulate successful reconnection", async () => {
  const { router, events, emit } = setup(); await router.open("example.feed", "changed");
  await router.setConnected(false); emit("backend-1", 9, "offline");
  expect(router.isConnected()).toBe(false);
  expect(events.filter((event) => event.kind === "event")).toEqual([]);
});

test("closing a subscription during restoration does not fail the entire connection", async () => {
  let count = 0; let resolveRestore!: (value: JsonValue) => void;
  const released: string[] = [];
  const transport = {
    async call(operation: string, args: JsonObject) {
      if (operation === "subscription.open") {
        if (++count === 1) return { subscriptionId: "initial" };
        return new Promise<JsonValue>((resolve) => { resolveRestore = resolve; });
      }
      if (operation === "subscription.close") released.push(args.subscriptionId as string);
      return null;
    }, async subscribe() { return () => {}; },
  } as HostTransport;
  const requests = createSessionRequests({ transport, sessionId: "s", timeoutMs: 1000 });
  const router = createEventRouter({ transport, requests, sessionId: "s", timeoutMs: 1000, send() {} }); routers.push(router);
  const logical = await router.open("example.feed", "changed"); await router.setConnected(false);
  const reconnect = router.setConnected(true);
  await Promise.resolve(); await Promise.resolve();
  await router.close(logical);
  resolveRestore({ subscriptionId: "restored-but-removed" });
  await expect(reconnect).resolves.toBeUndefined();
  expect(router.isConnected()).toBe(true);
  await Promise.resolve(); await Promise.resolve();
  expect(released).toContain("restored-but-removed");
});

test("an obsolete reconnect failure cannot tear down a newer connection generation", async () => {
  let count = 0; let resolveStale!: (value: JsonValue) => void;
  const transport = {
    async call(operation: string) {
      if (operation !== "subscription.open") return null;
      if (++count === 2) return new Promise<JsonValue>((resolve) => { resolveStale = resolve; });
      return { subscriptionId: `backend-${count}` };
    }, async subscribe() { return () => {}; },
  } as HostTransport;
  const requests = createSessionRequests({ transport, sessionId: "s", timeoutMs: 1000 });
  const router = createEventRouter({ transport, requests, sessionId: "s", timeoutMs: 1000, send() {} }); routers.push(router);
  await router.open("example.feed", "changed"); await router.setConnected(false);
  const stale = router.setConnected(true); const staleResult = expect(stale).resolves.toBeUndefined();
  await Promise.resolve(); await Promise.resolve();
  await router.setConnected(false);
  await router.setConnected(true);
  resolveStale({ subscriptionId: "stale-backend" });
  await staleResult;
  expect(router.isConnected()).toBe(true);
});

test("incoming burst buffering is bounded while a backend subscription is opening", async () => {
  let resolveOpen!: (value: JsonValue) => void; const sent: PortEvent[] = [];
  const transport = {
    async call(operation: string) { return operation === "subscription.open" ? new Promise<JsonValue>((resolve) => { resolveOpen = resolve; }) : null; },
    async subscribe() { return () => {}; },
  } as HostTransport;
  const requests = createSessionRequests({ transport, sessionId: "s", timeoutMs: 1000 });
  const router = createEventRouter({ transport, requests, sessionId: "s", timeoutMs: 1000, send: (event) => sent.push(event) }); routers.push(router);
  const opening = router.open("example.feed", "changed"); await Promise.resolve(); await Promise.resolve();
  for (let seq = 1; seq <= 40; seq++) router.accept({ kind: "capability.event", sessionId: "s", subscriptionId: "burst", seq, payload: seq });
  resolveOpen({ subscriptionId: "burst" }); await opening;
  expect(sent.filter((event) => event.kind === "event")).toHaveLength(32);
});

test("dispose is idempotent and releases each backend subscription once", async () => {
  const { router, closed } = setup(); await router.open("example.feed", "changed");
  await Promise.all([router.dispose(), router.dispose()]);
  expect(closed).toEqual(["backend-1"]);
  await expect(router.open("example.feed", "changed")).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
});
