import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { inspectPackage } from "../src/index.js";
import { withProject } from "./support/project.js";
import { validArchiveEntries, writeZipFixture, zipFixtureBytes, type ZipFixtureEntry, type ZipFixtureOverrides } from "./support/zip-fixtures.js";

async function rejected(entries: ZipFixtureEntry[], code?: string, overrides?: ZipFixtureOverrides) {
  await withProject({}, async (root) => {
    const file = join(root, "bad.aplg"); await writeZipFixture(file, entries, overrides);
    const before = await fs.readdir(root); const report = await inspectPackage(file);
    expect(report).toMatchObject({ valid: false, signature: "not-verified" });
    if (code) expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    expect(await fs.readdir(root)).toEqual(before);
    expect(JSON.stringify(report)).not.toContain(root);
  });
}

describe("read-only APLG archive inspection", () => {
  test("hashes actual package and file bytes, returns a manifest, and never verifies a signature", async () => {
    await withProject({}, async (root) => {
      const file = join(root, "notes.aplg"); const entries = validArchiveEntries();
      entries.push({ name: "README.md", data: "# Notes" }, { name: "dist/assets/", data: "" }, { name: "dist/assets/你好.txt", data: "你好", flags: 0x800 });
      await writeZipFixture(file, entries); const bytes = await fs.readFile(file); const before = await fs.readdir(root);
      const open = vi.spyOn(fs, "open"); const write = vi.spyOn(fs, "writeFile"); const mkdir = vi.spyOn(fs, "mkdir");
      let report;
      try {
        report = await inspectPackage(file);
        expect(open.mock.calls).toHaveLength(1);
        expect(open.mock.calls.every(([, flags]) => typeof flags === "number" && !(flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_APPEND)))).toBe(true);
        expect(write).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
      } finally { open.mockRestore(); write.mockRestore(); mkdir.mockRestore(); }
      expect(report.valid).toBe(true); expect(report.signature).toBe("not-verified");
      if (!report.valid) return;
      expect(report.manifest.id).toBe("io.github.example.notes"); expect(report.diagnostics).toEqual([]);
      expect(report.sha256).toBe(createHash("sha256").update(bytes).digest("hex")); expect(report.size).toBe(bytes.length);
      expect(report.files).toEqual(entries.filter((entry) => !entry.name.endsWith("/")).map((entry) => ({ path: entry.name, size: Buffer.byteLength(entry.data), sha256: createHash("sha256").update(entry.data).digest("hex") })).sort((a, b) => a.path < b.path ? -1 : 1));
      expect(await fs.readdir(root)).toEqual(before); expect(await fs.readFile(file)).toEqual(bytes);
    });
  });
  test("never executes plugin JavaScript or writes archive members", async () => {
    await withProject({}, async (root) => {
      const file = join(root, "code.aplg"); const entries = validArchiveEntries();
      entries[3].data = "import {writeFileSync} from 'node:fs'; writeFileSync('escaped.txt','executed'); throw new Error('ran');";
      await writeZipFixture(file, entries);
      expect((await inspectPackage(file)).valid).toBe(true);
      await expect(fs.access(join(root, "dist"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(join(root, "escaped.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
  test.each(["../outside.txt", "/absolute", "C:/outside.txt", "//server/share", "dist/../escape", "dist\\escape", "dist/CON.txt", "dist/a.", "dist/a ", "dist/a:b", "dist/%2e%2e/a", "dist//a", "dist/a\u0000b"])("rejects unsafe member %s", async (name) => {
    await rejected([...validArchiveEntries(), { name, data: "bad" }], "E_ARCHIVE_PATH");
  });
  test.each(["src/main.ts", "package.json", ".env", "dist/.env", "dist/node_modules/code.js", "dist/.git/config", "dist/id_rsa", "dist/token.pem", "dist/key.p12", "dist/example.ts", "dist/index.js.map", "native/tool", "dist/tool.exe", "dist/lib.dll", "dist/lib.so.1", "dist/lib.a", "dist/file.o", "dist/App.class", "dist/payload.jar", "dist/lib.dylib", "dist/addon.node", "dist/run.cmd", "dist/run.ps1"])("rejects disallowed web-v1 content %s", async (name) => {
    await rejected([...validArchiveEntries(), { name, data: "bad" }], "E_ARCHIVE_CONTENT");
  });
  test.each([0o120777, 0o100755, 0o104644, 0o010644, 0o020644])("rejects symlink/executable/special permissions %s", async (unixMode) => {
    await rejected([...validArchiveEntries(), { name: "dist/special", data: "../../secret", unixMode }], "E_ARCHIVE_MODE");
  });
  test.each([
    [{ name: "dist/Main.js", data: "1" }, { name: "dist/main.js", data: "2" }],
    [{ name: "dist/A/a.txt", data: "1" }, { name: "dist/a/b.txt", data: "2" }],
    [{ name: "dist/assets", data: "1" }, { name: "dist/assets/a.txt", data: "2" }],
    [{ name: "dist/assets/a.txt", data: "1" }, { name: "dist/assets", data: "2" }],
    [{ name: "dist/assets/", data: "" }, { name: "dist/assets/", data: "" }],
    [{ name: "dist/assets", data: "1" }, { name: "dist/assets-foo", data: "2" }, { name: "dist/assets/a", data: "3" }],
    [{ name: "dist/É.txt", data: "1", flags: 0x800 }, { name: "dist/é.txt", data: "2", flags: 0x800 }],
  ].map((entries) => ({ entries })))("rejects colliding paths without relying on the host filesystem: %j", async ({ entries }) => {
    await rejected([...validArchiveEntries().filter((e) => e.name !== "dist/main.js"), ...entries], "E_ARCHIVE_COLLISION");
  });
  test.each(["dist/e\u0301.txt", "dist/Ａ.txt", "dist/A~1.TXT", "dist/a\u202ejs"])("rejects known platform-ambiguous name %s", async (name) => {
    await rejected([...validArchiveEntries(), { name, data: "", flags: 0x800 }], "E_ARCHIVE_PATH");
  });
  test.each([{ name: "dist/bad", data: "", nameBytes: new Uint8Array([0xff]), flags: 0x800 }, { name: "dist/你好.txt", data: "" }])("rejects invalid/ambiguous filename encoding %j", async (entry) => {
    await rejected([...validArchiveEntries(), entry], "E_ARCHIVE_ENCODING");
  });
  test.each([{ name: "dist/assets/", data: "nonempty" }, { name: "dist/assets//", data: "" }, { name: "LICENSE/", data: "" }, { name: "dist/dir", data: "", unixMode: 0o040755 }])("rejects invalid directory semantics %j", async (entry) => {
    await rejected([...validArchiveEntries(), entry]);
  });
  test.each([
    { entries: [], code: "E_ARCHIVE_REQUIRED" },
    { entries: validArchiveEntries().filter((e) => e.name !== "aplg.json"), code: "E_ARCHIVE_REQUIRED" },
    { entries: validArchiveEntries().filter((e) => e.name !== "LICENSE"), code: "E_ARCHIVE_REQUIRED" },
    { entries: [...validArchiveEntries(), validArchiveEntries()[0]], code: "E_ARCHIVE_COLLISION" },
    { entries: validArchiveEntries().filter((e) => e.name !== "dist/index.html"), code: "E_ARCHIVE_ENTRY" },
  ])("requires one manifest, a license and the declared entry: $code", async ({ entries, code }) => rejected(entries, code));
  test.each(["duplicate", "native", "api", "syntax", "utf8"])("reuses D1 manifest policy for %s", async (kind) => {
    const entries = validArchiveEntries(); const manifest = JSON.parse(entries[0].data as string);
    if (kind === "duplicate") entries[0].data = '{"id":"first","id":"second"}';
    if (kind === "native") { manifest.permissions.native = true; entries[0].data = JSON.stringify(manifest); }
    if (kind === "api") { manifest.engines.aplg = "^2.0.0"; entries[0].data = JSON.stringify(manifest); }
    if (kind === "syntax") entries[0].data = "not JSON";
    if (kind === "utf8") entries[0].data = new Uint8Array([0xc3, 0x28]);
    await rejected(entries, ({ duplicate: "E_JSON_DUPLICATE_KEY", native: "E_PROFILE_UNSUPPORTED", api: "E_API_INCOMPATIBLE", syntax: "E_JSON_SYNTAX", utf8: "E_UTF8" } as const)[kind as "duplicate" | "native" | "api" | "syntax" | "utf8"]);
  });
  test.each(["notes.zip", "notes.aplg.exe", "notes.APLG"])("does not accept a renamed non-aplg extension: %s", async (name) => {
    await withProject({}, async (root) => { const file = join(root, name); await writeZipFixture(file, validArchiveEntries()); expect(await inspectPackage(file)).toMatchObject({ valid: false, signature: "not-verified", diagnostics: [expect.objectContaining({ code: "E_ARCHIVE_EXTENSION" })] }); });
  });
  test("truncation and a non-ZIP input cannot be valid packages", async () => {
    const bytes = zipFixtureBytes(validArchiveEntries());
    await withProject({}, async (root) => {
      for (const content of [Buffer.from("not zip"), bytes.subarray(0, bytes.length - 10), Buffer.alloc(0)]) {
        const file = join(root, "bad.aplg"); await fs.writeFile(file, content); expect((await inspectPackage(file)).valid).toBe(false);
      }
    });
  });
});
