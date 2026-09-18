import type { Diagnostic, Manifest } from "@ai-switch/tauri-plugin-runtime/protocol";

export interface PackFile { path: string; size: number; sha256: string }
export type ProjectReport =
  | { valid: true; manifest: Manifest; manifestSha256: string; files: PackFile[]; diagnostics: Diagnostic[] }
  | { valid: false; diagnostics: Diagnostic[] };
export interface ValidateProjectOptions { stage?: "source" | "dist"; profile?: "web-v1" }
export interface PackProjectOptions { outDir?: string; profile?: "web-v1" }
export interface PackResult {
  path: string;
  sha256: string;
  size: number;
  manifest: Manifest;
  manifestSha256: string;
}
