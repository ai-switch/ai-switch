import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ZipFile } from "yazl";
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
    assert.deepEqual(Object.keys(api), ['inspectPackage', 'packProject', 'validateProject']);
    assert.equal(typeof api.validateProject, 'function');
    assert.equal(typeof api.packProject, 'function');
    for(const path of ['/testing','/node-types','/src/index.ts','/dist/cli.js']) await assert.rejects(import('@ai-switch/tauri-plugin-devkit'+path),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
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
  const pack = spawnSync(process.execPath, [cli, "pack", "tests/absent-fixture", "--json"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(pack.status, 1); assert.equal(JSON.parse(pack.stdout).diagnostics[0].code, "E_PROJECT_ROOT");
  assert.ok(!pack.stdout.includes("E_COMMAND_UNAVAILABLE"));
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

test("built inspect CLI succeeds with a real ZIP without writing or claiming a trusted signature", async () => {
  const parent = await realpath(tmpdir()); const directory = await mkdtemp(join(parent, "aplg-inspect-bin-"));
  const initial = await lstat(directory);
  try {
    const file = join(directory, "example.aplg"); const zip = new ZipFile(); const chunks = [];
    const bytes = new Promise((resolve, reject) => { zip.outputStream.on("data", (chunk) => chunks.push(chunk)); zip.outputStream.once("end", () => resolve(Buffer.concat(chunks))); zip.outputStream.once("error", reject); zip.once("error", reject); });
    const manifest = await readFile(new URL("../../../fixtures/aplg/protocol-v1/manifest.valid.json", import.meta.url));
    zip.addBuffer(manifest, "aplg.json");
    zip.addBuffer(await readFile(new URL("../LICENSE", import.meta.url)), "LICENSE");
    zip.addBuffer(Buffer.from("<!doctype html><p>Fixture</p>"), JSON.parse(manifest).entry);
    zip.end(); await writeFile(file, await bytes);
    const result = spawnSync(process.execPath, [cli, "inspect", file, "--json"], { cwd: directory, encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.valid, true); assert.equal(report.signature, "not-verified"); assert.equal(report.files.length, 3);
    assert.equal(report.sha256.length, 64); assert.equal(result.stderr, ""); assert.deepEqual(await readdir(directory), ["example.aplg"]);
    const invalid = spawnSync(process.execPath, [cli, "inspect", "missing.aplg", "--json"], { cwd: directory, encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stdout).signature, "not-verified");
  } finally {
    const actual = await realpath(directory); const current = await lstat(directory);
    if (actual !== directory || dirname(actual) !== parent || current.isSymbolicLink() || current.ino !== initial.ino || current.dev !== initial.dev) throw new Error("Refusing unowned CLI fixture cleanup");
    await rm(actual, { recursive: true, force: true });
  }
});
test("public Vite entry is separate from the Node CLI and node-types is declarations only", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const {aplgVite} = await import('@ai-switch/tauri-plugin-devkit/vite');
    assert.equal(typeof aplgVite, 'function');
    assert.equal(Array.isArray(aplgVite({preview:false})), true);
    await assert.rejects(import('@ai-switch/tauri-plugin-devkit/node-types'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  `], { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "");
});