import { constants, promises as fs } from "node:fs";
import { createScanner, getNodePath, getNodeValue, parseTree, SyntaxKind, type Node, type ParseError } from "jsonc-parser";
import { ProjectError, errorCode } from "./errors.js";
import { inspectPath, sameFile, samePath } from "./files.js";

/** Exact-byte snapshot. A read budget is enforced both before and during I/O. */
export async function readBoundedFile(path: string, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new ProjectError("E_INVALID_ARGUMENT", "A nonnegative safe byte limit is required.");
  const before = await inspectPath(path);
  if (!before.stat.isFile()) throw new ProjectError("E_FILE_TYPE", "Project inputs must be regular files.");
  if (before.stat.size > BigInt(maxBytes)) throw new ProjectError("E_LIMIT_EXCEEDED", "Project input exceeds its byte limit.");
  const handle = await fs.open(before.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)).catch((error: unknown) => {
    if (errorCode(error) === "ELOOP") throw new ProjectError("E_PATH_SYMLINK", "The project input became a symbolic link.");
    throw error;
  });
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(before.stat, opened)) throw new ProjectError("E_FILE_CHANGED", "The project input changed before reading.");
    const size = Number(opened.size); const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const length = Math.min(64 * 1024, size - offset, maxBytes - offset);
      const read = await handle.read(bytes, offset, length, offset);
      if (read.bytesRead === 0) throw new ProjectError("E_FILE_CHANGED", "The project input was truncated during reading.");
      offset += read.bytesRead;
    }
    const extra = await handle.read(new Uint8Array(1), 0, 1, offset);
    if (extra.bytesRead) throw new ProjectError("E_FILE_CHANGED", "The project input grew during reading.");
    const after = await inspectPath(path).catch((error: unknown) => {
      if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) throw new ProjectError("E_FILE_CHANGED", "The project input was removed during reading.");
      throw error;
    });
    if (!samePath(before, after) || !sameFile(opened, await handle.stat({ bigint: true })) || !sameFile(opened, after.stat)) throw new ProjectError("E_FILE_CHANGED", "The project input changed during reading.");
    return bytes;
  } finally { await handle.close(); }
}

export function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new ProjectError("E_UTF8", "Project metadata must use valid UTF-8."); }
}

/** Parse data, not code. AST inspection rejects duplicate keys before materialization. */
export function parseStrictJson(text: string): unknown {
  if (typeof text !== "string") throw new ProjectError("E_JSON_SYNTAX", "JSON text is required.");
  if (text.length > 1024 * 1024) throw new ProjectError("E_LIMIT_EXCEEDED", "JSON exceeds the parser text budget.");
  function invalid(code: string, message: string, offset: number, path = ""): never {
    const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
    throw new ProjectError(code, `${message} (line ${lines.length}, column ${lines.at(-1)!.length + 1}).`, path);
  }
  if (text.startsWith("\uFEFF")) invalid("E_JSON_SYNTAX", "JSON must not start with a byte order mark", 0);
  // jsonc-parser constructs its tree recursively; bound container nesting first
  // with its scanner so hostile input cannot overflow before the AST is checked.
  const scanner = createScanner(text, false); const containers: SyntaxKind[] = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
      containers.push(token);
      if (containers.length > 64) invalid("E_JSON_DEPTH", "JSON nesting exceeds 64 levels", scanner.getTokenOffset());
    } else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) {
      const expected = token === SyntaxKind.CloseBraceToken ? SyntaxKind.OpenBraceToken : SyntaxKind.OpenBracketToken;
      if (containers.pop() !== expected) invalid("E_JSON_SYNTAX", "Mismatched JSON container", scanner.getTokenOffset());
    }
  }
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false });
  if (errors.length || !tree) invalid("E_JSON_SYNTAX", "Strict JSON syntax is required", errors[0]?.offset ?? 0);
  const pointer = (node: Node) => getNodePath(node).map((part) => `/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
  let nodes = 0;
  function visit(node: Node) {
    if (++nodes > 100000) invalid("E_LIMIT_EXCEEDED", "JSON node budget exceeded", node.offset);
    if (node.type === "number" && !Number.isFinite(node.value)) invalid("E_JSON_SYNTAX", "JSON numbers must be finite", node.offset, pointer(node));
    if (node.type === "object") {
      const names = new Set<string>();
      for (const property of node.children ?? []) {
        const [key, value] = property.children!;
        const name = key.value as string;
        if (names.has(name)) invalid("E_JSON_DUPLICATE_KEY", "Duplicate object key", key.offset, pointer(value));
        if (["__proto__", "prototype", "constructor"].includes(name)) invalid("E_JSON_UNSAFE_KEY", "Unsafe object key", key.offset, pointer(value));
        names.add(name); visit(value);
      }
    } else if (node.type === "array") for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return getNodeValue(tree) as unknown;
}
