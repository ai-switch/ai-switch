import { fromRandomAccessReaderPromise, type Entry, type ZipFile } from "yauzl";
import { limits } from "@ai-switch/tauri-plugin-runtime/protocol";
import { ProjectError } from "../project/errors.js";
import { decodeUtf8, parseStrictJson } from "../project/read.js";
import { validateWebManifest } from "../project/manifest.js";
import type { PackFile } from "../project/types.js";
import { checkEntryMode, createPathRegistry, decodeEntryName, entryPath } from "./paths.js";
import { zipOperation } from "./errors.js";
import { inspectContent } from "./content.js";
import { openArchiveSource } from "./source.js";
import { checkNextHeader, matchYauzlEntry, readZipLayout } from "./zip-header.js";
import type { PackageInspection } from "./types.js";

/** Structure/content inspection only: no extraction, execution or signature trust. */
export async function inspectPackage(file: string): Promise<PackageInspection> {
  try {
    if (typeof file !== "string" || !file.endsWith(".aplg")) throw new ProjectError("E_ARCHIVE_EXTENSION", "A file with the exact .aplg extension is required.");
    const source = await openArchiveSource(file);
    let zip: ZipFile | undefined; let iterator: AsyncIterableIterator<Entry> | undefined;
    try {
      const layout = await readZipLayout(source);
      zip = await zipOperation(() => fromRandomAccessReaderPromise(source, source.size, { autoClose: false, lazyEntries: true, decodeStrings: false, validateEntrySizes: false, strictFileNames: true }));
      if (zip.entryCount !== layout.count) throw new ProjectError("E_ARCHIVE_HEADER", "ZIP entry count differs between parsers.");
      iterator = zip.eachEntry();
      const registry = createPathRegistry(); const files: PackFile[] = []; const budget = { expanded: 0 };
      const ranges: { start: number; end: number }[] = [];
      let manifestBytes: Buffer | undefined; let central = layout.centralStart; let declared = 0;
      for (let index = 0; index < layout.count; index++) {
        const header = await checkNextHeader(source, layout, central);
        central = header.nextCentral;
        const rangeIndex = ranges.findIndex((range) => range.start >= header.localOffset);
        const insert = rangeIndex < 0 ? ranges.length : rangeIndex;
        if ((insert > 0 && ranges[insert - 1].end > header.localOffset) || (insert < ranges.length && ranges[insert].start < header.nextLocal)) throw new ProjectError("E_ARCHIVE_HEADER", "ZIP local records overlap.");
        ranges.splice(insert, 0, { start: header.localOffset, end: header.nextLocal });
        const name = decodeEntryName(header.name, header.flags); const path = entryPath(name);
        checkEntryMode(header.attributes, header.madeBy, path.directory);
        registry.add(path.path, path.directory);
        declared += header.size;
        if (header.size > path.limit || declared > limits.archiveExtractedBytes) throw new ProjectError("E_LIMIT_EXCEEDED", "Declared expanded ZIP bytes exceed the archive or member budget.", path.path);
        if (path.directory && (header.size !== 0 || header.compressedSize !== 0 || header.crc32 !== 0 || header.method !== 0)) throw new ProjectError("E_ARCHIVE_HEADER", "Directory records must be stored with zero data and CRC.", path.path);
        const next = await zipOperation(() => iterator!.next());
        if (next.done) throw new ProjectError("E_ARCHIVE_HEADER", "The ZIP directory ended early.");
        matchYauzlEntry(next.value, header);
        if (!path.directory) {
          const content = await inspectContent(zip, next.value, header, path.path, path.limit, budget);
          files.push(content.file);
          if (content.manifestBytes) manifestBytes = content.manifestBytes;
        }
      }
      let localEnd = 0;
      for (const range of ranges) {
        if (range.start !== localEnd) throw new ProjectError("E_ARCHIVE_HEADER", "ZIP has a prefix, gaps or unreferenced local records.");
        localEnd = range.end;
      }
      if (central !== layout.centralEnd || localEnd !== layout.centralStart || !(await zipOperation(() => iterator!.next())).done) throw new ProjectError("E_ARCHIVE_HEADER", "ZIP contains unmatched, hidden or overlapping records.");
      if (!manifestBytes || !files.some((entry) => entry.path === "LICENSE" && entry.size > 0)) throw new ProjectError("E_ARCHIVE_REQUIRED", "The archive must contain one aplg.json and a nonempty LICENSE.");
      let manifestInput: unknown;
      try { manifestInput = parseStrictJson(decodeUtf8(manifestBytes)); }
      catch (error) {
        if (error instanceof ProjectError) return { valid: false, signature: "not-verified", diagnostics: [error.diagnostic("aplg.json")] };
        throw error;
      }
      const manifest = validateWebManifest(manifestInput);
      if (!manifest.ok) return { valid: false, signature: "not-verified", diagnostics: manifest.diagnostics.map((d) => ({ ...d, path: `aplg.json${d.path}` })) };
      if (!files.some((entry) => entry.path === manifest.value.entry)) throw new ProjectError("E_ARCHIVE_ENTRY", "The manifest HTML entry is absent from the archive.", "aplg.json/entry");
      await source.assertUnchanged();
      const sha256 = await source.sha256();
      await source.assertUnchanged();
      return { valid: true, manifest: manifest.value, sha256, size: source.size, files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), signature: "not-verified", diagnostics: [] };
    } finally {
      try { try { await iterator?.return?.(); } finally { zip?.close(); } }
      finally { await source.dispose(); }
    }
  } catch (error) {
    if (error instanceof ProjectError) {
      if (error.kind === "io") throw error;
      return { valid: false, signature: "not-verified", diagnostics: [error.diagnostic()] };
    }
    throw new ProjectError("E_INTERNAL", "The archive inspection could not be completed.", "", "io");
  }
}
