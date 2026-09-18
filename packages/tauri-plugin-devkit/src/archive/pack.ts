import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { constants, promises as fs, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { limits, type Diagnostic } from "@ai-switch/tauri-plugin-runtime/protocol";
import { ZipFile } from "yazl";
import { ProjectError, errorCode } from "../project/errors.js";
import {
  copyStableFile,
  createOwnedTemporaryDirectory,
  ensureRealDirectory,
  inspectPath,
  sameIdentity,
  samePath,
  type OwnedTemporaryDirectory,
  type PathSnapshot,
} from "../project/files.js";
import { readBoundedFile } from "../project/read.js";
import type { PackFile, PackProjectOptions, PackResult, ProjectReport } from "../project/types.js";
import { validateProject } from "../project/validate.js";
import { inspectPackage } from "./inspect.js";
import { createPathRegistry, entryPath } from "./paths.js";

interface SnapshotEntry extends PackFile { snapshotPath: string }
interface StageFile { path: string; identity: BigIntStats }
type ValidProjectReport = Extract<ProjectReport, { valid: true }>;
const optionalRootFiles = ["THIRD_PARTY_NOTICES.md", "icon.svg", "icon.png"] as const;
const utf8Order = (a: { path: string }, b: { path: string }) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8"));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const diagnosticError = (code: string, message: string, diagnostics: Diagnostic[], kind: "validation" | "io" = "validation") =>
  Object.assign(new ProjectError(code, message, "", kind), { diagnostics });

function optionsRecord(value: unknown): value is PackProjectOptions {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validLocalOption(path: string): boolean {
  return !!path && !/[\u0000-\u001f\u007f]/.test(path)
    && !/^(?:[a-z]:(?![\\/])|[a-z][a-z0-9+.-]*:\/\/|\\\\[?.]\\)/i.test(path);
}
function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function assertOutputDirectory(projectRoot: string, option?: string): string {
  if (option !== undefined && (typeof option !== "string" || !validLocalOption(option))) {
    throw new ProjectError("E_INVALID_ARGUMENT", "outDir must be an ordinary local filesystem path.");
  }
  const output = option === undefined ? join(projectRoot, ".aplg-output") : resolve(projectRoot, option);
  if (inside(join(projectRoot, "dist"), output)) throw new ProjectError("E_OUTPUT_PATH", "The package output directory cannot be inside dist.");
  return output;
}
async function assertExistingAncestorsSafe(path: string): Promise<void> {
  let current = path;
  while (true) {
    try {
      const inspected = await inspectPath(current);
      if (current === path && !inspected.stat.isDirectory()) throw new ProjectError("E_OUTPUT_PATH", "The package output path must be a directory.");
      return;
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      if (errorCode(error) !== "ENOENT") throw new ProjectError("E_IO", "The package output path could not be inspected.", "", "io");
      const parent = dirname(current);
      if (parent === current) throw new ProjectError("E_OUTPUT_PATH", "The package output directory has no usable ancestor.");
      current = parent;
    }
  }
}
async function assertDirectoryUnchanged(before: PathSnapshot): Promise<void> {
  const after = await inspectPath(before.absolute).catch((error: unknown) => {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError("E_OUTPUT_PATH", "The package output directory changed during publication.");
  });
  if (!samePath(before, after) || !sameIdentity(before.stat, after.stat)) {
    throw new ProjectError("E_OUTPUT_PATH", "The package output directory changed during publication.");
  }
}
async function assertOutputMissing(path: string): Promise<void> {
  try {
    await fs.lstat(path, { bigint: true });
    throw new ProjectError("E_OUTPUT_EXISTS", "The target APLG package already exists.");
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    if (errorCode(error) !== "ENOENT") throw new ProjectError("E_IO", "The target package path could not be inspected.", "", "io");
  }
}
async function unlinkOwnedFile(path: string, identity?: BigIntStats): Promise<void> {
  if (!identity) return;
  try {
    const current = await fs.lstat(path, { bigint: true });
    if (!current.isSymbolicLink() && sameIdentity(current, identity)) await fs.unlink(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw new ProjectError("E_IO", "A staged package file could not be removed safely.", "", "io");
  }
}
function wrapInputError(error: unknown, path: string): never {
  if (error instanceof ProjectError) throw new ProjectError(error.code, error.message, error.path || path, error.kind);
  throw new ProjectError("E_IO", "A package input could not be snapshotted.", path, "io");
}

async function snapshotCandidates(root: string, report: ValidProjectReport): Promise<{ owner: OwnedTemporaryDirectory; files: SnapshotEntry[] }> {
  const owner = await createOwnedTemporaryDirectory();
  try {
    const expected = new Map(report.files.map((file) => [file.path, file]));
    const paths = [...expected.keys()];
    for (const path of optionalRootFiles) {
      if (expected.has(path)) continue;
      try {
        await fs.lstat(join(root, path), { bigint: true });
        paths.push(path);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") wrapInputError(error, path);
      }
    }
    paths.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    if (paths.length > limits.archiveEntries) throw new ProjectError("E_LIMIT_EXCEEDED", "The package contains too many files.");

    const registry = createPathRegistry();
    const files: SnapshotEntry[] = [];
    let expandedBytes = 0;
    for (const [index, path] of paths.entries()) {
      let policy;
      try { policy = entryPath(path); registry.add(path, false); }
      catch (error) { wrapInputError(error, path); }
      const wanted = expected.get(path);
      const maxBytes = wanted ? Math.min(policy.limit, wanted.size) : policy.limit;
      const snapshotPath = join(owner.path, `${String(index).padStart(5, "0")}.snapshot`);
      let actual;
      try { actual = await copyStableFile(join(root, ...path.split("/")), snapshotPath, maxBytes); }
      catch (error) { wrapInputError(error, path); }
      if (wanted && (actual.size !== wanted.size || actual.sha256 !== wanted.sha256)) {
        throw new ProjectError("E_FILE_CHANGED", "A validated package input changed before snapshotting.", path);
      }
      expandedBytes += actual.size;
      if (expandedBytes > limits.archiveExtractedBytes) throw new ProjectError("E_LIMIT_EXCEEDED", "Package inputs exceed the expanded byte budget.");
      files.push({ path, size: actual.size, sha256: actual.sha256, snapshotPath });
    }
    return { owner, files };
  } catch (error) {
    try { await owner.dispose(); } catch { /* preserve the primary safe error */ }
    throw error;
  }
}

async function createStagedArchive(output: PathSnapshot, files: SnapshotEntry[]): Promise<StageFile> {
  await assertDirectoryUnchanged(output);
  const stagePath = join(output.absolute, `.${randomBytes(16).toString("hex")}.staged.aplg`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let identity: BigIntStats | undefined;
  try {
    handle = await fs.open(stagePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    identity = await handle.stat({ bigint: true });
    if (!identity.isFile() || identity.size !== 0n) throw new ProjectError("E_OUTPUT_WRITE", "The staged package file could not be created safely.", "", "io");

    const zip = new ZipFile();
    const outputStream = handle.createWriteStream({ autoClose: false });
    const zipStream = zip.outputStream as Readable;
    const onZipError = (error: Error) => outputStream.destroy(error);
    zip.once("error", onZipError);
    const writing = pipeline(zipStream, outputStream);
    let openedAfter: BigIntStats | undefined;
    try {
      const mtime = new Date(1980, 0, 1, 0, 0, 0, 0);
      for (const file of files) {
        const bytes = Buffer.from(await readBoundedFile(file.snapshotPath, file.size));
        if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new ProjectError("E_FILE_CHANGED", "The private package snapshot changed before compression.", file.path);
        zip.addBuffer(bytes, file.path, {
          mtime,
          mode: 0o100644,
          compressionLevel: 9,
          forceDosTimestamp: true,
          forceZip64Format: false,
        });
      }
      zip.end({ forceZip64Format: false, comment: "" });
      await writing;
      await handle.sync();
      openedAfter = await handle.stat({ bigint: true });
    } catch (error) {
      zipStream.destroy(error instanceof Error ? error : new Error("Archive creation failed."));
      outputStream.destroy();
      await writing.catch(() => undefined);
      throw error;
    } finally {
      zip.off("error", onZipError);
      if (!outputStream.destroyed) outputStream.destroy();
      if (!outputStream.closed) await once(outputStream, "close");
    }
    if (!openedAfter || !sameIdentity(identity, openedAfter) || !openedAfter.isFile()) throw new ProjectError("E_OUTPUT_WRITE", "The staged package file identity changed.", "", "io");
    await handle.close(); handle = undefined;

    const staged = await inspectPath(stagePath);
    await assertDirectoryUnchanged(output);
    if (!staged.stat.isFile() || !sameIdentity(identity, staged.stat)) throw new ProjectError("E_OUTPUT_WRITE", "The staged package path changed before validation.", "", "io");
    return { path: stagePath, identity: staged.stat };
  } catch (error) {
    try { await handle?.close(); } catch { /* cleanup below remains best-effort */ }
    await unlinkOwnedFile(stagePath, identity).catch(() => undefined);
    if (error instanceof ProjectError) throw error;
    throw new ProjectError("E_OUTPUT_WRITE", "The APLG archive could not be written.", "", "io");
  }
}

function sameFiles(expected: SnapshotEntry[], actual: PackFile[]): boolean {
  const left = expected.map(({ path, size, sha256 }) => ({ path, size, sha256 })).sort(utf8Order);
  const right = actual.map(({ path, size, sha256 }) => ({ path, size, sha256 })).sort(utf8Order);
  return JSON.stringify(left) === JSON.stringify(right);
}
async function publishNoClobber(stage: StageFile, finalPath: string, output: PathSnapshot): Promise<void> {
  await assertDirectoryUnchanged(output);
  let linked = false;
  try {
    try { await fs.link(stage.path, finalPath); linked = true; }
    catch (error) {
      if (errorCode(error) === "EEXIST") throw new ProjectError("E_OUTPUT_EXISTS", "The target APLG package already exists.");
      throw new ProjectError("E_OUTPUT_PUBLISH", "This filesystem could not publish the package with atomic no-clobber semantics.", "", "io");
    }
    const staged = await fs.lstat(stage.path, { bigint: true }).catch(() => undefined);
    const final = await fs.lstat(finalPath, { bigint: true }).catch(() => undefined);
    if (!staged?.isFile() || !final?.isFile() || staged.isSymbolicLink() || final.isSymbolicLink()
      || !sameIdentity(stage.identity, staged) || !sameIdentity(staged, final)) {
      throw new ProjectError("E_OUTPUT_PUBLISH", "The published package identity could not be verified.", "", "io");
    }
    await assertDirectoryUnchanged(output);
    try { await fs.unlink(stage.path); }
    catch { throw new ProjectError("E_OUTPUT_PUBLISH", "The staged package link could not be finalized safely.", "", "io"); }
  } catch (error) {
    if (linked) await unlinkOwnedFile(finalPath, stage.identity).catch(() => undefined);
    throw error;
  }
}

/** Build output must already exist. This function snapshots and packages only. */
export async function packProject(root: string, options: PackProjectOptions = {}): Promise<PackResult> {
  let snapshot: { owner: OwnedTemporaryDirectory; files: SnapshotEntry[] } | undefined;
  let stage: StageFile | undefined;
  try {
    if (!optionsRecord(options) || Object.keys(options).some((key) => key !== "outDir" && key !== "profile")) {
      throw new ProjectError("E_INVALID_ARGUMENT", "Expected only optional outDir and web-v1 profile values.");
    }
    if (options.profile !== undefined && options.profile !== "web-v1") throw new ProjectError("E_PROFILE_UNSUPPORTED", "Only the web-v1 profile is supported.");
    const report = await validateProject(root, { stage: "dist", profile: options.profile ?? "web-v1" });
    if (!report.valid) throw diagnosticError("E_PROJECT_INVALID", "The project is not ready to package.", report.diagnostics);
    const project = await inspectPath(root);
    if (!project.stat.isDirectory()) throw new ProjectError("E_PROJECT_INVALID", "The project root must be an ordinary directory.");

    const outDir = assertOutputDirectory(project.absolute, options.outDir);
    const finalPath = join(outDir, `${report.manifest.id}-${report.manifest.version}.aplg`);
    await assertExistingAncestorsSafe(outDir);
    await assertOutputMissing(finalPath);

    snapshot = await snapshotCandidates(project.absolute, report);
    const output = await ensureRealDirectory(outDir).catch((error: unknown) => {
      if (error instanceof ProjectError) throw error;
      throw new ProjectError("E_IO", "The package output directory could not be created.", "", "io");
    });
    await assertOutputMissing(finalPath);
    stage = await createStagedArchive(output, snapshot.files);

    const inspection = await inspectPackage(stage.path);
    if (!inspection.valid) throw diagnosticError("E_PACKAGE_INVALID", "The generated package failed self-inspection.", inspection.diagnostics);
    if (!sameFiles(snapshot.files, inspection.files)
      || JSON.stringify(inspection.manifest) !== JSON.stringify(report.manifest)) {
      throw diagnosticError("E_PACKAGE_INVALID", "The generated package differs from its private snapshot.", [{
        code: "E_PACKAGE_CONTENT", path: "", message: "Self-inspected package files or manifest differ from the validated snapshot.",
      }]);
    }

    await snapshot.owner.dispose(); snapshot = undefined;
    await publishNoClobber(stage, finalPath, output); stage = undefined;
    return {
      path: finalPath,
      sha256: inspection.sha256,
      size: inspection.size,
      manifest: report.manifest,
      manifestSha256: report.manifestSha256,
    };
  } catch (error) {
    if (stage) await unlinkOwnedFile(stage.path, stage.identity).catch(() => undefined);
    if (snapshot) await snapshot.owner.dispose().catch(() => undefined);
    if (error instanceof ProjectError) throw error;
    throw new ProjectError("E_IO", "The APLG package could not be created.", "", "io");
  }
}
