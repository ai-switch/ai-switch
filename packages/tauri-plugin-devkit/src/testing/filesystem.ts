import {
  AplgError,
  limits,
  validateCapabilityRequest,
  validateVirtualPath,
  type JsonObject,
  type JsonValue,
} from "@ai-switch/tauri-plugin-runtime/protocol";

type FileNode = { kind: "file"; bytes: Uint8Array; mtimeMs: number } | { kind: "directory"; mtimeMs: number };
export interface MemoryFileSnapshot { [path: string]: Uint8Array }
interface Transfer {
  sessionId: string;
  path: string;
  mode: "read" | "write";
  bytes: Uint8Array;
  expectedSize?: number;
  writeMode?: "w" | "wx" | "a" | "ax";
  existedAtOpen?: boolean;
  receivedBytes?: number;
}

const dataRoot = "/data";
const now = () => 0;
const cloneBytes = (value: Uint8Array) => new Uint8Array(value);
const byteCompare = (a: Uint8Array, b: Uint8Array) => {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
};
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
const pathRoot = (path: string) => path.startsWith("/mounts/") ? path.split("/").slice(0, 3).join("/") : path.split("/").slice(0, 2).join("/");
function fsError(code: string, message: string, path?: string, dest?: string): Error {
  return Object.assign(new Error(message), { code, syscall: "test", path, dest });
}
function normalize(path: unknown): string {
  if (typeof path !== "string") throw new AplgError("E_INVALID_ARGUMENT", "A virtual filesystem path is required.");
  try { return validateVirtualPath(path); }
  catch { throw new AplgError("E_INVALID_ARGUMENT", "A virtual filesystem path is required."); }
}
function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}
function isDescendant(path: string, parent: string): boolean { return path.startsWith(parent === "/" ? "/" : `${parent}/`); }

export class MemoryFileSystem {
  private readonly nodes = new Map<string, FileNode>([[dataRoot, { kind: "directory", mtimeMs: now() }]]);
  private readonly transfers = new Map<string, Transfer>();
  private sequence = 0;

  constructor(initial: MemoryFileSnapshot = {}) {
    for (const [rawPath, bytes] of Object.entries(initial)) {
      const path = normalize(rawPath);
      if (path !== dataRoot && !isDescendant(path, dataRoot)) throw new AplgError("E_INVALID_ARGUMENT", "Memory files must be under /data.");
      if (path === dataRoot || !bytes || typeof bytes.length !== "number") throw new AplgError("E_INVALID_ARGUMENT", "Memory file entries must be regular files under /data.");
      this.ensureParents(path);
      if (this.nodes.has(path)) throw new AplgError("E_INVALID_ARGUMENT", "Memory file paths must be unique.");
      if (bytes.byteLength > limits.fileBytes) throw new AplgError("E_LIMIT_EXCEEDED", "A memory file exceeds the negotiated file limit.");
      this.nodes.set(path, { kind: "file", bytes: cloneBytes(bytes), mtimeMs: now() });
    }
  }

  private ensureParents(path: string): void {
    const parts = path.split("/").slice(2, -1);
    let current = dataRoot;
    for (const part of parts) {
      current += `/${part}`;
      const existing = this.nodes.get(current);
      if (existing && existing.kind !== "directory") throw fsError("ENOTDIR", "A path component is not a directory.", current);
      if (!existing) this.nodes.set(current, { kind: "directory", mtimeMs: now() });
    }
  }
  private node(path: string): FileNode {
    const node = this.nodes.get(path);
    if (!node) throw fsError("ENOENT", "The requested memory file does not exist.", path);
    return node;
  }
  private directory(path: string): Extract<FileNode, { kind: "directory" }> {
    const node = this.node(path);
    if (node.kind !== "directory") throw fsError("ENOTDIR", "The requested memory path is not a directory.", path);
    return node;
  }
  private owns(sessionId: string, handle: string): Transfer {
    const transfer = this.transfers.get(handle);
    if (!transfer || transfer.sessionId !== sessionId) throw new AplgError("E_PERMISSION_DENIED", "The file transfer handle belongs to another session.");
    return transfer;
  }
  private newHandle(): string { return `test-file-${++this.sequence}`; }

  snapshot(): MemoryFileSnapshot {
    const result: MemoryFileSnapshot = {};
    for (const [path, node] of this.nodes) if (node.kind === "file") result[path] = cloneBytes(node.bytes);
    return result;
  }
  clear(): void { this.nodes.clear(); this.transfers.clear(); this.nodes.set(dataRoot, { kind: "directory", mtimeMs: now() }); }
  abortSession(sessionId: string): void { for (const [handle, transfer] of this.transfers) if (transfer.sessionId === sessionId) this.transfers.delete(handle); }
  abortAll(): void { this.transfers.clear(); }

  call(sessionId: string, method: string, params: JsonValue): JsonValue {
    const checked = validateCapabilityRequest("aplg.fs", method, params);
    if (!checked.ok) throw new AplgError("E_INVALID_ARGUMENT", "Invalid test filesystem request.");
    const value = checked.value as JsonObject;
    switch (method) {
      case "stat": return this.stat(value.path as string);
      case "readdir": return this.readdir(value.path as string);
      case "mkdir": return this.mkdir(value.path as string, value.recursive as boolean);
      case "rename": return this.rename(value.from as string, value.to as string);
      case "copyFile": return this.copyFile(value.from as string, value.to as string);
      case "rm": return this.rm(value.path as string, value.recursive as boolean, value.force as boolean);
      case "transfer.openRead": return this.openRead(sessionId, value.path as string);
      case "transfer.openWrite": return this.openWrite(sessionId, value.path as string, value.size as number, value.mode as Transfer["writeMode"]);
      case "transfer.pull": return this.pull(sessionId, value.handle as string, value.offset as number, value.length as number);
      case "transfer.push": return this.push(sessionId, value.handle as string, value.offset as number, value.dataBase64 as string);
      case "transfer.finish": return this.finish(sessionId, value.handle as string);
      case "transfer.abort": return this.abort(sessionId, value.handle as string);
      default: throw new AplgError("E_CAPABILITY_UNAVAILABLE", "The test filesystem method is unavailable.");
    }
  }
  private stat(rawPath: string): JsonValue {
    const path = normalize(rawPath); const node = this.node(path);
    return { kind: node.kind, size: node.kind === "file" ? node.bytes.byteLength : 0, mtimeMs: node.mtimeMs };
  }
  private readdir(rawPath: string): JsonValue {
    const path = normalize(rawPath); this.directory(path);
    const children = new Map<string, "file" | "directory">();
    for (const [candidate, node] of this.nodes) {
      if (candidate === path || !isDescendant(candidate, path)) continue;
      const rest = candidate.slice(path === "/" ? 1 : path.length + 1);
      if (rest.includes("/")) children.set(rest.slice(0, rest.indexOf("/")), "directory");
      else children.set(rest, node.kind);
    }
    return [...children.entries()].sort((a, b) => byteCompare(new TextEncoder().encode(a[0]), new TextEncoder().encode(b[0]))).map(([name, kind]) => ({ name, kind }));
  }
  private mkdir(rawPath: string, recursive: boolean): JsonValue {
    const path = normalize(rawPath); if (path === dataRoot) return { createdPath: null };
    if (this.nodes.has(path)) {
      if (this.nodes.get(path)!.kind !== "directory") throw fsError("EEXIST", "A file already exists at the requested path.", path);
      if (!recursive) throw fsError("EEXIST", "The directory already exists.", path);
      return { createdPath: null };
    }
    const parent = parentOf(path);
    if (recursive) {
      this.ensureParents(`${path}/placeholder`);
    } else {
      this.directory(parent);
    }
    this.nodes.set(path, { kind: "directory", mtimeMs: now() });
    return { createdPath: path };
  }
  private rename(rawFrom: string, rawTo: string): JsonValue {
    const from = normalize(rawFrom); const to = normalize(rawTo);
    if (pathRoot(from) !== pathRoot(to)) throw fsError("EXDEV", "Cross-grant rename is unsupported.", from, to);
    const source = this.node(from); if (this.nodes.has(to)) throw fsError("EEXIST", "The destination already exists.", to);
    this.directory(parentOf(to));
    const entries = [...this.nodes.entries()].filter(([path]) => path === from || isDescendant(path, from));
    for (const [path] of entries) this.nodes.delete(path);
    for (const [path, node] of entries) this.nodes.set(to + path.slice(from.length), node);
    void source;
    return null;
  }
  private copyFile(rawFrom: string, rawTo: string): JsonValue {
    const from = normalize(rawFrom); const to = normalize(rawTo); const source = this.node(from);
    if (source.kind !== "file") throw fsError("EISDIR", "The source is a directory.", from);
    this.directory(parentOf(to)); this.nodes.set(to, { kind: "file", bytes: cloneBytes(source.bytes), mtimeMs: now() }); return null;
  }
  private rm(rawPath: string, recursive: boolean, force: boolean): JsonValue {
    const path = normalize(rawPath);
    if (path === dataRoot) throw fsError("EACCES", "The /data root cannot be removed.", path);
    if (!this.nodes.has(path)) { if (force) return null; throw fsError("ENOENT", "The requested memory path does not exist.", path); }
    const node = this.nodes.get(path)!;
    const descendants = [...this.nodes.keys()].filter((candidate) => isDescendant(candidate, path));
    if (node.kind === "directory" && descendants.length && !recursive) throw fsError("ENOTEMPTY", "The memory directory is not empty.", path);
    for (const candidate of [path, ...descendants]) this.nodes.delete(candidate);
    return null;
  }
  private openRead(sessionId: string, rawPath: string): JsonValue {
    const path = normalize(rawPath); const node = this.node(path); if (node.kind !== "file") throw fsError("EISDIR", "The requested memory path is a directory.", path);
    const handle = this.newHandle(); this.transfers.set(handle, { sessionId, path, mode: "read", bytes: cloneBytes(node.bytes) }); return { handle, size: node.bytes.byteLength };
  }
  private openWrite(sessionId: string, rawPath: string, size: number, mode: Transfer["writeMode"]): JsonValue {
    const path = normalize(rawPath); if (size < 0 || size > limits.fileBytes) throw new AplgError("E_LIMIT_EXCEEDED", "The memory write exceeds the file limit.");
    this.directory(parentOf(path)); const existing = this.nodes.get(path); const existed = !!existing;
    if (existing?.kind === "directory") throw fsError("EISDIR", "The requested memory path is a directory.", path);
    if ((mode === "wx" || mode === "ax") && existed) throw fsError("EEXIST", "The memory file already exists.", path);
    const handle = this.newHandle(); this.transfers.set(handle, { sessionId, path, mode: "write", bytes: new Uint8Array(size), expectedSize: size, writeMode: mode, existedAtOpen: existed, receivedBytes: 0 }); return { handle };
  }
  private pull(sessionId: string, handle: string, offset: number, length: number): JsonValue {
    const transfer = this.owns(sessionId, handle); if (transfer.mode !== "read") throw new AplgError("E_INVALID_ARGUMENT", "The transfer handle is not readable.");
    if (offset < 0 || length < 0 || offset + length > transfer.bytes.byteLength) throw fsError("EINVAL", "The requested memory range is invalid.");
    return { offset, dataBase64: encodeBase64(transfer.bytes.subarray(offset, offset + length)) };
  }
  private push(sessionId: string, handle: string, offset: number, encoded: string): JsonValue {
    const transfer = this.owns(sessionId, handle); if (transfer.mode !== "write") throw new AplgError("E_INVALID_ARGUMENT", "The transfer handle is not writable.");
    let decoded: Uint8Array;
    try { const binary = atob(encoded); decoded = Uint8Array.from(binary, (char) => char.charCodeAt(0)); } catch { throw new AplgError("E_INVALID_ARGUMENT", "The memory chunk is not valid base64."); }
    if (offset < 0 || offset + decoded.length > transfer.bytes.byteLength) throw fsError("EINVAL", "The memory write range is invalid.");
    transfer.bytes.set(decoded, offset); transfer.receivedBytes = (transfer.receivedBytes ?? 0) + decoded.length;
    if ((transfer.receivedBytes ?? 0) > (transfer.expectedSize ?? 0)) throw new AplgError("E_INVALID_ARGUMENT", "The memory file received too many bytes.");
    return { written: decoded.length };
  }
  private finish(sessionId: string, handle: string): JsonValue {
    const transfer = this.owns(sessionId, handle);
    if (transfer.mode === "write") {
      if ((transfer.receivedBytes ?? 0) !== transfer.expectedSize) throw new AplgError("E_INVALID_ARGUMENT", "The memory file transfer is incomplete.");
      if (transfer.writeMode === "a" || transfer.writeMode === "ax") {
        const existing = this.nodes.get(transfer.path); const prefix = existing?.kind === "file" ? existing.bytes : new Uint8Array();
        const combined = new Uint8Array(prefix.length + transfer.bytes.length); combined.set(prefix); combined.set(transfer.bytes, prefix.length); this.nodes.set(transfer.path, { kind: "file", bytes: combined, mtimeMs: now() });
      } else this.nodes.set(transfer.path, { kind: "file", bytes: cloneBytes(transfer.bytes), mtimeMs: now() });
    }
    this.transfers.delete(handle); return null;
  }
  private abort(sessionId: string, handle: string): JsonValue {
    this.owns(sessionId, handle); this.transfers.delete(handle); return null;
  }
}

export function cloneMemoryFiles(value: Record<string, Uint8Array> | undefined): MemoryFileSnapshot | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AplgError("E_INVALID_ARGUMENT", "memoryFiles must be an object of virtual paths and byte arrays.");
  return Object.fromEntries(Object.entries(value).map(([path, bytes]) => [path, cloneBytes(bytes)]));
}
