import { AplgError, validateCapabilityRequest, type JsonValue } from "@ai-switch/tauri-plugin-runtime/protocol";

const maxKeys = 32;
const maxValueBytes = 64 * 1024;

function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function checkedValue(value: unknown): JsonValue {
  const checked = validateCapabilityRequest("aplg.storage", "set", { key: "_", value });
  if (!checked.ok) throw new AplgError("E_INVALID_ARGUMENT", "Test storage values must be safe JSON.");
  const result = (checked.value as { value: JsonValue }).value;
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maxValueBytes) {
    throw new AplgError("E_LIMIT_EXCEEDED", "Test storage values are limited to 64 KiB.");
  }
  return clone(result);
}

export interface StorageState {
  get(key: string): JsonValue;
  set(key: string, value: JsonValue): void;
  remove(key: string): void;
  clear(): void;
  size(): number;
}

export function createStorageState(initial: Record<string, JsonValue> = {}): StorageState {
  const values = new Map<string, JsonValue>();
  for (const [key, value] of Object.entries(initial)) {
    if (!/^[\s\S]{1,1024}$/.test(key)) throw new AplgError("E_INVALID_ARGUMENT", "Test storage keys must be nonempty strings of at most 1024 characters.");
    if (values.size >= maxKeys) throw new AplgError("E_LIMIT_EXCEEDED", "Test storage allows at most 32 keys.");
    values.set(key, checkedValue(value));
  }
  return {
    get(key) { return clone(values.get(key) ?? null); },
    set(key, value) {
      if (typeof key !== "string" || key.length < 1 || key.length > 1024) throw new AplgError("E_INVALID_ARGUMENT", "Test storage keys must be nonempty strings of at most 1024 characters.");
      if (!values.has(key) && values.size >= maxKeys) throw new AplgError("E_LIMIT_EXCEEDED", "Test storage allows at most 32 keys.");
      values.set(key, checkedValue(value));
    },
    remove(key) { values.delete(key); },
    clear() { values.clear(); },
    size() { return values.size; },
  };
}

export function cloneStorageRecord(value: Record<string, JsonValue> | undefined): Record<string, JsonValue> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AplgError("E_INVALID_ARGUMENT", "initialStorage must be a JSON object.");
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, checkedValue(item)]));
}
