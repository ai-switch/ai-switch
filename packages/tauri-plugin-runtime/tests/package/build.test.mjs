import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sentinel = new URL("../../dist/chunk-R8STALE.js", import.meta.url);

test("a fresh production build never leaves an old chunk in dist", async () => {
  await mkdir(new URL("../../dist/", import.meta.url), { recursive: true });
  // Only this explicitly named fixture is created/removed by the test.
  await assert.rejects(readFile(sentinel), { code: "ENOENT" });
  try {
    await writeFile(sentinel, "export const stale = true;\n");
    const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: root, encoding: "utf8", timeout: 90_000 });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    await assert.rejects(readFile(sentinel), { code: "ENOENT" });
  } finally {
    await rm(sentinel, { force: true });
  }
});
