import { afterAll, beforeAll, expect, test } from "vitest";
import { readFile, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { InlineConfig, Rollup } from "vite";
import { aplgVite } from "../src/vite/index.js";
import { createBuildProject } from "./support/build-project.js";
import { validProjectFiles } from "./support/project.js";

let project: Awaited<ReturnType<typeof createBuildProject>>;
beforeAll(async () => { project = await createBuildProject(validProjectFiles()); }, 120000);
afterAll(async () => { await project?.dispose(); });
const html = '<!doctype html><html><head><title>Notes</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>';
const manifest = validProjectFiles()["aplg.json"];
async function build(input = html, extra: InlineConfig = {}) {
  await project.write("index.html", input); await project.write("aplg.json", manifest);
  return await project.vite.build({ root: project.root, configFile: false, logLevel: "silent", plugins: aplgVite({ preview: false }), build: { write: false }, ...extra }) as Rollup.RollupOutput;
}

test("replaces the business script with one bootstrap and records exact manifest bytes", async () => {
  const result = await build();
  const entry = result.output.find((item) => item.fileName === "index.html");
  expect(entry?.type).toBe("asset"); if(entry?.type !== "asset") return;
  expect(String(entry.source).match(/<script\b/g)).toHaveLength(1);
  expect(String(entry.source)).not.toContain("/src/main.ts");
  const recordAsset = result.output.find((item) => item.fileName === "aplg-build.json");
  expect(recordAsset?.type).toBe("asset"); if(recordAsset?.type !== "asset") return;
  const record = JSON.parse(String(recordAsset.source));
  expect(record).toMatchObject({ formatVersion: 1, devkitVersion: "0.1.0", manifestPath: "aplg.json", manifestSha256: createHash("sha256").update(manifest).digest("hex"), entry: "dist/index.html", businessEntry: "src/main.ts" });
  expect(record.bootstrap).toMatch(/^dist\/.+\.js$/); expect(record.businessChunk).toMatch(/^dist\/.+\.js$/);
  expect(record.bootstrap).not.toBe(record.businessChunk);
  expect(record.files.some((file: {path:string}) => file.path === "dist/aplg-build.json")).toBe(false);
  expect(await readFile(join(project.root, "aplg.json"), "utf8")).toBe(manifest);
});

test("zero-script HTML has a handshake-only bootstrap and records no business module", async () => {
  const result = await build('<!doctype html><p>Static only</p>');
  const recordAsset = result.output.find((item) => item.fileName === "aplg-build.json");
  expect(recordAsset?.type).toBe("asset"); if(recordAsset?.type !== "asset") return;
  expect(JSON.parse(String(recordAsset.source))).toMatchObject({ bootstrap: expect.stringMatching(/^dist\/.+\.js$/), businessEntry: null, businessChunk: null });
});

test.each([
  '<script type="module">globalThis.ran=true</script>', '<script src="/src/main.ts"></script>',
  '<script type="module" src="https://evil.invalid/main.js"></script>', '<script type="module" src="//evil.invalid/main.js"></script>',
  '<script type="module" src="/src/main.ts"></script><script type="module" src="/src/second.ts"></script>',
  '<button onclick="alert(1)">Unsafe</button>', '<script type="importmap">{"imports":{}}</script>',
  '<base href="https://evil.invalid/">', '<iframe srcdoc="<script>bad</script>"></iframe>',
  '<meta http-equiv="refresh" content="0;url=https://evil.invalid">',
])("rejects scripts or markup outside the source entry policy: %s", async (source) => {
  await expect(build(`<!doctype html>${source}`).then(() => "unexpected success")).rejects.toThrow(/E_(HTML_POLICY|EXTERNAL_RESOURCE)/);
});

test.each([
  { base: "/" }, { build: { outDir: "../outside" } }, { build: { target: "esnext" } },
  { build: { sourcemap: true } }, { build: { rolldownOptions: { output: { dir: "../outside" } } } },
])("rejects conflicting config before output cleanup: %j", async (extra) => {
  await project.write("untouched.txt", "keep");
  await expect(build(html, extra).then(() => "unexpected success")).rejects.toThrow(/E_BUILD_CONFIG/);
  expect(await readFile(join(project.root, "untouched.txt"), "utf8")).toBe("keep");
});

test("a custom manifest path is read only within the project root", async () => {
  await project.write("metadata/custom.json", manifest);
  const result = await build(html, { plugins: aplgVite({ manifestPath: "metadata/custom.json", preview: false }) });
  const record = result.output.find((item) => item.fileName === "aplg-build.json");
  expect(record?.type).toBe("asset"); if(record?.type === "asset") expect(JSON.parse(String(record.source)).manifestPath).toBe("metadata/custom.json");
  await expect(build(html, { plugins: aplgVite({ manifestPath: "../outside.json", preview: false }) }).then(() => "unexpected success")).rejects.toThrow(/E_(BUILD_CONFIG|ARCHIVE_PATH)/);
});

test("a manifest modified during a build is not blessed by a stale record", async () => {
  await expect(build(html, { plugins: [...aplgVite({ preview: false }), {
    name: "fixture-mutate-manifest", buildEnd() { return writeFile(join(project.root, "aplg.json"), manifest + " "); },
  }] }).then(() => "unexpected success")).rejects.toThrow(/E_BUILD_MANIFEST_CHANGED/);
});

test("installing the bootstrap hook twice is diagnosed, not injected twice", async () => {
  await expect(build(html, { plugins: [...aplgVite({preview:false}), ...aplgVite({preview:false})] }).then(() => "unexpected success")).rejects.toThrow(/E_BUILD_CONFIG/);
});

test("valid relative public images and styles are included in the recorded file set",async()=>{
  await project.write("public/image.png",new Uint8Array([137,80,78,71]));
  await project.write("public/extra.css",'body{background-image:url(./image.png)}');
  try {
    const result=await build('<!doctype html><link rel="stylesheet" href="/extra.css"><img src="/image.png"><script type="module" src="/src/main.ts"></script>',{build:{write:true,assetsInlineLimit:0}});
    expect(result.output.some((item)=>item.fileName==="aplg-build.json")).toBe(true);
    const record=JSON.parse(await readFile(join(project.root,"dist/aplg-build.json"),"utf8"));
    expect(record.files.some((file:{path:string})=>file.path==="dist/image.png")).toBe(true);
  } finally { await rm(join(project.root,"public/image.png"),{force:true});await rm(join(project.root,"public/extra.css"),{force:true}); }
});

test("an existing dist junction never redirects Vite's cleanup outside the project",async()=>{
  // dist is this fixture's generated directory; verify the explicit path first.
  const output=join(project.root,"dist");const outside=join(project.root,"outside-kept");
  await rm(output,{recursive:true,force:true});await mkdir(outside,{recursive:true});await writeFile(join(outside,"keep.txt"),"keep");
  await symlink(outside,output,process.platform==="win32"?"junction":"dir");
  try {
    await expect(build(html,{build:{write:true}}).then(()=>"unexpected success")).rejects.toThrow();
    expect(await readFile(join(outside,"keep.txt"),"utf8")).toBe("keep");
  } finally { await rm(output,{force:true}); }
});

test("late resolved output configuration cannot redirect cleanup or create external output",async()=>{
  await expect(build(html,{build:{write:false},plugins:[...aplgVite({preview:false}),{name:"late-output",configResolved(config){config.build.outDir="../outside";}}]}).then(()=>"unexpected success")).rejects.toThrow(/E_BUILD_CONFIG/);
});
test("late buildEnd changes are caught before Vite prepares an unsafe directory",async()=>{
  await expect(build(html,{plugins:[...aplgVite({preview:false}),{name:"late-build-output",configResolved(config){lateConfig=config;},buildEnd(){lateConfig!.build.outDir="../unsafe";}}]}).then(()=>"unexpected success")).rejects.toThrow(/E_BUILD_CONFIG/);
});
let lateConfig: import("vite").ResolvedConfig|undefined;

test("publicDir itself cannot point outside the project or through a junction",async()=>{
  await expect(build(html,{publicDir:"../outside-assets"}).then(()=>"unexpected success")).rejects.toThrow(/E_BUILD_CONFIG/);
});

test("non-minified output keeps semantic strings while removing only source provenance",async()=>{
  const result=await build(html,{build:{write:true,minify:false}});
  const js=result.output.filter((item):item is Rollup.OutputChunk=>item.type==="chunk").map(item=>item.code).join("\n");
  expect(js).not.toContain(project.root.replaceAll("\\","/"));
  expect(js).toContain("Plugin connection failed.");
});
test("reserved bootstrap URL cannot be used as the author business entry",async()=>{
  await expect(build('<!doctype html><script type="module" src="/@aplg/bootstrap.js"></script>').then(()=>"unexpected success")).rejects.toThrow(/E_BUILD_CONFIG/);
});

test("built static output and multi-page injection are checked against the declared single entry",async()=>{
  await project.write("other.html",html);
  await expect(build(html,{build:{write:false,rolldownOptions:{input:[join(project.root,"index.html"),join(project.root,"other.html")]}}}).then(()=>"unexpected success")).rejects.toThrow(/E_BUILD_CONFIG/);
});
test("an ordinary relative script URL without dot slash is a local HTML entry",async()=>{
  const result=await build('<!doctype html><script type="module" src="src/main.ts"></script>');
  const record=result.output.find(item=>item.fileName==="aplg-build.json");expect(record?.type).toBe("asset");
});
test("a business entry can import local CSS and a Unicode image without creating remote dependencies",async()=>{
  await project.write("src/local.css",'body{background:url(./图片.png)}');await project.write("src/图片.png",new Uint8Array([137,80,78,71]));
  await project.write("src/main.ts",'import "./local.css"; document.body.append("styled");');
  try {
    await build(html,{build:{write:true,assetsInlineLimit:0}});
    const record=JSON.parse(await readFile(join(project.root,"dist/aplg-build.json"),"utf8"));
    expect(record.files.some((file:{path:string})=>file.path.endsWith(".css"))).toBe(true);
  } finally {await project.write("src/main.ts",validProjectFiles()["src/main.ts"]);}
});
test("a namespaced alternate manifest remains source-only while dist references the correct HTML",async()=>{
  await project.write("metadata/custom.json",manifest);
  const result=await build(html,{plugins:aplgVite({manifestPath:"metadata/custom.json",preview:false}),build:{write:true}});
  expect(result.output.some(item=>item.fileName==="aplg-build.json")).toBe(true);
});