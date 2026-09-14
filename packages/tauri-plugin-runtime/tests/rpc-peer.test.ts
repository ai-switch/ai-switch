import { afterEach, expect, test, vi } from "vitest";
import { AplgError } from "../src/protocol/errors.js";
import type { JsonValue } from "../src/protocol/types.js";
import { createRpcPeer, type RpcPeer } from "../src/bridge/rpc-peer.js";

const peers: RpcPeer[] = [];
const ports: MessagePort[] = [];
afterEach(() => {
  peers.splice(0).forEach((peer) => peer.close());
  ports.splice(0).forEach((port) => port.close());
  vi.useRealTimers();
});
function pair(options?: Parameters<typeof createRpcPeer>[1]) {
  const channel = new MessageChannel();
  const left = createRpcPeer(channel.port1, options);
  const right = createRpcPeer(channel.port2, options);
  peers.push(left, right);
  return { left, right };
}
function rawPair(options?: Parameters<typeof createRpcPeer>[1]) {
  const channel = new MessageChannel();
  const peer = createRpcPeer(channel.port1, options);
  peers.push(peer); ports.push(channel.port2); channel.port2.start();
  return { peer, port: channel.port2 };
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const args = (params: JsonValue = null) => ({ capability: "example.echo", method: "echo", params });
function nextRequest(port: MessagePort) {
  return new Promise<{ id: string; args: Record<string, unknown> }>((resolve) => {
    const handle = (event: MessageEvent) => {
      const message = JSON.parse(event.data as string);
      if (message.kind === "request" && message.operation !== "request.cancel") {
        port.removeEventListener("message", handle);
        resolve(message);
      }
    };
    port.addEventListener("message", handle);
  });
}

test("requests and errors are correlated without exposing internal exception data", async () => {
  const { left, right } = pair();
  right.onRequest(async (request) => {
    if (request.operation !== "capability.call") throw new Error("wrong operation");
    if (request.args.params === "fail") throw Object.assign(new Error("C:/secret/token"), { token: "private" });
    return request.args.params;
  });
  expect(await left.request("capability.call", args({ unicode: "你好" }))).toEqual({ unicode: "你好" });
  await expect(left.request("capability.call", args("fail"))).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE", message: "The host operation failed." });
});

test("out-of-order replies settle only their corresponding requests", async () => {
  const { left, right } = pair();
  const first = deferred<JsonValue>(); const started = deferred<void>();
  right.onRequest(async (request) => {
    if (request.operation !== "capability.call") throw new Error("wrong operation");
    if (request.args.params === "first") { started.resolve(); return first.promise; }
    return "second-result";
  });
  const a = left.request("capability.call", args("first"));
  await started.promise;
  expect(await left.request("capability.call", args("second"))).toBe("second-result");
  first.resolve("first-result"); expect(await a).toBe("first-result");
});

test("local close rejects pending work and aborts the remote handler", async () => {
  const { left, right } = pair(); const started = deferred<void>(); const aborted = deferred<void>();
  right.onRequest(async ({ signal }) => {
    started.resolve();
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted.resolve(); reject(signal.reason); }, { once: true });
    });
  });
  const response = left.request("capability.call", args());
  const rejected = expect(response).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
  await started.promise; left.close(); left.close();
  await rejected; await aborted.promise;
  await expect(left.request("capability.call", args())).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
});

test("remote close rejects pending work and emits closed exactly once", async () => {
  const { left, right } = pair(); const started = deferred<void>(); const closed: string[] = [];
  left.onEvent((event) => { if (event.kind === "connection") closed.push(event.state); });
  right.onRequest(async () => { started.resolve(); return new Promise(() => {}); });
  const response = left.request("capability.call", args());
  const rejected = expect(response).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
  await started.promise; right.close(); await rejected; left.close();
  expect(closed).toEqual(["closed"]);
});

test("timeout sends a best-effort cancellation but never repeats a call", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { left, right } = pair(); const started = deferred<void>(); const aborted = deferred<void>(); let calls = 0;
  right.onRequest(async ({ signal }) => {
    calls++; started.resolve();
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted.resolve(); reject(signal.reason); }, { once: true });
    });
  });
  const response = left.request("capability.call", args());
  const rejected = expect(response).rejects.toMatchObject({ code: "E_TIMEOUT" });
  await started.promise; await vi.advanceTimersByTimeAsync(30_000); await rejected; await aborted.promise;
  expect(calls).toBe(1);
});

test("an already-aborted call is never dispatched", async () => {
  const { left, right } = pair(); let calls = 0;
  right.onRequest(async () => { calls++; return null; });
  const controller = new AbortController(); controller.abort();
  await expect(left.request("capability.call", args(), { signal: controller.signal })).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(await left.request("capability.call", args())).toBeNull();
  expect(calls).toBe(1);
});

test("cancellation frees capacity even when the handler ignores its signal", async () => {
  const { left, right } = pair({ maxInflight: 1 }); const started = deferred<void>(); let calls = 0;
  right.onRequest(async () => { calls++; if (calls === 1) { started.resolve(); return new Promise(() => {}); } return "next"; });
  const controller = new AbortController();
  const response = left.request("capability.call", args(), { signal: controller.signal });
  const rejected = expect(response).rejects.toMatchObject({ code: "E_CANCELLED" });
  await started.promise; controller.abort(); await rejected;
  expect(await left.request("capability.call", args())).toBe("next");
});

test("outgoing capacity is bounded and released after requests settle", async () => {
  const { left, right } = pair({ maxInflight: 2 }); const finish = deferred<JsonValue>(); const started = deferred<void>(); let count = 0;
  right.onRequest(async () => { if (++count === 2) started.resolve(); return finish.promise; });
  const a = left.request("capability.call", args()); const b = left.request("capability.call", args());
  await started.promise;
  await expect(left.request("capability.call", args())).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  finish.resolve("done"); expect(await Promise.all([a, b])).toEqual(["done", "done"]);
  expect(await left.request("capability.call", args())).toBe("done");
});

test("invalid local payloads do not poison a healthy peer", async () => {
  const { left, right } = pair(); right.onRequest(async () => "healthy");
  const circular: unknown[] = []; circular.push(circular);
  await expect(left.request("capability.call", args(circular as JsonValue))).rejects.toBeInstanceOf(Error);
  await expect(left.request("capability.call", args("x".repeat(1048577)))).rejects.toBeInstanceOf(Error);
  expect(await left.request("capability.call", args())).toBe("healthy");
});

test("malformed remote data fails closed and settles pending requests", async () => {
  const { peer, port } = rawPair();
  const response = peer.request("capability.call", args());
  const rejected = expect(response).rejects.toMatchObject({ code: "E_INVALID_MESSAGE" });
  port.postMessage('{"protocol":"aplg/2"}'); await rejected;
  await expect(peer.request("capability.call", args())).rejects.toBeInstanceOf(Error);
});

test("unknown and duplicate replies never settle another call", async () => {
  const { peer, port } = rawPair(); const received = nextRequest(port);
  const result = peer.request("capability.call", args()); const request = await received;
  port.postMessage(JSON.stringify({ protocol: "aplg/1", kind: "result", id: "not-pending", value: "wrong" }));
  port.postMessage(JSON.stringify({ protocol: "aplg/1", kind: "result", id: request.id, value: "right" }));
  port.postMessage(JSON.stringify({ protocol: "aplg/1", kind: "result", id: request.id, value: "duplicate" }));
  expect(await result).toBe("right");
  const secondReceived = nextRequest(port); const second = peer.request("capability.call", args()); const request2 = await secondReceived;
  port.postMessage(JSON.stringify({ protocol: "aplg/1", kind: "result", id: request2.id, value: "second" }));
  expect(await second).toBe("second");
});

test("late results after cancellation are discarded", async () => {
  const { peer, port } = rawPair(); const received = nextRequest(port); const controller = new AbortController();
  const response = peer.request("capability.call", args(), { signal: controller.signal });
  const rejected = expect(response).rejects.toMatchObject({ code: "E_CANCELLED" });
  const request = await received; controller.abort(); await rejected;
  port.postMessage(JSON.stringify({ protocol: "aplg/1", kind: "result", id: request.id, value: "too late" }));
  const secondReceived = nextRequest(port); const second = peer.request("capability.call", args()); const request2 = await secondReceived;
  port.postMessage(JSON.stringify({ protocol: "aplg/1", kind: "result", id: request2.id, value: "current" }));
  expect(await second).toBe("current");
});

test("event listener failures do not prevent delivery to other listeners", async () => {
  const { left, right } = pair(); const delivered = deferred<JsonValue>();
  left.onEvent(() => { throw new Error("consumer failure"); });
  const remove = left.onEvent((event) => { if (event.kind === "event") delivered.resolve(event.payload); });
  right.sendEvent({ protocol: "aplg/1", kind: "event", subscriptionId: "s-1", seq: 1, payload: "hello" });
  expect(await delivered.promise).toBe("hello"); remove(); remove();
});

test("explicit public errors roundtrip without copying their stack", async () => {
  const { left, right } = pair(); right.onRequest(async () => { throw new AplgError("E_PERMISSION_DENIED", "Not allowed", { path: "/data/a" }); });
  await expect(left.request("capability.call", args())).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", message: "Not allowed", details: { path: "/data/a" } });
});

test("incoming work is bounded independently from the local outgoing queue", async () => {
  const channel = new MessageChannel();
  const sender = createRpcPeer(channel.port1, { maxInflight: 2 });
  const receiver = createRpcPeer(channel.port2, { maxInflight: 1 });
  peers.push(sender, receiver);
  const started = deferred<void>(); const finish = deferred<JsonValue>();
  receiver.onRequest(async () => { started.resolve(); return finish.promise; });
  const a = sender.request("capability.call", args()); await started.promise;
  await expect(sender.request("capability.call", args())).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  finish.resolve("done"); expect(await a).toBe("done");
});

test("a duplicate inbound request cannot execute the same operation twice", async () => {
  const { peer, port } = rawPair(); const started = deferred<void>(); const ended = deferred<void>(); let calls = 0;
  peer.onEvent((event) => { if (event.kind === "connection" && event.state === "closed") ended.resolve(); });
  peer.onRequest(async ({ signal }) => {
    calls++; started.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const frame = JSON.stringify({ protocol: "aplg/1", kind: "request", id: "duplicate", operation: "capability.call", args: args() });
  port.postMessage(frame); await started.promise; port.postMessage(frame); await ended.promise;
  expect(calls).toBe(1);
});

test("invalid results produce a bounded error instead of hanging the caller", async () => {
  const { left, right } = pair();
  right.onRequest(async () => "x".repeat(1048577));
  await expect(left.request("capability.call", args())).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
});

test("settling a response removes its abort listener and timeout", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { left, right } = pair(); right.onRequest(async () => "done");
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  expect(await left.request("capability.call", args(), { signal: controller.signal })).toBe("done");
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
  controller.abort();
});

test.each([{ timeoutMs: 0 }, { timeoutMs: Infinity }, { maxInflight: 0 }, { maxInflight: 65 }, { maxBytes: 1048577 }])(
  "rejects options that can disable bounds: %j", (options) => {
    const channel = new MessageChannel(); ports.push(channel.port1, channel.port2);
    expect(() => createRpcPeer(channel.port1, options)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  },
);
