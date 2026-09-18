import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Diagnostic, Manifest } from "@ai-switch/tauri-plugin-runtime/protocol";
import { inspectBuildFiles } from "../vite/artifacts.js";
import { validateWebManifest } from "./manifest.js";
import { ProjectError, errorCode } from "./errors.js";
import { inspectPath, sameIdentity, samePath } from "./files.js";
import { decodeUtf8, parseStrictJson, readBoundedFile } from "./read.js";
import type { PackFile, ProjectReport, ValidateProjectOptions } from "./types.js";

const requiredFiles = [
  ["aplg.json", 256 * 1024], ["package.json", 256 * 1024],
  ["README.md", 1024 * 1024], ["LICENSE", 1024 * 1024], ["pnpm-lock.yaml", 4 * 1024 * 1024],
] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = (code: string, path: string, message: string): ProjectReport => ({ valid: false, diagnostics: [{ code, path, message }] });

/** Read metadata only. No configs, scripts, source imports, installs or writes. */
export async function validateProject(root: string, options: ValidateProjectOptions = {}): Promise<ProjectReport> {
  if (!record(options) || Object.keys(options).some((key) => key !== "stage" && key !== "profile") || options.stage !== undefined && options.stage !== "source" && options.stage !== "dist") return invalid("E_INVALID_ARGUMENT", "", "Expected stage source or dist and an optional web-v1 profile.");
  if (options.profile !== undefined && options.profile !== "web-v1") return invalid("E_PROFILE_UNSUPPORTED", "", "Only the web-v1 profile is supported.");
  let directory;
  try {
    directory = await inspectPath(root);
    if (!directory.stat.isDirectory()) return invalid("E_PROJECT_ROOT", "", "The project root must be an existing regular directory.");
  } catch (error) {
    if (error instanceof ProjectError) return { valid: false, diagnostics: [error.diagnostic()] };
    if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) return invalid("E_PROJECT_ROOT", "", "The project root must be an existing regular directory.");
    throw new ProjectError("E_IO", "The project root could not be inspected.", "", "io");
  }
  const diagnostics: Diagnostic[] = [];
  const texts = new Map<string, string>(); const files: PackFile[] = [];
  for (const [name, limit] of requiredFiles) {
    try {
      const bytes = await readBoundedFile(join(directory.absolute, name), limit);
      const text = decodeUtf8(bytes);
      if (!text.trim()) throw new ProjectError("E_EMPTY_FILE", "A required project metadata file is empty.");
      texts.set(name, text);
      files.push({ path: name, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
    } catch (error) {
      if (error instanceof ProjectError) diagnostics.push(error.diagnostic(name));
      else if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) diagnostics.push({ code: "E_REQUIRED_FILE", path: name, message: "A required project metadata file is missing." });
      else throw new ProjectError("E_IO", "A project metadata file could not be read.", name, "io");
    }
  }
  // Recheck the root identity across the complete metadata operation. This is
  // not a durable snapshot/authorization guarantee against a hostile filesystem.
  try {
    const after = await inspectPath(root);
    if (!samePath(directory, after) || !sameIdentity(directory.stat, after.stat)) diagnostics.push({ code: "E_FILE_CHANGED", path: "", message: "The project directory changed during validation." });
  } catch (error) {
    if (error instanceof ProjectError) diagnostics.push(error.diagnostic());
    else if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) diagnostics.push({ code: "E_FILE_CHANGED", path: "", message: "The project directory was removed during validation." });
    else throw new ProjectError("E_IO", "The project root could not be rechecked.", "", "io");
  }
  function json(name: string): unknown {
    const text = texts.get(name); if (text === undefined) return undefined;
    try { return parseStrictJson(text); }
    catch (error) {
      if (!(error instanceof ProjectError)) throw error;
      diagnostics.push(error.diagnostic(name)); return undefined;
    }
  }
  const inputManifest = json("aplg.json"); const pkg = json("package.json");
  let manifest: Manifest | undefined;
  if (inputManifest !== undefined) {
    const checked = validateWebManifest(inputManifest);
    if (!checked.ok) diagnostics.push(...checked.diagnostics.map((diagnostic) => ({ ...diagnostic, path: `aplg.json${diagnostic.path}` })));
    else manifest = checked.value;
  }
  if (pkg !== undefined) {
    if (!record(pkg) || typeof pkg.version !== "string") diagnostics.push({ code: "E_PACKAGE_INVALID", path: "package.json", message: "package.json must be a JSON object with a version string." });
    else if (manifest && pkg.version !== manifest.version) diagnostics.push({ code: "E_VERSION_MISMATCH", path: "package.json/version", message: "Package and manifest versions must agree exactly." });
  }

  if (diagnostics.length || !manifest) return { valid: false, diagnostics };
  if (options.stage === "dist") {
    const output = await inspectBuildFiles(directory.absolute, manifest);
    if (output.diagnostics.length) return { valid: false, diagnostics: output.diagnostics };
    return { valid: true, manifest, manifestSha256: files.find((file) => file.path === "aplg.json")!.sha256,
      files: [...files.filter((file)=>["aplg.json","README.md","LICENSE"].includes(file.path)), ...output.files].sort((a,b)=>a.path<b.path?-1:1), diagnostics: [] };
  }
  return { valid: true, manifest, manifestSha256: files.find((file) => file.path === "aplg.json")!.sha256, files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), diagnostics: [] };
}
