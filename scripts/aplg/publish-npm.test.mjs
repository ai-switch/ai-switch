import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { publishNpm } from "./publish-npm.mjs";

function tarWithPackageJson(metadata) {
  const body = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(512);
  const name = Buffer.from("package/package.json");
  header.write(name.toString("utf8"), 0, "utf8");
  header.write(body.length.toString(8).padStart(11, "0"), 124, "ascii");
  header.write("0000000", 136, "ascii");
  header.write("0000000", 148, "ascii");
  header[156] = 0x30;
  let sum = 0; for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  const padding = Buffer.alloc((512 - body.length % 512) % 512);
  return gzipSync(Buffer.concat([header, body, padding, Buffer.alloc(1024)]));
}

async function withRegistry(run) {
  const state = { packages: new Map(), distTags: new Map(), puts: [], failures: new Set() };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const send = (status, body) => { response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)); };
    const name = decodeURIComponent(url.pathname.split("/")[1] ?? "");
    if (request.method === "GET" && /^\/[^/]+\/[^/]+$/.test(url.pathname)) {
      const version = decodeURIComponent(url.pathname.split("/")[2]);
      const record = state.packages.get(`${name}@${version}`);
      return record ? send(200, { dist: { integrity: record.integrity } }) : send(404, { error: "not found" });
    }
    if (request.method === "GET" && url.pathname.startsWith("/-/package/")) {
      const packageName = decodeURIComponent(url.pathname.slice("/-/package/".length, url.pathname.lastIndexOf("/dist-tags")));
      return send(200, Object.fromEntries([...state.distTags].filter(([key]) => key.startsWith(`${packageName}@`)).map(([key, value]) => [key.slice(packageName.length + 1), value])));
    }
    if (request.method === "PUT" && url.pathname.startsWith("/-/package/")) {
      const marker = "/dist-tags/";
      const index = url.pathname.lastIndexOf(marker);
      const packageName = decodeURIComponent(url.pathname.slice("/-/package/".length, index));
      const tag = decodeURIComponent(url.pathname.slice(index + marker.length));
      const version = JSON.parse(await new Promise((resolve) => { let data = ""; request.on("data", (chunk) => data += chunk); request.on("end", () => resolve(data)); }));
      state.puts.push({ packageName, tag, version });
      if (state.failures.has(`${packageName}@${tag}`)) return send(500, { error: "injected" });
      state.distTags.set(`${packageName}@${tag}`, version);
      return send(200, {});
    }
    send(404, { error: "not found" });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const registry = `http://127.0.0.1:${server.address().port}`;
  try { await run({ registry, state }); } finally { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); }
}

async function fixtures() {
  const directory = await mkdtemp(join(tmpdir(), "aplg-publish-"));
  const runtime = join(directory, "runtime.tgz");
  const devkit = join(directory, "devkit.tgz");
  await writeFile(runtime, tarWithPackageJson({ name: "@ai-switch/tauri-plugin-runtime", version: "0.1.0", dependencies: {} }));
  await writeFile(devkit, tarWithPackageJson({ name: "@ai-switch/tauri-plugin-devkit", version: "0.1.0", dependencies: { "@ai-switch/tauri-plugin-runtime": "0.1.0" } }));
  return { directory, runtime, devkit, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("dry-run validates tarballs and never writes to the registry", async () => {
  const files = await fixtures();
  try {
    await withRegistry(async ({ registry, state }) => {
      const result = await publishNpm({ runtime: files.runtime, devkit: files.devkit, tag: "tauri-plugin-runtime-v0.1.0", execute: false, registry });
      assert.equal(result.execute, false);
      assert.deepEqual(result.results.map((item) => item.status), ["dry-run", "dry-run"]);
      assert.equal(state.puts.length, 0);
    });
  } finally { await files.cleanup(); }
});

test("matching published integrity is idempotently skipped and conflicts fail closed", async () => {
  const files = await fixtures();
  try {
    const runtimeBytes = await readFile(files.runtime);
    const devkitBytes = await readFile(files.devkit);
    await withRegistry(async ({ registry, state }) => {
      const integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
      state.packages.set("@ai-switch/tauri-plugin-runtime@0.1.0", { integrity: integrity(runtimeBytes) });
      state.packages.set("@ai-switch/tauri-plugin-devkit@0.1.0", { integrity: integrity(devkitBytes) });
      const result = await publishNpm({ runtime: files.runtime, devkit: files.devkit, tag: "tauri-plugin-runtime-v0.1.0", execute: false, registry });
      assert.deepEqual(result.results.map((item) => item.status), ["already-published", "already-published"]);
      state.packages.set("@ai-switch/tauri-plugin-runtime@0.1.0", { integrity: "sha512-conflict" });
      await assert.rejects(publishNpm({ runtime: files.runtime, devkit: files.devkit, tag: "tauri-plugin-runtime-v0.1.0", execute: false, registry }), { code: "E_NPM_PUBLISH" });
    });
  } finally { await files.cleanup(); }
});
test("execute publishes in order, then promotes latest with rollback on partial failure", async () => {
  const files = await fixtures();
  try {
    await withRegistry(async ({ registry, state }) => {
      state.distTags.set("@ai-switch/tauri-plugin-runtime@latest", "0.0.9");
      state.distTags.set("@ai-switch/tauri-plugin-devkit@latest", "0.0.9");
      const published = [];
      const result = await publishNpm({
        runtime: files.runtime, devkit: files.devkit, tag: "tauri-plugin-runtime-v0.1.0", execute: true, registry,
        publish: async (item) => { published.push(item.name); state.packages.set(`${item.name}@${item.version}`, { integrity: "sha512-test" }); },
      });
      assert.deepEqual(published, ["@ai-switch/tauri-plugin-runtime", "@ai-switch/tauri-plugin-devkit"]);
      assert.deepEqual(result.results.map((item) => item.status), ["published", "published"]);
      assert.equal(state.distTags.get("@ai-switch/tauri-plugin-runtime@latest"), "0.1.0");
      assert.equal(state.distTags.get("@ai-switch/tauri-plugin-devkit@latest"), "0.1.0");

      state.packages.clear();
      state.failures.add("@ai-switch/tauri-plugin-devkit@latest");
      await assert.rejects(publishNpm({
        runtime: files.runtime, devkit: files.devkit, tag: "tauri-plugin-runtime-v0.1.0", execute: true, registry,
        publish: async (item) => { state.packages.set(`${item.name}@${item.version}`, { integrity: "sha512-test" }); },
      }), { code: "E_NPM_PUBLISH" });
      assert.equal(state.distTags.get("@ai-switch/tauri-plugin-runtime@latest"), "0.1.0");
      assert.equal(state.distTags.get("@ai-switch/tauri-plugin-devkit@latest"), "0.1.0");
    });
  } finally { await files.cleanup(); }
});
