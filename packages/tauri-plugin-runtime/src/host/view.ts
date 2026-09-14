import { AplgError } from "../protocol/errors.js";
import { protocolVersion } from "../protocol/limits.js";
import { validateJson } from "../protocol/json-safety.js";
import { standardCapabilities, validateCapabilityRequest, validateCapabilityResult } from "../protocol/capabilities.js";
import type { HostEvent, SessionDescriptor } from "../protocol/generated/types.generated.js";
import type { HostTransport } from "../protocol/wire.js";
import type { IncomingRequest, RpcPeer } from "../bridge/rpc-types.js";
import { createRpcPeer } from "../bridge/rpc-peer.js";
import { appendBootstrapHint } from "../bridge/handshake.js";
import { createSessionRequests } from "./requests.js";
import { createFileHandleGuard } from "./file-handles.js";
import { createEventRouter } from "./event-router.js";
import { randomNonce } from "./policy.js";
import type { PluginView } from "./types.js";

export interface ManagedView {
  view: PluginView;
  ready: Promise<PluginView>;
  accept(event: HostEvent): void;
  dispose(reason?: Error): Promise<void>;
}

export function createManagedView(options: {
  descriptor: SessionDescriptor; container: HTMLElement; transport: HostTransport;
  handshakeTimeoutMs: number; requestTimeoutMs: number;
  closeSession(): Promise<void>; onDisposed(): void;
}): ManagedView {
  const { descriptor, container, transport } = options;
  const document = container.ownerDocument;
  const window = document.defaultView!;
  const iframe = document.createElement("iframe");
  iframe.title = descriptor.manifest.name;
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.referrerPolicy = "no-referrer";
  iframe.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'");
  const nonce = randomNonce();
  const requests = createSessionRequests({ transport, sessionId: descriptor.sessionId, timeoutMs: options.requestTimeoutMs });
  const fileHandles = createFileHandleGuard({ transport, requests, sessionId: descriptor.sessionId, timeoutMs: options.requestTimeoutMs, maxTransfers: descriptor.info.limits.fileTransfers });
  let peer: RpcPeer | undefined;
  let closed = false; let established = false; let loaded = false; let transportGeneration = 0;
  let disposePromise: Promise<void> | undefined;
  let resolveReady!: (view: PluginView) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<PluginView>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const events = createEventRouter({
    transport, requests, sessionId: descriptor.sessionId, timeoutMs: options.requestTimeoutMs,
    send(event) { if (established && !closed) { try { peer?.sendEvent(event); } catch { void dispose(new AplgError("E_INVALID_MESSAGE", "The plugin event could not be delivered.")); } } },
  });
  const timer = setTimeout(() => { void dispose(new AplgError("E_TIMEOUT", "The plugin handshake timed out.")); }, options.handshakeTimeoutMs);
  const observer = new MutationObserver(() => {
    if (!container.isConnected || iframe.parentElement !== container || iframe.getAttribute("sandbox") !== "allow-scripts") {
      void dispose(new AplgError("E_SESSION_CLOSED", "The plugin container was removed or changed."));
    }
  });
  const view: PluginView = { pluginId: descriptor.manifest.id, element: iframe, dispose: () => dispose() };

  function requireCapability(name: string, method?: string) {
    if (closed || !established) throw new AplgError("E_SESSION_CLOSED", "The plugin session is not active.");
    if (!events.isConnected()) throw new AplgError("E_HOST_UNAVAILABLE", "The host transport is disconnected.");
    const capability = Object.hasOwn(descriptor.info.capabilities, name) ? descriptor.info.capabilities[name] : undefined;
    if (!capability || method !== undefined && !capability.methods.includes(method)) {
      throw new AplgError("E_CAPABILITY_UNAVAILABLE", "The session does not grant this capability or method.");
    }
  }
  async function handle(request: IncomingRequest) {
    if (request.operation === "capability.call") {
      const { capability, method, params } = request.args;
      requireCapability(capability, method);
      const standard = Object.hasOwn(standardCapabilities, capability);
      if (standard && !validateCapabilityRequest(capability, method, params).ok) throw new AplgError("E_INVALID_ARGUMENT", "The capability request is invalid.");
      const result = capability === "aplg.fs"
        ? await fileHandles.call(method, params, request.signal)
        : await requests.run("capability.call", { capability, method, params }, request.signal);
      if (standard && !validateCapabilityResult(capability, method, result).ok) throw new AplgError("E_INVALID_MESSAGE", "The backend capability result is invalid.");
      return result;
    }
    if (request.operation === "subscription.open") {
      requireCapability(request.args.capability);
      return { subscriptionId: await events.open(request.args.capability, request.args.topic, request.signal) };
    }
    if (request.operation === "subscription.close") {
      if (closed || !established) throw new AplgError("E_SESSION_CLOSED", "The plugin session is closed.");
      await events.close(request.args.subscriptionId); return null;
    }
    // request.cancel is consumed by RpcPeer and aborts only its own handler signal.
    throw new AplgError("E_PERMISSION_DENIED", "The plugin cannot call this host operation.");
  }
  function receive(event: MessageEvent) {
    if (closed || peer) return;
    if (event.source !== iframe.contentWindow || event.origin !== "null") return;
    if (!validateJson(event.data, 4096).ok || !event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    if (data.nonce !== nonce) return;
    if (Object.keys(data).length !== 4 || data.channel !== "aplg.bootstrap" || data.protocol !== protocolVersion || data.kind !== "ready" || event.ports.length !== 0) {
      event.ports.forEach((port) => port.close()); void dispose(new AplgError("E_PROTOCOL_MISMATCH", "The plugin bootstrap request is invalid.")); return;
    }
    const channel = new MessageChannel();
    peer = createRpcPeer(channel.port1, { timeoutMs: options.requestTimeoutMs, maxBytes: descriptor.info.limits.controlBytes });
    peer.onRequest(handle);
    peer.onEvent((message) => {
      if (message.kind !== "connection" || message.state === "disconnected") { void dispose(new AplgError("E_INVALID_MESSAGE", "Plugins cannot emit host events.")); return; }
      if (message.state === "closed") { void dispose(); return; }
      if (established) { void dispose(new AplgError("E_INVALID_MESSAGE", "Duplicate plugin handshake acknowledgement.")); return; }
      if (!events.isConnected()) { void dispose(new AplgError("E_HOST_UNAVAILABLE", "The host disconnected during plugin startup.")); return; }
      established = true;
      clearTimeout(timer); window.removeEventListener("message", receive);
      try { peer!.sendEvent({ protocol: protocolVersion, kind: "connection", state: "connected" }); }
      catch { void dispose(new AplgError("E_SESSION_CLOSED", "The plugin handshake port closed.")); return; }
      resolveReady(view);
    });
    try {
      iframe.contentWindow!.postMessage({ channel: "aplg.bootstrap", protocol: protocolVersion, kind: "connect", nonce, info: descriptor.info }, "*", [channel.port2]);
    } catch {
      channel.port2.close(); void dispose(new AplgError("E_SESSION_CLOSED", "The plugin bootstrap could not be sent."));
    }
  }
  function load() {
    if (loaded) void dispose(new AplgError("E_SESSION_CLOSED", "The plugin document navigated or reloaded."));
    loaded = true;
  }
  function leave() { void dispose(); }
  function dispose(reason: Error = new AplgError("E_SESSION_CLOSED", "The plugin view closed.")): Promise<void> {
    if (disposePromise) return disposePromise;
    // Set the promise before closing the peer: its close event is synchronous.
    let done!: () => void;
    disposePromise = new Promise<void>((resolve) => { done = resolve; });
    closed = true;
    clearTimeout(timer); observer.disconnect();
    window.removeEventListener("message", receive); window.removeEventListener("pagehide", leave);
    iframe.removeEventListener("load", load);
    if (!established) rejectReady(reason);
    requests.abortAll(reason);
    peer?.close(reason); iframe.remove();
    options.onDisposed();
    void Promise.allSettled([events.dispose(), fileHandles.dispose(), options.closeSession()]).then(() => done());
    return disposePromise;
  }

  try {
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", leave, { once: true });
    iframe.addEventListener("load", load);
    iframe.src = appendBootstrapHint(descriptor.assetUrl, nonce, window.location.origin);
    container.append(iframe);
    for (let node: Node | null = container; node; node = node.parentNode) observer.observe(node, { childList: true });
    observer.observe(iframe, { attributes: true, attributeFilter: ["sandbox"] });
  } catch { void dispose(new AplgError("E_HOST_UNAVAILABLE", "The plugin container could not be mounted.")); }
  return {
    view, ready, dispose,
    accept(event) {
      if (closed) return;
      if (event.kind === "session.closed") { if (event.sessionId === descriptor.sessionId) void dispose(); return; }
      if (event.kind === "transport.state") {
        if (event.state === "disconnected") {
          transportGeneration++;
          void events.setConnected(false);
        } else {
          if (events.isConnected()) return;
          const generation = transportGeneration;
          void fileHandles.restore().then(() => {
            if (!closed && generation === transportGeneration) return events.setConnected(true);
          }).catch(() => {
            if (!closed && generation === transportGeneration) void dispose(new AplgError("E_HOST_UNAVAILABLE", "The plugin resources could not be restored."));
          });
        }
      } else events.accept(event);
    },
  };
}
