import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ZipFile } from "yazl";
import { fromBufferPromise } from "yauzl";
import { expect, test, vi } from "vitest";
import { limits } from "@ai-switch/tauri-plugin-runtime/protocol";
import { inspectPackage } from "../src/index.js";
import { ArchiveSource, openArchiveSource } from "../src/archive/source.js";
import { inspectContent } from "../src/archive/content.js";
import { createCrc32 } from "../src/archive/crc32.js";
import { withProject } from "./support/project.js";
import { validArchiveEntries, writeZipFixture, zipFixtureBytes } from "./support/zip-fixtures.js";

async function yazlBytes(forceDosTimestamp: boolean) {
  const zip = new ZipFile(); const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.once("end", () => resolve(Buffer.concat(chunks))); zip.outputStream.once("error", reject); zip.once("error", reject); });
  for (const entry of validArchiveEntries()) zip.addBuffer(Buffer.from(entry.data), entry.name, { mode: 0o100644, mtime: new Date("2000-01-01T00:00:00Z"), forceDosTimestamp });
  zip.end(); return result;
}

test.each([false, true])("accepts real yazl addBuffer output with forceDosTimestamp=%s without using packProject", async (forceDosTimestamp) => {
  await withProject({}, async (root) => {
    const file = join(root, "real-writer.aplg"); const bytes = await yazlBytes(forceDosTimestamp); await fs.writeFile(file, bytes);
    const report = await inspectPackage(file); expect(report.valid).toBe(true);
    if (report.valid) expect(report.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

test.each(["valid", "crc", "manifest", "truncated", "payload"])('always closes its single owned handle after %s input', async (kind) => {
  await withProject({}, async (root) => {
    const file = join(root, "closed.aplg"); const entries = validArchiveEntries();
    if (kind === "crc") entries[3].crc32 = 0;
    if (kind === "manifest") entries[0].data = '{"permissions":{"native":false,"native":true}}';
    if (kind === "payload") entries[3].compressedData = Buffer.from([0xff, 0xff, 0xff]);
    const bytes = zipFixtureBytes(entries); await fs.writeFile(file, kind === "truncated" ? bytes.subarray(0, 12) : bytes);
    const original = fs.open.bind(fs); const handles: { close: ReturnType<typeof vi.spyOn> }[] = [];
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => { const handle = await original(...args); handles.push({ close: vi.spyOn(handle, "close") }); return handle; });
    try {
      const report = await inspectPackage(file); expect(report.valid).toBe(kind === "valid");
      expect(handles).toHaveLength(1); expect(handles[0].close).toHaveBeenCalledOnce();
    } finally { open.mockRestore(); }
  });
});

test("a truncated read during inspection cannot pass and still closes", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "race.aplg"); await writeZipFixture(file, validArchiveEntries());
    const original = fs.open.bind(fs); let close: ReturnType<typeof vi.spyOn> | undefined;
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await original(...args); close = vi.spyOn(handle, "close");
      const read = handle.read.bind(handle); let changed = false;
      vi.spyOn(handle, "read").mockImplementation(async (...args: unknown[]) => { if (!changed) { changed = true; await fs.truncate(file, 3); } return Reflect.apply(read, handle, args); });
      return handle;
    });
    try { expect((await inspectPackage(file)).valid).toBe(false); expect(close).toHaveBeenCalledOnce(); }
    finally { open.mockRestore(); }
  });
});

test("a metadata-only change after opening is detected before returning a verified byte snapshot", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "mtime.aplg"); await writeZipFixture(file, validArchiveEntries());
    const original = fs.open.bind(fs);
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await original(...args); const read = handle.read.bind(handle); let changed = false;
      vi.spyOn(handle, "read").mockImplementation(async (...args: unknown[]) => { if (!changed) { changed = true; await fs.utimes(file, new Date(0), new Date(0)); } return Reflect.apply(read, handle, args); });
      return handle;
    });
    try { expect(await inspectPackage(file)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_FILE_CHANGED" })] }); }
    finally { open.mockRestore(); }
  });
});

test("file paths through a directory junction are rejected without an archive read", async () => {
  await withProject({}, async (outside) => withProject({}, async (root) => {
    await writeZipFixture(join(outside, "package.aplg"), validArchiveEntries());
    await fs.symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    const open = vi.spyOn(fs, "open");
    try { expect(await inspectPackage(join(root, "linked/package.aplg"))).toMatchObject({ valid: false, signature: "not-verified", diagnostics: [expect.objectContaining({ code: "E_PATH_SYMLINK" })] }); expect(open).not.toHaveBeenCalled(); }
    finally { open.mockRestore(); }
  }));
});

test("an I/O error while streaming is reported as I/O instead of blaming the package", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "io.aplg"); await writeZipFixture(file, validArchiveEntries());
    const original = fs.open.bind(fs); let close: ReturnType<typeof vi.spyOn> | undefined;
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await original(...args); close = vi.spyOn(handle, "close");
      vi.spyOn(handle, "read").mockRejectedValue(Object.assign(new Error("EIO private path"), { code: "EIO" })); return handle;
    });
    try { await expect(inspectPackage(file)).rejects.toMatchObject({ code: "E_IO", kind: "io" }); expect(close).toHaveBeenCalledOnce(); }
    finally { open.mockRestore(); }
  });
});

test("actual stream bytes enforce cumulative budget separately from ZIP declared sizes", async () => {
  const data = Buffer.alloc(32768, 97); const bytes = zipFixtureBytes([{ name: "dist/a.bin", data, method: 8 }]);
  const zip = await fromBufferPromise(bytes, { lazyEntries: true }); const iterator = zip.eachEntry();
  try {
    const next = await iterator.next(); if (next.done) throw new Error("fixture entry absent");
    const crc = createCrc32(); crc.update(data);
    const entry = next.value;
    const budget = { expanded: limits.archiveExtractedBytes - 10 };
    await expect(inspectContent(zip, entry, {
      method: 8, size: data.length, compressedSize: entry.compressedSize, crc32: crc.digest(),
    }, "dist/a.bin", limits.archiveExtractedBytes, budget)).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
    expect(budget.expanded).toBeGreaterThan(limits.archiveExtractedBytes);
  } finally { await iterator.return?.(); zip.close(); }
});

test("actual streamed member bytes enforce the text budget independently of the declared length", async () => {
  const data = Buffer.alloc(32768, 97); const zip = await fromBufferPromise(zipFixtureBytes([{ name: "dist/a.js", data, method: 8 }]), { lazyEntries: true });
  const iterator = zip.eachEntry();
  try {
    const next = await iterator.next(); if (next.done) throw new Error("fixture entry absent");
    await expect(inspectContent(zip, next.value, { method: 8, size: data.length, compressedSize: next.value.compressedSize, crc32: next.value.crc32 }, "dist/a.js", 16384, { expanded: 0 })).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  } finally { await iterator.return?.(); zip.close(); }
});

test("an OS read error in a real member stream closes all readers without a dangling rejection", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "stream-io.aplg"); const entries = validArchiveEntries();
    entries[3] = { name: "dist/binary.bin", data: Buffer.alloc(100000, 97) }; await writeZipFixture(file, entries);
    const contentStart = entries.slice(0, 3).reduce((offset, entry) => offset + 30 + Buffer.byteLength(entry.name) + Buffer.byteLength(entry.data), 0) + 30 + Buffer.byteLength(entries[3].name);
    const original = fs.open.bind(fs); let failed = false; let close: ReturnType<typeof vi.spyOn> | undefined;
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await original(...args); const read = handle.read.bind(handle); close = vi.spyOn(handle, "close");
      vi.spyOn(handle, "read").mockImplementation(async (...args: unknown[]) => {
        if (args[3] === contentStart && args[2] === 65536) { failed = true; throw Object.assign(new Error("disk failed private path"), { code: "EIO" }); }
        return Reflect.apply(read, handle, args);
      });
      return handle;
    });
    try { await expect(inspectPackage(file)).rejects.toMatchObject({ code: "E_IO" }); expect(failed).toBe(true); expect(close).toHaveBeenCalledOnce(); }
    finally { open.mockRestore(); }
  });
});

test("ordinary ZIP comments, explicit directories, metadata and Unicode binary assets are accepted", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "metadata.aplg");
    await writeZipFixture(file, [
      { name: "dist/", data: "" }, ...validArchiveEntries(),
      { name: "icon.svg", data: '<svg xmlns="http://www.w3.org/2000/svg" />' },
      { name: "THIRD_PARTY_NOTICES.md", data: "MIT components" },
      { name: "dist/images/图.png", data: new Uint8Array([137, 80, 78, 71]), flags: 0x800 },
    ], { comment: Buffer.from("local structure fixture") });
    const report = await inspectPackage(file); expect(report.valid).toBe(true);
    if (report.valid) expect(report.files.some((file) => file.path === "dist")).toBe(false);
  });
});
test("central directory ordering need not match local file ordering in a classic ZIP", async () => {
  await withProject({}, async (root) => {
    const original = zipFixtureBytes(validArchiveEntries()); const end = original.length - 22;
    const start = original.readUInt32LE(end + 16); const records: Buffer[] = [];
    for (let offset = start; offset < end;) {
      const length = 46 + original.readUInt16LE(offset + 28) + original.readUInt16LE(offset + 30) + original.readUInt16LE(offset + 32);
      records.push(original.subarray(offset, offset + length)); offset += length;
    }
    const reordered = Buffer.concat([original.subarray(0, start), ...records.reverse(), original.subarray(end)]);
    const file = join(root, "reordered.aplg"); await fs.writeFile(file, reordered);
    const report = await inspectPackage(file); expect(report.valid).toBe(true);
    if (report.valid) expect(report.files.map((file) => file.path)).toEqual(["LICENSE", "aplg.json", "dist/index.html", "dist/main.js"]);
  });
});
test("large raw bodies stop on early content rejection and leave no pending handle reads", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "early.aplg"); const data = Buffer.alloc(512 * 1024, 97); data.write("MZ", 0, "ascii");
    await writeZipFixture(file, [...validArchiveEntries(), { name: "dist/renamed.bin", data }]);
    const original = fs.open.bind(fs); let close: ReturnType<typeof vi.spyOn> | undefined;
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => { const handle = await original(...args); close = vi.spyOn(handle, "close"); return handle; });
    try { expect(await inspectPackage(file)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_ARCHIVE_CONTENT" })] }); expect(close).toHaveBeenCalledOnce(); }
    finally { open.mockRestore(); }
  });
});
test("stored zero-byte assets are valid and an explicit parent may follow its children", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "empty-assets.aplg");
    await writeZipFixture(file, [...validArchiveEntries(), { name: "dist/assets/empty.txt", data: "" }, { name: "dist/assets/", data: "" }, { name: "dist/", data: "" }]);
    const report = await inspectPackage(file); expect(report.valid).toBe(true);
    if (report.valid) expect(report.files.find((file) => file.path === "dist/assets/empty.txt")).toMatchObject({ size: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" });
  });
});
test("unexpected implementation failures are execution errors, not invalid-package verdicts", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "internal.aplg"); await writeZipFixture(file, validArchiveEntries());
    const digest = vi.spyOn(ArchiveSource.prototype, "sha256").mockRejectedValue(new Error("private internal details"));
    try {
      await expect(inspectPackage(file)).rejects.toMatchObject({ code: "E_INTERNAL", kind: "io", message: "The archive inspection could not be completed." });
    } finally { digest.mockRestore(); }
  });
});
test("source disposal waits for an entire in-flight partial-range read, not just its first OS request", async () => {
  await withProject({ "partial.aplg": "0123456789abcdef" }, async (root) => {
    const original = fs.open.bind(fs);
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await original(...args); const read = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...args: unknown[]) => { args[2] = Math.min(1, args[2] as number); return Reflect.apply(read, handle, args); });
      return handle;
    });
    try {
      const source = await openArchiveSource(join(root, "partial.aplg"));
      const [bytes] = await Promise.all([source.bytes(0, 16), source.dispose()]);
      expect(bytes.toString()).toBe("0123456789abcdef");
    } finally { open.mockRestore(); }
  });
});