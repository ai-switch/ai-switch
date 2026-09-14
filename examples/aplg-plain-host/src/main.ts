import { protocolVersion } from "@ai-switch/tauri-plugin-runtime";
import { createPluginHost, type PluginView } from "@ai-switch/tauri-plugin-runtime/host";
import { createMemoryTransport, manifest } from "./memory-transport.js";
import "./style.css";

const status = document.querySelector<HTMLElement>("#host-status")!;
const open = document.querySelector<HTMLButtonElement>("#open")!;
const close = document.querySelector<HTMLButtonElement>("#close")!;
const slot = document.querySelector<HTMLElement>("#plugin-slot")!;
const assetOrigin = document.querySelector<HTMLMetaElement>('meta[name="aplg-asset-origin"]')!.content;
document.querySelector("#protocol")!.textContent = protocolVersion;
const backend = createMemoryTransport(`${assetOrigin}/plugin/index.html`, (snapshot) => {
  for (const [key, value] of Object.entries(snapshot)) document.getElementById(key)!.textContent = String(value);
});
const host = createPluginHost({ transport: backend.transport, allowedAssetOrigins: [assetOrigin] });
let view: PluginView | undefined;
let busy = false;
function buttons() { open.disabled = busy || !!view; close.disabled = busy || !view; }
function message(error: unknown) { return error instanceof Error ? error.message : "操作未完成，请重试。"; }

open.addEventListener("click", async () => {
  if (busy || view) return;
  busy = true; buttons(); status.textContent = "正在连接隔离视图…";
  try { view = await host.mount({ pluginId: manifest.id, container: slot }); status.textContent = "插件已打开 · 关闭后清空本次会话"; }
  catch (error) { status.textContent = message(error); }
  finally { busy = false; buttons(); }
});
close.addEventListener("click", async () => {
  if (busy || !view) return;
  busy = true; buttons();
  try { await view.dispose(); view = undefined; status.textContent = "已关闭 · 会话和内存已释放"; }
  catch (error) { status.textContent = message(error); }
  finally { busy = false; buttons(); }
});
// The in-memory provider has no durable or remote resources; page teardown is
// best effort. Production transports must also reclaim abandoned sessions.
window.addEventListener("pagehide", () => { void host.dispose().catch(() => {}); }, { once: true });
