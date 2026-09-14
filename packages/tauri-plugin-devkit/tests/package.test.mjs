import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("public Node import never runs the CLI, reads a project or imports browser/Vite APIs", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { promises as fs } from 'node:fs';
    for(const name of ['window','document']) Object.defineProperty(globalThis,name,{get(){throw new Error('DOM access on import');}});
    fs.open = async () => { throw new Error('project read on import'); };
    const api = await import('@ai-switch/tauri-plugin-devkit');
    assert.deepEqual(Object.keys(api), ['validateProject']);
    assert.equal(typeof api.validateProject, 'function');
    for(const path of ['/testing','/vite','/src/index.ts','/dist/cli.js']) await assert.rejects(import('@ai-switch/tauri-plugin-devkit'+path),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  `], { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "");
});

test("built bin preserves the shebang, metadata version and actual process exit codes", async () => {
  assert.ok((await readFile(cli, "utf8")).startsWith("#!/usr/bin/env node\n"));
  const version = spawnSync(process.execPath, [cli, "--version"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(version.status, 0); assert.equal(version.stdout, `${metadata.version}\n`); assert.equal(version.stderr, "");
  const unknown = spawnSync(process.execPath, [cli, "not-a-command", "--json"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(unknown.status, 1); assert.equal(JSON.parse(unknown.stdout).diagnostics[0].code, "E_CLI_ARGUMENTS");
  const absent = spawnSync(process.execPath, [cli, "validate", "tests/absent-fixture", "--json"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(absent.status, 1); assert.equal(JSON.parse(absent.stdout).diagnostics[0].code, "E_PROJECT_ROOT");
});

test("building clears stale generated artifacts without shipping source aliases", async () => {
  const sentinel = new URL("../dist/D1-stale.js", import.meta.url);
  const { writeFile } = await import("node:fs/promises");
  await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
  await assert.rejects(readFile(sentinel), { code: "ENOENT" });
  try {
    await writeFile(sentinel, "stale");
    const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: root, encoding: "utf8", timeout: 90000, windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await assert.rejects(readFile(sentinel), { code: "ENOENT" });
    const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
    assert.ok(!source.includes("tauri-plugin-runtime/src"));
    assert.equal(metadata.peerDependenciesMeta.vite.optional, true);
  } finally { await rm(sentinel, { force: true }); }
});
