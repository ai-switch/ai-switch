import capabilitySchema from "./schema/capabilities.schema.json";
import fsSchema from "./schema/fs.schema.json";
import { validateFsCapabilityMessageSchema, validateStandardCapabilityMessageSchema } from "./generated/validators.generated.mjs";
import { normalizeArchivePath, validateVirtualPath } from "./path-policy.js";
import { limits } from "./limits.js";
import type { JsonObject, JsonValue, SchemaValidator, ValidationResult } from "./types.js";
import { validateWithSchema } from "./validation.js";

const names = new Map<string, Set<string>>();
for (const branch of [...capabilitySchema.oneOf, ...fsSchema.oneOf]) {
  const capability = branch.properties.capability.const;
  const methods = names.get(capability) ?? new Set<string>();
  methods.add(branch.properties.method.const);
  names.set(capability, methods);
}

/** Methods come from the authoritative schemas, not a second handwritten list. */
export const standardCapabilities: Readonly<Record<string, { readonly version: string; readonly methods: readonly string[] }>> = Object.freeze(
  Object.fromEntries(Array.from(names, ([name, methods]) => [name, Object.freeze({ version: "1.0.0", methods: Object.freeze([...methods]) })])),
);

function invalid(message: string, path = "", code = "E_INVALID_ARGUMENT"): ValidationResult<JsonValue> {
  return { ok: false, diagnostics: [{ code, path, message }] };
}

function virtualRoot(path: string) {
  return path.startsWith("/mounts/") ? path.split("/").slice(0, 3).join("/") : path.split("/").slice(0, 2).join("/");
}

function canonicalBase64(value: string): number | null {
  if (value.length > 349_528 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    const bytes = atob(value);
    return btoa(bytes) === value && bytes.length <= limits.fileChunkBytes ? bytes.length : null;
  } catch {
    return null;
  }
}

function validatePayload(capability: string, method: string, direction: "request" | "result", value: unknown): ValidationResult<JsonValue> {
  if (!Object.hasOwn(standardCapabilities, capability) || !standardCapabilities[capability].methods.includes(method)) {
    return invalid("No standard capability contract is registered for this method.", "", "E_CAPABILITY_UNAVAILABLE");
  }
  const validator = (capability === "aplg.fs" ? validateFsCapabilityMessageSchema : validateStandardCapabilityMessageSchema) as SchemaValidator;
  const message = { capability, method, direction, value };
  const structural = validateWithSchema(message, validator, "E_INVALID_ARGUMENT");
  if (!structural.ok) return structural;
  const data = value as JsonObject;
  try {
    if (capability === "aplg.fs") {
      if (direction === "request") {
        for (const key of ["path", "from", "to"]) {
          if (Object.hasOwn(data, key)) validateVirtualPath(data[key] as string);
        }
        if (method === "rename" && virtualRoot(validateVirtualPath(data.from as string)) !== virtualRoot(validateVirtualPath(data.to as string))) {
          return invalid("rename cannot cross a virtual filesystem grant.", "/to", "EXDEV");
        }
      }
      if (method === "transfer.push" && direction === "request" || method === "transfer.pull" && direction === "result") {
        const size = canonicalBase64(data.dataBase64 as string);
        if (size === null) return invalid("File chunks must use canonical bounded base64.", "/dataBase64");
        if ((data.offset as number) + size > limits.fileBytes) return invalid("Chunk exceeds the file transfer limit.", "/offset");
      }
      if (method === "transfer.pull" && direction === "request" && (data.offset as number) + (data.length as number) > limits.fileBytes) {
        return invalid("Requested range exceeds the file transfer limit.", "/length");
      }
      if (direction === "result" && method === "mkdir" && data.createdPath !== null) validateVirtualPath(data.createdPath as string);
      if (direction === "result" && method === "readdir") {
        const entries = value as Array<{ name: string }>;
        const seen = new Set<string>();
        for (const entry of entries) {
          normalizeArchivePath(entry.name);
          if (entry.name.includes("/") || seen.has(entry.name)) return invalid("Directory entries must have unique direct-child names.");
          seen.add(entry.name);
        }
      }
    }
    if (capability === "aplg.dialog" && direction === "result" && value !== null) {
      const path = validateVirtualPath(data.path as string);
      if (!path.startsWith("/mounts/")) return invalid("Directory selection must return an authorized mount path.", "/path");
    }
  } catch {
    return invalid("Capability payload contains an invalid virtual path.");
  }
  return { ok: true, value: value as JsonValue };
}

export function validateCapabilityRequest(capability: string, method: string, params: unknown): ValidationResult<JsonValue> {
  return validatePayload(capability, method, "request", params);
}

export function validateCapabilityResult(capability: string, method: string, result: unknown): ValidationResult<JsonValue> {
  return validatePayload(capability, method, "result", result);
}
