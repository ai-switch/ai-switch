import type { Diagnostic, Manifest } from "@ai-switch/tauri-plugin-runtime/protocol";
import type { PackFile } from "../project/types.js";

export type PackageInspection =
  | { valid: true; manifest: Manifest; sha256: string; size: number; files: PackFile[]; signature: "not-verified"; diagnostics: Diagnostic[] }
  | { valid: false; signature: "not-verified"; diagnostics: Diagnostic[] };
