import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planRelease } from "./plan-release.mjs";
import { runNodeCommand } from "../../packages/tauri-plugin-runtime/scripts/verification-process.mjs";

function fail(message) {
  throw Object.assign(new Error(`E_NPM_PUBLISH: ${message}`), { code: "E_NPM_PUBLISH" });
}

function parse(argv) {
  const values = { execute: false };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (name === "--execute") { values.execute = true; continue; }
    if (!["--runtime", "--devkit", "--tag", "--source-sha", "--registry"].includes(name)) fail(`Unknown argument: ${name}`);
    const value = argv[++index];
    if (typeof value !== "string" || !value || value.startsWith("-")) fail(`Missing value for ${name}`);
    values[name.slice(2)] = value;
  }
  for (const key of ["runtime", "devkit", "tag", "source-sha"]) if (!values[key]) fail(`Missing required --${key}.`);
  if (!/^[0-9a-f]{40}$/i.test(values["source-sha"])) fail("--source-sha must be a full Git commit SHA.");
  return values;
}

async function checkedTarball(path, label) {
  const actual = await realpath(path).catch(() => fail(`${label} tarball does not exist.`));
  const entry = await lstat(actual);
  if (!entry.isFile() || !actual.endsWith(".tgz")) fail(`${label} tarball must be a regular .tgz file.`);
  return actual;
}

async function packageMetadata(tarball) {
  const bytes = await readFile(tarball);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) fail("Tarball is not gzip-compressed.");
  const { gunzipSync } = await import("node:zlib");
  const tar = gunzipSync(bytes);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    offset += 512;
    if (name === "package/package.json") return JSON.parse(tar.subarray(offset, offset + size).toString("utf8"));
    offset += Math.ceil(size / 512) * 512;
  }
  return fail("Tarball has no package/package.json.");
}

function sha512(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

async function registryJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) fail(`Registry request failed (${response.status}) for ${url}.`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function publishedIntegrity(registry, name, version) {
  const encoded = name.startsWith("@") ? name.replace("/", "%2f") : name;
  const result = await registryJson(`${registry}/${encoded}/${version}`);
  if (result.status === 404) return null;
  const integrity = result.body?.dist?.integrity;
  if (typeof integrity !== "string") fail(`Registry metadata for ${name}@${version} has no dist.integrity.`);
  return integrity;
}

async function distTag(registry, name, tag) {
  const encoded = name.startsWith("@") ? name.replace("/", "%2f") : name;
  const result = await registryJson(`${registry}/-/package/${encoded}/dist-tags`);
  if (result.status === 404) return null;
  const value = result.body?.[tag];
  return typeof value === "string" ? value : null;
}

async function setDistTag(registry, name, tag, version) {
  const encoded = name.startsWith("/") ? name.slice(1).replace("/", "%2f") : name.replace("/", "%2f");
  const response = await fetch(`${registry}/-/package/${encoded}/dist-tags/${tag}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(version) });
  if (!response.ok) fail(`Could not set ${name}@${version} dist-tag ${tag} (${response.status}).`);
}

export async function publishNpm(options) {
  const runtimeTarball = await checkedTarball(options.runtime, "runtime");
  const devkitTarball = await checkedTarball(options.devkit, "devkit");
  const [runtimeMetadata, devkitMetadata] = await Promise.all([packageMetadata(runtimeTarball), packageMetadata(devkitTarball)]);
  const plan = planRelease({
    tag: options.tag,
    runtime: { name: runtimeMetadata.name, version: runtimeMetadata.version },
    devkit: { name: devkitMetadata.name, version: devkitMetadata.version, runtimeDependency: devkitMetadata.dependencies?.["@ai-switch/tauri-plugin-runtime"] },
  });
  const registry = (options.registry ?? "https://registry.npmjs.org").replace(/\/+$/, "");
  const tarballs = { [runtimeMetadata.name]: runtimeTarball, [devkitMetadata.name]: devkitTarball };
  const integrities = { [runtimeMetadata.name]: sha512(await readFile(runtimeTarball)), [devkitMetadata.name]: sha512(await readFile(devkitTarball)) };
  const results = [];
  for (const name of plan.order) {
    const existing = await publishedIntegrity(registry, name, plan.version);
    if (existing === integrities[name]) { results.push({ name, version: plan.version, status: "already-published" }); continue; }
    if (existing !== null) fail(`${name}@${plan.version} already exists with a different integrity.`);
    if (!options.execute) { results.push({ name, version: plan.version, status: "dry-run" }); continue; }
    const npm = process.env.npm_execpath ?? "npm";
    if (options.publish) await options.publish({ name, version: plan.version, tarball: tarballs[name], tag: plan.candidateTag, registry });
    else await runNodeCommand([npm, "publish", tarballs[name], "--ignore-scripts", "--provenance", "--access", "public", "--tag", plan.candidateTag, "--registry", registry], { cwd: process.cwd(), env: { ...process.env }, capture: true, timeout: 180_000 });
    results.push({ name, version: plan.version, status: "published" });
  }
  if (!options.execute) return { ...plan, registry, execute: false, results };
  const previous = {};
  for (const name of plan.order) previous[name] = await distTag(registry, name, plan.stableTag);
  try {
    for (const name of plan.order) await setDistTag(registry, name, plan.stableTag, plan.version);
  } catch (error) {
    for (const name of plan.order) {
      const value = previous[name];
      if (value) { try { await setDistTag(registry, name, plan.stableTag, value); } catch {} }
    }
    throw error;
  }
  return { ...plan, registry, execute: true, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parse(process.argv.slice(2));
  const result = await publishNpm(options);
  console.log(JSON.stringify(result, null, 2));
}