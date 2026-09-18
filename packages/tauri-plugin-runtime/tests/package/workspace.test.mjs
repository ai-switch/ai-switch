import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createVerificationWorkspace } from "../../scripts/verification-workspace.mjs";

test("verification workspace owns a directory directly under the real OS temp root and cleans on failure", async () => {
  const workspace = await createVerificationWorkspace(new URL("../../../../", import.meta.url));
  const root = workspace.root;
  assert.equal(dirname(await realpath(root)), await realpath(tmpdir()));
  try {
    await writeFile(join(root, "sentinel"), "temporary");
    throw new Error("simulated install failure");
  } catch (error) {
    assert.equal(error.message, "simulated install failure");
  } finally { await workspace.cleanup(); }
  await assert.rejects(readFile(join(root, "sentinel")), { code: "ENOENT" });
  await workspace.cleanup();
});

test("cleanup refuses a directory whose ownership marker was replaced", async () => {
  const workspace = await createVerificationWorkspace(new URL("../../../../", import.meta.url));
  const marker = join(workspace.root, ".aplg-verification-owner");
  const original = await readFile(marker, "utf8");
  try {
    await writeFile(marker, "not-owned");
    await assert.rejects(workspace.cleanup(), /unowned/);
    assert.equal(await readFile(marker, "utf8"), "not-owned");
  } finally { await writeFile(marker, original); await workspace.cleanup(); }
});