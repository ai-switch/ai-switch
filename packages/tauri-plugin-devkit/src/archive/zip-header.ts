import { limits } from "@ai-switch/tauri-plugin-runtime/protocol";
import type { Entry } from "yauzl";
import { ProjectError } from "../project/errors.js";
import type { ArchiveSource } from "./source.js";

const fail = (code: string, message: string): never => { throw new ProjectError(code, message); };
export interface ZipLayout { count: number; centralStart: number; centralEnd: number }
export interface CheckedHeader {
  name: Buffer; flags: number; method: number; crc32: number; size: number; compressedSize: number;
  dataStart: number; nextLocal: number; nextCentral: number; attributes: number; madeBy: number;
  localOffset: number; needed: number; time: number; date: number; extra: Buffer; comment: Buffer;
}

/** Parse EOCD ourselves before yauzl sees ZIP64/multidisk or oversized metadata. */
export async function readZipLayout(source: ArchiveSource): Promise<ZipLayout> {
  if (source.size < 22) fail("E_ARCHIVE_HEADER", "The ZIP end record is missing.");
  const tailStart = Math.max(0, source.size - 65557); const tail = await source.bytes(tailStart, source.size - tailStart);
  let end = -1;
  for (let offset = tail.length - 22; offset >= 0; offset--) if (tail.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  if (end < 0 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length) fail("E_ARCHIVE_HEADER", "The ZIP end record or trailing data is invalid.");
  const count = tail.readUInt16LE(end + 10); const size = tail.readUInt32LE(end + 12); const start = tail.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) fail("E_ARCHIVE_PROFILE", "ZIP64 is not supported by web-v1.");
  if (count > limits.archiveEntries) fail("E_LIMIT_EXCEEDED", "The archive exceeds 10000 entries.");
  if (tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0 || tail.readUInt16LE(end + 8) !== count) fail("E_ARCHIVE_PROFILE", "Multidisk ZIP archives are not supported.");
  const centralEnd = tailStart + end;
  if (start + size !== centralEnd || size < count * 46) fail("E_ARCHIVE_HEADER", "The ZIP central directory bounds are invalid.");
  return { count, centralStart: start, centralEnd };
}

function checkExtra(bytes: Buffer, central: boolean): void {
  const seen = new Set<number>();
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) fail("E_ARCHIVE_HEADER", "Truncated ZIP extra field.");
    const id = bytes.readUInt16LE(offset); const length = bytes.readUInt16LE(offset + 2); offset += 4;
    if (offset + length > bytes.length) fail("E_ARCHIVE_HEADER", "Truncated ZIP extra field data.");
    // Only the harmless Info-ZIP timestamp emitted by yazl is admitted. ZIP64,
    // Unicode path overrides, NTFS/security descriptors and vendor fields fail closed.
    if (id !== 0x5455 || seen.has(id)) fail("E_ARCHIVE_PROFILE", "Unsupported or repeated ZIP extra field.");
    seen.add(id);
    const flags = bytes[offset];
    const expected = central ? 5 : 1 + ((flags & 1) ? 4 : 0) + ((flags & 2) ? 4 : 0) + ((flags & 4) ? 4 : 0);
    if (!(flags & 1) || flags & ~7 || length !== expected) fail("E_ARCHIVE_HEADER", "Invalid ZIP timestamp extra field.");
    offset += length;
  }
}

/** Both headers, payload ranges and physical layout are checked independently. */
export async function checkNextHeader(source: ArchiveSource, layout: ZipLayout, central: number): Promise<CheckedHeader> {
  if (central + 46 > layout.centralEnd) fail("E_ARCHIVE_HEADER", "ZIP central entries exceed their directory.");
  const fixed = await source.bytes(central, 46);
  if (fixed.readUInt32LE(0) !== 0x02014b50) fail("E_ARCHIVE_HEADER", "Invalid central ZIP signature.");
  const madeBy = fixed.readUInt16LE(4); const needed = fixed.readUInt16LE(6); const flags = fixed.readUInt16LE(8); const method = fixed.readUInt16LE(10);
  const time = fixed.readUInt16LE(12); const date = fixed.readUInt16LE(14); const crc32 = fixed.readUInt32LE(16);
  const compressedSize = fixed.readUInt32LE(20); const size = fixed.readUInt32LE(24);
  const nameLength = fixed.readUInt16LE(28); const extraLength = fixed.readUInt16LE(30); const commentLength = fixed.readUInt16LE(32);
  const localOffset = fixed.readUInt32LE(42);
  if (![10, 20].includes(needed) || method === 8 && needed !== 20 || fixed.readUInt16LE(36) & ~1 || flags & ~0x806 || ![0, 8].includes(method) || method === 0 && flags & 6 || fixed.readUInt16LE(34) || size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) fail("E_ARCHIVE_PROFILE", "Encrypted, descriptor, ZIP64 or unsupported compression entries are forbidden.");
  if (!nameLength || nameLength > 4096 || extraLength > 4096 || commentLength > 4096) fail("E_LIMIT_EXCEEDED", "ZIP entry metadata exceeds its budget.");
  const nextCentral = central + 46 + nameLength + extraLength + commentLength;
  if (nextCentral > layout.centralEnd || localOffset + 30 > layout.centralStart) fail("E_ARCHIVE_HEADER", "ZIP records overlap, contain gaps, or use inconsistent offsets.");
  const variable = await source.bytes(central + 46, nameLength + extraLength + commentLength);
  const name = variable.subarray(0, nameLength); const extra = variable.subarray(nameLength, nameLength + extraLength); const comment = variable.subarray(nameLength + extraLength);
  checkExtra(extra, true);
  const local = await source.bytes(localOffset, 30);
  if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(4) !== needed || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || local.readUInt16LE(10) !== time || local.readUInt16LE(12) !== date || local.readUInt32LE(14) !== crc32 || local.readUInt32LE(18) !== compressedSize || local.readUInt32LE(22) !== size || local.readUInt16LE(26) !== nameLength) fail("E_ARCHIVE_HEADER", "Local and central ZIP headers do not agree.");
  const localExtraLength = local.readUInt16LE(28);
  if (localExtraLength > 4096) fail("E_LIMIT_EXCEEDED", "Local ZIP metadata exceeds its budget.");
  const dataStart = localOffset + 30 + nameLength + localExtraLength;
  if (dataStart + compressedSize > layout.centralStart) fail("E_ARCHIVE_HEADER", "ZIP payload overlaps the central directory.");
  const localVariable = await source.bytes(localOffset + 30, nameLength + localExtraLength);
  if (!localVariable.subarray(0, nameLength).equals(name)) fail("E_ARCHIVE_HEADER", "Local and central ZIP names differ.");
  checkExtra(localVariable.subarray(nameLength), false);
  return { name, flags, method, crc32, size, compressedSize, dataStart, nextLocal: dataStart + compressedSize, nextCentral, attributes: fixed.readUInt32LE(38), madeBy, localOffset, needed, time, date, extra, comment };
}

export function matchYauzlEntry(entry: Entry, checked: CheckedHeader): void {
  if (!entry.fileNameRaw.equals(checked.name) || entry.generalPurposeBitFlag !== checked.flags || entry.compressionMethod !== checked.method || entry.crc32 !== checked.crc32 || entry.uncompressedSize !== checked.size || entry.compressedSize !== checked.compressedSize || entry.relativeOffsetOfLocalHeader !== checked.localOffset || entry.externalFileAttributes !== checked.attributes || entry.versionMadeBy !== checked.madeBy || entry.versionNeededToExtract !== checked.needed || entry.lastModFileTime !== checked.time || entry.lastModFileDate !== checked.date || !entry.extraFieldRaw.equals(checked.extra) || !entry.fileCommentRaw.equals(checked.comment)) fail("E_ARCHIVE_HEADER", "ZIP parser metadata differs from the independently checked record.");
}
