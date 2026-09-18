import { validateJson } from "./json-safety.js";
import { validateVirtualPath } from "./path-policy.js";
import type { JsonObject, JsonValue } from "./types.js";
import type { WireMessage } from "./generated/types.generated.js";

export type ErrorPayload = Extract<WireMessage, { kind: "error" }>["error"];

export const errorCodes = Object.freeze([
  "E_CAPABILITY_UNAVAILABLE", "E_PERMISSION_DENIED", "E_SESSION_CLOSED", "E_TIMEOUT",
  "E_CANCELLED", "E_LIMIT_EXCEEDED", "E_PROTOCOL_MISMATCH", "E_INVALID_ARGUMENT",
  "E_INVALID_MESSAGE", "E_HOST_UNAVAILABLE",
] as const);
export type AplgErrorCode = typeof errorCodes[number];

/** Only construct this with a deliberately public message and JSON details. */
export class AplgError extends Error {
  readonly code: AplgErrorCode;
  readonly details?: JsonValue;

  constructor(code: AplgErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = "AplgError";
    this.code = code;
    this.details = details;
  }
}

const fileErrors = new Set(["ENOENT", "EACCES", "EPERM", "EEXIST", "ENOTDIR", "EISDIR", "ENOTEMPTY", "EXDEV", "EINVAL", "ENOSPC", "EIO", "EBUSY", "EROFS"]);
const publicSyscalls = new Set(["open", "read", "write", "stat", "scandir", "mkdir", "rename", "copyfile", "unlink", "rmdir"]);

function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function toErrorPayload(error: unknown): ErrorPayload {
  const fallback: ErrorPayload = { code: "E_HOST_UNAVAILABLE", message: "The host operation failed." };
  try {
    if (error instanceof AplgError && errorCodes.includes(error.code)) {
      const publicError: ErrorPayload = { code: error.code, message: error.message.slice(0, 8192) };
      if (error.details !== undefined) {
        const safe = validateJson(error.details, 65536);
        if (safe.ok) publicError.details = safe.value;
      }
      return publicError;
    }
    const code = ownData(error, "code");
    if (typeof code === "string" && fileErrors.has(code)) {
      const details: JsonObject = {};
      const syscall = ownData(error, "syscall");
      if (typeof syscall === "string" && publicSyscalls.has(syscall)) details.syscall = syscall;
      const path = ownData(error, "path");
      if (typeof path === "string") {
        try { details.path = validateVirtualPath(path); } catch { /* Never expose an OS path. */ }
      }
      return { code, message: "The filesystem operation failed.", ...(Object.keys(details).length ? { details } : {}) };
    }
  } catch {
    // Hostile thrown objects and accessors cannot prevent a safe error reply.
  }
  return fallback;
}
