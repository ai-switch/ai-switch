import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
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

test("generated protocol artifacts are pinned to LF checkout so byte checks survive Windows", async () => {
  const generated = fileURLToPath(new URL("../src/protocol/generated/", import.meta.url));
  const names = await readdir(generated);
  const extensions = [...new Set(names.map((name) => name.slice(name.lastIndexOf("."))))];
  const attributes = await readFile(new URL("../../../.gitattributes", import.meta.url), "utf8");
  const lfPatterns = new Set(
    attributes
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split(/\s+/))
      .filter((parts) => parts.includes("text") && parts.includes("eol=lf"))
      .map((parts) => parts[0]),
  );
  for (const extension of extensions) {
    expect(lfPatterns, `${extension} artifacts must be checked out with LF`).toContain(`*${extension}`);
  }
});