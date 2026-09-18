import { createPluginHost, type PluginView } from "../../../src/host/index.js";
import { memoryTransport } from "./memory-transport.js";

const mode = new URLSearchParams(location.search).get("mode") ?? "normal";
const set = (id: string, value: string | number) => { document.getElementById(id)!.textContent = String(value); };
const backend = memoryTransport(mode, (counts) => { for (const [id, count] of Object.entries(counts)) set(id, count); });
const host = createPluginHost({
  transport: backend.transport,
  ...(mode === "disallowed-origin" ? {} : { allowedAssetOrigins: ["http://127.0.0.1:43172"] }),
  handshakeTimeoutMs: ["slow-open", "no-handshake", "slow-listener"].includes(mode) ? 700 : 5000,
  requestTimeoutMs: 1000,
});
const views = new Map<string, PluginView>();
for (const id of ["A", "B"]) document.getElementById(`mount-${id}`)!.addEventListener("click", () => {
  set(`status-${id}`, "mounting");
  void host.mount({ pluginId: `io.example.${id.toLowerCase()}`, container: document.querySelector(`[data-view="${id}"]`)! }).then((view) => {
    views.set(id, view); set(`status-${id}`, "mounted");
  }, (error) => set(`status-${id}`, `error:${error.code ?? "UNKNOWN"}`));
});
document.getElementById("dispose-A")!.addEventListener("click", () => { void views.get("A")?.dispose(); });
document.getElementById("dispose-host")!.addEventListener("click", () => { void host.dispose(); });
document.getElementById("remove-A")!.addEventListener("click", () => document.querySelector('[data-view="A"]')?.remove());
document.getElementById("resolve-opens")!.addEventListener("click", backend.resolveOpens);
document.getElementById("close-A")!.addEventListener("click", backend.closeA);
document.getElementById("disconnect")!.addEventListener("click", backend.disconnect);
document.getElementById("reconnect")!.addEventListener("click", backend.reconnect);
document.getElementById("emit-A")!.addEventListener("click", () => backend.emitA("next"));
document.getElementById("stale-A")!.addEventListener("click", () => backend.emitA("stale"));
document.getElementById("duplicate-A")!.addEventListener("click", () => backend.emitA("duplicate"));

document.getElementById("probe-A")!.addEventListener("click", () => views.get("A")?.element.contentWindow?.postMessage({ attack: mode }, "*"));
window.addEventListener("message", (event) => {
  if (event.source === views.get("A")?.element.contentWindow && typeof event.data?.probe === "string") set("probe-result", event.data.probe);
});

document.getElementById("move-A")!.addEventListener("click", () => document.getElementById("move-parent")!.append(document.querySelector('[data-view="A"]')!));
document.getElementById("remove-moved")!.addEventListener("click", () => document.getElementById("move-parent")!.remove());
