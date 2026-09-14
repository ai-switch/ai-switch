import { spawnSync } from "node:child_process";
import { chmod, lstat, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(import.meta.url);
// Node entry points only. /vite and browser /testing get separate build graphs
// in their implementation tasks, rather than sharing a bundle with Node fs.
const output = resolve(packageRoot, "dist");
if (dirname(output) !== packageRoot) throw new Error("Unsafe devkit output directory.");
const existing = await lstat(output).catch((error) => { if (error.code !== "ENOENT") throw error; });
if (existing && (existing.isSymbolicLink() || !existing.isDirectory() || await realpath(output) !== output)) throw new Error("Devkit output must be a real package-local directory.");
await rm(output, { recursive: true, force: true });
await build({
  absWorkingDir: packageRoot,
  entryPoints: { index: "src/index.ts", cli: "src/cli.ts" },
  outdir: "dist", bundle: true, splitting: true, format: "esm", platform: "node",
  packages: "external", target: "node22.12", sourcemap: false, logLevel: "info",
});
const types = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.types.json"], { cwd: packageRoot, stdio: "inherit", windowsHide: true });
if (types.status !== 0) throw new Error("Devkit declaration build failed.");
await chmod(join(output, "cli.js"), 0o755);
