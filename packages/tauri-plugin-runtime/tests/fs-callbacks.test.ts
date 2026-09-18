import { afterEach, expect, test, vi } from "vitest";
import { Buffer } from "../src/node/buffer.js";
import { createFsClient } from "../src/node/fs/client.js";
import { createCallbackFs } from "../src/node/fs/callbacks.js";
import { createMemoryFsProvider } from "./support/memory-fs-provider.js";

function setup() { const provider = createMemoryFsProvider(); const promises = createFsClient(provider.call, provider.session); return { provider, promises, fs: createCallbackFs(promises) }; }
afterEach(() => vi.useRealTimers());

test("callback and promises forms share one client and use asynchronous error-first callbacks", async () => {
  const { fs, promises } = setup(); expect(fs.promises).toBe(promises);
  let synchronous = true; let count = 0;
  const done = new Promise<void>((resolve, reject) => {
    const returned = fs.writeFile("/data/a", "hello", (error) => {
      try { expect(synchronous).toBe(false); expect(error).toBeNull(); count++; resolve(); } catch (failure) { reject(failure); }
    });
    expect(returned).toBeUndefined();
  });
  synchronous = false; await done; expect(count).toBe(1);
  expect(await promises.readFile("/data/a", "utf8")).toBe("hello");
  const read = await new Promise<string>((resolve, reject) => fs.readFile("/data/a", "utf8", (error, data) => error ? reject(error) : resolve(data)));
  expect(read).toBe("hello");
  const bytes = await new Promise<Buffer>((resolve, reject) => fs.readFile("/data/a", (error, data) => error ? reject(error) : resolve(data)));
  expect(Buffer.isBuffer(bytes)).toBe(true);
});

test("callback failures preserve safe errors and invoke the callback once", async () => {
  const { fs } = setup(); let calls = 0;
  await new Promise<void>((resolve, reject) => fs.readFile("/data/missing", (error, value) => {
    try { calls++; expect(error).toMatchObject({ code: "ENOENT", syscall: "readFile", path: "/data/missing" }); expect(value).toBeUndefined(); resolve(); } catch (failure) { reject(failure); }
  }));
  expect(calls).toBe(1);
});

test("missing callbacks are rejected before side effects begin", () => {
  const { provider, fs } = setup();
  expect(() => (fs.writeFile as (...args: unknown[]) => unknown)("/data/a", "text")).toThrow(TypeError);
  expect(() => (fs.rm as (...args: unknown[]) => unknown)("/data/a", {})).toThrow(TypeError);
  expect(provider.calls).toEqual([]);
});

test.each(["readFileSync", "writeFileSync", "appendFileSync", "readdirSync", "statSync", "mkdirSync", "renameSync", "copyFileSync", "rmSync"])("sync IO is explicitly unsupported: %s", (method) => {
  const { fs, provider } = setup();
  expect(() => (fs as unknown as Record<string, () => void>)[method]()).toThrow(expect.objectContaining({ code: "ERR_APLG_SYNC_IO_UNSUPPORTED" }));
  expect(provider.calls).toEqual([]);
});

test("callback exceptions are not caught and delivered as a second callback", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { fs } = setup(); const problem = new Error("callback failed"); let calls = 0;
  fs.stat("/data", () => { calls++; throw problem; });
  // Async callback failures are rethrown on a task, never interpreted as IO errors.
  await expect(vi.runAllTimersAsync()).rejects.toThrow(problem);
  expect(calls).toBe(1);
});
