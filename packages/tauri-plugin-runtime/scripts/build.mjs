import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, lstat, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { checkBuildGraph } from "../../../scripts/aplg/check-package-boundaries.mjs";
import { packageRoot, schemaRoot } from "./protocol-output.mjs";

const require = createRequire(import.meta.url);
const generated = spawnSync(process.execPath, [join(packageRoot, "scripts/check-generated.mjs")], { cwd: packageRoot, stdio: "inherit" });
if (generated.status !== 0) throw new Error("Generated protocol check failed.");
// dist is an owned generated directory. Resolve and check before recursive cleanup;
// never follow a substituted symlink/junction or remove another workspace path.
const root = await realpath(packageRoot);
const output = resolve(root, "dist");
if (dirname(output) !== root) throw new Error("Unsafe build output directory.");
const existing = await lstat(output).catch((error) => { if (error.code !== "ENOENT") throw error; });
if (existing && (existing.isSymbolicLink() || !existing.isDirectory() || await realpath(output) !== output)) throw new Error("Build output must be a real local directory.");
await rm(output, { recursive: true, force: true });
const result = await build({
  absWorkingDir: packageRoot,
  entryPoints: {
    index: "src/index.ts", "protocol/index": "src/protocol/index.ts",
    "plugin/index": "src/plugin/index.ts", "host/index": "src/host/index.ts",
    "node/path": "src/node/path.ts", "node/buffer": "src/node/buffer.ts", "node/events": "src/node/events.ts",
    "node/fs": "src/node/fs.ts", "node/fs/promises": "src/node/fs/promises.ts",
  },
  metafile: true,
  outdir: "dist", bundle: true, splitting: true, format: "esm", platform: "browser",
  target: "es2022", sourcemap: false, legalComments: "inline", logLevel: "info",
});
checkBuildGraph(result.metafile);
const types = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.types.json"], { cwd: packageRoot, stdio: "inherit" });
if (types.status !== 0) throw new Error("Type declarations failed.");
await mkdir(join(packageRoot, "dist/protocol/schema"), { recursive: true });
await cp(schemaRoot, join(packageRoot, "dist/protocol/schema"), { recursive: true });
