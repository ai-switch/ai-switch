import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { nodeSpecifiers } from "../src/vite/node-specifiers.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { aplgVite } from "../src/vite/index.js";
import { renderNodeTypes } from "../scripts/generate-node-types.mjs";

test("the alias table is exact and the declaration adapters derive from the same list", async () => {
  expect(nodeSpecifiers.map((item) => item.name)).toEqual(["fs/promises", "fs", "path", "buffer", "events"]);
  const text = renderNodeTypes();
  expect(await readFile(new URL("../src/node-types.d.ts", import.meta.url), "utf8")).toBe(text);
  for(const entry of nodeSpecifiers) {
    for(const name of [entry.name, `node:${entry.name}`]) expect(text).toContain(`declare module "${name}"`);
    expect(text).toContain(`export * from "${entry.target}"`);
  }
  expect(text).not.toMatch(/reference types="node"/);
  expect(nodeSpecifiers.find((entry) => entry.name === "buffer")!.hasDefault).toBe(false);
});

test("generation check rejects stale declarations without rewriting them", async () => {
  const file = new URL("../src/node-types.d.ts", import.meta.url); const original = await readFile(file, "utf8");
  try {
    await writeFile(file, original + "// stale fixture\n");
    expect(() => execFileSync(process.execPath, ["scripts/generate-node-types.mjs", "--check"], { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "pipe" })).toThrow();
    expect(await readFile(file, "utf8")).toBe(original + "// stale fixture\n");
  } finally { await writeFile(file, original); }
});

test.each([null, [], {unknown:true}, {preview:"yes"}].map((options)=>({options})))("rejects invalid plugin options: %j", ({ options }) => {
  expect(() => aplgVite(options as never)).toThrow(/APLG_INVALID_OPTIONS/);
});
test("custom manifest options construct the build hook without reading the project", () => {
  expect(aplgVite({manifestPath:"custom.json"})).toHaveLength(2);
});