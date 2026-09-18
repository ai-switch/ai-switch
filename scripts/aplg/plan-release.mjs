const runtimeName = "@ai-switch/tauri-plugin-runtime";
const devkitName = "@ai-switch/tauri-plugin-devkit";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const fail = (message) => { throw Object.assign(new Error(`E_RELEASE_PLAN: ${message}`), { code: "E_RELEASE_PLAN" }); };

function exact(value) {
  return typeof value === "string" && stableVersion.test(value);
}

/** Pure, network-free release plan. Callers cannot choose dist-tags. */
export function planRelease(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("A release input object is required.");
  const { tag, runtime, devkit } = input;
  if (typeof tag !== "string" || !/^tauri-plugin-runtime-v\d+\.\d+\.\d+$/.test(tag)) fail("The tag must be a stable tauri-plugin-runtime-v SemVer tag.");
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime) || runtime.name !== runtimeName || !exact(runtime.version)) fail("Unexpected runtime package name or version.");
  if (!devkit || typeof devkit !== "object" || Array.isArray(devkit) || devkit.name !== devkitName || !exact(devkit.version) || !exact(devkit.runtimeDependency)) fail("Unexpected devkit package name or version.");
  if (runtime.version !== devkit.version) fail("Both packages must release the same version.");
  if (devkit.runtimeDependency !== runtime.version) fail("The devkit runtime dependency must match the exact runtime version.");
  if (tag !== `tauri-plugin-runtime-v${runtime.version}`) fail("The tag version must match both package versions.");
  // npm trusted publishing authenticates only `npm publish`, so a separate
  // candidate-then-promote step is impossible without a long-lived token.
  // The stable tag is applied by the publish call itself.
  return {
    version: runtime.version,
    order: [runtimeName, devkitName],
    stableTag: "latest",
  };
}