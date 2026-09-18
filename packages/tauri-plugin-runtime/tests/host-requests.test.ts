import { afterEach, expect, test, vi } from "vitest";
import { createSessionRequests } from "../src/host/requests.js";
import { AplgError } from "../src/protocol/errors.js";
import type { HostOperation, HostTransport } from "../src/protocol/wire.js";
import type { JsonObject, JsonValue } from "../src/protocol/types.js";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const managers: ReturnType<typeof createSessionRequests>[] = [];
afterEach(() => { managers.splice(0).forEach((manager) => manager.abortAll(new AplgError("E_SESSION_CLOSED", "closed"))); vi.useRealTimers(); });
function setup(call: (operation: HostOperation, args: JsonObject) => Promise<unknown>, timeoutMs = 30_000) {
  const transport = { call, async subscribe() { return () => {}; } } as HostTransport;
  const manager = createSessionRequests({ transport, sessionId: "trusted-session", timeoutMs }); managers.push(manager); return manager;
}

test("host request context cannot be supplied by plugin data", async () => {
  const received: JsonObject[] = [];
  const manager = setup(async (_operation, args) => { received.push(args); return "ok"; });
  expect(await manager.run("capability.call", { capability: "example.echo", method: "echo", params: null })).toBe("ok");
  expect(received[0]).toMatchObject({ sessionId: "trusted-session", capability: "example.echo", method: "echo" });
  expect(typeof received[0].requestId).toBe("string");
  await expect(manager.run("capability.call", { sessionId: "victim", capability: "example.echo", method: "echo", params: null })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(received).toHaveLength(1);
});

test("aborting an active call sends cancellation for its own backend request only", async () => {
  const waiting = deferred<JsonValue>(); const started = deferred<JsonObject>(); const cancelled = deferred<JsonObject>();
  const manager = setup(async (operation, args) => {
    if (operation === "request.cancel") { cancelled.resolve(args); return null; }
    started.resolve(args); return waiting.promise;
  });
  const controller = new AbortController();
  const response = manager.run("capability.call", { capability: "example.wait", method: "wait", params: null }, controller.signal);
  const rejected = expect(response).rejects.toMatchObject({ code: "E_CANCELLED" });
  const request = await started.promise; controller.abort(); await rejected;
  expect(await cancelled.promise).toEqual({ sessionId: "trusted-session", requestId: request.requestId });
  waiting.resolve("too late");
});

test("timeouts cancel but do not retry side-effecting backend calls", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const called: HostOperation[] = [];
  const manager = setup(async (operation) => { called.push(operation); if (operation === "request.cancel") return null; return new Promise(() => {}); }, 100);
  const response = manager.run("capability.call", { capability: "aplg.storage", method: "set", params: { key: "a", value: 1 } });
  const rejected = expect(response).rejects.toMatchObject({ code: "E_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(100); await rejected;
  expect(called).toEqual(["capability.call", "request.cancel"]);
});

test("late subscription replies are released after local cancellation", async () => {
  const waiting = deferred<JsonValue>(); const released = deferred<string>();
  const manager = setup(async (operation) => operation === "subscription.open" ? waiting.promise : null);
  const controller = new AbortController();
  const response = manager.run("subscription.open", { capability: "example.feed", topic: "changed" }, controller.signal, (result) => { released.resolve((result as { subscriptionId: string }).subscriptionId); });
  const rejected = expect(response).rejects.toMatchObject({ code: "E_CANCELLED" });
  await Promise.resolve(); controller.abort(); await rejected;
  waiting.resolve({ subscriptionId: "late-subscription" });
  expect(await released.promise).toBe("late-subscription");
});
