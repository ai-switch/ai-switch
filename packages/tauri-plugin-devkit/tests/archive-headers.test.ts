import { promises as fs } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { inspectPackage } from "../src/index.js";
import { limits } from "@ai-switch/tauri-plugin-runtime/protocol";
import { withProject } from "./support/project.js";
import { validArchiveEntries, writeZipFixture, type ZipFixtureEntry, type ZipFixtureOverrides } from "./support/zip-fixtures.js";

async function rejectHeader(change: Partial<ZipFixtureEntry>, code?: string) {
  await withProject({}, async (root) => {
    const file = join(root, "headers.aplg"); const entries = validArchiveEntries(); Object.assign(entries[3], change);
    await writeZipFixture(file, entries); const report = await inspectPackage(file);
    expect(report.valid).toBe(false); expect(report.signature).toBe("not-verified");
    if (code) expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
}

test.each([
  { localName: "dist/other.js" }, { localFlags: 0x800 }, { localMethod: 0 }, { localCrc32: 42 },
  { localCompressedSize: 42 }, { localUncompressedSize: 42 }, { localVersionNeeded: 10 },
])("independently compares local and central fields: %j", async (change) => rejectHeader(change, "E_ARCHIVE_HEADER"));

test.each([
  { flags: 1 }, { flags: 8 }, { flags: 0x40 }, { flags: 0x2000 }, { method: 99 },
  { versionNeeded: 0 }, { versionNeeded: 11 }, { versionNeeded: 10 }, { internalAttributes: 2 },
  { versionNeeded: 45 }, { diskStart: 1 }, { compressedSize: 0xffffffff }, { uncompressedSize: 0xffffffff },
  { extra: new Uint8Array([1, 0, 0, 0]) }, { localExtra: new Uint8Array([1, 0, 0, 0]) },
  { extra: new Uint8Array([0x75, 0x70, 0, 0]) }, { localExtra: new Uint8Array([0x75, 0x70, 0, 0]) },
])("rejects unsupported/encrypted/descriptor/ZIP64 structures: %j", async (change) => rejectHeader(change, "E_ARCHIVE_PROFILE"));

test.each([
  { entries: 0xffff }, { disk: 1 }, { centralDisk: 1 }, { entriesOnDisk: 0 },
  { centralSize: 1 }, { centralOffset: 0xffffffff }, { suffix: new Uint8Array([1, 2, 3]) },
  { prefix: new Uint8Array([0x4d, 0x5a]) }, { entries: 3 }, { entries: 5 },
] satisfies ZipFixtureOverrides[])("rejects invalid global ZIP layout: %j", async (overrides) => {
  await withProject({}, async (root) => {
    const file = join(root, "layout.aplg"); await writeZipFixture(file, validArchiveEntries(), overrides);
    expect((await inspectPackage(file)).valid).toBe(false);
  });
});

test("CRC is recomputed, not trusted just because both headers agree", async () => rejectHeader({ crc32: 0 }, "E_ARCHIVE_CRC"));
test("a valid deflate stream with a false declared length cannot pass", async () => rejectHeader({ uncompressedSize: 0 }, "E_ARCHIVE_SIZE"));
test("compressed data is not allowed to hide trailing payload", async () => {
  const { deflateRawSync } = await import("node:zlib");
  await rejectHeader({ compressedData: Buffer.concat([deflateRawSync('document.body.append("ready");'), Buffer.from("hidden")]) }, "E_ARCHIVE_SIZE");
});
test("offsets pointing into a different local header fail", async () => rejectHeader({ localOffset: 0 }, "E_ARCHIVE_HEADER"));
test("truncated extra fields fail closed", async () => rejectHeader({ extra: new Uint8Array([0x55, 0x54, 99, 0, 1]) }));
test.each([0x400, 0x4, 0x8])("rejects DOS device/reparse/volume attributes %d", async (externalAttributes) => rejectHeader({ externalAttributes }, "E_ARCHIVE_MODE"));

test.each([
  { name: "aplg.json", size: 256 * 1024 + 1 }, { name: "dist/index.html", size: 2 * 1024 * 1024 + 1 },
  { name: "dist/main.js", size: 16 * 1024 * 1024 + 1 }, { name: "dist/main.css", size: 16 * 1024 * 1024 + 1 },
  { name: "dist/big.bin", size: limits.archiveExtractedBytes + 1 },
])("rejects declared expanded bounds before reading body: $name", async ({ name, size }) => {
  await withProject({}, async (root) => {
    const file = join(root, "budget.aplg"); await writeZipFixture(file, [{ name, data: "", method: 8, uncompressedSize: size }]);
    expect(await inspectPackage(file)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_LIMIT_EXCEEDED" })] });
  });
});
test("a sparse input over the compressed archive cap is rejected without reading it", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "huge.aplg"); const handle = await fs.open(file, "w"); await handle.truncate(limits.archiveBytes + 1); await handle.close();
    const open = vi.spyOn(fs, "open");
    try { expect(await inspectPackage(file)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_LIMIT_EXCEEDED" })] }); expect(open).not.toHaveBeenCalled(); }
    finally { open.mockRestore(); }
  });
});
test("more than 10000 entries is rejected from EOCD before enumerating", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "many.aplg"); await writeZipFixture(file, [], { entries: limits.archiveEntries + 1 });
    expect(await inspectPackage(file)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_LIMIT_EXCEEDED" })] });
  });
});
test("a high-expansion bomb with a lying length stops early and closes its input handle", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "bomb.aplg");
    await writeZipFixture(file, [{ name: "dist/bomb.js", data: Buffer.alloc(17 * 1024 * 1024, 65), method: 8, uncompressedSize: 1 }]);
    const original = fs.open.bind(fs); let close: ReturnType<typeof vi.spyOn> | undefined;
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => { const h = await original(...args); close = vi.spyOn(h, "close"); return h; });
    try { expect(await inspectPackage(file)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_ARCHIVE_SIZE" })] }); expect(close).toHaveBeenCalledOnce(); }
    finally { open.mockRestore(); }
  });
});
test.each([
  Buffer.from([0x4d, 0x5a, 0x90, 0]), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from("-----BEGIN PRIVATE KEY-----"),
])("rejects recognizable native/private-key content even when renamed: %j", async (bytes) => {
  await withProject({}, async (root) => {
    const file = join(root, "native.aplg"); await writeZipFixture(file, [...validArchiveEntries(), { name: "dist/disguised.bin", data: bytes }]);
    expect(await inspectPackage(file)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_ARCHIVE_CONTENT" })] });
  });
});
test("archive read errors are distinct safe I/O failures", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "io.aplg"); await writeZipFixture(file, validArchiveEntries());
    const open = vi.spyOn(fs, "open").mockRejectedValue(Object.assign(new Error(`EACCES private ${root}`), { code: "EACCES" }));
    try { await expect(inspectPackage(file)).rejects.toMatchObject({ code: "E_IO", kind: "io", path: "" }); }
    finally { open.mockRestore(); }
  });
});

test("a stored entry cannot disagree about compressed and uncompressed length", async () => rejectHeader({ method: 0, uncompressedSize: 1 }, "E_ARCHIVE_SIZE"));
test("uncompressed sizes are summed across entries before admitting the next body", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "cumulative.aplg");
    await writeZipFixture(file, [...validArchiveEntries(), { name: "dist/large.bin", data: "", method: 8, uncompressedSize: limits.archiveExtractedBytes }]);
    expect(await inspectPackage(file)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_LIMIT_EXCEEDED" })] });
  });
});