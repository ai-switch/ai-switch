import { Buffer } from "../buffer.js";
import { validateJson } from "../../protocol/json-safety.js";
import { validateVirtualPath } from "../../protocol/path-policy.js";
import { limits } from "../../protocol/limits.js";
import { AplgError } from "../../protocol/errors.js";
import { invalidArgument } from "./errors.js";

export function filePath(value: unknown): string {
  if (typeof value !== "string") invalidArgument();
  return validateVirtualPath(value);
}
function objectOptions(value: unknown, allowed: readonly string[]) {
  if (value === undefined || value === null) return {} as Record<string, unknown>;
  if (typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalidArgument();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) invalidArgument();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) invalidArgument();
    if (descriptor.value !== undefined) result[key] = descriptor.value;
  }
  if (!validateJson(result, 4096).ok) invalidArgument();
  return result;
}
export function readEncoding(value: unknown): "utf8" | null {
  if (value === "utf8") return "utf8";
  const options = objectOptions(value, ["encoding"]);
  if (options.encoding !== undefined && options.encoding !== null && options.encoding !== "utf8") invalidArgument();
  return options.encoding === "utf8" ? "utf8" : null;
}
export function writeMode(value: unknown, append: boolean): "w" | "wx" | "a" | "ax" {
  const options = value === "utf8" ? {} : objectOptions(value, ["encoding", "flag"]);
  if (options.encoding !== undefined && options.encoding !== "utf8") invalidArgument();
  const mode = options.flag ?? (append ? "a" : "w");
  if (!(append ? ["a", "ax"] : ["w", "wx"]).includes(mode as string)) invalidArgument();
  return mode as "w" | "wx" | "a" | "ax";
}
export function boolOptions(value: unknown, allowed: readonly string[]): Record<string, boolean> {
  const options = objectOptions(value, allowed); const result: Record<string, boolean> = {};
  for (const key of allowed) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") invalidArgument();
    result[key] = options[key] === true;
  }
  return result;
}
export function snapshotData(data: unknown): Buffer {
  if (typeof data === "string") {
    if (data.length > limits.fileBytes || Buffer.byteLength(data, "utf8") > limits.fileBytes) throw new AplgError("E_LIMIT_EXCEEDED", "File data exceeds the supported size.");
    return Buffer.from(data, "utf8");
  }
  if (!(data instanceof Uint8Array)) invalidArgument();
  if (data.byteLength > limits.fileBytes) throw new AplgError("E_LIMIT_EXCEEDED", "File data exceeds the supported size.");
  return Buffer.from(data);
}
export function virtualRoot(path: string) {
  return path.startsWith("/mounts/") ? path.split("/").slice(0, 3).join("/") : path.split("/").slice(0, 2).join("/");
}
