import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { parseStrictJson, readBoundedFile, decodeUtf8 } from "../project/read.js";
import { ProjectError } from "../project/errors.js";
import { validateWebManifest } from "../project/manifest.js";
import type { Manifest } from "@ai-switch/tauri-plugin-runtime/protocol";
import { previewClientVirtualId } from "./aliases.js";

export interface PreviewPluginOptions { manifestPath?: string; memoryFiles?: Record<string, Uint8Array> }

export const previewRoute = "/__aplg_preview__";
const clientPublic = `${previewRoute}/client.js`;
const clientVirtual = previewClientVirtualId;
const testingVirtual = "\0aplg:preview-testing";
const bundledPreview = /\/dist\/vite\/index\.js(?:$|[?#])/.test(import.meta.url);
const testingEntry = fileURLToPath(new URL(bundledPreview ? "../testing/index.js" : "../testing/index.ts", import.meta.url));

function loopbackHost(value: unknown): boolean {
  if (value === undefined || value === false) return true;
  if (typeof value !== "string") return false;
  const host = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) && parts[0] === "127";
}
function loopbackHostHeader(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 && loopbackHost(value.slice(1, end)) && (value.slice(end + 1) === "" || /^:\d+$/.test(value.slice(end + 1)));
  }
  const parts = value.split(":");
  return parts.length <= 2 && loopbackHost(parts[0]) && (parts.length === 1 || /^\d+$/.test(parts[1]));
}
function failHost(): never { throw new Error("APLG_PREVIEW_HOST: preview must bind to a loopback address."); }
function safeProjectPath(root: string, candidate: string): string {
  const absolute = resolve(root, candidate);
  const child = relative(root, absolute);
  if (isAbsolute(child) || child === ".." || child.startsWith("../") || child.startsWith("..\\")) {
    throw new ProjectError("E_BUILD_CONFIG", "Preview manifest path must remain inside the project root.");
  }
  return absolute;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}
function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}
interface PreviewContext { manifest: Manifest; assetPath: string }
async function loadContext(config: ResolvedConfig, manifestPath: string): Promise<PreviewContext> {
  const source = safeProjectPath(config.root, manifestPath);
  const bytes = await readBoundedFile(source, 256 * 1024);
  const checked = validateWebManifest(parseStrictJson(decodeUtf8(bytes)));
  if (!checked.ok) throw new ProjectError(checked.diagnostics[0].code, checked.diagnostics[0].message, manifestPath);
  return { manifest: checked.value, assetPath: `/${checked.value.entry.slice("dist/".length)}` };
}
function clientSource(context: PreviewContext, memoryFiles?: Record<string, Uint8Array>): string {
  const manifest = JSON.stringify(context.manifest);
  const assetPath = JSON.stringify(context.assetPath);
  const encodedFiles = memoryFiles === undefined ? null : Object.fromEntries(
    Object.entries(memoryFiles).map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")]),
  );
  const memoryBootstrap = encodedFiles === null
    ? ""
    : `const encodedMemoryFiles = ${JSON.stringify(encodedFiles)};
const decodedMemoryFiles = Object.fromEntries(Object.entries(encodedMemoryFiles).map(([path, encoded]) => [path, Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))]));
`;
  const memoryOption = encodedFiles === null ? "" : ", memoryFiles: decodedMemoryFiles";
  return `
import { createPluginHost } from "@ai-switch/tauri-plugin-runtime/host";
import { createTestHost } from "@ai-switch/tauri-plugin-devkit/testing";
const manifest = ${manifest};
const title = document.createElement("h1");
title.textContent = "APLG 模拟宿主 / 内存数据";
const note = document.createElement("p");
note.textContent = manifest.name;
const status = document.createElement("p");
status.id = "aplg-preview-status";
status.textContent = "正在挂载插件…";
const controls = document.createElement("p");
const disconnect = document.createElement("button");
disconnect.type = "button";
disconnect.textContent = "断开模拟宿主";
const reconnect = document.createElement("button");
reconnect.type = "button";
reconnect.textContent = "重新连接模拟宿主";
const reload = document.createElement("button");
reload.type = "button";
reload.textContent = "重新挂载";
controls.append(disconnect, " ", reconnect, " ", reload);
const slot = document.createElement("div");
slot.id = "aplg-preview-slot";
document.body.replaceChildren(title, note, status, controls, slot);
${memoryBootstrap}const testHost = createTestHost({ manifest, assetUrl: new URL(${assetPath}, location.href).href${memoryOption} });
const pluginHost = createPluginHost({ transport: testHost.transport, allowedAssetOrigins: [location.origin] });
let view;
let mounting;
async function mount() {
  if (mounting) return mounting;
  status.textContent = "正在挂载插件…";
  mounting = pluginHost.mount({ pluginId: manifest.id, container: slot }).then((next) => {
    view = next;
    status.textContent = "已连接（模拟宿主 / 内存数据）";
    status.dataset.sessionId = testHost.activeSessionIds()[0] ?? "";
    return next;
  }, () => {
    status.textContent = "插件挂载失败";
    return undefined;
  }).finally(() => { mounting = undefined; });
  return mounting;
}
disconnect.addEventListener("click", () => testHost.disconnect());
reconnect.addEventListener("click", () => testHost.reconnect());
reload.addEventListener("click", async () => { await view?.dispose(); view = undefined; await mount(); });
window.addEventListener("pagehide", () => { void pluginHost.dispose(); void testHost.dispose(); }, { once: true });
await mount();
`;
}

/** Vite dev-only loopback preview shell; it has no production build output. */
export function previewPlugin(options: PreviewPluginOptions = {}): Plugin {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => !["manifestPath", "memoryFiles"].includes(key)) || options.manifestPath !== undefined && typeof options.manifestPath !== "string" || options.memoryFiles !== undefined && (options.memoryFiles === null || typeof options.memoryFiles !== "object" || Array.isArray(options.memoryFiles))) {
    throw new Error("APLG_INVALID_OPTIONS: Invalid preview options.");
  }
  const manifestPath = options.manifestPath ?? "aplg.json";
  let config: ResolvedConfig | undefined;
  let active = false;
  let context: PreviewContext | undefined;
  let contextPromise: Promise<PreviewContext> | undefined;
  const contextFor = async () => {
    if (!config) throw new ProjectError("E_BUILD_CONFIG", "Preview server configuration is not ready.");
    contextPromise ??= loadContext(config, manifestPath);
    return context ??= await contextPromise;
  };
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const raw = req.url ?? "/";
    let pathname: string;
    try { pathname = new URL(raw, "http://127.0.0.1").pathname; } catch { next(); return; }
    if (pathname !== previewRoute && pathname !== `${previewRoute}/`) { next(); return; }
    if (!loopbackHostHeader(req.headers?.host)) { send(res, 403, "text/plain; charset=utf-8", "Preview is loopback-only."); return; }
    void contextFor().then((current) => {
      const csp = "default-src 'none'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
      res.setHeader("Content-Security-Policy", csp);
      send(res, 200, "text/html; charset=utf-8", `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(current.manifest.name)} · APLG Preview</title></head><body><script type="module" src="${clientPublic}"></script></body></html>`);
    }).catch(() => send(res, 500, "text/plain; charset=utf-8", "Preview is unavailable."));
  };
  return {
    name: "aplg:preview",
    apply: "serve",
    config(input) {
      if (!loopbackHost(input.server?.host)) failHost();
      return { server: { host: "127.0.0.1", hmr: false, cors: false, open: false } };
    },
    async configResolved(resolved) {
      config = resolved;
      active = resolved.command === "serve" && !resolved.build.ssr;
      context = undefined;
      contextPromise = active ? loadContext(resolved, manifestPath) : undefined;
      if (contextPromise) context = await contextPromise;
    },
    async resolveId(source, importer) {
      if (!active) return;
      if (source === clientPublic) return clientVirtual;
      if (importer === clientVirtual && source === "@ai-switch/tauri-plugin-devkit/testing") return testingVirtual;
    },
    load(id) {
      if (!active) return;
      if (id === clientVirtual) return context ? clientSource(context, options.memoryFiles) : undefined;
      if (id === testingVirtual) return `export * from ${JSON.stringify(testingEntry)};`;
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        // Vite injects its client even with hmr:false. The plugin iframe must
        // never receive that client or attempt a websocket connection.
        return html.replace(/<script\s+type=["']module["']\s+src=["']\/\@vite\/client["']\s*><\/script>\s*/gi, "");
      },
    },
    configureServer(server: ViteDevServer) {
      // A sandboxed iframe without allow-same-origin has an opaque `null`
      // origin. Vite module scripts are CORS requests, so only that origin gets
      // a read-only response header while the preview server remains loopback.
      server.middlewares.use((request, response, next) => {
        if (request.headers.origin === "null") {
          response.setHeader("Access-Control-Allow-Origin", "null");
          response.setHeader("Vary", "Origin");
        }
        next();
      });
      server.middlewares.use(middleware);
    },
  };
}
