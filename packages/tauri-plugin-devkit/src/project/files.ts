import { createHash, randomBytes } from "node:crypto";
import { constants, promises as fs, type BigIntStats } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { ProjectError, errorCode } from "./errors.js";

export interface PathSnapshot {
  absolute: string;
  directories: { path: string; stat: BigIntStats }[];
  stat: BigIntStats;
}
export interface StableFileSnapshot { size: number; sha256: string }
export interface OwnedTemporaryDirectory { path: string; dispose(): Promise<void> }

export function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
}
export function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
export function samePath(a: PathSnapshot, b: PathSnapshot): boolean {
  return a.absolute === b.absolute && a.directories.length === b.directories.length
    && a.directories.every((part, index) => part.path === b.directories[index].path && sameIdentity(part.stat, b.directories[index].stat));
}
function localAbsolute(input: string): string {
  if (typeof input !== "string" || !input || /[\u0000-\u001f\u007f]/.test(input)
    || process.platform === "win32" && /^(?:[a-z]:(?![\\/])|\\\\[?.]\\)/i.test(input)) {
    throw new ProjectError("E_INVALID_ARGUMENT", "An ordinary local filesystem path is required.");
  }
  return resolve(input);
}

/** lstat every component, including ancestor junctions, before opening a file. */
export async function inspectPath(input: string): Promise<PathSnapshot> {
  const absolute = localAbsolute(input);
  const root = parse(absolute).root;
  const parts = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  const directories: PathSnapshot["directories"] = [];
  for (let index = 0; index <= parts.length; index++) {
    if (index) current = join(current, parts[index - 1]);
    const stat = await fs.lstat(current, { bigint: true });
    if (stat.isSymbolicLink()) throw new ProjectError("E_PATH_SYMLINK", "Symbolic links and junctions are not allowed in filesystem paths.");
    if (index === parts.length) return { absolute, directories, stat };
    if (!stat.isDirectory()) throw new ProjectError("E_FILE_TYPE", "A path ancestor is not a directory.");
    directories.push({ path: current, stat });
  }
  throw new ProjectError("E_INVALID_ARGUMENT", "The local filesystem path is invalid.");
}

/** Create a directory one component at a time without accepting linked ancestors. */
export async function ensureRealDirectory(input: string): Promise<PathSnapshot> {
  const absolute = localAbsolute(input);
  const root = parse(absolute).root;
  const parts = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  const directories: PathSnapshot["directories"] = [];
  for (let index = 0; index <= parts.length; index++) {
    if (index) current = join(current, parts[index - 1]);
    let stat: BigIntStats;
    try {
      stat = await fs.lstat(current, { bigint: true });
    } catch (error) {
      if (index === 0 || errorCode(error) !== "ENOENT") throw error;
      try { await fs.mkdir(current, { mode: 0o700 }); }
      catch (mkdirError) { if (errorCode(mkdirError) !== "EEXIST") throw mkdirError; }
      stat = await fs.lstat(current, { bigint: true });
    }
    if (stat.isSymbolicLink()) throw new ProjectError("E_PATH_SYMLINK", "Symbolic links and junctions are not allowed in output paths.");
    if (!stat.isDirectory()) throw new ProjectError("E_OUTPUT_PATH", "The output path must contain only ordinary directories.");
    if (index === parts.length) return { absolute, directories, stat };
    directories.push({ path: current, stat });
  }
  throw new ProjectError("E_OUTPUT_PATH", "The output directory could not be created.");
}

async function safeUnlink(path: string, identity?: BigIntStats): Promise<void> {
  if (!identity) return;
  try {
    const current = await fs.lstat(path, { bigint: true });
    if (!current.isSymbolicLink() && sameIdentity(identity, current)) await fs.unlink(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/** Copy one stable regular file into an exclusively-created private snapshot. */
export async function copyStableFile(input: string, output: string, maxBytes: number): Promise<StableFileSnapshot> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new ProjectError("E_INVALID_ARGUMENT", "A nonnegative safe byte limit is required.");
  const before = await inspectPath(input);
  if (!before.stat.isFile()) throw new ProjectError("E_FILE_TYPE", "Package inputs must be regular files.");
  if (before.stat.size > BigInt(maxBytes)) throw new ProjectError("E_LIMIT_EXCEEDED", "Package input exceeds its byte limit.");
  const parent = await inspectPath(dirname(output));
  if (!parent.stat.isDirectory()) throw new ProjectError("E_FILE_TYPE", "The private snapshot parent must be a directory.");

  const source = await fs.open(before.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)).catch((error: unknown) => {
    if (errorCode(error) === "ELOOP") throw new ProjectError("E_PATH_SYMLINK", "The package input became a symbolic link.");
    throw error;
  });
  let destination: Awaited<ReturnType<typeof fs.open>> | undefined;
  let destinationIdentity: BigIntStats | undefined;
  let completed = false;
  try {
    const opened = await source.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(before.stat, opened)) throw new ProjectError("E_FILE_CHANGED", "The package input changed before snapshotting.");
    destination = await fs.open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    destinationIdentity = await destination.stat({ bigint: true });
    if (!destinationIdentity.isFile() || destinationIdentity.size !== 0n) throw new ProjectError("E_FILE_TYPE", "The private snapshot could not be created safely.");

    const digest = createHash("sha256");
    const expectedSize = Number(opened.size);
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, expectedSize)));
    let offset = 0;
    while (offset < expectedSize) {
      const length = Math.min(buffer.length, expectedSize - offset);
      const read = await source.read(buffer, 0, length, offset);
      if (!read.bytesRead) throw new ProjectError("E_FILE_CHANGED", "The package input was truncated while snapshotting.");
      digest.update(buffer.subarray(0, read.bytesRead));
      let written = 0;
      while (written < read.bytesRead) {
        const result = await destination.write(buffer, written, read.bytesRead - written, offset + written);
        if (!result.bytesWritten) throw new ProjectError("E_IO", "The private package snapshot could not be written.", "", "io");
        written += result.bytesWritten;
      }
      offset += read.bytesRead;
    }
    const extra = await source.read(Buffer.alloc(1), 0, 1, offset);
    if (extra.bytesRead) throw new ProjectError("E_FILE_CHANGED", "The package input grew while snapshotting.");
    await destination.sync();

    const after = await inspectPath(input).catch((error: unknown) => {
      if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) throw new ProjectError("E_FILE_CHANGED", "The package input was removed while snapshotting.");
      throw error;
    });
    const parentAfter = await inspectPath(parent.absolute);
    const sourceAfter = await source.stat({ bigint: true });
    const destinationAfter = await destination.stat({ bigint: true });
    if (!samePath(before, after) || !sameFile(opened, sourceAfter) || !sameFile(opened, after.stat)) throw new ProjectError("E_FILE_CHANGED", "The package input changed while snapshotting.");
    if (!samePath(parent, parentAfter) || !sameIdentity(parent.stat, parentAfter.stat)
      || !sameIdentity(destinationIdentity, destinationAfter) || destinationAfter.size !== opened.size) {
      throw new ProjectError("E_FILE_CHANGED", "The private package snapshot changed while it was written.");
    }
    const result = { size: expectedSize, sha256: digest.digest("hex") };
    completed = true;
    return result;
  } finally {
    try { await destination?.close(); } finally {
      await source.close();
    }
    // Failed copies must not leave partially-written files in the private directory.
    if (!completed) await safeUnlink(output, destinationIdentity);
  }
}

/** A marker and inode check guard recursive cleanup of this process-owned temp tree. */
export async function createOwnedTemporaryDirectory(prefix = "aplg-pack-"): Promise<OwnedTemporaryDirectory> {
  if (!/^[a-z0-9][a-z0-9-]*-$/i.test(prefix)) throw new ProjectError("E_INVALID_ARGUMENT", "A safe temporary directory prefix is required.");
  const parent = await inspectPath(tmpdir());
  if (!parent.stat.isDirectory()) throw new ProjectError("E_IO", "The temporary directory is unavailable.", "", "io");
  const path = await fs.mkdtemp(join(parent.absolute, prefix));
  const markerPath = join(path, ".aplg-owner");
  const token = randomBytes(32).toString("hex");
  let created: PathSnapshot | undefined;
  let owned: PathSnapshot | undefined;
  try {
    await fs.chmod(path, 0o700);
    created = await inspectPath(path);
    const parentAfter = await inspectPath(parent.absolute);
    if (!created.stat.isDirectory() || dirname(created.absolute) !== parent.absolute
      || !samePath(parent, parentAfter) || !sameIdentity(parent.stat, parentAfter.stat)) {
      throw new ProjectError("E_IO", "The temporary directory could not be created safely.", "", "io");
    }
    await fs.writeFile(markerPath, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
    owned = await inspectPath(path);
    if (!sameIdentity(created.stat, owned.stat)) throw new ProjectError("E_IO", "The temporary directory identity changed during creation.", "", "io");
  } catch (error) {
    if (created) {
      const current = await fs.lstat(path, { bigint: true }).catch(() => undefined);
      if (current && !current.isSymbolicLink() && sameIdentity(current, created.stat) && dirname(path) === parent.absolute) {
        await fs.rm(path, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    throw error;
  }

  let disposed = false;
  return {
    path: owned.absolute,
    async dispose(): Promise<void> {
      if (disposed) return;
      let current: PathSnapshot;
      try { current = await inspectPath(owned!.absolute); }
      catch { throw new ProjectError("E_TEMP_CLEANUP", "The private package snapshot could not be safely removed.", "", "io"); }
      if (!samePath(owned!, current) || !sameIdentity(owned!.stat, current.stat) || dirname(current.absolute) !== parent.absolute) {
        throw new ProjectError("E_TEMP_CLEANUP", "The private package snapshot identity changed before cleanup.", "", "io");
      }
      const markerBefore = await inspectPath(markerPath).catch(() => undefined);
      if (!markerBefore?.stat.isFile()) throw new ProjectError("E_TEMP_CLEANUP", "The private package snapshot ownership marker is missing.", "", "io");
      const marker = await fs.readFile(markerPath, "utf8").catch(() => undefined);
      const markerAfter = await inspectPath(markerPath).catch(() => undefined);
      if (marker !== token || !markerAfter || !samePath(markerBefore, markerAfter) || !sameFile(markerBefore.stat, markerAfter.stat)) {
        throw new ProjectError("E_TEMP_CLEANUP", "The private package snapshot ownership marker changed.", "", "io");
      }
      await fs.rm(current.absolute, { recursive: true, force: false });
      disposed = true;
    },
  };
}
