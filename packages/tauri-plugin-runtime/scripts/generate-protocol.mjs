import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generatedRoot, generateProtocolOutput } from "./protocol-output.mjs";

const outputs = await generateProtocolOutput();
await mkdir(generatedRoot, { recursive: true });
for (const [name, source] of outputs) await writeFile(join(generatedRoot, name), source, "utf8");
console.log(`Generated ${outputs.size} protocol files.`);
