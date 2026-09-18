import { AplgError, errorCodes } from "../../protocol/errors.js";
import { validateVirtualPath } from "../../protocol/path-policy.js";
import type { FsError } from "./types.js";

const known = new Set<string>([...errorCodes, "ENOENT", "EACCES", "EPERM", "EEXIST", "ENOTDIR", "EISDIR", "ENOTEMPTY", "EXDEV", "EINVAL", "ENOSPC", "EIO", "EBUSY", "EROFS", "EBADF", "ENAMETOOLONG", "EMFILE", "ELOOP", "ERR_APLG_SYNC_IO_UNSUPPORTED"]);
export function invalidArgument(): never { throw new AplgError("E_INVALID_ARGUMENT", "Unsupported filesystem argument or option."); }
export function checkArity(count: number, min: number, max: number) { if (count < min || count > max) invalidArgument(); }
export function toFsError(error: unknown, syscall: string, path?: unknown, dest?: unknown): FsError {
  let code = "EIO";
  try {
    if (error && typeof error === "object") {
      const descriptor = Object.getOwnPropertyDescriptor(error, "code");
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string" && known.has(descriptor.value)) code = descriptor.value;
    }
  } catch { /* Never evaluate a hostile thrown object's accessors. */ }
  const result: FsError = Object.assign(new Error(`Filesystem operation failed: ${syscall} (${code}).`), { name: "FileSystemError", code, syscall });
  try { if (typeof path === "string") result.path = validateVirtualPath(path); } catch { /* No real paths in errors. */ }
  try { if (typeof dest === "string") result.dest = validateVirtualPath(dest); } catch { /* No real paths in errors. */ }
  return result;
}
export function unsupportedSync(): never {
  throw toFsError({ code: "ERR_APLG_SYNC_IO_UNSUPPORTED" }, "sync");
}
