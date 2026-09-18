import type { Manifest } from "@ai-switch/tauri-plugin-runtime/protocol";

export function validManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    manifestVersion: 1,
    id: "io.github.example.notes",
    name: "Notes",
    version: "0.1.0",
    description: "Test plugin",
    license: "MIT",
    engines: { aplg: "^1.0.0" },
    entry: "dist/index.html",
    activation: "view",
    requires: { "aplg.storage": "^1.0.0" },
    optional: {},
    permissions: { filesystem: [], network: [], native: false },
    contributes: { views: [{ id: "main", title: "Notes" }] },
    ...overrides,
  };
}
