import assert from "node:assert/strict";
import { cp, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createVerificationWorkspace } from "../../packages/tauri-plugin-runtime/scripts/verification-workspace.mjs";
import { runNodeCommand } from "../../packages/tauri-plugin-runtime/scripts/verification-process.mjs";
import { runPackagedExample } from "./packaged-example-runner.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const fixture = join(repository, "fixtures/aplg/plugin-example");

function usage(message) {
  throw new Error(`${message}\nUsage: node scripts/aplg/verify-pair.mjs --runtime <runtime.tgz> --devkit <devkit.tgz>`);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--runtime", "--devkit"].includes(name) || typeof value !== "string" || value.startsWith("-")) usage("Invalid verifier arguments.");
    if (values[name]) usage(`Duplicate verifier argument: ${name}`);
    values[name] = value;
  }
  if (!values["--runtime"] || !values["--devkit"]) usage("Both tarball paths are required.");
  return values;
}

async function regularFile(path, label) {
  const actual = await realpath(path);
  const entry = await lstat(actual);
  if (!entry.isFile() || !actual.endsWith(".tgz")) usage(`${label} must be a real .tgz file.`);
  return actual;
}

async function npmCli() {
  const executable = await realpath(process.execPath);
  const candidates = [process.env.npm_execpath, join(dirname(executable), "node_modules/npm/bin/npm-cli.js"), join(dirname(executable), "../lib/node_modules/npm/bin/npm-cli.js"), "/usr/share/nodejs/npm/bin/npm-cli.js"];
  for (const candidate of candidates) if (candidate && /(?:npm-cli\.js|npm\.js)$/.test(candidate) && await lstat(candidate).then((entry) => entry.isFile()).catch(() => false)) return candidate;
  throw new Error("npm CLI was not found alongside Node.");
}

const args = parseArgs(process.argv.slice(2));
const runtimeTarball = await regularFile(args["--runtime"], "runtime tarball");
const devkitTarball = await regularFile(args["--devkit"], "devkit tarball");
const npm = await npmCli();
const owned = await createVerificationWorkspace(repository);
const consumer = join(owned.root, "consumer");
const env = { ...process.env, CI: "1" };
for (const key of Object.keys(env)) if (["node_path", "node_options", "init_cwd", "npm_config_workspace", "npm_config_workspaces", "npm_config_prefix", "force_color", "clicolor_force"].includes(key.toLowerCase())) delete env[key];
const run = (argv, cwd, timeout = 180_000) => runNodeCommand(argv, { cwd, env, capture: true, timeout });
const log = (message) => console.log(`[aplg-verify-pair] ${message}`);

try {
  log("creating external consumer");
  await mkdir(consumer);
  for (const name of ["LICENSE", "README.md", "aplg.json", "index.html", "src", "tests"]) {
    await cp(join(fixture, name), join(consumer, name), { recursive: true });
  }
  await cp(join(fixture, "pnpm-lock.yaml"), join(consumer, "pnpm-lock.yaml"));
  const fixturePackage = JSON.parse(await readFile(join(fixture, "package.json"), "utf8"));
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    ...fixturePackage,
    dependencies: { "@ai-switch/tauri-plugin-runtime": pathToFileURL(runtimeTarball).href },
    devDependencies: {
      ...fixturePackage.devDependencies,
      "@ai-switch/tauri-plugin-devkit": pathToFileURL(devkitTarball).href,
      "@playwright/test": "1.63.0",
    },
  }, null, 2));
  await writeFile(join(consumer, ".npmrc"), "ignore-scripts=true\nworkspaces=false\naudit=false\nfund=false\n");
  await writeFile(join(consumer, "vite.config.js"), await readFile(join(fixture, "vite.config.js"), "utf8"));

  log("installing both tarballs");
  await run([npm, "install", "--ignore-scripts", "--workspaces=false", "--no-audit", "--no-fund"], consumer);
  for (const installed of ["@ai-switch/tauri-plugin-runtime", "@ai-switch/tauri-plugin-devkit"]) {
    const path = join(consumer, "node_modules", installed);
    assert.equal((await lstat(path)).isSymbolicLink(), false, `workspace link leaked for ${installed}`);
    assert.equal(await realpath(path), path);
  }
  const devkitPackage = JSON.parse(await readFile(join(consumer, "node_modules/@ai-switch/tauri-plugin-devkit/package.json"), "utf8"));
  assert.equal(JSON.stringify(devkitPackage).includes("workspace:"), false, "workspace protocol leaked into devkit tarball");

  log("running upstream behavior tests");
  await run(["tests/analyze-text.test.mjs"], consumer);
  const cli = join(consumer, "node_modules/@ai-switch/tauri-plugin-devkit/dist/cli.js");
  const vite = join(consumer, "node_modules/vite/bin/vite.js");

  log("building example with aplgVite");
  await run([vite, "build"], consumer);
  const record = JSON.parse(await readFile(join(consumer, "dist/aplg-build.json"), "utf8"));
  assert.equal(record.manifestPath, "aplg.json");
  assert.equal(record.entry, "dist/index.html");
  assert.match(record.bootstrap, /^dist\/.+\.js$/);
  assert.match(record.businessChunk, /^dist\/.+\.js$/);

  log("validating dist");
  const validation = JSON.parse(await run([cli, "validate", ".", "--stage", "dist", "--json"], consumer));
  assert.equal(validation.valid, true);
  assert.equal(validation.manifest.id, "io.github.ai-switch.plugin-example");

  log("packing and inspecting archive");
  const packed = JSON.parse(await run([cli, "pack", ".", "--json"], consumer));
  assert.equal(packed.valid, true);
  const archive = join(consumer, ".aplg-output", packed.path);
  const inspection = JSON.parse(await run([cli, "inspect", archive, "--json"], consumer));
  assert.equal(inspection.valid, true);
  assert.equal(inspection.signature, "not-verified");
  assert.equal(inspection.manifest.id, "io.github.ai-switch.plugin-example");
  assert.ok(inspection.files.some((file) => file.path === "dist/aplg-build.json"));

  log("loading unpacked archive in Chromium and WebKit");
  const spec = await readFile(join(repository, "packages/tauri-plugin-devkit/tests/browser/packaged-example.spec.ts"), "utf8");
  const playwright = join(consumer, "node_modules/@playwright/test/cli.js");
  await runPackagedExample({ consumer, archive, inspection, spec, playwright });

  console.log(JSON.stringify({
    runtimeTarball: runtimeTarball.split(/[\\/]/).at(-1),
    devkitTarball: devkitTarball.split(/[\\/]/).at(-1),
    plugin: validation.manifest.id,
    version: validation.manifest.version,
    archive: packed.path,
    files: inspection.files.length,
    platform: process.platform,
    node: process.version,
  }, null, 2));
} finally {
  await owned.cleanup();
  log("external consumer cleaned");
}
