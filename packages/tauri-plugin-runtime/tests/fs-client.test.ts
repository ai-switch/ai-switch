import { expect, test } from "vitest";
import { Buffer } from "../src/node/buffer.js";
import { createFsClient } from "../src/node/fs/client.js";
import { createMemoryFsProvider } from "./support/memory-fs-provider.js";

function setup(options?: Parameters<typeof createMemoryFsProvider>[0]) {
  const provider = createMemoryFsProvider(options);
  return { provider, fs: createFsClient(provider.call, provider.session, { onConnectionChange: provider.onConnectionChange }) };
}

test("UTF-8 writes become visible only after the complete transfer commits", async () => {
  const { provider, fs } = setup();
  await fs.writeFile("/data/note.txt", "你好🙂", "utf8");
  expect(await fs.readFile("/data/note.txt", "utf8")).toBe("你好🙂");
  expect(Array.from(provider.readCommitted("/data/note.txt")!)).toEqual([228, 189, 160, 229, 165, 189, 240, 159, 153, 130]);
  expect(provider.activeTransfers()).toBe(0);
});

test("reads without encoding return browser Buffer and allow binary roundtrips", async () => {
  const { fs } = setup();
  const bytes = new Uint8Array([0, 255, 10, 128]);
  await fs.writeFile("/data/binary", bytes);
  const result = await fs.readFile("/data/binary");
  expect(Buffer.isBuffer(result)).toBe(true); expect(Array.from(result)).toEqual([0, 255, 10, 128]);
  expect(Buffer.isBuffer(await fs.readFile("/data/binary", null))).toBe(true);
  expect(Buffer.isBuffer(await fs.readFile("/data/binary", { encoding: null }))).toBe(true);
});

test("writes snapshot mutable byte input before asynchronous work starts", async () => {
  const { provider, fs } = setup(); const input = new Uint8Array([1, 2, 3]);
  const writing = fs.writeFile("/data/snapshot", input); input.fill(9); await writing;
  expect(Array.from(provider.readCommitted("/data/snapshot")!)).toEqual([1, 2, 3]);
});

test("append and exclusive flags preserve their Node-style behavior", async () => {
  const { fs } = setup(); await fs.writeFile("/data/a", "one", { flag: "wx" });
  await expect(fs.writeFile("/data/a", "bad", { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST", path: "/data/a", syscall: "writeFile" });
  await fs.appendFile("/data/a", "+two", "utf8");
  expect(await fs.readFile("/data/a", "utf8")).toBe("one+two");
  await expect(fs.appendFile("/data/a", "bad", { flag: "ax" })).rejects.toMatchObject({ code: "EEXIST" });
  await fs.writeFile("/data/a", "replaced"); expect(await fs.readFile("/data/a", "utf8")).toBe("replaced");
});

test("directory and stat methods return only the declared snapshot subset", async () => {
  const { fs } = setup();
  expect(await fs.mkdir("/data/nested/a", { recursive: true })).toBe("/data/nested");
  expect(await fs.mkdir("/data/nested/a", { recursive: true })).toBeUndefined();
  expect(await fs.mkdir("/data/empty")).toBeUndefined();
  await fs.writeFile("/data/nested/file", "a");
  expect((await fs.readdir("/data/nested")).sort()).toEqual(["a", "file"]);
  const entries = await fs.readdir("/data/nested", { withFileTypes: true });
  const file = entries.find((entry) => entry.name === "file")!; const directory = entries.find((entry) => entry.name === "a")!;
  expect(file.isFile()).toBe(true); expect(file.isDirectory()).toBe(false); expect(directory.isDirectory()).toBe(true);
  const stats = await fs.stat("/data/nested/file");
  expect(stats.size).toBe(1); expect(stats.mtimeMs).toBe(-1000); expect(stats.isFile()).toBe(true);
  expect(Object.isFrozen(stats)).toBe(true); expect("uid" in stats).toBe(false);
});

test("rename, copy and removal respect virtual grant boundaries", async () => {
  const { provider, fs } = setup({ files: { "/data/a": "text" } });
  await fs.rename("/data/a", "/data/b"); expect(await fs.readFile("/data/b", "utf8")).toBe("text");
  await expect(fs.readFile("/data/a")).rejects.toMatchObject({ code: "ENOENT", path: "/data/a" });
  await fs.copyFile("/data/b", "/mounts/grant/c"); expect(await fs.readFile("/mounts/grant/c", "utf8")).toBe("text");
  const before = provider.calls.length;
  await expect(fs.rename("/data/b", "/mounts/grant/b")).rejects.toMatchObject({ code: "EXDEV", path: "/data/b", dest: "/mounts/grant/b" });
  expect(provider.calls).toHaveLength(before);
  await fs.rm("/data/b"); await fs.rm("/data/missing", { force: true });
  await expect(fs.rm("/app/secret", { force: true, recursive: true })).rejects.toMatchObject({ code: "EACCES" });
});

test("directory type errors and missing files preserve safe error metadata", async () => {
  const { fs } = setup({ files: { "/data/file": "text" } });
  await expect(fs.readdir("/data/file")).rejects.toMatchObject({ code: "ENOTDIR", path: "/data/file", syscall: "readdir" });
  await expect(fs.readFile("/data")).rejects.toMatchObject({ code: "EISDIR" });
  await expect(fs.stat("/data/missing")).rejects.toMatchObject({ code: "ENOENT", path: "/data/missing", syscall: "stat" });
});

test("absent filesystem capability is not replaced with a local browser fallback", async () => {
  const { provider, fs } = setup({ available: false });
  await expect(fs.readFile("/data/a")).rejects.toMatchObject({ code: "E_CAPABILITY_UNAVAILABLE" });
  expect(provider.calls).toEqual([]);
});

test("readdir entries do not expose mutable backend objects through their methods", async () => {
  const { fs, provider } = setup(); const entry = { name: "a", kind: "file" };
  provider.interceptNext("readdir", () => [entry]);
  const listed = await fs.readdir("/data", { withFileTypes: true });
  entry.kind = "directory";
  expect(listed[0].isFile()).toBe(true); expect(listed[0].isDirectory()).toBe(false);
});

test("stat snapshots cannot change when backend result objects are later mutated", async () => {
  const { fs, provider } = setup(); const reply = { kind: "file", size: 3, mtimeMs: 0 };
  provider.interceptNext("stat", () => reply);
  const result = await fs.stat("/data/a"); reply.kind = "directory";
  expect(result.isFile()).toBe(true); expect(result.isDirectory()).toBe(false);
});

test("mkdir cannot return an unrelated virtual path as its first created directory", async () => {
  const { fs, provider } = setup(); provider.interceptNext("mkdir", () => ({ createdPath: "/mounts/other" }));
  await expect(fs.mkdir("/data/a/b", { recursive: true })).rejects.toMatchObject({ code: "E_INVALID_MESSAGE" });
});
