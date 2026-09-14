import { writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { validProjectFiles } from "./project.js";

// Deliberately independent of production CRC/pack code. All header inconsistencies
// are authored directly so the inspector never generates its own expected input.
function fixtureCrc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export interface ZipFixtureEntry {
  name: string; data: string | Uint8Array; unixMode?: number;
  flags?: number; method?: number; crc32?: number; compressedSize?: number; uncompressedSize?: number;
  nameBytes?: Uint8Array; localName?: string; localNameBytes?: Uint8Array;
  localFlags?: number; localMethod?: number; localCrc32?: number;
  localCompressedSize?: number; localUncompressedSize?: number; localOffset?: number;
  extra?: Uint8Array; localExtra?: Uint8Array; comment?: Uint8Array;
  versionNeeded?: number; localVersionNeeded?: number; versionMadeBy?: number;
  diskStart?: number; externalAttributes?: number; internalAttributes?: number;
  compressedData?: Uint8Array;
}
export interface ZipFixtureOverrides {
  entries?: number; entriesOnDisk?: number; disk?: number; centralDisk?: number;
  centralSize?: number; centralOffset?: number; comment?: Uint8Array; prefix?: Uint8Array; suffix?: Uint8Array;
}
export function validArchiveEntries(): ZipFixtureEntry[] {
  const files = validProjectFiles();
  return [
    { name: "aplg.json", data: files["aplg.json"] },
    { name: "LICENSE", data: files.LICENSE },
    { name: "dist/index.html", data: '<!doctype html><script type="module" src="./main.js"></script>' },
    { name: "dist/main.js", data: 'document.body.append("ready");', method: 8 },
  ];
}
export function zipFixtureBytes(entries: ZipFixtureEntry[], overrides: ZipFixtureOverrides = {}): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = [];
  let offset = overrides.prefix?.length ?? 0;
  if (overrides.prefix) local.push(Buffer.from(overrides.prefix));
  for (const entry of entries) {
    const data = Buffer.from(entry.data);
    const raw = Buffer.from(entry.compressedData ?? (entry.method === 8 ? deflateRawSync(data) : data));
    const name = Buffer.from(entry.nameBytes ?? Buffer.from(entry.name));
    const localName = Buffer.from(entry.localNameBytes ?? (entry.localName !== undefined ? Buffer.from(entry.localName) : name));
    const extra = Buffer.from(entry.extra ?? []); const localExtra = Buffer.from(entry.localExtra ?? []); const comment = Buffer.from(entry.comment ?? []);
    const crc = entry.crc32 ?? fixtureCrc(data);
    const size = entry.compressedSize ?? raw.length; const expanded = entry.uncompressedSize ?? data.length;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(entry.localVersionNeeded ?? entry.versionNeeded ?? 20, 4);
    header.writeUInt16LE(entry.localFlags ?? entry.flags ?? 0, 6); header.writeUInt16LE(entry.localMethod ?? entry.method ?? 0, 8);
    header.writeUInt16LE(0x21, 12); header.writeUInt32LE(entry.localCrc32 ?? crc, 14);
    header.writeUInt32LE(entry.localCompressedSize ?? size, 18); header.writeUInt32LE(entry.localUncompressedSize ?? expanded, 22);
    header.writeUInt16LE(localName.length, 26); header.writeUInt16LE(localExtra.length, 28);
    local.push(header, localName, localExtra, raw);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(entry.versionMadeBy ?? 0x033f, 4);
    directory.writeUInt16LE(entry.versionNeeded ?? 20, 6); directory.writeUInt16LE(entry.flags ?? 0, 8); directory.writeUInt16LE(entry.method ?? 0, 10);
    directory.writeUInt16LE(0x21, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(size, 20); directory.writeUInt32LE(expanded, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt16LE(extra.length, 30); directory.writeUInt16LE(comment.length, 32);
    directory.writeUInt16LE(entry.diskStart ?? 0, 34); directory.writeUInt16LE(entry.internalAttributes ?? 0, 36);
    const mode = entry.unixMode ?? (entry.name.endsWith("/") ? 0o040755 : 0o100644);
    directory.writeUInt32LE(entry.externalAttributes ?? (((mode << 16) | (entry.name.endsWith("/") ? 0x10 : 0)) >>> 0), 38);
    directory.writeUInt32LE(entry.localOffset ?? offset, 42);
    central.push(directory, name, extra, comment);
    offset += header.length + localName.length + localExtra.length + raw.length;
  }
  const centralBytes = Buffer.concat(central); const comment = Buffer.from(overrides.comment ?? []);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(overrides.disk ?? 0, 4); end.writeUInt16LE(overrides.centralDisk ?? 0, 6);
  end.writeUInt16LE(overrides.entriesOnDisk ?? overrides.entries ?? entries.length, 8); end.writeUInt16LE(overrides.entries ?? entries.length, 10);
  end.writeUInt32LE(overrides.centralSize ?? centralBytes.length, 12); end.writeUInt32LE(overrides.centralOffset ?? offset, 16); end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...local, centralBytes, end, comment, Buffer.from(overrides.suffix ?? [])]);
}
export async function writeZipFixture(file: string, entries: ZipFixtureEntry[], overrides?: ZipFixtureOverrides): Promise<void> {
  await writeFile(file, zipFixtureBytes(entries, overrides));
}
