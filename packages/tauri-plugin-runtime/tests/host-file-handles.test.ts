import { expect, test, vi, afterEach } from "vitest";
import { createFileHandleGuard } from "../src/host/file-handles.js";
import { createSessionRequests } from "../src/host/requests.js";
import type { HostTransport } from "../src/protocol/wire.js";
import type { JsonObject, JsonValue } from "../src/protocol/types.js";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
afterEach(() => vi.useRealTimers());
function fixture(invoke: (method: string, params: JsonObject) => Promise<JsonValue>, maxTransfers = 2) {
  const calls: Array<{ method: string; params: JsonObject; sessionId: string }> = [];
  const transport = {
    async call(operation: string, args: JsonObject) {
      if (operation !== "capability.call") return null;
      calls.push({ method: args.method as string, params: args.params as JsonObject, sessionId: args.sessionId as string });
      return invoke(args.method as string, args.params as JsonObject);
    }, async subscribe() { return () => {}; },
  } as HostTransport;
  const requests = createSessionRequests({ transport, sessionId: "owned-session", timeoutMs: 100 });
  return { calls, guard: createFileHandleGuard({ transport, requests, sessionId: "owned-session", timeoutMs: 100, maxTransfers }) };
}

test("host timeout releases a late file handle using the bound session", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const late = deferred<JsonValue>();
  const { guard, calls } = fixture(async (method) => method === "transfer.openWrite" ? late.promise : null);
  const pending = guard.call("transfer.openWrite", { path: "/data/a", size: 1, mode: "w" }, new AbortController().signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: "E_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(100); await rejected;
  late.resolve({ handle: "late" }); await vi.advanceTimersByTimeAsync(1);
  expect(calls).toContainEqual({ method: "transfer.abort", params: { handle: "late" }, sessionId: "owned-session" });
  await guard.dispose();
});

test("duplicate handles never abort the currently owned transfer", async () => {
  const { guard, calls } = fixture(async (method) => method.startsWith("transfer.open") ? { handle: "active" } : null);
  const signal = new AbortController().signal;
  await guard.call("transfer.openWrite", { path: "/data/a", size: 1, mode: "w" }, signal);
  await expect(guard.call("transfer.openWrite", { path: "/data/b", size: 1, mode: "w" }, signal)).rejects.toMatchObject({ code: "E_INVALID_MESSAGE" });
  expect(calls.filter((entry) => entry.method === "transfer.abort")).toHaveLength(0);
  await guard.dispose();
  expect(calls.filter((entry) => entry.method === "transfer.abort")).toHaveLength(1);
});

test("malformed opens with a fresh handle are released before exposing invalid data", async () => {
  const { guard, calls } = fixture(async (method) => method === "transfer.openRead" ? { handle: "invalid-read", size: -1 } : null);
  await expect(guard.call("transfer.openRead", { path: "/data/a" }, new AbortController().signal)).rejects.toMatchObject({ code: "E_INVALID_MESSAGE" });
  await Promise.resolve(); await Promise.resolve();
  expect(calls.some((entry) => entry.method === "transfer.abort")).toBe(true);
  await guard.dispose();
});

test("successful finish frees the host reservation but an arbitrary handle is rejected", async () => {
  const { guard } = fixture(async (method) => method === "transfer.openWrite" ? { handle: "one" } : null, 1);
  const signal = new AbortController().signal;
  await guard.call("transfer.openWrite", { path: "/data/a", size: 0, mode: "w" }, signal);
  await expect(guard.call("transfer.openWrite", { path: "/data/b", size: 0, mode: "w" }, signal)).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  await guard.call("transfer.finish", { handle: "one" }, signal);
  await expect(guard.call("transfer.abort", { handle: "not-owned" }, signal)).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
  await guard.call("transfer.openWrite", { path: "/data/b", size: 0, mode: "w" }, signal);
  await guard.dispose();
});

test("an already-aborted open cannot consume a host transfer reservation", async () => {
  const { guard, calls } = fixture(async (method) => method === "transfer.openWrite" ? { handle: "one" } : null, 1);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(guard.call("transfer.openWrite", { path: "/data/a", size: 0, mode: "w" }, cancelled.signal)).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(calls).toHaveLength(0);
  await guard.call("transfer.openWrite", { path: "/data/b", size: 0, mode: "w" }, new AbortController().signal);
  await guard.dispose();
});

test("restoration fails closed when an interrupted open has no confirmed handle", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { guard } = fixture(async (method) => method === "transfer.openWrite" ? new Promise(() => {}) : null);
  const response = guard.call("transfer.openWrite", { path: "/data/a", size: 1, mode: "w" }, new AbortController().signal);
  const rejected = expect(response).rejects.toMatchObject({ code: "E_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(100); await rejected;
  await expect(guard.restore()).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
  await guard.dispose();
});

test("restoration retains unconfirmed reservations rather than allowing more backend handles", async () => {
  const { guard } = fixture(async (method) => {
    if (method === "transfer.openWrite") return { handle: "reserved" };
    if (method === "transfer.abort") throw new Error("offline");
    return null;
  }, 1);
  await guard.call("transfer.openWrite", { path: "/data/a", size: 0, mode: "w" }, new AbortController().signal);
  await expect(guard.restore()).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
  await expect(guard.call("transfer.openWrite", { path: "/data/b", size: 0, mode: "w" }, new AbortController().signal)).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  await guard.dispose();
});
