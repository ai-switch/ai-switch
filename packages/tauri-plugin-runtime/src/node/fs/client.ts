import type { Buffer } from "../buffer.js";
import { AplgError } from "../../protocol/errors.js";
import { createBackend } from "./backend.js";
import { createLifecycle } from "./lifecycle.js";
import { createTransferClient } from "./transfer.js";
import { boolOptions, filePath, readEncoding, snapshotData, virtualRoot, writeMode } from "./options.js";
import { checkArity, toFsError } from "./errors.js";
import type { CapabilityCall, DirectoryEntry, FsClientOptions, FsPromises, FileStats, ReadFileOptions, WriteFileOptions, AppendFileOptions, ReaddirOptions, MkdirOptions, RemoveOptions } from "./types.js";
import type { SessionInfo } from "../../protocol/wire.js";

export function createFsClient(call: CapabilityCall, session: () => Promise<SessionInfo>, options: FsClientOptions = {}): FsPromises {
  const lifecycle = createLifecycle(session, options);
  const backend = createBackend(call);
  const transfers = createTransferClient(backend);
  const api = {
    async readFile(path: string, options?: ReadFileOptions): Promise<Buffer | string> {
      try {
        checkArity(arguments.length, 1, 2); const normalized = filePath(path); const encoding = readEncoding(options);
        const data = await lifecycle.run((context) => transfers.read(context, normalized));
        return encoding === "utf8" ? data.toString("utf8") : data;
      } catch (error) { throw toFsError(error, "readFile", path); }
    },
    async writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void> {
      try {
        checkArity(arguments.length, 2, 3); const normalized = filePath(path); const mode = writeMode(options, false); const copy = snapshotData(data);
        await lifecycle.run((context) => transfers.write(context, normalized, copy, mode));
      } catch (error) { throw toFsError(error, "writeFile", path); }
    },
    async appendFile(path: string, data: string | Uint8Array, options?: AppendFileOptions): Promise<void> {
      try {
        checkArity(arguments.length, 2, 3); const normalized = filePath(path); const mode = writeMode(options, true); const copy = snapshotData(data);
        await lifecycle.run((context) => transfers.write(context, normalized, copy, mode));
      } catch (error) { throw toFsError(error, "appendFile", path); }
    },
    async readdir(path: string, options?: ReaddirOptions): Promise<string[] | DirectoryEntry[]> {
      try {
        checkArity(arguments.length, 1, 2); const normalized = filePath(path); const parsed = boolOptions(options, ["withFileTypes"]);
        const entries = await lifecycle.run((context) => backend.invoke(context, "readdir", { path: normalized }));
        return parsed.withFileTypes ? entries.map(({ name, kind }) => Object.freeze({ name, isFile: () => kind === "file", isDirectory: () => kind === "directory" })) : entries.map((entry) => entry.name);
      } catch (error) { throw toFsError(error, "readdir", path); }
    },
    async stat(path: string): Promise<FileStats> {
      try {
        checkArity(arguments.length, 1, 1); const normalized = filePath(path);
        const entry = await lifecycle.run((context) => backend.invoke(context, "stat", { path: normalized }));
        const { kind, size, mtimeMs } = entry;
        return Object.freeze({ size, mtimeMs, isFile: () => kind === "file", isDirectory: () => kind === "directory" });
      } catch (error) { throw toFsError(error, "stat", path); }
    },
    async mkdir(path: string, options?: MkdirOptions): Promise<string | undefined> {
      try {
        checkArity(arguments.length, 1, 2); const normalized = filePath(path); const parsed = boolOptions(options, ["recursive"]);
        const result = await lifecycle.run((context) => backend.invoke(context, "mkdir", { path: normalized, recursive: parsed.recursive }));
        if (result.createdPath !== null) {
          const created = filePath(result.createdPath);
          if (virtualRoot(created) !== virtualRoot(normalized) || !(created === normalized || normalized.startsWith(created + "/"))) {
            throw new AplgError("E_INVALID_MESSAGE", "The created directory path does not match the request.");
          }
        }
        return parsed.recursive ? result.createdPath ?? undefined : undefined;
      } catch (error) { throw toFsError(error, "mkdir", path); }
    },
    async rename(from: string, to: string): Promise<void> {
      try {
        checkArity(arguments.length, 2, 2); const source = filePath(from); const destination = filePath(to);
        if (virtualRoot(source) !== virtualRoot(destination)) throw Object.assign(new Error("Cross-grant rename is unsupported."), { code: "EXDEV" });
        await lifecycle.run((context) => backend.invoke(context, "rename", { from: source, to: destination }));
      } catch (error) { throw toFsError(error, "rename", from, to); }
    },
    async copyFile(from: string, to: string): Promise<void> {
      try {
        checkArity(arguments.length, 2, 2); const source = filePath(from); const destination = filePath(to);
        await lifecycle.run((context) => backend.invoke(context, "copyFile", { from: source, to: destination }));
      } catch (error) { throw toFsError(error, "copyFile", from, to); }
    },
    async rm(path: string, options?: RemoveOptions): Promise<void> {
      try {
        checkArity(arguments.length, 1, 2); const normalized = filePath(path); const parsed = boolOptions(options, ["recursive", "force"]);
        await lifecycle.run((context) => backend.invoke(context, "rm", { path: normalized, recursive: parsed.recursive, force: parsed.force }));
      } catch (error) { throw toFsError(error, "rm", path); }
    },
  };
  return Object.freeze(api) as FsPromises;
}
