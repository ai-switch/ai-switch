import { AplgError } from "../protocol/errors.js";
import { protocolVersion } from "../protocol/limits.js";
import type { SessionInfo } from "../protocol/wire.js";
import { createRpcPeer, type RpcPeer } from "../bridge/rpc-peer.js";
import { readBootstrapHint, validateConnectMessage } from "../bridge/handshake.js";
import { createPluginClient } from "./client.js";
import type { ConnectionState, PluginApi } from "./types.js";

let client: PluginApi | undefined;
let connecting: Promise<PluginApi> | undefined;
let ready: Promise<SessionInfo> | undefined;
let currentState: ConnectionState | "idle" = "idle";
const listeners = new Set<(state: ConnectionState) => void>();

function closeTransferredPorts(event: MessageEvent) {
  for (const port of event.ports) port.close();
}

/** Connect only on demand. The caller owns the real window, not a fake bridge. */
function connectWindow(target: Window): Promise<PluginApi> {
  if (target.parent === target) return Promise.reject(new AplgError("E_HOST_UNAVAILABLE", "A plugin must be opened by an APLG host."));
  let hint: ReturnType<typeof readBootstrapHint>;
  try { hint = readBootstrapHint(target.location.href); }
  catch (error) { return Promise.reject(error); }
  return new Promise<PluginApi>((resolve, reject) => {
    let peer: RpcPeer | undefined;
    let settled = false;
    let handshakeAccepted = false;
    let removeAckListener = () => {};
    let removeCloseListener = () => {};
    const timer = setTimeout(() => fail(new AplgError("E_TIMEOUT", "The plugin host did not complete the handshake.")), 10_000);

    function clearHandshake() {
      clearTimeout(timer);
      target.removeEventListener("message", receive);
      removeAckListener();
    }
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearHandshake();
      target.removeEventListener("pagehide", leave);
      removeCloseListener();
      peer?.close(error);
      reject(error);
    }
    function leave() {
      if (!settled) fail(new AplgError("E_SESSION_CLOSED", "The plugin view was unloaded."));
      else peer?.close();
    }
    function receive(event: MessageEvent) {
      if (event.source !== target.parent || event.origin !== hint.parentOrigin) { closeTransferredPorts(event); return; }
      const data: unknown = event.data;
      if (data === null || typeof data !== "object" || Array.isArray(data) || !Object.hasOwn(data, "nonce") || (data as { nonce: unknown }).nonce !== hint.nonce) {
        closeTransferredPorts(event); return;
      }
      if (handshakeAccepted) { closeTransferredPorts(event); return; }
      let info: SessionInfo;
      try {
        info = validateConnectMessage(data, hint.nonce);
        if (event.ports.length !== 1) throw new AplgError("E_PROTOCOL_MISMATCH", "The host must provide exactly one RPC port.");
      } catch {
        closeTransferredPorts(event); fail(new AplgError("E_PROTOCOL_MISMATCH", "The bootstrap response was invalid.")); return;
      }
      handshakeAccepted = true;
      peer = createRpcPeer(event.ports[0], { maxBytes: info.limits.controlBytes });
      removeCloseListener = peer.onEvent((message) => {
        if (message.kind === "connection" && message.state === "closed") {
          target.removeEventListener("pagehide", leave);
          if (!settled) fail(new AplgError("E_SESSION_CLOSED", "The host closed during the handshake."));
          removeCloseListener();
        }
      });
      removeAckListener = peer.onEvent((message) => {
        if (settled || message.kind !== "connection" || message.state !== "connected") return;
        try {
          const connectedClient = createPluginClient(peer!, info);
          try {
            target.history.replaceState(target.history.state, "", `${target.location.pathname}${target.location.search}${hint.originalHash}`);
          } catch {
            // Opaque sandbox origins may not use History.replaceState. A hash
            // update stays within this document and still precedes business code.
            target.location.hash = hint.originalHash;
          }
          settled = true;
          clearHandshake();
          resolve(connectedClient);
        } catch { fail(new AplgError("E_PROTOCOL_MISMATCH", "The plugin connection could not be initialized.")); }
      });
      try { peer.sendEvent({ protocol: protocolVersion, kind: "connection", state: "connected" }); }
      catch { fail(new AplgError("E_SESSION_CLOSED", "The handshake port is unavailable.")); }
    }
    target.addEventListener("message", receive);
    target.addEventListener("pagehide", leave, { once: true });
    try {
      target.parent.postMessage({ channel: "aplg.bootstrap", protocol: protocolVersion, kind: "ready", nonce: hint.nonce }, hint.parentOrigin);
    } catch { fail(new AplgError("E_HOST_UNAVAILABLE", "The plugin host cannot be reached.")); }
  });
}

export function getPluginClient(): Promise<PluginApi> {
  connecting ??= (typeof window === "undefined"
    ? Promise.reject(new AplgError("E_HOST_UNAVAILABLE", "A plugin connection requires a browser host."))
    : connectWindow(window)).then((value) => {
      client = value;
      currentState = "connected";
      value.onConnectionChange((state) => {
        currentState = state;
        for (const callback of [...listeners]) { try { callback(state); } catch { /* Isolate application callbacks. */ } }
        if (state === "closed") listeners.clear();
      });
      return value;
    }).catch((error: unknown) => {
      currentState = "closed";
      for (const callback of [...listeners]) { try { callback("closed"); } catch { /* Isolate callbacks. */ } }
      listeners.clear();
      throw error;
    });
  return connecting;
}

export function connectPlugin(): Promise<SessionInfo> {
  if (client) return client.ready();
  ready ??= getPluginClient().then((value) => value.ready());
  return ready;
}

export function supportsCapability(name: string, range?: string) {
  return client?.capabilities.supports(name, range) ?? false;
}
export function onConnectionChange(callback: (state: ConnectionState) => void) {
  if (currentState === "closed") { try { callback("closed"); } catch { /* Isolate callbacks. */ } return () => {}; }
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}
