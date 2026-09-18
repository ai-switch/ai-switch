import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
    assert.deepEqual(Object.keys(api), ['initProject', 'inspectPackage', 'packProject', 'validateProject']);
    assert.equal(typeof api.validateProject, 'function');
    assert.equal(typeof api.packProject, 'function');
    assert.equal(typeof api.initProject, 'function');
    for(const path of ['/node-types','/src/index.ts','/dist/cli.js']) await assert.rejects(import('@ai-switch/tauri-plugin-devkit'+path),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
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

test("the published metadata replaces workspace protocols with exact registry versions", async () => {
  const packed = spawnSync(process.execPath, [process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules/corepack/dist/pnpm.js"), "pack", "--json", "--pack-destination", root, "--loglevel=error"], { cwd: root, encoding: "utf8", timeout: 120000, windowsHide: true });
  assert.equal(packed.status, 0, packed.stderr);
  const entry = JSON.parse(packed.stdout);
  assert.ok(entry?.filename?.endsWith(".tgz"), "pnpm pack did not produce a tarball");
  const archive = entry.filename;
  try {
    const result = spawnSync("tar", ["-xOf", archive, "package/package.json"], { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const published = JSON.parse(result.stdout);
    assert.equal(published.dependencies["@ai-switch/tauri-plugin-runtime"], "0.1.0");
    assert.equal(JSON.stringify(published).includes("workspace:"), false);
  } finally { await rm(archive, { force: true }); }
  assert.equal(metadata.dependencies["@ai-switch/tauri-plugin-runtime"], "workspace:0.1.0");
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
test("built init resolves the packaged template files without running install or build", async () => {
  const parent = await realpath(tmpdir()); const directory = await mkdtemp(join(parent, "aplg-init-bin-"));
  const initial = await lstat(directory);
  try {
    const { initProject } = await import("@ai-switch/tauri-plugin-devkit");
    const result = await initProject(join(directory, "generated"), { id: "io.github.example.demo", name: "Demo" });
    assert.equal(result.files.includes("templates"), false);
    assert.equal(result.files.includes("vite.config.ts"), true);
    assert.equal(JSON.parse(await readFile(join(directory, "generated", "aplg.json"), "utf8")).id, "io.github.example.demo");
    assert.equal((await readFile(join(directory, "generated", "README.md"), "utf8")).includes("pnpm install"), true);
  } finally {
    const actual = await realpath(directory); const current = await lstat(directory);
    if (actual !== directory || dirname(actual) !== parent || current.isSymbolicLink() || current.ino !== initial.ino || current.dev !== initial.dev) throw new Error("Refusing unowned init fixture cleanup");
    await rm(actual, { recursive: true, force: true });
  }
});
test("npm pack retains the non-hidden template source files", () => {
  const executable = process.execPath;
  const candidates = [
    process.env.npm_execpath,
    join(dirname(executable), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(executable), "../lib/node_modules/npm/bin/npm-cli.js"),
  ].filter((value) => value && /npm(?:-cli)?\.js$/i.test(value) && existsSync(value));
  const command = candidates.length ? [executable, candidates[0]] : ["npm"];
  const result = spawnSync(command[0], [...command.slice(1), "pack", "--dry-run", "--json", "--ignore-scripts", "--loglevel=error"], { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const files = JSON.parse(result.stdout)[0].files.map((file) => file.path);
  assert.ok(files.includes("templates/vanilla-ts/gitignore"));
  assert.ok(!files.includes("templates/vanilla-ts/.gitignore"));
});
test("public Vite entry is separate from the Node CLI and node-types is declarations only", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const {aplgVite} = await import('@ai-switch/tauri-plugin-devkit/vite');
    const {createTestHost} = await import('@ai-switch/tauri-plugin-devkit/testing');
    assert.equal(typeof aplgVite, 'function');
    assert.equal(typeof createTestHost, 'function');
    assert.equal(Array.isArray(aplgVite({preview:false})), true);
    await assert.rejects(import('@ai-switch/tauri-plugin-devkit/node-types'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  `], { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "");
});