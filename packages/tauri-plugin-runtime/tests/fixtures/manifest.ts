export function makeManifest() {
  return {
    manifestVersion: 1,
    id: "io.github.example.notes",
    name: "Notes",
    version: "0.1.0",
    description: "Notes fixture",
    license: "MIT",
    engines: { aplg: "^1.0.0" },
    entry: "dist/index.html",
    activation: "view",
    requires: {},
    optional: {},
    permissions: { filesystem: [], network: [], native: false },
    contributes: { views: [{ id: "main", title: "Notes" }] },
  };
}
