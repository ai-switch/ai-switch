import { afterEach, expect, test, vi } from "vitest";
import { createFsClient } from "../src/node/fs/client.js";
import { createMemoryFsProvider } from "./support/memory-fs-provider.js";
import type { JsonValue } from "../src/protocol/types.js";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
afterEach(() => vi.useRealTimers());
function setup(options?: Parameters<typeof createMemoryFsProvider>[0]) { const provider = createMemoryFsProvider(options); return { provider, fs: createFsClient(provider.call, provider.session, { onConnectionChange: provider.onConnectionChange }) }; }

test.each([0, 262144, 262145, 8388608])("roundtrips exactly %s bytes within bounded chunks", async (size) => {
  const { fs, provider } = setup(); const data = new Uint8Array(size).fill(231);
  await fs.writeFile("/data/a", data);
  const read = await fs.readFile("/data/a"); expect(read.length).toBe(size);
  expect(read.every((byte) => byte === 231)).toBe(true);
  for (const call of provider.calls.filter((item) => item.method === "transfer.push")) expect(Buffer.from(call.params.dataBase64 as string, "base64").length).toBeLessThanOrEqual(262144);
  expect(provider.activeTransfers()).toBe(0); expect(provider.observerCount()).toBe(0);
}, 20000);

test("data larger than 8 MiB fails before opening a transfer", async () => {
  const { fs, provider } = setup();
  await expect(fs.writeFile("/data/a", new Uint8Array(8388609))).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  expect(provider.calls).toEqual([]);
});

test("concurrent read/write calls share one two-slot queue", async () => {
  const { fs, provider } = setup(); const first = deferred<void>(); const second = deferred<void>(); const started = deferred<void>(); let count = 0;
  for (const gate of [first, second]) provider.interceptNext("transfer.push", async (_params, perform) => { if (++count === 2) started.resolve(); await gate.promise; return perform(); });
  const a = fs.writeFile("/data/a", "a"); const b = fs.writeFile("/data/b", "b"); const c = fs.writeFile("/data/c", "c");
  await started.promise;
  expect(provider.calls.filter((item) => item.method === "transfer.openWrite")).toHaveLength(2);
  expect(provider.activeTransfers()).toBe(2);
  first.resolve(); second.resolve(); await Promise.all([a, b, c]);
  expect(provider.maxTransfers()).toBe(2); expect(provider.activeTransfers()).toBe(0); expect(provider.observerCount()).toBe(0);
});

test("closing a connection cancels in-flight and queued operations without starting the third write", async () => {
  const { fs, provider } = setup(); const started = deferred<void>(); let count = 0;
  for (let i = 0; i < 2; i++) provider.interceptNext("transfer.push", () => { if (++count === 2) started.resolve(); return new Promise(() => {}); });
  const outcomes = Promise.allSettled([fs.writeFile("/data/a", "a"), fs.writeFile("/data/b", "b"), fs.writeFile("/data/c", "c")]);
  await started.promise; provider.setState("closed");
  const results = await outcomes;
  expect(results.every((result) => result.status === "rejected" && result.reason.code === "E_SESSION_CLOSED")).toBe(true);
  expect(provider.calls.filter((item) => item.method === "transfer.openWrite")).toHaveLength(2);
  expect(provider.readCommitted("/data/a")).toBeUndefined(); expect(provider.readCommitted("/data/c")).toBeUndefined();
  expect(provider.activeTransfers()).toBe(0); expect(provider.observerCount()).toBe(0);
});

test("push failure aborts staging and does not overwrite the existing file", async () => {
  const { fs, provider } = setup({ files: { "/data/a": "original" } });
  provider.failNext("transfer.push", "EIO");
  await expect(fs.writeFile("/data/a", "changed")).rejects.toMatchObject({ code: "EIO" });
  expect(Buffer.from(provider.readCommitted("/data/a")!).toString()).toBe("original"); expect(provider.activeTransfers()).toBe(0);
});

test.each([
  { offset: 1, dataBase64: "YWJj" },
  { offset: 0, dataBase64: "" },
  { offset: 0, dataBase64: "YQ==" },
  { offset: 0, dataBase64: "YWJjZA==" },
  { offset: 0, dataBase64: "Zh==" },
])("a malformed pull cannot return partial or uncorrelated data: %j", async (response) => {
  const { fs, provider } = setup({ files: { "/data/a": "abc" } }); provider.interceptNext("transfer.pull", () => response);
  await expect(fs.readFile("/data/a")).rejects.toMatchObject({ code: "E_INVALID_MESSAGE" });
  expect(provider.activeTransfers()).toBe(0);
});

test("wrong push byte acknowledgement prevents commit", async () => {
  const { fs, provider } = setup(); provider.interceptNext("transfer.push", () => ({ written: 0 }));
  await expect(fs.writeFile("/data/a", "abc")).rejects.toMatchObject({ code: "E_INVALID_MESSAGE" });
  expect(provider.calls.some((item) => item.method === "transfer.finish")).toBe(false); expect(provider.activeTransfers()).toBe(0);
});

test("a negotiated smaller byte limit reduces chunk size", async () => {
  const { fs, provider } = setup({ limits: { controlBytes: 2048, fileChunkBytes: 262144 } });
  const data = new Uint8Array(3000).fill(9); await fs.writeFile("/data/a", data); expect((await fs.readFile("/data/a")).length).toBe(3000);
  const pushes = provider.calls.filter((item) => item.method === "transfer.push");
  expect(pushes.length).toBeGreaterThan(1);
  for (const push of pushes) expect(JSON.stringify({ protocol: "aplg/1", kind: "request", id: "x".repeat(128), operation: "capability.call", args: { capability: "aplg.fs", method: push.method, params: push.params } }).length).toBeLessThanOrEqual(2048);
});

test("a never-settling finish is bounded and never automatically retries an append", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { fs, provider } = setup({ files: { "/data/a": "original" } }); const started = deferred<void>();
  provider.interceptNext("transfer.finish", () => { started.resolve(); return new Promise(() => {}); });
  const writing = fs.appendFile("/data/a", "+extra"); const rejected = expect(writing).rejects.toMatchObject({ code: "E_TIMEOUT" });
  await started.promise; await vi.advanceTimersByTimeAsync(30_000); await rejected;
  expect(provider.calls.filter((item) => item.method === "transfer.finish")).toHaveLength(1);
  expect(provider.activeTransfers()).toBe(0); expect(provider.observerCount()).toBe(0);
});

test("connection loss cancels queued work but later recovery can start new operations", async () => {
  const { fs, provider } = setup(); const started = deferred<void>();
  provider.interceptNext("transfer.push", () => { started.resolve(); return new Promise(() => {}); });
  const writing = fs.writeFile("/data/a", "a"); const rejected = expect(writing).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
  await started.promise; provider.setState("disconnected"); await rejected;
  expect(provider.observerCount()).toBe(0); provider.setState("connected");
  await fs.writeFile("/data/b", "new"); expect(await fs.readFile("/data/b", "utf8")).toBe("new");
});

test("an oversized declared read aborts its handle before any chunk is requested", async () => {
  const { fs, provider } = setup({ limits: { fileBytes: 2 }, files: { "/data/a": "abc" } });
  await expect(fs.readFile("/data/a")).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  expect(provider.calls.some((item) => item.method === "transfer.pull")).toBe(false);
  expect(provider.activeTransfers()).toBe(0);
});

test("the same active handle cannot be adopted by two independent transfers", async () => {
  const { fs, provider } = setup(); const firstPush = deferred<void>(); const release = deferred<void>(); let firstHandle = "";
  provider.interceptNext("transfer.openWrite", (_params, perform) => { const result = perform() as { handle: string }; firstHandle = result.handle; return result; });
  provider.interceptNext("transfer.push", async (_params, perform) => { firstPush.resolve(); await release.promise; return perform(); });
  const first = fs.writeFile("/data/first", "first"); await firstPush.promise;
  provider.interceptNext("transfer.openWrite", () => ({ handle: firstHandle }));
  await expect(fs.writeFile("/data/second", "second")).rejects.toMatchObject({ code: "E_INVALID_MESSAGE" });
  expect(provider.activeTransfers()).toBe(1);
  release.resolve(); await first;
  expect(Buffer.from(provider.readCommitted("/data/first")!).toString()).toBe("first");
});

test("a timed-out open is cleaned up when its handle eventually arrives", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { fs, provider } = setup(); const waiting = deferred<JsonValue>(); const started = deferred<void>(); let create!: () => JsonValue;
  provider.interceptNext("transfer.openWrite", (_params, perform) => { create = perform; started.resolve(); return waiting.promise; });
  const writing = fs.writeFile("/data/a", "a"); const rejected = expect(writing).rejects.toMatchObject({ code: "E_TIMEOUT" });
  await started.promise; await vi.advanceTimersByTimeAsync(30_000); await rejected;
  waiting.resolve(create()); await vi.advanceTimersByTimeAsync(1);
  expect(provider.activeTransfers()).toBe(0); expect(provider.calls.filter((item) => item.method === "transfer.openWrite")).toHaveLength(1);
});

test("unknown host exception fields and messages cannot leak through file errors", async () => {
  const { fs, provider } = setup();
  provider.interceptNext("stat", () => { throw Object.assign(new Error("C:/secret/token"), { code: "UNRECOGNIZED", path: "C:/secret", token: "hidden" }); });
  try { await fs.stat("/data/a"); throw new Error("expected rejection"); } catch (error) {
    expect(error).toMatchObject({ code: "EIO", path: "/data/a", syscall: "stat" });
    expect((error as Error).message).not.toContain("secret"); expect("token" in (error as object)).toBe(false);
  }
});

test("failed abort cleanup cannot free capacity for more potentially live backend handles", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { fs, provider } = setup(); const abortStarted = deferred<void>();
  provider.failNext("transfer.push", "EIO");
  provider.interceptNext("transfer.abort", () => { abortStarted.resolve(); return new Promise(() => {}); });
  const first = fs.writeFile("/data/a", "a"); const failed = expect(first).rejects.toMatchObject({ code: "EIO" });
  await abortStarted.promise; await vi.advanceTimersByTimeAsync(1000); await failed;
  await expect(fs.writeFile("/data/b", "b")).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
  expect(provider.calls.filter((item) => item.method === "transfer.openWrite")).toHaveLength(1);
  provider.setState("closed");
});
