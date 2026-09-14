import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import ts from "typescript";
import { checkBuildGraph, checkPackageBoundaries } from "../../../scripts/aplg/check-package-boundaries.mjs";

const owned: string[] = [];
afterEach(async () => {
  const parent = await realpath(tmpdir());
  for (const directory of owned.splice(0)) {
    const actual = await realpath(directory);
    const within = relative(parent, actual);
    if (!within || isAbsolute(within) || within.startsWith("..") || dirname(actual) !== parent) throw new Error("Unsafe test cleanup");
    await rm(actual, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), "aplg-boundaries-"));
  owned.push(root);
  const original = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const metadata = { ...original, dependencies: {}, devDependencies: {} };
  const files = new Set<string>();
  async function put(name: string, value: string) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), value);
    files.add(name);
  }
  async function manifest() { await put("package.json", JSON.stringify(metadata)); }
  await manifest();
  for (const name of ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) await put(name, "APLG test fixture\n");
  for (const target of Object.values(metadata.exports)) {
    if (typeof target === "string") continue;
    const entry = target as { types: string; import: string };
    await put(entry.import.slice(2), 'export const apiVersion = "1.0.0";\n');
    await put(entry.types.slice(2), 'export declare const apiVersion: string;\n');
  }
  return { root, files, metadata, put, manifest,
    check: () => checkPackageBoundaries({ packageRoot: root, files: [...files], typescript: ts, sourceRoots: [root] }),
  };
}

describe("runtime package boundaries", () => {
  test("walks a bundled relative graph and accepts portable public declarations", async () => {
    const f = await fixture();
    await f.put("dist/shared.js", 'export const marker = "not an import: require(\\"node:fs\\")";');
    await f.put("dist/plugin/index.js", 'export { marker } from "../shared.js";');
    await f.put("dist/shared.d.ts", "export type Marker = string;");
    await f.put("dist/plugin/index.d.ts", 'export type { Marker } from "../shared.js";');
    const result = await f.check();
    expect(result.files).toBe(f.files.size);
    expect(result.dependencies).toEqual([]);
  });

  test.each([".env", "dist/.env", "dist/token.pem", "src/index.ts", "dist/index.js.map", "dist/private.json"])("rejects unexpected packed file %s", async (file) => {
    const f = await fixture(); await f.put(file, "private");
    await expect(f.check()).rejects.toThrow(/file|allowlist|boundary/i);
  });

  test.each([
    'import "node:fs";', 'export { readFile } from "fs/promises";',
    'import("node:child_process");', 'import("https://example.org/plugin.js");',
    'import(name);', 'require("fs");', 'module.require("node:fs");',
    'import "@tauri-apps/api/core";', 'import "react";', 'import "vue";',
    'import "@/src/lib/client";', 'import "../../../../src/main.js";',
    'export * from "./missing.js";',
  ])("rejects unsafe or unresolved JS import: %s", async (source) => {
    const f = await fixture(); await f.put("dist/plugin/index.js", source);
    await expect(f.check()).rejects.toThrow(/import|module|package|boundary/i);
  });

  test("follows valid package dependencies and reports their full installed graph", async () => {
    const f = await fixture(); f.metadata.dependencies = { harmless: "1.0.0" }; await f.manifest();
    await mkdir(join(f.root, "node_modules/harmless/node_modules/leaf"), { recursive: true });
    await writeFile(join(f.root, "node_modules/harmless/package.json"), JSON.stringify({ name: "harmless", version: "1.0.0", dependencies: { leaf: "^2.0.0" } }));
    await writeFile(join(f.root, "node_modules/harmless/node_modules/leaf/package.json"), JSON.stringify({ name: "leaf", version: "2.0.0" }));
    expect((await f.check()).dependencies).toEqual(["harmless@1.0.0", "leaf@2.0.0"]);
  });

  test("validates all public type imports from installed registry dependencies", async () => {
    const f = await fixture(); f.metadata.dependencies = { portable: "1.0.0" }; await f.manifest();
    await mkdir(join(f.root, "node_modules/portable"), { recursive: true });
    await writeFile(join(f.root, "node_modules/portable/package.json"), JSON.stringify({ name: "portable", version: "1.0.0", main: "index.js", types: "index.d.ts" }));
    await writeFile(join(f.root, "node_modules/portable/index.js"), "export {};");
    await writeFile(join(f.root, "node_modules/portable/index.d.ts"), "export type X = string;");
    await f.put("dist/node/buffer.d.ts", 'export type { X } from "portable";');
    expect((await f.check()).dependencies).toEqual(["portable@1.0.0"]);
  });

  test("rejects an unreachable old JS chunk even when the file extension is allowed", async () => {
    const f = await fixture(); await f.put("dist/chunk-STALE.js", "export const old = true;");
    await expect(f.check()).rejects.toThrow(/unreachable|stale/i);
  });

  test("rejects a published export whose declaration is not in the tarball", async () => {
    const f = await fixture(); f.files.delete("dist/node/fs.d.ts");
    await expect(f.check()).rejects.toThrow(/export|declaration/i);
  });

  test("does not permit version-only root side-effect imports of capability code", async () => {
    const f = await fixture(); await f.put("dist/index.js", 'import "./host/index.js"; export const apiVersion = "1.0.0";');
    await expect(f.check()).rejects.toThrow(/root|aggregate/i);
  });

  test.each([
    'const require = globalThis.require; require("fs");',
    'module["require"]("fs");',
    'import fs = require("node:fs"); export { fs };',
    'const load = require; export { load };',
  ])("rejects hidden CommonJS module access: %s", async (source) => {
    const f = await fixture(); await f.put("dist/plugin/index.js", source);
    await expect(f.check()).rejects.toThrow(/import|require|module|boundary/i);
  });

  test.each(['"C:/build/repo/src/private.ts"', '"/home/runner/work/repo/src/private.ts"'])("rejects unknown absolute build source roots: %s", async (source) => {
    const f = await fixture(); await f.put("dist/plugin/index.js", `export const source = ${source};`);
    await expect(f.check()).rejects.toThrow(/absolute|source/i);
  });

  test("does not permit the version-only root to aggregate the host", async () => {
    const f = await fixture(); await f.put("dist/index.js", 'export * from "./host/index.js";');
    await expect(f.check()).rejects.toThrow(/root|aggregate/i);
  });

  test.each(['import type { Stats } from "node:fs";', '/// <reference types="node" />', 'export type X = import("../../src/private.js").X;'])("checks declaration edges: %s", async (source) => {
    const f = await fixture(); await f.put("dist/node/fs.d.ts", source);
    await expect(f.check()).rejects.toThrow(/declaration|import|module|reference|boundary/i);
  });

  test("checks nested production dependency names rather than only direct dependencies", async () => {
    const f = await fixture(); f.metadata.dependencies = { innocent: "1.0.0" }; await f.manifest();
    // Dependency files are installed metadata, not files in our tarball.
    await mkdir(join(f.root, "node_modules/innocent"), { recursive: true });
    await writeFile(join(f.root, "node_modules/innocent/package.json"), JSON.stringify({ name: "innocent", version: "1.0.0", dependencies: { "@tauri-apps/api": "2.0.0" } }));
    await expect(f.check()).rejects.toThrow(/tauri|dependency/i);
  });

  test.each(["workspace:*", "link:../sibling", "file:../sibling", "github:example/repo", "https://example.org/p.tgz"])("rejects non-registry dependency %s", async (version) => {
    const f = await fixture(); f.metadata.dependencies = { innocent: version }; await f.manifest();
    await expect(f.check()).rejects.toThrow(/dependency|registry/i);
  });

  test.each(["preinstall", "install", "postinstall", "prepare"])("rejects lifecycle install script %s", async (hook) => {
    const f = await fixture(); f.metadata.scripts[hook] = "node download-native.js"; await f.manifest();
    await expect(f.check()).rejects.toThrow(/script|lifecycle/i);
  });

  test("rejects absolute source paths and private key material", async () => {
    const f = await fixture();
    await f.put("dist/plugin/index.js", `// ${f.root.replaceAll("\\", "/")}/src/plugin.ts\nexport {};`);
    await expect(f.check()).rejects.toThrow(/absolute|source/i);
    await f.put("dist/plugin/index.js", 'const key = "-----BEGIN PRIVATE KEY-----"; export { key };');
    await expect(f.check()).rejects.toThrow(/secret|private key/i);
  });
});

describe("browser build input graph", () => {
  const graph = (inputs: Record<string, { imports: { path: string; external?: boolean }[] }>) => ({ inputs, outputs: { "dist/index.js": { imports: [] } } });
  test("accepts local package source and declared browser dependencies", () => {
    expect(() => checkBuildGraph(graph({
      "src/node/buffer.ts": { imports: [{ path: "../../node_modules/.pnpm/buffer@6.0.3/node_modules/buffer/index.js" }] },
      "../../node_modules/.pnpm/buffer@6.0.3/node_modules/buffer/index.js": { imports: [] },
    }))).not.toThrow();
  });
  test.each(["../../src/main.ts", "../other/src/index.ts", "../../node_modules/react/index.js", "../../node_modules/@tauri-apps/api/core.js", "../../node_modules/@ai-switch/tauri-plugin-devkit/index.js"])("rejects bundled forbidden input %s", (path) => {
    expect(() => checkBuildGraph(graph({ [path]: { imports: [] } }))).toThrow(/input|dependency|boundary/i);
  });
  test("rejects external runtime imports that a bundler leaves unresolved", () => {
    expect(() => checkBuildGraph(graph({ "src/index.ts": { imports: [{ path: "node:fs", external: true }] } }))).toThrow(/external|import|boundary/i);
  });
});