import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { generatedRoot, generateProtocolOutput } from "./protocol-output.mjs";

const expected = await generateProtocolOutput();
const actualNames = await readdir(generatedRoot).catch(() => []);
const mismatches = actualNames.filter((name) => !expected.has(name));
for (const [name, source] of expected) {
  const actual = await readFile(join(generatedRoot, name), "utf8").catch(() => null);
  if (actual !== source) mismatches.push(name);
}
if (mismatches.length) throw new Error(`Generated protocol files are stale: ${mismatches.join(", ")}. Run pnpm generate.`);
console.log(`Verified ${expected.size} generated protocol files.`);
