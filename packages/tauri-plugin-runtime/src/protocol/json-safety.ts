import { limits } from "./limits.js";
import type { Diagnostic, JsonValue, ValidationResult } from "./types.js";

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const encoder = new TextEncoder();

/** Validate before schema traversal or serialization; never read an accessor. */
export function validateJson(value: unknown, maxBytes: number = limits.controlBytes): ValidationResult<JsonValue> {
  let remaining = maxBytes;
  let nodes = 0;
  const ancestors = new Set<object>();
  let failure: Diagnostic | undefined;

  function fail(path: string, message: string) {
    failure ??= { code: "E_INVALID_ARGUMENT", path, message };
    return false;
  }
  function spend(bytes: number, path: string) {
    remaining -= bytes;
    return remaining >= 0 || fail(path, "JSON exceeds the maximum encoded size.");
  }
  function stringBytes(text: string, path: string) {
    if (text.length > remaining) return fail(path, "JSON exceeds the maximum encoded size.");
    return spend(encoder.encode(JSON.stringify(text)).byteLength, path);
  }
  function visit(item: unknown, path: string, depth: number): boolean {
    if (depth > 64 || ++nodes > 100_000) return fail(path, "JSON exceeds the traversal limit.");
    if (item === null) return spend(4, path);
    if (typeof item === "boolean") return spend(item ? 4 : 5, path);
    if (typeof item === "number") return Number.isFinite(item)
      ? spend(JSON.stringify(item).length, path) : fail(path, "JSON numbers must be finite.");
    if (typeof item === "string") return stringBytes(item, path);
    if (typeof item !== "object") return fail(path, "Only JSON values are accepted.");
    if (ancestors.has(item)) return fail(path, "Circular JSON values are not accepted.");
    const array = Array.isArray(item);
    const proto = Object.getPrototypeOf(item);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
      return fail(path, "Only plain JSON objects and arrays are accepted.");
    }
    if (!spend(2, path)) return false;
    const keys = Reflect.ownKeys(item);
    if (keys.length > remaining + 1) return fail(path, "JSON exceeds the maximum encoded size.");
    ancestors.add(item);
    try {
      if (array) {
        if (keys.length !== item.length + 1) return fail(path, "Arrays must be dense and have no extra properties.");
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return fail(path, "JSON accessors and sparse arrays are not accepted.");
          if (index && !spend(1, path)) return false;
          if (!visit(descriptor.value, `${path}/${index}`, depth + 1)) return false;
        }
      } else {
        let count = 0;
        for (const key of keys) {
          if (typeof key !== "string" || forbiddenKeys.has(key)) return fail(path, "Unsafe object keys are not accepted.");
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
          if (!("value" in descriptor) || !descriptor.enumerable) return fail(path, "JSON accessors and hidden properties are not accepted.");
          if (!spend(count++ ? 2 : 1, path) || !stringBytes(key, path)) return false;
          const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
          if (!visit(descriptor.value, `${path}/${escaped}`, depth + 1)) return false;
        }
      }
      return true;
    } finally {
      ancestors.delete(item);
    }
  }
  try {
    if (visit(value, "", 0)) return { ok: true, value: value as JsonValue };
  } catch {
    fail("", "The value could not be inspected safely.");
  }
  return { ok: false, diagnostics: [failure ?? { code: "E_INVALID_ARGUMENT", path: "", message: "Invalid JSON value." }] };
}
