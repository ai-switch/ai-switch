import { spawnSync } from "node:child_process";
import { chmod, copyFile, lstat, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { renderNodeTypes } from "./generate-node-types.mjs";

const packageRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(import.meta.url);
// Node APIs and the Vite hook are separate entries. The future browser /testing
// entry must have a different browser build graph, never the Node tooling graph.
if (await readFile(join(packageRoot, "src/node-types.d.ts"), "utf8") !== renderNodeTypes()) throw new Error("Generated Node adapter declarations are stale.");
const output = resolve(packageRoot, "dist");
if (dirname(output) !== packageRoot) throw new Error("Unsafe devkit output directory.");
const existing = await lstat(output).catch((error) => { if (error.code !== "ENOENT") throw error; });
if (existing && (existing.isSymbolicLink() || !existing.isDirectory() || await realpath(output) !== output)) throw new Error("Devkit output must be a real package-local directory.");
await rm(output, { recursive: true, force: true });
await build({
  absWorkingDir: packageRoot,
  entryPoints: { index: "src/index.ts", cli: "src/cli.ts", "vite/index": "src/vite/index.ts" },
  outdir: "dist", bundle: true, splitting: true, format: "esm", platform: "node",
  packages: "external", target: "node22.12", sourcemap: false, logLevel: "info",
});
const types = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.types.json"], { cwd: packageRoot, stdio: "inherit", windowsHide: true });
if (types.status !== 0) throw new Error("Devkit declaration build failed.");
await copyFile(join(packageRoot, "src/node-types.d.ts"), join(output, "node-types.d.ts"));
await chmod(join(output, "cli.js"), 0o755);
