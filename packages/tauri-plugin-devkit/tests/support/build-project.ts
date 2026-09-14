import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createVerificationWorkspace } from "../../../tauri-plugin-runtime/scripts/verification-workspace.mjs";
import { runNodeCommand } from "../../../tauri-plugin-runtime/scripts/verification-process.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const runtime = join(repository, "packages/tauri-plugin-runtime");

/** D3 tests our Vite hook against an installed runtime tarball, not a src alias.
 * This is not the two-published-package consumer acceptance owned by D8.
 */
export async function createBuildProject(files: Record<string, string | Uint8Array>) {
  const owned = await createVerificationWorkspace(repository);
  const root = join(owned.root, "plugin");
  const env = { ...process.env, CI: "1" };
  for (const key of Object.keys(env)) if (["node_path", "node_options", "init_cwd", "npm_config_workspace", "npm_config_workspaces", "npm_config_prefix", "force_color", "clicolor_force"].includes(key.toLowerCase())) delete env[key];
  const executable = await realpath(process.execPath);
  const candidates = [process.env.npm_execpath, join(dirname(executable), "node_modules/npm/bin/npm-cli.js"), join(dirname(executable), "../lib/node_modules/npm/bin/npm-cli.js"), "/usr/share/nodejs/npm/bin/npm-cli.js"];
  const npm = (await Promise.all(candidates.map(async (path) => path && /npm(?:-cli)?\.js$/.test(path) && await lstat(path).then((s) => s.isFile()).catch(() => false) ? path : undefined))).find(Boolean);
  const run = (args: string[], cwd: string) => runNodeCommand(args, { cwd, env, capture: true, timeout: 120000 });
  async function write(name: string, bytes: string | Uint8Array) {
    const file = join(root, name); const within = relative(root, file);
    if (!within || isAbsolute(within) || within.startsWith("..")) throw new Error("Fixture write escaped root.");
    await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
  }
  try {
    if (!npm) throw new Error("npm CLI not found alongside Node.");
    const [packed] = JSON.parse(await run([npm, "pack", "--json", "--ignore-scripts", "--workspaces=false", "--pack-destination", owned.root, "--loglevel=error"], runtime));
    assert.match(packed.filename, /^ai-switch-tauri-plugin-runtime-[0-9][a-zA-Z0-9.-]*\.tgz$/);
    await mkdir(root);
    for (const [name, data] of Object.entries(files)) if (name !== "package.json" && name !== "pnpm-lock.yaml") await write(name, data);
    await write("package.json", JSON.stringify({ name: "aplg-build-fixture", private: true, type: "module", version: "0.1.0", dependencies: { "@ai-switch/tauri-plugin-runtime": pathToFileURL(join(owned.root, packed.filename)).href }, devDependencies: { vite: "8.3.0" } }));
    await write(".npmrc", "ignore-scripts=true\nworkspaces=false\naudit=false\nfund=false\n");
    // A real lock is generated for these exact dependencies, then consumed frozen.
    await run([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false"], root);
    await run([npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false"], root);
    const consumerRequire = createRequire(join(root, "package.json"));
    const installed = consumerRequire.resolve("@ai-switch/tauri-plugin-runtime/package.json");
    assert.equal(await realpath(installed), join(root, "node_modules/@ai-switch/tauri-plugin-runtime/package.json"));
    assert.equal((await lstat(dirname(installed))).isSymbolicLink(), false);
    const vitePath = consumerRequire.resolve("vite/package.json");
    assert.equal(await realpath(vitePath), join(root, "node_modules/vite/package.json"));
    // Drive builds with the devkit's pinned Vite, as in the D3 contract.
    // Importing a temporary native Rolldown DLL locks it on Windows until this
    // worker exits, preventing deterministic finally cleanup. D8 owns the fully
    // external tool process. Plugin modules still resolve only to their tarball.
    const vite = await import("vite");
    assert.equal(vite.version, "8.3.0");
    assert.equal(JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")).lockfileVersion, 3);
    return { root, vite, write, dispose: () => owned.cleanup() };
  } catch (error) { await owned.cleanup(); throw error; }
}
export async function withBuildProject(files: Record<string, string | Uint8Array>, run: (root: string) => Promise<void>): Promise<void> {
  const project = await createBuildProject(files);
  try { await run(project.root); } finally { await project.dispose(); }
}
