import { expect, test } from "vitest";
import { createFsClient } from "../src/node/fs/client.js";
import { createMemoryFsProvider } from "./support/memory-fs-provider.js";

function setup() { const provider = createMemoryFsProvider(); return { provider, fs: createFsClient(provider.call, provider.session) }; }

test.each([42, new URL("file:///data/a"), "relative", "C:/private", "/etc/passwd", "/data/../../outside", "/data/a\u0000b"])("invalid paths are rejected before invoking the host: %j", async (path) => {
  const { fs, provider } = setup();
  await expect(fs.readFile(path as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(provider.calls).toEqual([]);
});

test.each(["base64", { encoding: "hex" }, { signal: new AbortController().signal }, { flag: "r" }, { encoding: "utf8", extra: true }, []])(
  "unsupported read options are not silently ignored: %j", async (options) => {
    const { fs, provider } = setup();
    await expect(fs.readFile("/data/a", options as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    expect(provider.calls).toEqual([]);
  },
);

test("write and append flags are restricted to their explicit supported modes", async () => {
  const { fs, provider } = setup();
  for (const options of [{ mode: 0o777 }, { flag: "a" }, { encoding: "latin1" }, { encoding: "utf8", unknown: true }]) {
    await expect(fs.writeFile("/data/a", "text", options as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  }
  await expect(fs.appendFile("/data/a", "text", { flag: "w" } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  for (const data of [1, [1, 2], new DataView(new ArrayBuffer(2)), { toString: () => "bad" }]) {
    await expect(fs.writeFile("/data/a", data as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  }
  expect(provider.calls).toEqual([]);
});

test("options are inspected without executing getters", async () => {
  const { fs, provider } = setup(); let reads = 0;
  const options = Object.defineProperty({}, "encoding", { enumerable: true, get() { reads++; return "utf8"; } });
  await expect(fs.readFile("/data/a", options)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(reads).toBe(0); expect(provider.calls).toEqual([]);
});

test("metadata operations reject unsupported options before issuing calls", async () => {
  const { fs, provider } = setup();
  await expect(fs.readdir("/data", { recursive: true } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(fs.mkdir("/data/a", { recursive: "yes" } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(fs.rm("/data/a", { force: 1 } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(provider.calls).toEqual([]);
});

test("the file limit is checked in UTF-8 bytes, not string length", async () => {
  const provider = createMemoryFsProvider({ limits: { fileBytes: 5 } });
  const fs = createFsClient(provider.call, provider.session);
  await expect(fs.writeFile("/data/a", "你好", "utf8")).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  expect(provider.calls).toEqual([]);
});

test("explicit undefined optional fields behave like omitted fields without allowing unknown keys", async () => {
  const provider = createMemoryFsProvider({ files: { "/data/a": "text" } });
  const fs = createFsClient(provider.call, provider.session);
  expect(await fs.readFile("/data/a", { encoding: undefined })).toHaveLength(4);
  await fs.writeFile("/data/b", "new", { encoding: undefined, flag: undefined });
  expect(await fs.readdir("/data", { withFileTypes: undefined })).toContain("b");
  await expect(fs.readFile("/data/a", { unknown: undefined } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});
