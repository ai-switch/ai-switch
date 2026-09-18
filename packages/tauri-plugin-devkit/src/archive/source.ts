import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { RandomAccessReader } from "yauzl";
import { limits } from "@ai-switch/tauri-plugin-runtime/protocol";
import { ProjectError, errorCode } from "../project/errors.js";
import { inspectPath, sameFile, samePath, type PathSnapshot } from "../project/files.js";

const ioFailure = () => new ProjectError("E_IO", "The archive could not be read.", "", "io");
export class ArchiveSource extends RandomAccessReader {
  private pending = new Set<Promise<unknown>>();
  private closed = false;
  readonly size: number;
  constructor(private handle: FileHandle, private before: PathSnapshot) { super(); this.size = Number(before.stat.size); }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    return operation;
  }
  async bytes(offset: number, length: number): Promise<Buffer> {
    if (this.closed) throw new ProjectError("E_FILE_CHANGED", "The archive is no longer open.");
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.size) throw new ProjectError("E_ARCHIVE_HEADER", "A ZIP read extends beyond the archive.");
    return this.track(this.readRange(offset, length));
  }
  private async readRange(offset: number, length: number): Promise<Buffer> {
    const bytes = Buffer.alloc(length); let done = 0;
    while (done < length) {
      const { bytesRead } = await this.handle.read(bytes, done, Math.min(length - done, 65536), offset + done).catch(() => { throw ioFailure(); });
      if (!bytesRead) throw new ProjectError("E_ARCHIVE_HEADER", "The ZIP file is truncated.");
      done += bytesRead;
    }
    return bytes;
  }
  override read(buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | null) => void): void {
    void this.bytes(position, length).then((bytes) => { bytes.copy(buffer, offset); callback(null); }, (error: unknown) => callback(error instanceof Error ? error : ioFailure()));
  }
  override _readStreamForRange(start: number, end: number): Readable {
    const source = this;
    return Readable.from((async function* () {
      for (let offset = start; offset < end; offset += 65536) yield await source.bytes(offset, Math.min(65536, end - offset));
    })(), { objectMode: false });
  }
  // yauzl closes its logical reader; the FileHandle is owned by inspect's finally.
  override close(callback: (error: Error | null) => void): void { callback(null); }
  async assertUnchanged(): Promise<void> {
    try {
      const after = await inspectPath(this.before.absolute);
      if (!samePath(this.before, after) || !sameFile(this.before.stat, after.stat) || !sameFile(this.before.stat, await this.handle.stat({ bigint: true }))) throw new ProjectError("E_FILE_CHANGED", "The archive changed during inspection.");
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) throw new ProjectError("E_FILE_CHANGED", "The archive was removed during inspection.");
      throw ioFailure();
    }
  }
  async sha256(): Promise<string> {
    const hash = createHash("sha256");
    for (let offset = 0; offset < this.size; offset += 65536) hash.update(await this.bytes(offset, Math.min(65536, this.size - offset)));
    return hash.digest("hex");
  }
  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
    try { await this.handle.close(); } catch { throw ioFailure(); }
  }
}
export async function openArchiveSource(file: string): Promise<ArchiveSource> {
  let before: PathSnapshot;
  try { before = await inspectPath(file); }
  catch (error) {
    if (error instanceof ProjectError) throw error;
    if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) throw new ProjectError("E_ARCHIVE_FILE", "The archive must be an existing regular file.");
    throw ioFailure();
  }
  if (!before.stat.isFile()) throw new ProjectError("E_ARCHIVE_FILE", "The archive must be a regular file.");
  if (before.stat.size > BigInt(limits.archiveBytes)) throw new ProjectError("E_LIMIT_EXCEEDED", "The archive exceeds the 128 MiB compressed limit.");
  let handle: FileHandle;
  try { handle = await fs.open(before.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch (error) { if (errorCode(error) === "ELOOP") throw new ProjectError("E_PATH_SYMLINK", "The archive became a link."); throw ioFailure(); }
  const source = new ArchiveSource(handle, before);
  try { await source.assertUnchanged(); return source; }
  catch (error) { await source.dispose(); throw error; }
}
