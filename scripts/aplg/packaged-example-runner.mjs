import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { createRequire } from "node:module";
import { runNodeCommand } from "../../packages/tauri-plugin-runtime/scripts/verification-process.mjs";

const devkitRequire = createRequire(new URL("../../packages/tauri-plugin-devkit/package.json", import.meta.url));
const { fromBufferPromise } = devkitRequire("yauzl");
const { build: bundle } = devkitRequire("esbuild");

export async function unpackInspection(archive, inspection, destination) {
  const zip = await fromBufferPromise(await readFile(archive), { autoClose: true, lazyEntries: true, decodeStrings: false, validateEntrySizes: false, strictFileNames: true });
  const allowed = new Map(inspection.files.map((file) => [file.path, file]));
  for await (const entry of zip.eachEntry()) {
    const name = entry.fileName.toString("utf8");
    if (name.endsWith("/")) continue;
    const declared = allowed.get(name);
    if (!declared) throw new Error(`Unexpected archive entry: ${name}`);
    const path = join(destination, name);
    const child = relative(destination, path);
    if (!child || isAbsolute(child) || child.startsWith("..")) throw new Error(`Unsafe archive path: ${name}`);
    const chunks = [];
    for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.length, declared.size, `Unpacked size mismatch: ${name}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
}

export async function runPackagedExample({ consumer, archive, inspection, spec, playwright }) {
  const unpacked = join(consumer, "unpacked");
  await mkdir(unpacked);
  await unpackInspection(archive, inspection, unpacked);
  await writeFile(join(unpacked, "host.html"), `<!doctype html><html lang="zh-CN"><body><button id="open" type="button">打开示例插件</button><p id="status">等待</p><div id="slot"></div><script type="module" src="/host.mjs"></script></body></html>`);
  const hostSource = `
import { createPluginHost } from "@ai-switch/tauri-plugin-runtime/host";
window.__hostLoaded = true;
const status = document.getElementById("status");
const slot = document.getElementById("slot");
const manifest = await (await fetch("/aplg.json")).json();
const sessions = new Map();
const transport = {
  async call(operation, args) {
    if (operation === "session.open") {
      const id = "example-session";
      sessions.set(id, manifest);
      return { sessionId: id, manifest, assetUrl: new URL("/dist/index.html", location.href).href, info: { protocol: "aplg/1", apiVersion: "1.0.0", plugin: { id: manifest.id, version: manifest.version, packageSha256: "0".repeat(64) }, capabilities: {}, limits: { controlBytes: 1048576, fileChunkBytes: 262144, fileBytes: 8388608, fileTransfers: 2 } } };
    }
    if (operation === "session.close") { sessions.delete(args.sessionId); return null; }
    if (operation === "request.cancel") return null;
    throw Object.assign(new Error("unavailable"), { code: "E_CAPABILITY_UNAVAILABLE" });
  },
  async subscribe() { return () => {}; },
};
const host = createPluginHost({ transport, allowedAssetOrigins: [location.origin] });
document.getElementById("open").addEventListener("click", async () => {
  status.textContent = "连接中";
  try { await host.mount({ pluginId: manifest.id, container: slot }); status.textContent = "已连接"; }
  catch (error) { status.textContent = error.code || error.message || "失败"; }
});
window.addEventListener("pagehide", () => { void host.dispose(); }, { once: true });
`;
  const bundledHost = await bundle({ stdin: { contents: hostSource, resolveDir: consumer, sourcefile: "host.mjs", loader: "js" }, bundle: true, write: false, platform: "browser", format: "esm", target: "es2022", logLevel: "silent" });
  await writeFile(join(unpacked, "host.mjs"), bundledHost.outputFiles[0].contents);
  const server = createServer((request, response) => {
    let pathname;
    try { pathname = new URL(request.url, "http://127.0.0.1").pathname; } catch { response.writeHead(400).end(); return; }
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    const name = pathname === "/" ? "host.html" : pathname.slice(1);
    const path = join(unpacked, name);
    const child = relative(unpacked, path);
    if (!child || isAbsolute(child) || child.startsWith("..")) { response.writeHead(404).end(); return; }
    void readFile(path).then((bytes) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'");
      if (pathname.startsWith("/dist/")) response.setHeader("Access-Control-Allow-Origin", "*");
      const extension = pathname.endsWith(".html") || pathname === "/" ? ".html" : pathname.slice(pathname.lastIndexOf("."));
      if (![".html", ".js", ".mjs", ".css", ".json"].includes(extension)) throw new Error(`Unexpected packaged asset extension: ${pathname}`);
      response.writeHead(200, { "Content-Type": extension === ".html" ? "text/html; charset=utf-8" : extension === ".js" || extension === ".mjs" ? "application/javascript; charset=utf-8" : extension === ".css" ? "text/css; charset=utf-8" : extension === ".json" ? "application/json; charset=utf-8" : "application/octet-stream" }).end(bytes);
    }, () => response.writeHead(404).end());
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await writeFile(join(consumer, "playwright.config.mjs"), `export default ${JSON.stringify({ testDir: ".", testMatch: "packaged-example.spec.ts", timeout: 30000, expect: { timeout: 7000 }, workers: 1, reporter: "list", use: { baseURL: origin, headless: true }, projects: [{ name: "chromium", use: { browserName: "chromium", launchOptions: { channel: "chromium" } } }, { name: "webkit", use: { browserName: "webkit" } }] })};\n`);
    await writeFile(join(consumer, "packaged-example.spec.ts"), spec);
    await runNodeCommand([playwright, "test", "--config", "playwright.config.mjs"], { cwd: consumer, capture: false, timeout: 240_000 });
  } finally { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); }
}