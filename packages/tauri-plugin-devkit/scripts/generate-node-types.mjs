import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { nodeSpecifiers } from "../src/vite/node-specifiers.mjs";

export function renderNodeTypes() {
  const modules = nodeSpecifiers.flatMap((entry) => [entry.name, `node:${entry.name}`].map((name) => [
    `declare module ${JSON.stringify(name)} {`,
    `  export * from ${JSON.stringify(entry.target)};`,
    ...(entry.hasDefault ? [`  export { default } from ${JSON.stringify(entry.target)};`] : []),
    "}",
  ].join("\n")));
  return "// Generated from vite/node-specifiers.mjs. Do not edit.\n// Browser plugin tsconfig only: do not combine with @types/node.\n\n" + modules.join("\n\n") + "\n";
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const file = new URL("../src/node-types.d.ts", import.meta.url);
  const expected = renderNodeTypes();
  if (process.argv.includes("--check")) {
    if (await readFile(file, "utf8") !== expected) throw new Error("Generated Node adapter declarations are stale. Run generate:node-types.");
  } else await writeFile(file, expected);
}
