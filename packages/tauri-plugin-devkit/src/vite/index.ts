import type { Plugin } from "vite";
import { nodeAliases } from "./aliases.js";

export interface AplgViteOptions { manifestPath?: string; preview?: boolean }

/** Install only in the plugin's own Vite config, never in the application host. */
export function aplgVite(options: AplgViteOptions = {}): Plugin[] {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => !["manifestPath", "preview"].includes(key)) || options.preview !== undefined && typeof options.preview !== "boolean") throw new Error("APLG_INVALID_OPTIONS: Invalid plugin build options.");
  if (options.manifestPath !== undefined) throw new Error("APLG_OPTION_UNAVAILABLE: Manifest/bootstrap integration belongs to the next implementation slice.");
  // D3 only supplies Node import/type adaptation. Bootstrap, artifact validation
  // and a preview test host are intentionally not implied by this build hook.
  return [nodeAliases()];
}
