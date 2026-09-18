import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { checkPackageBoundaries } from "../../../scripts/aplg/check-package-boundaries.mjs";
import { createVerificationWorkspace } from "./verification-workspace.mjs";
import { runNodeCommand } from "./verification-process.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const example = join(repoRoot, "examples/aplg-plain-host");
const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const childEnv = { ...process.env, CI: "1" };
for (const key of Object.keys(childEnv)) if (["node_path", "node_options", "init_cwd", "npm_config_prefix", "npm_config_workspace", "npm_config_workspaces", "force_color", "clicolor_force"].includes(key.toLowerCase())) delete childEnv[key];

async function npmCli() {
  // Invoke Node's CLI file directly: no cmd/batch composition on Windows.
  const executable = await realpath(process.execPath);
  const candidates = [process.env.npm_execpath, join(dirname(executable), "node_modules/npm/bin/npm-cli.js"), join(dirname(executable), "../lib/node_modules/npm/bin/npm-cli.js"), "/usr/share/nodejs/npm/bin/npm-cli.js"];
  for (const candidate of candidates) if (candidate && /(?:npm-cli\.js|npm\.js)$/.test(candidate) && await lstat(candidate).then((s) => s.isFile()).catch(() => false)) return candidate;
  throw new Error("npm CLI was not found alongside Node; install npm for this Node toolchain.");
}
const npm = await npmCli();
const controller = new AbortController();
const run = (args, options) => runNodeCommand(args, { ...options, env: childEnv, signal: controller.signal });
const workspace = await createVerificationWorkspace(repoRoot);
let servers;
const onSignal = () => controller.abort(new Error("Verification interrupted"));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, onSignal);
try {
  console.log(`External consumer: ${workspace.root}`);
  await run([join(packageRoot, "scripts/build.mjs")], { cwd: packageRoot });
  const [packed] = JSON.parse(await run([npm, "pack", "--json", "--ignore-scripts", "--workspaces=false", "--pack-destination", workspace.root, "--loglevel=error"], { cwd: packageRoot, capture: true }));
  assert.ok(packed.filename && packed.filename === packed.filename.split(/[\\/]/).at(-1) && packed.filename.endsWith(".tgz"), "unsafe tarball filename");
  const files = packed.files.map((file) => file.path);
  await checkPackageBoundaries({ packageRoot, files, typescript: ts, sourceRoots: [repoRoot] });
  const consumer = join(workspace.root, "consumer"); await mkdir(consumer);
  // Copy only example inputs, never node_modules, dist, source aliases or workspace config.
  for (const name of ["index.html", "tsconfig.json", "vite.config.ts", "src", "plugin", "scripts"]) await cp(join(example, name), join(consumer, name), { recursive: true });
  const examplePackage = JSON.parse(await readFile(join(example, "package.json"), "utf8"));
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    ...examplePackage,
    dependencies: { [metadata.name]: pathToFileURL(join(workspace.root, packed.filename)).href },
    devDependencies: { ...examplePackage.devDependencies, "@playwright/test": metadata.devDependencies["@playwright/test"] },
  }, null, 2));
  await writeFile(join(consumer, ".npmrc"), "workspaces=false\nignore-scripts=true\naudit=false\nfund=false\n");
  await run([npm, "install", "--ignore-scripts", "--workspaces=false", "--no-audit", "--no-fund", "--package-lock=false"], { cwd: consumer });
  const installed = join(consumer, "node_modules/@ai-switch/tauri-plugin-runtime");
  assert.equal((await lstat(installed)).isSymbolicLink(), false, "workspace symlink leaked into consumer");
  assert.equal(await realpath(installed), installed);
  const report = await checkPackageBoundaries({ packageRoot: installed, files, typescript: ts, sourceRoots: [repoRoot], dependencyRoot: consumer });
  const installedFiles = (await readdir(installed, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => relative(installed, join(entry.parentPath, entry.name)).replaceAll("\\", "/")).sort();
  assert.deepEqual(installedFiles, [...files].sort(), "installed tarball file list differs");
  for (const path of files) assert.deepEqual(await readFile(join(installed, path)), await readFile(join(packageRoot, path)), `installed file differs: ${path}`);
  const externalRequire = createRequire(join(consumer, "package.json"));
  function tool(name) {
    const resolved = externalRequire.resolve(name);
    const fromConsumer = relative(consumer, resolved);
    assert.ok(fromConsumer && !isAbsolute(fromConsumer) && !fromConsumer.startsWith(".."), `tool escaped consumer: ${name}`);
    return resolved;
  }
  await cp(join(packageRoot, "tests/package/public-smoke.mjs"), join(consumer, "public-smoke.mjs"));
  await run(["public-smoke.mjs"], { cwd: consumer });
  await mkdir(join(consumer, "tests/types"), { recursive: true });
  for (const name of ["public-node-subset.test-d.ts", "public-fs-subset.test-d.ts"]) await cp(join(packageRoot, "tests/types", name), join(consumer, "tests/types", name));
  await run([tool("typescript/bin/tsc"), "--noEmit", "-p", "tsconfig.json"], { cwd: consumer });
  await writeFile(join(consumer, "tsconfig.public-nodenext.json"), JSON.stringify({
    extends: "./tsconfig.json", compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" }, include: ["tests/types"],
  }));
  await run([tool("typescript/bin/tsc"), "--noEmit", "-p", "tsconfig.public-nodenext.json"], { cwd: consumer });
  await run([join(dirname(tool("vite/package.json")), "bin/vite.js"), "build"], { cwd: consumer });
  const { startExampleServers } = await import(pathToFileURL(join(consumer, "scripts/serve.mjs")).href);
  servers = await startExampleServers({ distRoot: join(consumer, "dist") });
  // The tests/config/tools also live outside the repository. No source fixture server.
  await cp(join(packageRoot, "tests/browser/packaged-host.spec.ts"), join(consumer, "tests/packaged-host.spec.ts"));
  await writeFile(join(consumer, "playwright.config.mjs"), `export default ${JSON.stringify({
    testDir: "tests", testMatch: "packaged-host.spec.ts", fullyParallel: true, workers: 2,
    timeout: 25000, expect: { timeout: 7000 }, reporter: "list", outputDir: "test-results",
    use: { baseURL: servers.hostOrigin, headless: true },
    projects: [
      { name: "chromium", use: { browserName: "chromium", launchOptions: { channel: "chromium" } } },
      { name: "webkit", use: { browserName: "webkit" } },
    ],
  })};\n`);
  await run([tool("@playwright/test/cli"), "test"], { cwd: consumer, timeout: 180_000 });
  console.log(JSON.stringify({ tarball: packed.filename, bytes: packed.size, unpackedBytes: packed.unpackedSize, ...report, platform: process.platform, node: process.version, browsers: ["chromium", "webkit"] }, null, 2));
} finally {
  for (const signal of ["SIGINT", "SIGTERM"]) process.removeListener(signal, onSignal);
  try { await servers?.close(); } finally { await workspace.cleanup(); }
  console.log("External consumer, tarball and demo servers cleaned.");
}
