import { validateJson } from "./json-safety.js";
import { schemaDiagnostics, type SchemaValidator, type ValidationResult } from "./types.js";

export function validateWithSchema<T>(value: unknown, schema: SchemaValidator, code: string): ValidationResult<T> {
  const json = validateJson(value);
  if (!json.ok) return { ok: false, diagnostics: json.diagnostics.map((diagnostic) => ({ ...diagnostic, code })) };
  if (!schema(value)) return { ok: false, diagnostics: schemaDiagnostics(schema, code) };
  return { ok: true, value: value as T };
}
