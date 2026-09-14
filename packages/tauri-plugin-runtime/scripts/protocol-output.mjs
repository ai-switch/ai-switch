import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import { compile } from "json-schema-to-typescript";
import { build } from "esbuild";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const generatedRoot = join(packageRoot, "src/protocol/generated");
export const schemaRoot = join(packageRoot, "src/protocol/schema");

export async function generateProtocolOutput() {
  const files = (await readdir(schemaRoot)).filter((name) => name.endsWith(".schema.json")).sort();
  const schemas = await Promise.all(files.map(async (name) => ({ name, value: JSON.parse(await readFile(join(schemaRoot, name), "utf8")) })));
  const ajv = new Ajv({ strict: true, allErrors: true, code: { source: true, esm: true }, ownProperties: true });
  for (const schema of schemas) ajv.addSchema(schema.value);
  const exports = {};
  const output = new Map();
  const typeExports = [];
  for (const { name, value } of schemas) {
    const stem = name.slice(0, -".schema.json".length);
    exports[`validate${value.title}Schema`] = value.$id;
    const declarations = await compile(value, value.title, {
      cwd: schemaRoot,
      ignoreMinAndMaxItems: true,
      bannerComment: "/* Generated from JSON Schema. Do not edit directly. */",
      style: { singleQuote: false, semi: true, tabWidth: 2 },
    });
    output.set(`${stem}.generated.ts`, declarations.replaceAll("\r\n", "\n"));
    typeExports.push(`export type { ${value.title} } from "./${stem}.generated.js";`);
  }
  const source = standaloneCode(ajv, exports);
  // Bundle Ajv runtime helpers ahead of time: the shipped browser module does not
  // need require(), the Ajv compiler, eval(), or new Function().
  const result = await build({
    stdin: { contents: source, resolveDir: packageRoot, sourcefile: "validators.generated.mjs" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    legalComments: "inline", logLevel: "silent",
  });
  output.set("validators.generated.mjs", "// Generated from JSON Schema. Do not edit directly.\n" + result.outputFiles[0].text);
  output.set("types.generated.ts", "// Generated from JSON Schema. Do not edit directly.\n" + typeExports.join("\n") + "\n");
  return output;
}
