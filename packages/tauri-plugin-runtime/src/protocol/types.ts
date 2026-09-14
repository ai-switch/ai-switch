export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export interface Diagnostic { code: string; path: string; message: string }
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: Diagnostic[] };

export interface SchemaError {
  instancePath: string;
  message?: string;
  keyword: string;
  params: Record<string, unknown>;
}
export interface SchemaValidator {
  (value: unknown): boolean;
  errors?: SchemaError[] | null;
}

export function schemaDiagnostics(validator: SchemaValidator, code: string): Diagnostic[] {
  return (validator.errors ?? []).slice(0, 32).map((error) => ({
    code,
    path: error.instancePath,
    message: error.message ?? "Schema validation failed.",
  }));
}
