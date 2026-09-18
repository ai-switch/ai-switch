import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// npm trusted publishing refuses to publish unless repository.url matches the
// GitHub repository that hosts the workflow exactly.
const repository = "git+https://github.com/ai-switch/ai-switch.git";
const packages = [
  { name: "@ai-switch/tauri-plugin-runtime", directory: "packages/tauri-plugin-runtime" },
  { name: "@ai-switch/tauri-plugin-devkit", directory: "packages/tauri-plugin-devkit" },
];

for (const entry of packages) {
  test(`${entry.name} declares the repository npm trusted publishing requires`, async () => {
    const metadata = JSON.parse(await readFile(new URL(`../../${entry.directory}/package.json`, import.meta.url), "utf8"));
    assert.equal(metadata.name, entry.name);
    assert.equal(metadata.repository?.url, repository);
    assert.equal(metadata.repository?.directory, entry.directory);
    assert.equal(metadata.publishConfig?.access, "public");
  });
}