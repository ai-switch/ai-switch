import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This file is copied into the os.tmpdir consumer before it is executed. No
// imports point back at the source checkout or its node_modules.
const consumer = await realpath(process.cwd());
const packageName = "@ai-switch/tauri-plugin-runtime";
const entryNames = ["", "/protocol", "/host", "/plugin", "/node/path", "/node/buffer", "/node/events", "/node/fs", "/node/fs/promises"];
for (const name of ["window", "document"]) Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error(`SSR import touched ${name}`); } });
const modules = {};
for (const entry of entryNames) {
  const path = fileURLToPath(import.meta.resolve(packageName + entry));
  const fromConsumer = relative(consumer, await realpath(path));
  assert.ok(fromConsumer && !fromConsumer.startsWith("..") && !isAbsolute(fromConsumer), `import escaped consumer: ${entry}`);
  modules[entry] = await import(packageName + entry);
}
assert.deepEqual(Object.keys(modules[""]).sort(), ["apiVersion", "protocolVersion"]);
assert.equal(typeof modules["/host"].createPluginHost, "function");
assert.equal(typeof modules["/plugin"].aplg.ready, "function");
assert.equal(modules["/node/path"].default.resolve("notes.txt"), "/data/notes.txt");
assert.equal(modules["/protocol"].validateManifest({ manifestVersion: 99 }).ok, false);
assert.equal(modules["/node/buffer"].Buffer.from("你好").toString("utf8"), "你好");
const emitter = new modules["/node/events"].EventEmitter();
let count = 0; emitter.once("message", () => count++); emitter.emit("message"); emitter.emit("message"); assert.equal(count, 1);
assert.equal(modules["/node/fs"].default.promises, modules["/node/fs/promises"].default);
assert.equal(modules["/node/fs"].promises.readFile, modules["/node/fs/promises"].readFile);
for (const entry of ["/src/plugin/index.ts", "/dist/plugin/index.js", "/testing"]) await assert.rejects(import(packageName + entry), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
const require = createRequire(import.meta.url);
const packagePath = require.resolve(packageName + "/package.json");
const root = dirname(packagePath);
assert.equal((await lstat(root)).isSymbolicLink(), false, "npm installed a workspace link");
assert.equal(await realpath(root), resolve(consumer, "node_modules/@ai-switch/tauri-plugin-runtime"));
assert.equal(require(packageName + "/package.json").name, packageName);
console.log(`External SSR: ${entryNames.length} public ESM entries, export guards and fs singleton passed (${process.platform}, ${process.version}).`);
