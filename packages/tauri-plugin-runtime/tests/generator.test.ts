import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

test("generated contract checking detects stale files without relying on Git", async () => {
  const file = new URL("../src/protocol/generated/types.generated.ts", import.meta.url);
  const original = await readFile(file, "utf8");
  try {
    await writeFile(file, `${original}\n// stale fixture\n`);
    expect(() => execFileSync(process.execPath, ["scripts/check-generated.mjs"], { cwd: root, stdio: "pipe" })).toThrow();
  } finally {
    await writeFile(file, original);
  }
  expect(execFileSync(process.execPath, ["scripts/check-generated.mjs"], { cwd: root, encoding: "utf8" })).toContain("Verified");
});
