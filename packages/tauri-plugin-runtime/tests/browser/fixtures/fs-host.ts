import { createPluginHost } from "../../../src/host/index.js";
import type { HostEvent } from "../../../src/protocol/generated/types.generated.js";
import type { HostTransport } from "../../../src/protocol/wire.js";
import { makeSession } from "../../fixtures/session.js";
import { createMemoryFsProvider } from "../../support/memory-fs-provider.js";

const mode = new URLSearchParams(location.search).get("mode");
const provider = createMemoryFsProvider({ available: mode !== "unavailable" });
const listeners = new Set<(event: HostEvent) => void>();
const gates: Array<() => void> = [];
const update = () => {
  document.getElementById("active")!.textContent = String(provider.activeTransfers());
  document.getElementById("peak")!.textContent = String(provider.maxTransfers());
  document.getElementById("calls")!.textContent = String(provider.calls.length);
};
if (mode === "gate") for (let index = 0; index < 2; index++) provider.interceptNext("transfer.push", async (_params, perform) => { update(); await new Promise<void>((resolve) => gates.push(resolve)); return perform(); });
const transport: HostTransport = {
  async call(operation, args) {
    if (operation === "session.open") {
      const descriptor = makeSession(); descriptor.assetUrl = "http://127.0.0.1:43172/fs-plugin.html";
      const info = await provider.session(); descriptor.info = info;
      if (mode !== "unavailable") descriptor.manifest.requires = { "aplg.fs": "^1.0.0" };
      return descriptor as never;
    }
    if (operation === "capability.call") {
      try { return await provider.call(args.capability as string, args.method as string, args.params); }
      finally { update(); }
    }
    if (operation === "session.close") { provider.setState("closed"); update(); }
    return null as never;
  },
  async subscribe(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
};
if (mode === "late-open") provider.interceptNext("transfer.openWrite", async (_params, perform) => {
  await new Promise<void>((resolve) => gates.push(resolve)); return perform();
});
const host = createPluginHost({ transport, allowedAssetOrigins: ["http://127.0.0.1:43172"], requestTimeoutMs: mode === "late-open" ? 200 : 30000 });
void host.mount({ pluginId: "io.github.example.notes", container: document.getElementById("container")! });
document.getElementById("release")!.addEventListener("click", () => gates.splice(0).forEach((resolve) => resolve()));
document.getElementById("close")!.addEventListener("click", () => {
  provider.setState("closed"); update();
  for (const listener of [...listeners]) listener({ kind: "session.closed", sessionId: "session-a", reason: "test" });
  gates.splice(0).forEach((resolve) => resolve());
});

document.getElementById("disconnect")!.addEventListener("click", () => {
  provider.setState("disconnected"); update();
  for (const listener of [...listeners]) listener({ kind: "transport.state", state: "disconnected" });
});
document.getElementById("reconnect")!.addEventListener("click", () => {
  provider.setState("connected"); update();
  for (const listener of [...listeners]) listener({ kind: "transport.state", state: "connected" });
});
