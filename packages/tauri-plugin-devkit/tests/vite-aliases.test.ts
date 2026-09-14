import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chromium, webkit } from "@playwright/test";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runNodeCommand } from "../../tauri-plugin-runtime/scripts/verification-process.mjs";
import type { InlineConfig, Rollup } from "vite";
import { aplgVite } from "../src/vite/index.js";
import { createBuildProject } from "./support/build-project.js";
import { validProjectFiles } from "./support/project.js";

let project: Awaited<ReturnType<typeof createBuildProject>>;
beforeAll(async () => { project = await createBuildProject(validProjectFiles()); }, 120000);
afterAll(async () => { await project?.dispose(); });
const output = (result: unknown) => (result as Rollup.RollupOutput).output.filter((item) => item.type === "chunk").map((item) => item.code).join("\n");
async function build(code: string, extra: InlineConfig = {}) {
  await project.write("src/main.ts", code);
  return project.vite.build({ root: project.root, configFile: false, logLevel: "silent", plugins: aplgVite({ preview: false }), build: { write: false, target: "es2022", minify: false }, ...extra });
}

describe("plugin-only Node import adaptation", () => {
  test("an external type consumer resolves the public types-only subpath without Node globals", async () => {
    const current = fileURLToPath(new URL("../", import.meta.url));
    const installed = join(project.root, "node_modules/@ai-switch/tauri-plugin-devkit");
    // D3 tests emitted declaration packaging, not a D8 devkit registry install.
    await mkdir(installed, { recursive: true });
    await cp(join(current, "dist"), join(installed, "dist"), { recursive: true });
    await cp(join(current, "package.json"), join(installed, "package.json"));
    await project.write("types.ts", await readFile(join(current, "tests/types/node-imports.ts"), "utf8"));
    const config = JSON.parse(await readFile(join(current, "tsconfig.browser-type-tests.json"), "utf8"));
    config.compilerOptions.types = ["@ai-switch/tauri-plugin-devkit/node-types"]; config.include = ["types.ts"];
    await project.write("tsconfig.json", JSON.stringify(config));
    const require = createRequire(import.meta.url);
    await expect(runNodeCommand([require.resolve("typescript/bin/tsc"), "--noEmit", "-p", "tsconfig.json"], { cwd: project.root, capture: true })).resolves.toBe("");
  });
  test("loads only the public tarball path entry rather than Vite's native browser stub", async () => {
    const code = output(await build('import path from "node:path"; document.body.textContent = path.resolve("note.txt");'));
    expect(code).toContain("/data"); expect(code).not.toContain("__vite-browser-external");
  });
  test.each(["path", "fs", "fs/promises", "buffer", "events"])("bare and node: forms share the same %s module", async (name) => {
    const code = `import * as bare from ${JSON.stringify(name)}; import * as prefixed from ${JSON.stringify(`node:${name}`)}; document.body.textContent = String(bare === prefixed);`;
    expect(output(await build(code))).not.toContain("__vite-browser-external");
  });
  test.each(["node:child_process", "child_process", "node:net", "tls", "worker_threads", "process", "node:process", "node:crypto", "path/posix", "node:fs/promises?raw", "node:not-real"])("unsupported builtin fails during real Vite build: %s", async (name) => {
    await expect(build(`import * as value from ${JSON.stringify(name)}; console.log(value);`)).rejects.toThrow(/APLG_UNSUPPORTED_NODE_MODULE/);
  });
  test.each(["@ai-switch/tauri-plugin-runtime/host", "@ai-switch/tauri-plugin-devkit/testing", "@ai-switch/tauri-plugin-devkit", "@tauri-apps/api/core"])("forbids host-only plugin imports: %s", async (name) => {
    await expect(build(`import * as host from ${JSON.stringify(name)}; console.log(host);`)).rejects.toThrow(/APLG_HOST_IMPORT/);
  });
  test.each([
    'const name = "fs"; console.log(require(name));',
    'const load = require; load("fs");', 'module.require("fs");',
    'console.log(process.cwd());', 'console.log(globalThis.process.env);',
    'console.log(globalThis["process"].cwd());', 'console.log(Buffer.from("a"));',
    'console.log(__dirname);', 'console.log(__filename);',
  ])("rejects unsupported runtime globals/require: %s", async (source) => {
    await expect(build(source)).rejects.toThrow(/APLG_(DYNAMIC_REQUIRE|UNSUPPORTED_NODE_GLOBAL)/);
  });
  test("does not confuse comments, strings, object keys or locally bound names with Node globals", async () => {
    const code = 'const object = {process:"data",require:"label"}; function format(process:string){return process;} const process = "ok"; /* require(name), process.cwd() */ document.body.textContent = format(process) + object.process + "node:child_process";';
    expect(output(await build(code))).toContain("ok");
  });
  test("ordinary packages with similar names are not redirected", async () => {
    await project.write("node_modules/path-helper/package.json", JSON.stringify({ name: "path-helper", type: "module", exports: "./index.js" }));
    await project.write("node_modules/path-helper/index.js", 'export const marker = "ordinary-package";');
    expect(output(await build('import {marker} from "path-helper"; document.body.textContent=marker;'))).toContain("ordinary-package");
  });
  test("cannot bypass the host-entry restriction using an absolute/relative installed path", async () => {
    await expect(build('import {createPluginHost} from "../node_modules/@ai-switch/tauri-plugin-runtime/dist/host/index.js"; console.log(createPluginHost);')).rejects.toThrow(/APLG_HOST_IMPORT/);
  });
  test("checks transitive dependencies instead of only author entry imports", async () => {
    await project.write("node_modules/transitive-helper/package.json", JSON.stringify({ name: "transitive-helper", type: "module", exports: "./index.js" }));
    await project.write("node_modules/transitive-helper/index.js", 'import {spawn} from "node:child_process"; export {spawn};');
    await expect(build('import {spawn} from "transitive-helper"; console.log(spawn);')).rejects.toThrow(/APLG_UNSUPPORTED_NODE_MODULE/);
  });
  test("rejects native addons before a loader tries to execute or bundle them", async () => {
    await project.write("src/addon.node", new Uint8Array([0, 1]));
    try { await expect(build('import addon from "./addon.node"; console.log(addon);')).rejects.toThrow(/APLG_NATIVE_ADDON/); }
    finally { await rm(join(project.root, "src/addon.node")); }
  });
  test("static CommonJS dependency imports are adapted without a global require shim", async () => {
    await project.write("node_modules/cjs-helper/package.json", JSON.stringify({ name: "cjs-helper", main: "./index.cjs" }));
    await project.write("node_modules/cjs-helper/index.cjs", 'const path = require("path"); module.exports = {result:path.resolve("cjs")};');
    expect(output(await build('import helper from "cjs-helper"; document.body.textContent=helper.result;'))).toContain("/data");
  });
  test("explicit user externals cannot leave real Node imports in an output chunk", async () => {
    await expect(build('import path from "node:path"; console.log(path.resolve("x"));', { build: { write: false, rolldownOptions: { external: ["node:path"] } } }).then(() => "unexpected success")).rejects.toThrow(/APLG_(UNSUPPORTED_NODE_MODULE|EXTERNAL_NODE_IMPORT)/);
  });
  test("an aliased host path is still forbidden after Vite alias resolution", async () => {
    await expect(build('import {createPluginHost} from "fake-host"; console.log(createPluginHost);', { resolve: { alias: { "fake-host": join(project.root, "node_modules/@ai-switch/tauri-plugin-runtime/dist/host/index.js") } } }).then(() => "unexpected success")).rejects.toThrow(/APLG_HOST_IMPORT/);
  });
  test("dynamic require inside a dependency is diagnosed before the bundler hides it", async () => {
    await project.write("node_modules/dynamic-helper/package.json", JSON.stringify({ name: "dynamic-helper", main: "./index.cjs" }));
    await project.write("node_modules/dynamic-helper/index.cjs", 'module.exports = function(name){return require(name)};');
    await expect(build('import load from "dynamic-helper"; console.log(load("path"));').then(() => "unexpected success")).rejects.toThrow(/APLG_DYNAMIC_REQUIRE/);
  });
  test("Vite Node configuration and an unrelated SSR host retain the real Node APIs", async () => {
    await project.write("vite.config.mjs", 'import {writeFileSync} from "node:fs"; import path from "node:path"; writeFileSync(new URL("./node-config.txt",import.meta.url), path.resolve("native-config")); export default {};');
    try {
      await build('import path from "path"; document.body.textContent=path.resolve("plugin");', { configFile: join(project.root, "vite.config.mjs") });
      expect(await readFile(join(project.root, "node-config.txt"), "utf8")).toBe(join(process.cwd(), "native-config"));
      const host = await project.vite.build({ root: project.root, configFile: false, logLevel: "silent", build: { ssr: "src/main.ts", write: false, minify: false } });
      expect(output(host)).toMatch(/from ["'](?:node:)?path["']/); expect(output(host)).not.toContain('resolve("/data"');
    } finally { await rm(join(project.root, "vite.config.mjs"), { force: true }); await rm(join(project.root, "node-config.txt"), { force: true }); }
  });
  test("an author ESM file with a literal require never ships a runtime require call", async () => {
    const result = output(await build('const path = require("path"); document.body.textContent = path.resolve("author");'));
    expect(result).toContain("/data"); expect(result).not.toMatch(/require\(["']path["']\)/);
  });
  test("Vite dev transforms resolve the same aliases without prebundle Node stubs", async () => {
    await project.write("src/main.ts", 'import path from "node:path"; import { Buffer } from "buffer"; document.body.textContent = path.resolve(Buffer.from("dev").toString());');
    const server = await project.vite.createServer({ root: project.root, configFile: false, logLevel: "silent", plugins: aplgVite({ preview: false }), server: { host: "127.0.0.1", port: 0 } });
    try {
      await server.listen();
      const result = await server.transformRequest("/src/main.ts");
      expect(result!.code).toContain("tauri-plugin-runtime");
      expect(result!.code).not.toContain("__vite-browser-external");
    } finally { await server.close(); }
  });
  test("an SSR environment opts out even if aplgVite is included", async () => {
    const code = output(await build('import {readFile} from "node:fs/promises"; export {readFile};', { build: { ssr: "src/main.ts", write: false, minify: false } }));
    expect(code).toContain("node:fs/promises"); expect(code).not.toContain("aplg/1");
  });
});

describe("actual alias bundle in a browser", () => {
  test.each([{ name: "chromium", engine: chromium }, { name: "webkit", engine: webkit }])("public Node imports run in $name without global shims or fake filesystem", async ({ name, engine }) => {
    await build(`
      import path from "node:path"; import { Buffer } from "buffer"; import EventEmitter from "node:events";
      import fs from "node:fs"; import fsp from "fs/promises"; import direct from "node:fs/promises";
      const events = new EventEmitter(); let count = 0; events.once("tick",()=>count++); events.emit("tick"); events.emit("tick");
      const result = { path:path.resolve("notes.txt"), text:Buffer.from("你好").toString("utf8"), count, same:fs.promises === fsp && fsp === direct, error:"" };
      try { await fsp.readFile("/data/notes.txt"); } catch(error) { result.error = (error as {code:string}).code; }
      document.body.textContent = JSON.stringify(result);
    `, { base: "./", build: { write: true, target: "es2022", minify: false } });
    const server = await project.vite.preview({ root: project.root, configFile: false, logLevel: "silent", preview: { host: "127.0.0.1", port: 0, headers: { "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'none'" } } });
    let browser;
    try {
      const address = server.httpServer.address(); if (!address || typeof address === "string") throw new Error("Missing preview port");
      browser = await engine.launch({ headless: true, ...(name === "chromium" ? { channel: "chromium" } : {}) });
      const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror",(e)=>errors.push(e.message));
      await page.addInitScript(() => {
        // semver's browser bundle probes typeof process; undefined is a normal
        // browser, while a throwing getter would make that feature probe fail.
        Object.defineProperty(globalThis, "process", { configurable: true, value: undefined });
        for (const name of ["Buffer", "require"]) Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error(`Unexpected global ${name}`); } });
      });
      await page.goto(`http://127.0.0.1:${address.port}/`);
      try { await page.waitForFunction(() => document.body.textContent?.startsWith("{"), undefined, { timeout: 5000 }); }
      catch (error) { console.error("Browser alias errors:", errors, await page.locator("body").innerText()); throw error; }
      expect(JSON.parse(await page.locator("body").innerText())).toEqual({ path:"/data/notes.txt", text:"你好", count:1, same:true, error:"E_HOST_UNAVAILABLE" });
      expect(await page.evaluate(() => typeof (globalThis as {process?: unknown}).process)).toBe("undefined");
      expect(errors).toEqual([]);
    } finally { await browser?.close(); await server.close(); }
  }, 30000);
});
