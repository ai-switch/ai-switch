import { afterAll, beforeAll, expect, test } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createBuildProject } from "./support/build-project.js";
import { validProjectFiles } from "./support/project.js";
import { aplgVite } from "../src/vite/index.js";
import { validateProject } from "../src/index.js";
import { runCli } from "../src/cli/run.js";
import { inspectArtifactSnapshot } from "../src/vite/artifacts.js";
import { scanArtifactText } from "../src/vite/resource-policy.js";

const cases = [
  ['dist/index.html', '<script type="module" src="https://example.invalid/a.js"></script>', 'E_EXTERNAL_RESOURCE'],
  ['dist/index.html', '<img src="/assets/a.png">', 'E_RESOURCE_PATH'],
  ['dist/index.html', '<img srcset="./a.png 1x, https://cdn.invalid/b.png 2x">', 'E_EXTERNAL_RESOURCE'],
  ['dist/index.html', '<img src="..%2f..%2fsecret.png">', 'E_RESOURCE_PATH'],
  ['dist/index.html', '<img src="data:text/html,bad">', 'E_EXTERNAL_RESOURCE'],
  ['dist/index.html', '<script src="data:application/javascript,bad" type="module"></script>', 'E_EXTERNAL_RESOURCE'],
  ['dist/index.html', '<button onload="bad()">Bad</button>', 'E_HTML_POLICY'],
  ['dist/assets/a.css', '@import "https://cdn.invalid/style.css";', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.css', 'body{background:url(//cdn.invalid/a.png)}', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.css', 'body{background:url(C:/private/a.png)}', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.css', 'body{background:url(../../../escape.png)}', 'E_RESOURCE_PATH'],
  ['dist/assets/a.js', 'import "node:fs";', 'E_NODE_IMPORT'],
  ['dist/assets/a.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://cdn.invalid/image.png"/></svg>', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.css', 'a{background:image-set("https://cdn.invalid/a.png" 1x)}', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.css', '@supports (background:url(https://cdn.invalid/a.png)){a{color:red}}', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.css', 'a{background:u\\72l("https://cdn.invalid/a.png")}', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.js', 'export * from "@ai-switch/tauri-plugin-runtime/host";', 'E_HOST_IMPORT'],
  ['dist/assets/a.js', 'import("@ai-switch/tauri-plugin-devkit/testing");', 'E_HOST_IMPORT'],
  ['dist/assets/a.js', 'import("https://cdn.invalid/a.js");', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.js', 'import "missing-package";', 'E_RESOURCE_PATH'],
  ['dist/assets/a.js', 'const image=new URL("https://cdn.invalid/image.png",import.meta.url);', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.js', 'const worker=new Worker("https://cdn.invalid/worker.js");', 'E_EXTERNAL_RESOURCE'],
  ['dist/assets/a.js', 'const module=require("fs");', 'E_NODE_IMPORT'],
  ['dist/assets/a.js', 'const path=globalThis.require("path");', 'E_NODE_IMPORT'],
  ['dist/assets/a.js', 'const not valid;', 'E_JS_PARSE'],
  ['dist/assets/a.js', '//# sourceMappingURL=https://private.invalid/a.map\nexport {};', 'E_SOURCE_MAP'],
] as const;
test.each(cases.map(([path, code, expected])=>({path,code,expected})))('offline policy rejects $expected in $path', async ({path,code,expected}) => {
  const report = await scanArtifactText(path, code);
  expect(report.diagnostics.some((d) => d.code === expected)).toBe(true);
});
test("collects local HTML/CSS/module references, allows local image data and fragments", async () => {
  const html = await scanArtifactText("dist/index.html", '<!doctype html><img src="data:image/png;base64,aA=="><a href="#anchor">Jump</a><link href="./style.css" rel="stylesheet"><img srcset="./小图.png 1x, ./large.png 2x">');
  expect(html.diagnostics).toEqual([]); expect(html.references.map((r)=>r.path)).toEqual(["dist/style.css", "dist/小图.png", "dist/large.png"]);
  const css = await scanArtifactText("dist/assets/a.css", 'body{background:url(../image.png)} @import "./extra.css";');
  expect(css.diagnostics).toEqual([]); expect(css.references.map((r)=>r.path)).toEqual(["dist/image.png", "dist/assets/extra.css"]);
  const js = await scanArtifactText("dist/assets/a.js", 'import "./b.js"; export {x} from "./c.js"; import("./d.js");');
  expect(js.diagnostics).toEqual([]); expect(js.references.map((r)=>r.path)).toEqual(["dist/assets/b.js", "dist/assets/c.js", "dist/assets/d.js"]);
});

let project: Awaited<ReturnType<typeof createBuildProject>>;
beforeAll(async () => { project = await createBuildProject(validProjectFiles()); await project.write("pnpm-lock.yaml", validProjectFiles()["pnpm-lock.yaml"]); }, 120000);
afterAll(async () => { await project?.dispose(); });
async function build() { await project.write("aplg.json", validProjectFiles()["aplg.json"]); return project.vite.build({root:project.root, configFile:false, logLevel:"silent", plugins:aplgVite({preview:false})}); }

test("real build and public dist validation share the artifact and record policy", async () => {
  await build(); const report = await validateProject(project.root, {stage:"dist"});
  expect(report.valid).toBe(true); if(!report.valid) return;
  expect(report.files.some((file)=>file.path === "dist/aplg-build.json")).toBe(true);
  expect(report.files.some((file)=>file.path === "package.json" || file.path === "pnpm-lock.yaml")).toBe(false);
});
test("dist validation detects a remote HTML dependency without importing author config", async () => {
  await build(); await project.write("vite.config.js", 'throw new Error("must-not-execute")');
  await writeFile(join(project.root,"dist/index.html"), '<script type="module" src="https://example.invalid/a.js"></script>');
  const report = await validateProject(project.root,{stage:"dist"});
  expect(report.valid).toBe(false); expect(report.diagnostics.some((d)=>d.code === "E_EXTERNAL_RESOURCE")).toBe(true);
});
test("changed emitted bytes or stale manifest hashes invalidate the build record", async () => {
  await build(); const record = JSON.parse(await readFile(join(project.root,"dist/aplg-build.json"),"utf8"));
  const business = record.businessChunk as string; await writeFile(join(project.root,business),'console.log("tampered")');
  const report = await validateProject(project.root,{stage:"dist"}); expect(report.valid).toBe(false); expect(report.diagnostics.some((d)=>d.code === "E_BUILD_RECORD")).toBe(true);
  await build(); await project.write("aplg.json",validProjectFiles()["aplg.json"]+" ");
  const stale = await validateProject(project.root,{stage:"dist"}); expect(stale.valid).toBe(false); expect(stale.diagnostics.some((d)=>d.code === "E_BUILD_MANIFEST_CHANGED")).toBe(true);
});
test("missing resources and unexpected public secrets cannot enter the archive candidates", async () => {
  await build(); await writeFile(join(project.root,"dist/index.html"),'<img src="./missing.png">');
  const report=await validateProject(project.root,{stage:"dist"}); expect(report.diagnostics.some((d)=>d.code === "E_RESOURCE_MISSING")).toBe(true);
  await project.write("public/.env","DO_NOT_SHIP=secret");
  await expect(build().then(()=>"unexpected success")).rejects.toThrow(/E_ARCHIVE_CONTENT/);
});

test.each([
  {manifestPath:7}, {manifestSha256:null}, {bootstrap:7}, {files:[null]}, {files:[{path:"dist/a.js",size:0,sha256:"x"}]},
])("malformed untrusted record is invalid data, not a thrown I/O error: %j",async(change)=>{
  await rm(join(project.root,"public/.env"),{force:true});
  await build();const path=join(project.root,"dist/aplg-build.json");const record=JSON.parse(await readFile(path,"utf8"));
  await writeFile(path,JSON.stringify({...record,...change}));
  const report=await validateProject(project.root,{stage:"dist"});
  expect(report.valid).toBe(false);expect(report.diagnostics.some((d)=>d.code==="E_BUILD_RECORD")).toBe(true);
});
test("runtime-computed network APIs are explicitly outside static resource guarantees",async()=>{
  const scan=await scanArtifactText("dist/main.js",'const runtimeUrl = location.hash.slice(1); fetch(runtimeUrl);');
  expect(scan.diagnostics).toEqual([]);
});
test("literal JS URL resources are resolved relative to their emitted module",async()=>{
  const scan=await scanArtifactText("dist/assets/a.js",'const image=new URL("../image.png",import.meta.url); const text="//# sourceMappingURL=example";');
  expect(scan.diagnostics).toEqual([]);expect(scan.references).toEqual([{path:"dist/image.png",kind:"asset"}]);
});
test("public CLI dist validation succeeds only for matching real build output",async()=>{
  await build();let stdout="";let stderr="";
  const result=await runCli(["validate","--stage","dist","--json"],{stdout:text=>{stdout+=text;},stderr:text=>{stderr+=text;}},{cwd:project.root});
  expect(result).toBe(0);expect(stderr).toBe("");expect(JSON.parse(stdout)).toMatchObject({valid:true,files:expect.arrayContaining([expect.objectContaining({path:"dist/aplg-build.json"})])});
});

test("rewriting a record to load business statically still fails bootstrap graph checks",async()=>{
  await build();const recordFile=join(project.root,"dist/aplg-build.json");const record=JSON.parse(await readFile(recordFile,"utf8"));
  const bootstrap=join(project.root,record.bootstrap);const business='./'+record.businessChunk.split('/').at(-1);
  const content=`import ${JSON.stringify(business)};`;
  await writeFile(bootstrap,content);
  const {createHash}=await import("node:crypto");
  const file=record.files.find((file:{path:string})=>file.path===record.bootstrap);file.size=Buffer.byteLength(content);file.sha256=createHash("sha256").update(content).digest("hex");
  await writeFile(recordFile,JSON.stringify(record));
  const report=await validateProject(project.root,{stage:"dist"});expect(report.valid).toBe(false);expect(report.diagnostics.some(d=>d.code==="E_BOOTSTRAP_ORDER")).toBe(true);
});
test("resource paths with NFD filenames or host source literals are rejected",async()=>{
  const nonportable=await scanArtifactText("dist/index.html",'<img src="./e\u0301.png">');
  expect(nonportable.diagnostics.some(d=>d.code==="E_RESOURCE_PATH")).toBe(true);
  const path=await scanArtifactText("dist/main.js",'const source="C:/private/application/src/main.ts";');
  expect(path.diagnostics.some(d=>d.code==="E_SOURCE_PATH")).toBe(true);
});
test("HTML script src URLs are relative URLs rather than bare package specifiers",async()=>{
  const scan=await scanArtifactText("dist/index.html",'<script type="module" src="assets/main.js"></script>');
  expect(scan.diagnostics).toEqual([]);expect(scan.references).toEqual([{path:"dist/assets/main.js",kind:"module"}]);
});
test("a statically external new URL base cannot disguise an external asset",async()=>{
  const scan=await scanArtifactText("dist/main.js",'new URL("image.png","https://cdn.invalid/");');
  expect(scan.diagnostics.some(d=>d.code==="E_EXTERNAL_RESOURCE")).toBe(true);
});
test("a build record is metadata, not an assertion that an arbitrary script performed a handshake",async()=>{
  await build();const recordPath=join(project.root,"dist/aplg-build.json");const record=JSON.parse(await readFile(recordPath,"utf8"));
  const chunkPath=join(project.root,record.bootstrap);const {createHash}=await import("node:crypto");
  // Preserve the dynamic edge, but remove the actual handshake. The metadata
  // must not be treated as authorization; generation has a real browser test.
  const replacement=`await import(${JSON.stringify('./'+record.businessChunk.split('/').at(-1))});`;
  await writeFile(chunkPath,replacement);const item=record.files.find((item:{path:string})=>item.path===record.bootstrap);
  item.size=Buffer.byteLength(replacement);item.sha256=createHash("sha256").update(replacement).digest("hex");await writeFile(recordPath,JSON.stringify(record));
  const report=await validateProject(project.root,{stage:"dist"});
  // The static graph is coherent, but the record is unsigned and cannot prove
  // runtime behavior. This explicit boundary guards against overclaiming trust.
  expect(report.valid).toBe(true);
});
test("in-memory write:false builds enforce the same aggregate artifact budget as disk scans",async()=>{
  const manifest=JSON.parse(validProjectFiles()["aplg.json"]);
  const result=await inspectArtifactSnapshot({files:[{path:"dist/index.html",size:536870913,sha256:"0".repeat(64)}],texts:new Map(),diagnostics:[]},manifest);
  expect(result.diagnostics.some(d=>d.code==="E_LIMIT_EXCEEDED")).toBe(true);
});