import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

export function validProjectFiles(): Record<string, string> {
  return {
    "aplg.json": JSON.stringify({
      manifestVersion: 1, id: "io.github.example.notes", name: "Notes", version: "0.1.0",
      description: "Permission-free devkit test fixture", license: "MIT", engines: { aplg: "^1.0.0" },
      entry: "dist/index.html", activation: "view", requires: {}, optional: {},
      permissions: { filesystem: [], network: [], native: false },
      contributes: { views: [{ id: "main", title: "Notes" }] },
    }, null, 2) + "\n",
    "package.json": JSON.stringify({
      name: "notes", version: "0.1.0", type: "module", private: true,
      packageManager: "pnpm@10.12.4", scripts: { build: "vite build" },
      dependencies: { "@ai-switch/tauri-plugin-runtime": "0.1.1" },
      devDependencies: { "@ai-switch/tauri-plugin-devkit": "0.1.1", vite: "8.3.0" },
    }),
    "pnpm-lock.yaml": readFileSync(new URL("../fixtures/plugin-example/pnpm-lock.yaml", import.meta.url), "utf8"),
    "README.md": "# Notes\nThis is a permission-free test fixture.\n",
    "LICENSE": readFileSync(new URL("../../LICENSE", import.meta.url), "utf8"),
    "index.html": '<!doctype html><script type="module" src="/src/main.ts"></script>',
    "src/main.ts": 'document.body.append("ready");',
  };
}

export async function withProject(files: Record<string, string | Uint8Array>, run: (root: string) => Promise<void>): Promise<void> {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, "aplg-devkit-test-"));
  const initial = await lstat(root);
  const marker = join(root, ".test-owner"); const token = randomUUID();
  await writeFile(marker, token);
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const target = join(root, name); const path = relative(root, target);
      if (!path || isAbsolute(path) || path.startsWith("..")) throw new Error("Unsafe test fixture path.");
      await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
    }
    await run(root);
  } finally {
    const actual = await realpath(root); const current = await lstat(root);
    if (actual !== root || dirname(actual) !== parent || current.isSymbolicLink() || current.ino !== initial.ino || current.dev !== initial.dev || await readFile(marker, "utf8") !== token) throw new Error("Unsafe test fixture cleanup.");
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  }
}
