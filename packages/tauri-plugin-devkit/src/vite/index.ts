import type { Plugin } from "vite";
import { nodeAliases } from "./aliases.js";
import { bootstrapPlugin } from "./bootstrap.js";
import { previewPlugin } from "./preview.js";

export interface AplgViteOptions { manifestPath?: string; preview?: boolean; memoryFiles?: Record<string, Uint8Array> }

/** Install only in the plugin's own Vite config, never in the application host. */
export function aplgVite(options: AplgViteOptions = {}): Plugin[] {
  const validKeys = ["manifestPath", "preview", "memoryFiles"];
  const invalid = !options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => !validKeys.includes(key)) || options.preview !== undefined && typeof options.preview !== "boolean" || options.memoryFiles !== undefined && (options.memoryFiles === null || typeof options.memoryFiles !== "object" || Array.isArray(options.memoryFiles));
  if (invalid) throw new Error("APLG_INVALID_OPTIONS: Invalid plugin build options.");
  return [nodeAliases({ allowPreviewClient: options.preview === true }), bootstrapPlugin(options), ...(options.preview ? [previewPlugin({ manifestPath: options.manifestPath, memoryFiles: options.memoryFiles })] : [])];
}
