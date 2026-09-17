import assert from "node:assert/strict";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createVerificationWorkspace } from "../../../tauri-plugin-runtime/scripts/verification-workspace.mjs";
import { runNodeCommand } from "../../../tauri-plugin-runtime/scripts/verification-process.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const runtimeRoot = join(repository, "packages/tauri-plugin-runtime");
const devkitRoot = join(repository, "packages/tauri-plugin-devkit");

function cleanEnv() {
  const env = { ...process.env, CI: "1" };
  for (const key of Object.keys(env)) if (["node_path", "node_options", "init_cwd", "npm_config_workspace", "npm_config_workspaces", "npm_config_prefix", "force_color", "clicolor_force"].includes(key.toLowerCase())) delete env[key];
  return env;
}

async function npmCli() {
  const executable = await realpath(process.execPath);
  const candidates = [process.env.npm_execpath, join(dirname(executable), "node_modules/npm/bin/npm-cli.js"), join(dirname(executable), "../lib/node_modules/npm/bin/npm-cli.js"), "/usr/share/nodejs/npm/bin/npm-cli.js"];
  for (const candidate of candidates) if (candidate && /(?:npm-cli\.js|npm\.js)$/.test(candidate) && await lstat(candidate).then((entry) => entry.isFile()).catch(() => false)) return candidate;
  throw new Error("npm CLI was not found alongside Node.");
}

async function pnpmCli() {
  const executable = await realpath(process.execPath);
  const candidates = [process.env.npm_execpath, join(dirname(executable), "node_modules/corepack/dist/pnpm.js"), join(dirname(executable), "../lib/node_modules/corepack/dist/pnpm.js"), "/usr/share/nodejs/corepack/dist/pnpm.js"];
  for (const candidate of candidates) if (candidate && /pnpm\.js$/.test(candidate) && await lstat(candidate).then((entry) => entry.isFile()).catch(() => false)) return candidate;
  throw new Error("pnpm CLI was not found alongside Node.");
}

export interface TarballConsumer {
  root: string;
  npm: string;
  runtimeTarball: string;
  devkitTarball: string;
  run(args: string[], options?: { cwd?: string; timeout?: number }): Promise<{ code: number; stdout: string; stderr: string }>;
  runCli(args: string[], options?: { cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }>;
  write(name: string, bytes: string | Uint8Array): Promise<void>;
}

async function runCaptured(args: string[], cwd: string, env: Record<string, string | undefined>, timeout = 120_000) {
  let stdout = ""; let stderr = "";
  try {
    stdout = await runNodeCommand(args, { cwd, env, capture: true, timeout });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/Verification command failed \((\d+)\)(?::[\s\S]*?)?\n([\s\S]*?)\n([\s\S]*)$/);
    if (!match) throw error;
    return { code: Number(match[1]), stdout: match[2] ?? "", stderr: match[3] ?? "" };
  }
}

export async function withInstalledTarballs(run: (consumer: TarballConsumer) => Promise<void>): Promise<void> {
  const owned = await createVerificationWorkspace(repository);
  const env = cleanEnv();
  const npm = await npmCli();
  const pnpm = await pnpmCli();
  const consumerRoot = join(owned.root, "consumer");
  try {
    await runNodeCommand([join(runtimeRoot, "scripts/build.mjs")], { cwd: runtimeRoot, env, capture: true, timeout: 120_000 });
    await runNodeCommand([join(devkitRoot, "scripts/build.mjs")], { cwd: devkitRoot, env, capture: true, timeout: 120_000 });
    const runtimePacked = JSON.parse(await runNodeCommand([pnpm, "pack", "--json", "--pack-destination", owned.root, "--loglevel=error"], { cwd: runtimeRoot, env, capture: true, timeout: 120_000 }));
    const devkitPacked = JSON.parse(await runNodeCommand([pnpm, "pack", "--json", "--pack-destination", owned.root, "--loglevel=error"], { cwd: devkitRoot, env, capture: true, timeout: 120_000 }));
    const runtimePack = { ...runtimePacked, filename: runtimePacked.filename.split(/[\\/]/).at(-1) };
    const devkitPack = { ...devkitPacked, filename: devkitPacked.filename.split(/[\\/]/).at(-1) };
    assert.match(runtimePack.filename, /^ai-switch-tauri-plugin-runtime-[0-9][a-zA-Z0-9.-]*\.tgz$/);
    assert.match(devkitPack.filename, /^ai-switch-tauri-plugin-devkit-[0-9][a-zA-Z0-9.-]*\.tgz$/);
    await mkdir(consumerRoot);
    await writeFile(join(consumerRoot, "package.json"), JSON.stringify({
      name: "aplg-external-consumer",
      version: "0.1.0",
      private: true,
      type: "module",
      dependencies: {
        "@ai-switch/tauri-plugin-runtime": pathToFileURL(join(owned.root, runtimePack.filename)).href,
        "@ai-switch/tauri-plugin-devkit": pathToFileURL(join(owned.root, devkitPack.filename)).href,
      },
      devDependencies: { typescript: "5.9.3", vite: "8.3.0" },
      pnpm: { overrides: { "@ai-switch/tauri-plugin-runtime": pathToFileURL(join(owned.root, runtimePack.filename)).href } },
    }, null, 2));
    await writeFile(join(consumerRoot, ".npmrc"), "ignore-scripts=true\nworkspaces=false\naudit=false\nfund=false\n");
    await runNodeCommand([npm, "install", "--ignore-scripts", "--workspaces=false", "--no-audit", "--no-fund"], { cwd: consumerRoot, env, capture: true, timeout: 180_000 });
    const runtimeInstalled = join(consumerRoot, "node_modules/@ai-switch/tauri-plugin-runtime");
    const devkitInstalled = join(consumerRoot, "node_modules/@ai-switch/tauri-plugin-devkit");
    for (const installed of [runtimeInstalled, devkitInstalled]) {
      assert.equal((await lstat(installed)).isSymbolicLink(), false, "workspace link leaked into external consumer");
      assert.equal(await realpath(installed), installed);
    }
    const packageJson = JSON.parse(await readFile(join(devkitInstalled, "package.json"), "utf8"));
    assert.equal(packageJson.dependencies["@ai-switch/tauri-plugin-runtime"], "0.1.0");
    const cli = join(devkitInstalled, "dist/cli.js");
    const consumer: TarballConsumer = {
      root: consumerRoot,
      npm,
      runtimeTarball: join(owned.root, runtimePack.filename),
      devkitTarball: join(owned.root, devkitPack.filename),
      async run(args, options = {}) { return runCaptured(args, options.cwd ?? consumerRoot, env, options.timeout); },
      async runCli(args, options = {}) { return runCaptured([cli, ...args], options.cwd ?? consumerRoot, env, 120_000); },
      async write(name, bytes) {
        const path = join(consumerRoot, name);
        const child = relative(consumerRoot, path);
        if (!child || isAbsolute(child) || child.startsWith("..")) throw new Error("External fixture write escaped consumer.");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      },
    };
    await run(consumer);
  } finally {
    await owned.cleanup();
  }
}