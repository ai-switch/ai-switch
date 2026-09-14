import semver from "semver";
import { validateSessionDescriptorSchema } from "./generated/validators.generated.mjs";
import type { SessionDescriptor } from "./generated/types.generated.js";
import { standardCapabilities } from "./capabilities.js";
import { validateManifest, satisfiesApiRange } from "./manifest.js";
import { apiVersion, limits } from "./limits.js";
import { validateWithSchema } from "./validation.js";
import type { Diagnostic, SchemaValidator, ValidationResult } from "./types.js";

function validAssetUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(url.hostname));
  } catch {
    return false;
  }
}

export function validateSessionDescriptor(value: unknown): ValidationResult<SessionDescriptor> {
  const structural = validateWithSchema<SessionDescriptor>(value, validateSessionDescriptorSchema as SchemaValidator, "E_PROTOCOL_MISMATCH");
  if (!structural.ok) return structural;
  const session = structural.value;
  const manifest = validateManifest(session.manifest);
  if (!manifest.ok) return { ok: false, diagnostics: manifest.diagnostics.map((d) => ({ ...d, path: `/manifest${d.path}` })) };
  const diagnostics: Diagnostic[] = [];
  const invalid = (path: string, message: string) => diagnostics.push({ code: "E_PROTOCOL_MISMATCH", path, message });
  if (!validAssetUrl(session.assetUrl)) invalid("/assetUrl", "An HTTPS or loopback HTTP asset URL without credentials is required.");
  if (session.info.plugin.id !== session.manifest.id || session.info.plugin.version !== session.manifest.version) {
    invalid("/info/plugin", "Session identity must match the installed plugin manifest.");
  }
  if (!satisfiesApiRange(session.info.apiVersion, session.manifest.engines.aplg) || !satisfiesApiRange(session.info.apiVersion, `^${apiVersion}`)) {
    invalid("/info/apiVersion", "The host, plugin and runtime API versions do not intersect.");
  }
  for (const [capability, range] of Object.entries(session.manifest.requires)) {
    const provided = session.info.capabilities[capability];
    if (!provided || !satisfiesApiRange(provided.version, range)) invalid(`/info/capabilities/${capability}`, "A required compatible capability is unavailable.");
  }
  for (const [capability, info] of Object.entries(session.info.capabilities)) {
    const range = session.manifest.requires[capability] ?? session.manifest.optional[capability];
    if (!range || !satisfiesApiRange(info.version, range)) invalid(`/info/capabilities/${capability}`, "A capability must be declared and version-compatible.");
    if (semver.valid(info.version) !== info.version) invalid(`/info/capabilities/${capability}/version`, "A canonical capability version is required.");
    const standard = Object.hasOwn(standardCapabilities, capability) ? standardCapabilities[capability] : undefined;
    if (capability.startsWith("aplg.") && !standard) invalid(`/info/capabilities/${capability}`, "The standard capability namespace is reserved.");
    if (standard && (!satisfiesApiRange(info.version, `^${standard.version}`) || standard.methods.some((method) => !info.methods.includes(method)))) {
      invalid(`/info/capabilities/${capability}/methods`, "The standard capability must provide its complete compatible method contract.");
    }
  }
  for (const key of ["controlBytes", "fileChunkBytes", "fileBytes", "fileTransfers"] as const) {
    if (session.info.limits[key] > limits[key]) invalid(`/info/limits/${key}`, "A host cannot expand the protocol limits.");
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, value: session };
}
