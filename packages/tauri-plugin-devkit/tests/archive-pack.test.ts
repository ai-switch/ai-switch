import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { fromBufferPromise } from "yauzl";
import { ZipFile } from "yazl";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { inspectPackage, packProject, validateProject } from "../src/index.js";
import { createBuiltProject } from "./support/built-project.js";

let project: Awaited<ReturnType<typeof createBuiltProject>>;
beforeAll(async () => { project = await createBuiltProject(); }, 120000);
afterAll(async () => { await project?.dispose(); });
beforeEach(async () => { await project.reset(); });
const finalName = "io.github.example.notes-0.1.0.aplg";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function zipEntries(bytes: Buffer) {
  const zip = await fromBufferPromise(bytes, { lazyEntries: true, decodeStrings: false });
  const entries: { name: string; time: number; date: number; mode: number; extra: number }[] = [];
  try {
    for await (const entry of zip.eachEntry()) entries.push({ name: entry.fileNameRaw.toString("utf8"), time: entry.lastModFileTime, date: entry.lastModFileDate, mode: entry.externalFileAttributes >>> 16, extra: entry.extraFieldLength });
  } finally { zip.close(); }
  return entries;
}

describe("deterministic APLG packing from a real D4 build", () => {
  test("packages only validated candidates and returns the self-inspected byte identity", async () => {
    await project.write(".env", "MUST_NOT_SHIP=secret");
    await project.write("THIRD_PARTY_NOTICES.md", "# Notices\n");
    await project.write("icon.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const source = await validateProject(project.root, { stage: "dist" }); expect(source.valid).toBe(true);
    const result = await packProject(project.root);
    expect(result.path).toBe(join(project.root, ".aplg-output", finalName));
    const bytes = await fs.readFile(result.path); expect(result).toMatchObject({ size: bytes.length, sha256: sha(bytes), manifest: { id: "io.github.example.notes", version: "0.1.0" } });
    if (source.valid) expect(result.manifestSha256).toBe(source.manifestSha256);
    const inspection = await inspectPackage(result.path); expect(inspection.valid).toBe(true);
    if (!inspection.valid) return;
    expect(inspection.sha256).toBe(result.sha256); expect(inspection.size).toBe(result.size);
    const paths = inspection.files.map((file) => file.path);
    expect(paths).toEqual([...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
    expect(paths).toEqual(expect.arrayContaining(["aplg.json", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md", "icon.svg", "dist/aplg-build.json", "dist/index.html"]));
    expect(paths).not.toEqual(expect.arrayContaining(["package.json", "pnpm-lock.yaml", ".env", "src/main.ts"]));
  });

  test("mtime, timezone and filesystem enumeration do not change ZIP bytes or metadata", async () => {
    await project.write("THIRD_PARTY_NOTICES.md", "third"); await project.write("icon.png", new Uint8Array([137, 80, 78, 71]));
    const previous = process.env.TZ;
    try {
      process.env.TZ = "UTC"; const first = await packProject(project.root, { outDir: join(project.root, "out-a") });
      for (const file of ["aplg.json", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md", "icon.png", "dist/index.html"]) await fs.utimes(join(project.root, file), new Date(0), new Date(0));
      process.env.TZ = "America/Los_Angeles"; const second = await packProject(project.root, { outDir: join(project.root, "out-b") });
      const a = await fs.readFile(first.path); const b = await fs.readFile(second.path); expect(b).toEqual(a);
      const entries = await zipEntries(a); const names = entries.map((entry) => entry.name);
      expect(names).toEqual([...names].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y))));
      expect(entries.every((entry) => entry.time === 0 && entry.date === 0x21 && entry.mode === 0o100644 && entry.extra === 0)).toBe(true);
      expect(a.readUInt16LE(a.length - 2)).toBe(0);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });

  test("compression reads the private snapshot even if source files change after snapshotting", async () => {
    const before = await fs.readFile(join(project.root, "dist/index.html")); let changed = false;
    const original = ZipFile.prototype.addBuffer;
    const spy = vi.spyOn(ZipFile.prototype, "addBuffer").mockImplementation(function (buffer, name, options) {
      if (!changed) { changed = true; void fs.writeFile(join(project.root, "dist/index.html"), "tampered after snapshot"); }
      return original.call(this, buffer, name, options);
    });
    try {
      const result = await packProject(project.root, { outDir: join(project.root, "race-out") });
      const inspection = await inspectPackage(result.path); expect(inspection.valid).toBe(true);
      if (inspection.valid) expect(inspection.files.find((file) => file.path === "dist/index.html")?.sha256).toBe(sha(before));
      expect(await fs.readFile(join(project.root, "dist/index.html"), "utf8")).toBe("tampered after snapshot");
    } finally { spy.mockRestore(); }
  });
});

describe("no-clobber output and failure cleanup", () => {
  test("a repeated path rejects without replacing the existing package", async () => {
    const options = { outDir: join(project.root, "existing-out") }; const first = await packProject(project.root, options); const before = await fs.readFile(first.path);
    await expect(packProject(project.root, options)).rejects.toMatchObject({ code: "E_OUTPUT_EXISTS" });
    expect(await fs.readFile(first.path)).toEqual(before);
    expect((await fs.readdir(options.outDir)).filter((name) => name.includes(".staged.aplg"))).toEqual([]);
  });

  test("concurrent publishers produce exactly one final link and no staged files", async () => {
    const outDir = join(project.root, "concurrent-out"); const settled = await Promise.allSettled([packProject(project.root, { outDir }), packProject(project.root, { outDir })]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const failure = settled.find((item): item is PromiseRejectedResult => item.status === "rejected"); expect(failure?.reason).toMatchObject({ code: "E_OUTPUT_EXISTS" });
    expect(await fs.readdir(outDir)).toEqual([finalName]);
  });

  test("a post-link output identity failure removes the final link as well as staging", async () => {
    const outDir = join(project.root, "identity-out");
    const originalLink = fs.link.bind(fs); const originalLstat = fs.lstat.bind(fs); let alterOutput = false;
    const link = vi.spyOn(fs, "link").mockImplementation(async (source, target) => { await originalLink(source, target); alterOutput = true; });
    const lstat = vi.spyOn(fs, "lstat").mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await originalLstat(...args);
      if (alterOutput && String(args[0]) === outDir && typeof stat.mode === "bigint") {
        return new Proxy(stat, { get(target, property, receiver) { return property === "mode" ? target.mode ^ 1n : Reflect.get(target, property, receiver); } });
      }
      return stat;
    });
    try {
      await expect(packProject(project.root, { outDir })).rejects.toMatchObject({ code: "E_OUTPUT_PATH" });
      alterOutput = false;
      expect(await fs.readdir(outDir)).toEqual([]);
    } finally { lstat.mockRestore(); link.mockRestore(); }
  });

  test("dist and linked output directories are rejected before packaging", async () => {
    const inside = join(project.root, "dist", "packages");
    await expect(packProject(project.root, { outDir: inside })).rejects.toMatchObject({ code: "E_OUTPUT_PATH" });
    await expect(fs.access(inside)).rejects.toMatchObject({ code: "ENOENT" });
    const target = join(project.root, "external-target"); await fs.mkdir(target);
    const linked = join(project.root, "inside-link"); await fs.symlink(target, linked, process.platform === "win32" ? "junction" : "dir");
    await expect(packProject(project.root, { outDir: linked })).rejects.toMatchObject({ code: "E_PATH_SYMLINK" });
    expect(await fs.readdir(target)).toEqual([]);
  });

  test("an optional input link is rejected and never followed into the package", async () => {
    await project.write("source-icon.svg", "outside bytes");
    await fs.symlink(join(project.root, "source-icon.svg"), join(project.root, "icon.svg"));
    await expect(packProject(project.root)).rejects.toMatchObject({ code: "E_PATH_SYMLINK" });
    await expect(fs.access(join(project.root, ".aplg-output", finalName))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("a D2 self-inspection failure removes the stage and never creates final output", async () => {
    await project.reset({ "public/disguised.bin": new Uint8Array([0x4d, 0x5a, 0x90, 0]) });
    expect((await validateProject(project.root, { stage: "dist" })).valid).toBe(true);
    const outDir = join(project.root, "invalid-out");
    await expect(packProject(project.root, { outDir })).rejects.toMatchObject({ code: "E_PACKAGE_INVALID", diagnostics: expect.any(Array) });
    expect(await fs.readdir(outDir)).toEqual([]);
  });

  test("a missing manifest entry fails project validation before output is created", async () => {
    await fs.rm(join(project.root, "dist/index.html"));
    await expect(packProject(project.root)).rejects.toMatchObject({ code: "E_PROJECT_INVALID" });
    await expect(fs.access(join(project.root, ".aplg-output", finalName))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("missing build or license fails validation without invoking a build or leaving output", async () => {
    await fs.rm(join(project.root, "dist"), { recursive: true });
    await expect(packProject(project.root)).rejects.toMatchObject({ code: "E_PROJECT_INVALID" });
    await expect(fs.access(join(project.root, ".aplg-output", finalName))).rejects.toMatchObject({ code: "ENOENT" });
    await project.reset(); await fs.rm(join(project.root, "LICENSE"));
    await expect(packProject(project.root)).rejects.toMatchObject({ code: "E_PROJECT_INVALID" });
  });
});
