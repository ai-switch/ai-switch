import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { parseStrictJson, readBoundedFile } from "../src/project/read.js";
import { withProject } from "./support/project.js";

describe("strict metadata JSON", () => {
  test("reads ordinary JSON without changing strings or accepting prototype properties", () => {
    expect(parseStrictJson('{"text":"你好","items":[true,null,1.5],"nested":{"same":1},"same":2}')).toEqual({ text: "你好", items: [true, null, 1.5], nested: { same: 1 }, same: 2 });
  });
  test.each(["", "null true", "{", '{"x":1,}', '[1,]', '{/* comment */"x":1}', '// hello\n{}', '\uFEFF{}', '{"x":NaN}', '{"x":1e400}'])("rejects non-strict or non-finite input: %s", (text) => {
    expect(() => parseStrictJson(text)).toThrowError(expect.objectContaining({ code: "E_JSON_SYNTAX" }));
  });
  test.each(['{"id":1,"id":2}', '{"permissions":{"native":false,"native":true}}', '{"value":[{"x":1,"\\u0078":2}]}'])("rejects duplicate decoded keys: %s", (text) => {
    expect(() => parseStrictJson(text)).toThrowError(expect.objectContaining({ code: "E_JSON_DUPLICATE_KEY" }));
  });
  test.each(["__proto__", "constructor", "prototype"])("never materializes unsafe key %s", (key) => {
    expect(() => parseStrictJson(`{"${key}":{}}`)).toThrowError(expect.objectContaining({ code: "E_JSON_UNSAFE_KEY" }));
  });
  test("malformed mismatched closes cannot hide recursive object nesting from the preflight", () => {
    const text = '{"value":[' + '{"nested":0],"next":'.repeat(10000) + "0";
    try { parseStrictJson(text); throw new Error("expected rejection"); }
    catch (error) { expect(error).toMatchObject({ code: expect.stringMatching(/^E_JSON_(SYNTAX|DEPTH)$/) }); }
  });
  test("bounds nesting before recursive AST creation and includes a safe location", () => {
    expect(() => parseStrictJson("[".repeat(10000) + "0" + "]".repeat(10000))).toThrowError(expect.objectContaining({ code: "E_JSON_DEPTH" }));
    expect(parseStrictJson("[".repeat(64) + "0" + "]".repeat(64))).toBeDefined();
    try { parseStrictJson('{\n"id": 1,\n"id": 2}'); } catch (error) {
      expect(error).toMatchObject({ code: "E_JSON_DUPLICATE_KEY", path: "/id" });
      expect((error as Error).message).toMatch(/line 3.*column/i);
    }
  });
});

describe("bounded regular-file reads", () => {
  test("returns exact bytes at the limit, including non-text data", async () => {
    await withProject({ "input": new Uint8Array([0, 1, 255, 128]), "empty": "" }, async (root) => {
      expect(await readBoundedFile(join(root, "input"), 4)).toEqual(new Uint8Array([0, 1, 255, 128]));
      expect((await readBoundedFile(join(root, "empty"), 0)).byteLength).toBe(0);
    });
  });
  test("refuses files over budget before loading their content", async () => {
    await withProject({ input: "12345" }, async (root) => {
      await expect(readBoundedFile(join(root, "input"), 4)).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
    });
  });
  test("rejects directories and links rather than following them", async () => {
    await withProject({ "outside/secret": "secret" }, async (root) => {
      await fs.symlink(join(root, "outside"), join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
      await expect(readBoundedFile(join(root, "outside"), 100)).rejects.toMatchObject({ code: "E_FILE_TYPE" });
      await expect(readBoundedFile(join(root, "linked", "secret"), 100)).rejects.toMatchObject({ code: "E_PATH_SYMLINK" });
    });
  });
  test.each([-1, Infinity, NaN, 0.5])("invalid byte budget %s fails without opening a path", async (limit) => {
    await expect(readBoundedFile("not-opened", limit)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  });
  test("preserves filesystem failures so the caller can distinguish I/O from validation", async () => {
    await withProject({}, async (root) => {
      await expect(readBoundedFile(join(root, "missing"), 10)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
  test("handles partial reads with a 64 KiB maximum read buffer", async () => {
    const bytes = new Uint8Array(150000).map((_, index) => index % 251);
    await withProject({ input: bytes }, async (root) => {
      const original = fs.open.bind(fs); const lengths: number[] = [];
      const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await original(...args); const read = handle.read.bind(handle);
        vi.spyOn(handle, "read").mockImplementation(async (...readArgs: unknown[]) => {
          const length = readArgs[2] as number; lengths.push(length); readArgs[2] = Math.min(length, 317);
          return Reflect.apply(read, handle, readArgs);
        });
        return handle;
      });
      try { expect(await readBoundedFile(join(root, "input"), bytes.length)).toEqual(bytes); expect(Math.max(...lengths)).toBeLessThanOrEqual(65536); }
      finally { open.mockRestore(); }
    });
  });
  test.each(["truncate", "rewrite"])("rejects a concurrent %s, even when the budget is not exceeded", async (mode) => {
    await withProject({ input: "original" }, async (root) => {
      const original = fs.open.bind(fs);
      const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await original(...args); const read = handle.read.bind(handle); let changed = false;
        vi.spyOn(handle, "read").mockImplementation(async (...readArgs: unknown[]) => {
          if (!changed) {
            changed = true;
            if (mode === "truncate") await fs.truncate(join(root, "input"), 2);
            else { await fs.writeFile(join(root, "input"), "modified"); await fs.utimes(join(root, "input"), new Date(0), new Date(0)); }
          }
          return Reflect.apply(read, handle, readArgs);
        });
        return handle;
      });
      try { await expect(readBoundedFile(join(root, "input"), 20)).rejects.toMatchObject({ code: "E_FILE_CHANGED" }); }
      finally { open.mockRestore(); }
    });
  });
  test("detects a file changing while read and closes the opened handle", async () => {
    await withProject({ input: "abcd" }, async (root) => {
      const original = fs.open.bind(fs); let closeSpy: ReturnType<typeof vi.spyOn> | undefined;
      const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await original(...args);
        const read = handle.read.bind(handle); let changed = false;
        vi.spyOn(handle, "read").mockImplementation(async (...readArgs: unknown[]) => {
          if (!changed) { changed = true; await fs.appendFile(join(root, "input"), "more"); }
          return Reflect.apply(read, handle, readArgs);
        });
        closeSpy = vi.spyOn(handle, "close");
        return handle;
      });
      try { await expect(readBoundedFile(join(root, "input"), 20)).rejects.toMatchObject({ code: "E_FILE_CHANGED" }); expect(closeSpy).toHaveBeenCalledOnce(); }
      finally { open.mockRestore(); }
    });
  });
});
