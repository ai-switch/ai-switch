import type { Plugin } from "vite";
import { nodeAliases } from "./aliases.js";
import { bootstrapPlugin } from "./bootstrap.js";

export interface AplgViteOptions { manifestPath?: string; preview?: boolean }

/** Install only in the plugin's own Vite config, never in the application host. */
export function aplgVite(options: AplgViteOptions = {}): Plugin[] {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => !["manifestPath", "preview"].includes(key)) || options.preview !== undefined && typeof options.preview !== "boolean") throw new Error("APLG_INVALID_OPTIONS: Invalid plugin build options.");
  return [nodeAliases(), bootstrapPlugin(options)];
}
