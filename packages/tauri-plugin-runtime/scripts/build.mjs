import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { packageRoot, schemaRoot } from "./protocol-output.mjs";

const require = createRequire(import.meta.url);
const generated = spawnSync(process.execPath, [join(packageRoot, "scripts/check-generated.mjs")], { cwd: packageRoot, stdio: "inherit" });
if (generated.status !== 0) throw new Error("Generated protocol check failed.");
await build({
  absWorkingDir: packageRoot,
  entryPoints: { index: "src/index.ts", "protocol/index": "src/protocol/index.ts" },
  outdir: "dist", bundle: true, splitting: true, format: "esm", platform: "browser",
  target: "es2022", sourcemap: false, legalComments: "inline", logLevel: "info",
});
const types = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.types.json"], { cwd: packageRoot, stdio: "inherit" });
if (types.status !== 0) throw new Error("Type declarations failed.");
await mkdir(join(packageRoot, "dist/protocol/schema"), { recursive: true });
await cp(schemaRoot, join(packageRoot, "dist/protocol/schema"), { recursive: true });
