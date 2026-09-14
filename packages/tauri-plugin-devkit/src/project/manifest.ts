import { apiVersion, satisfiesApiRange, validateManifest, type Manifest, type ValidationResult } from "@ai-switch/tauri-plugin-runtime/protocol";

/** Shared source/archive policy; schemas and semantic versions remain in runtime. */
export function validateWebManifest(value: unknown): ValidationResult<Manifest> {
  const parsed = validateManifest(value);
  if (!parsed.ok) return parsed;
  const diagnostics = [];
  if (parsed.value.permissions.native) diagnostics.push({ code: "E_PROFILE_UNSUPPORTED", path: "/permissions/native", message: "The web-v1 profile does not support native plugins." });
  if (!satisfiesApiRange(apiVersion, parsed.value.engines.aplg)) diagnostics.push({ code: "E_API_INCOMPATIBLE", path: "/engines/aplg", message: "The plugin API range does not include this runtime API version." });
  return diagnostics.length ? { ok: false, diagnostics } : parsed;
}
