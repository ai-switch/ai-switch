import semver from "semver";
import { validateManifestSchema } from "./generated/validators.generated.mjs";
import type { Manifest } from "./generated/types.generated.js";
import { validateJson } from "./json-safety.js";
import { normalizeArchivePath } from "./path-policy.js";
import { schemaDiagnostics, type Diagnostic, type ValidationResult, type SchemaValidator } from "./types.js";

export function satisfiesApiRange(version: string, range: string): boolean {
  if (typeof version !== "string" || typeof range !== "string" || !range.trim()) return false;
  try {
    return semver.valid(version) === version && semver.satisfies(version, range, { includePrerelease: false });
  } catch {
    return false;
  }
}

function validRange(range: string) {
  return range.trim().length > 0 && semver.validRange(range) !== null;
}

function validOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      && !url.hostname.includes("*") && url.origin === origin && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function validateManifest(value: unknown): ValidationResult<Manifest> {
  const json = validateJson(value);
  if (!json.ok) return { ok: false, diagnostics: json.diagnostics.map((d) => ({ ...d, code: "E_MANIFEST_INVALID" })) };
  const validator = validateManifestSchema as SchemaValidator;
  if (!validator(value)) return { ok: false, diagnostics: schemaDiagnostics(validator, "E_MANIFEST_INVALID") };
  const manifest = value as Manifest;
  const diagnostics: Diagnostic[] = [];
  const invalid = (path: string, message: string) => diagnostics.push({ code: "E_MANIFEST_INVALID", path, message });
  if (semver.valid(manifest.version) !== manifest.version) invalid("/version", "A canonical semantic version is required.");
  if (!validRange(manifest.engines.aplg)) invalid("/engines/aplg", "A valid nonempty API version range is required.");
  try {
    normalizeArchivePath(manifest.entry);
    if (!manifest.entry.startsWith("dist/") || !manifest.entry.endsWith(".html")) invalid("/entry", "The entry must be an HTML file under dist/.");
  } catch {
    invalid("/entry", "The entry must be a portable relative archive path.");
  }
  for (const group of ["requires", "optional"] as const) {
    for (const [capability, range] of Object.entries(manifest[group])) {
      if (!validRange(range)) invalid(`/${group}/${capability}`, "A valid nonempty capability version range is required.");
    }
  }
  for (const capability of Object.keys(manifest.requires)) {
    if (Object.hasOwn(manifest.optional, capability)) invalid(`/optional/${capability}`, "Required and optional capabilities cannot overlap.");
  }
  const views = new Set<string>();
  manifest.contributes.views.forEach((view, index) => {
    if (views.has(view.id)) invalid(`/contributes/views/${index}/id`, "View identifiers must be unique.");
    views.add(view.id);
  });
  const roots = new Set<string>();
  manifest.permissions.filesystem.forEach((permission, index) => {
    if (roots.has(permission.root)) invalid(`/permissions/filesystem/${index}/root`, "Filesystem roots must be unique.");
    roots.add(permission.root);
  });
  manifest.permissions.network.forEach((permission, index) => {
    permission.origins.forEach((origin, originIndex) => {
      if (!validOrigin(origin)) invalid(`/permissions/network/${index}/origins/${originIndex}`, "A canonical HTTP(S) origin without credentials, wildcards or a path is required.");
    });
  });
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, value: manifest };
}

export function parseManifest(value: unknown): Manifest {
  const result = validateManifest(value);
  if (!result.ok) throw Object.assign(new Error("Invalid APLG manifest."), {
    code: "E_MANIFEST_INVALID", diagnostics: result.diagnostics,
  });
  return result.value;
}
