import { appendBootstrapHint } from "../../../src/bridge/handshake.js";
import { makeSession } from "../../fixtures/session.js";

const mode = new URLSearchParams(location.search).get("mode") ?? "normal";
const frame = document.getElementById("plugin") as HTMLIFrameElement;
const rogue = document.getElementById("rogue") as HTMLIFrameElement;
const nonce = "A".repeat(43);
const info = makeSession().info;
info.capabilities = { "example.echo": { version: "1.0.0", methods: ["echo"] } };
const ports: MessagePort[] = [];
let acknowledged: MessagePort | undefined;
let awaiting: MessagePort | undefined;
let readies = 0; let acks = 0; let calls = 0; let sent = 0;
const write = (id: string, count: string | number) => { document.getElementById(id)!.textContent = String(count); };
const message = () => ({ channel: "aplg.bootstrap", protocol: "aplg/1", kind: "connect", nonce, info });
const send = (port: MessagePort, value: unknown) => port.postMessage(JSON.stringify(value));

function acknowledge() {
  if (!awaiting) return;
  acknowledged = awaiting;
  send(awaiting, { protocol: "aplg/1", kind: "connection", state: "connected" });
  awaiting = undefined;
}
function connect(overrideMode = mode) {
  const channel = new MessageChannel(); ports.push(channel.port1);
  channel.port1.onmessage = (event) => {
    const data = JSON.parse(event.data as string);
    if (data.kind === "connection" && data.state === "connected") {
      write("acks", ++acks); awaiting = channel.port1;
      if (mode !== "manual-ack") acknowledge();
    }
    if (data.kind === "request") {
      write("calls", ++calls);
      send(channel.port1, { protocol: "aplg/1", kind: "result", id: data.id, value: data.operation === "capability.call" ? data.args.params : null });
    }
  };
  let payload: Record<string, unknown> = message();
  const transfer = [channel.port2];
  if (overrideMode === "wrong-nonce") payload = { ...payload, nonce: "B".repeat(43) };
  if (overrideMode === "bad-protocol") payload = { ...payload, protocol: "aplg/99" };
  if (overrideMode === "private-info") payload = { ...payload, info: { ...info, sessionId: "secret-session" } };
  if (overrideMode === "extra-port") { const extra = new MessageChannel(); ports.push(extra.port1); transfer.push(extra.port2); }
  if (overrideMode === "missing-port") transfer.length = 0;
  frame.contentWindow!.postMessage(payload, "*", transfer);
  write("sent", ++sent);
}
window.addEventListener("message", (event) => {
  if (event.source === rogue.contentWindow && event.data === "rogue-sent") { write("rogue-sent", "yes"); return; }
  if (event.source !== frame.contentWindow || event.data?.kind !== "ready" || event.data?.nonce !== nonce) return;
  write("readies", ++readies);
  if (mode !== "manual" && mode !== "wrong-origin") connect();
});
document.getElementById("connect")!.addEventListener("click", () => connect("normal"));
document.getElementById("ack")!.addEventListener("click", acknowledge);
document.getElementById("close")!.addEventListener("click", () => {
  if (acknowledged) send(acknowledged, { protocol: "aplg/1", kind: "connection", state: "closed" });
});
document.getElementById("rogue-connect")!.addEventListener("click", () => rogue.contentWindow!.postMessage(message(), location.origin));
window.addEventListener("pagehide", () => ports.forEach((port) => port.close()), { once: true });
const asset = "http://127.0.0.1:43172/plugin.html#/notes?q=1";
frame.src = mode === "missing-context" ? asset : appendBootstrapHint(asset, nonce, mode === "wrong-origin" ? "http://127.0.0.1:43171" : location.origin);
