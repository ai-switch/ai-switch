import { readBootstrapHint } from "../../../src/bridge/handshake.js";
const hint = readBootstrapHint(location.href);
let port: MessagePort | undefined;
let connected = false;
let currentAttack = "";
const reply = (value: string) => parent.postMessage({ probe: value }, hint.parentOrigin);
window.addEventListener("message", (event) => {
  if (event.source !== parent) return;
  if (event.data?.kind === "connect" && event.data.nonce === hint.nonce && !port) {
    port = event.ports[0];
    port.onmessage = (event) => {
      const data = JSON.parse(event.data as string);
      if (data.kind === "connection" && data.state === "connected") { connected = true; return; }
      if (data.kind === "connection" && data.state === "closed") reply("closed");
      if (data.kind === "error") reply(data.error.code);
      if (data.kind === "result") reply("success");
    };
    port.postMessage(JSON.stringify({ protocol: "aplg/1", kind: "connection", state: "connected" }));
    return;
  }
  if (!connected || !port || typeof event.data?.attack !== "string") return;
  currentAttack = event.data.attack;
  const message = { protocol: "aplg/1", kind: "request", id: "attack-1", operation: "capability.call", args: { capability: "aplg.storage", method: "get", params: { key: "value" } } } as Record<string, unknown>;
  if (currentAttack === "attack-identity") message.args = { ...(message.args as object), sessionId: "victim" };
  if (currentAttack === "attack-unknown") message.args = { capability: "aplg.exec", method: "run", params: null };
  if (currentAttack === "attack-subscription") { message.operation = "subscription.close"; message.args = { subscriptionId: "backend-1" }; }
  if (currentAttack === "attack-ack") { port.postMessage(JSON.stringify({ protocol: "aplg/1", kind: "connection", state: "connected" })); return; }
  if (currentAttack === "attack-dom") {
    try { reply(parent.document.body.tagName); } catch { reply("blocked"); }
    return;
  }
  port.postMessage(JSON.stringify(message));
});
parent.postMessage({ channel: "aplg.bootstrap", protocol: "aplg/1", kind: "ready", nonce: hint.nonce }, hint.parentOrigin);
