import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import type { Entry, ZipFile } from "yauzl";
import { limits } from "@ai-switch/tauri-plugin-runtime/protocol";
import { ProjectError } from "../project/errors.js";
import { zipOperation } from "./errors.js";
import { createCrc32 } from "./crc32.js";
import type { CheckedHeader } from "./zip-header.js";

export interface ContentBudget { expanded: number }
export async function inspectContent(zip: ZipFile, entry: Entry, header: Pick<CheckedHeader, "method" | "size" | "compressedSize" | "crc32">, path: string, limit: number, budget: ContentBudget) {
  // Request compressed bytes from yauzl. Our own inflater allows checking bytes
  // consumed, including trailing compressed payload, rather than trusting headers.
  const raw = await zipOperation(() => zip.openReadStreamPromise(entry, { decodeFileData: false }));
  const inflater = header.method === 8 ? createInflateRaw() : undefined;
  const crc = createCrc32(); const hash = createHash("sha256");
  const chunks: Buffer[] = []; let size = 0; let prefix = Buffer.alloc(0); let tail = "";
  let failure: ProjectError | undefined;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        size += chunk.length; budget.expanded += chunk.length;
        if (size > limit || budget.expanded > limits.archiveExtractedBytes) throw new ProjectError("E_LIMIT_EXCEEDED", "Actual expanded ZIP bytes exceed the archive or member budget.", path);
        if (size > header.size) throw new ProjectError("E_ARCHIVE_SIZE", "Actual ZIP member bytes exceed the declared size.", path);
        if (prefix.length < 4) prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
        const nativePrefix = (prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a) || (prefix.length === 4 && [0x7f454c46, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(prefix.readUInt32BE(0)));
        if (nativePrefix) throw new ProjectError("E_ARCHIVE_CONTENT", "Recognizable native executable content is not a web-v1 asset.", path);
        const text = tail + chunk.toString("latin1");
        if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text)) throw new ProjectError("E_ARCHIVE_CONTENT", "Private key material is not a plugin asset.", path);
        tail = text.slice(-80);
        hash.update(chunk); crc.update(chunk);
        if (path === "aplg.json") chunks.push(Buffer.from(chunk));
        callback();
      } catch (error) { failure = error instanceof ProjectError ? error : new ProjectError("E_ARCHIVE_CONTENT", "The ZIP member could not be inspected.", path); callback(failure); }
    },
  });
  try {
    if (inflater) await pipeline(raw, inflater, sink);
    else await pipeline(raw, sink);
  } catch (error) {
    if (failure) throw failure;
    if (error instanceof ProjectError) throw error;
    throw new ProjectError("E_ARCHIVE_DECOMPRESSION", "ZIP payload could not be decompressed safely.", path);
  } finally { raw.destroy(); inflater?.destroy(); sink.destroy(); }
  if (size !== header.size || inflater && inflater.bytesWritten !== header.compressedSize) throw new ProjectError("E_ARCHIVE_SIZE", "Actual ZIP payload size differs from its headers.", path);
  if (crc.digest() !== header.crc32) throw new ProjectError("E_ARCHIVE_CRC", "ZIP member CRC does not match its actual bytes.", path);
  return { file: { path, size, sha256: hash.digest("hex") }, manifestBytes: path === "aplg.json" ? Buffer.concat(chunks) : undefined };
}
