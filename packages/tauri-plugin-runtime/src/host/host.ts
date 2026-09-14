import { AplgError } from "../protocol/errors.js";
import { validateJson } from "../protocol/json-safety.js";
import { validateSessionDescriptor } from "../protocol/session.js";
import { validateHostEvent } from "../protocol/wire.js";
import type { HostEvent, SessionDescriptor } from "../protocol/generated/types.generated.js";
import type { Unsubscribe } from "../protocol/wire.js";
import { bounded, checkedOrigin, checkedTimeout, requireAssetOrigin } from "./policy.js";
import { createManagedView, type ManagedView } from "./view.js";
import type { PluginHost, PluginHostOptions, PluginView } from "./types.js";

export function createPluginHost(options: PluginHostOptions): PluginHost {
  const handshakeTimeoutMs = checkedTimeout(options.handshakeTimeoutMs ?? 10_000);
  const requestTimeoutMs = checkedTimeout(options.requestTimeoutMs ?? 30_000);
  const allowedAssetOrigins = options.allowedAssetOrigins?.map(checkedOrigin);
  const views = new Map<string, ManagedView>();
  const sessionOwners = new Map<string, AbortController>();
  const mounts = new Map<HTMLElement, AbortController>();
  const inUse = new Set<HTMLElement>();
  const recentlyClosed = new Set<string>();
  let disposed = false; let online = true;
  let subscribed: Promise<void> | undefined;
  let unsubscribe: Unsubscribe | undefined;
  let subscriptionGeneration = 0;
  let disposing: Promise<void> | undefined;

  function releaseListenerIfIdle() {
    if (views.size || mounts.size) return;
    subscriptionGeneration++;
    const remove = unsubscribe; unsubscribe = undefined; subscribed = undefined; recentlyClosed.clear();
    try { remove?.(); } catch { /* Transport teardown must not prevent session cleanup. */ }
  }
  function receive(input: HostEvent) {
    const validation = validateHostEvent(input);
    if (disposed || !validation.ok) return;
    const event = validation.value;
    if (event.kind === "transport.state") {
      online = event.state === "connected";
      for (const view of views.values()) view.accept(event);
      return;
    }
    if (event.kind === "session.closed" && mounts.size) {
      if (!recentlyClosed.has(event.sessionId) && recentlyClosed.size >= 256) {
        for (const controller of mounts.values()) controller.abort(new AplgError("E_LIMIT_EXCEEDED", "Too many session changes occurred during startup."));
      } else recentlyClosed.add(event.sessionId);
    }
    views.get(event.sessionId)?.accept(event);
  }
  async function ensureSubscribed() {
    if (subscribed) return subscribed;
    // A detached listener cannot observe recovery; each fresh event subscription
    // starts a new transport observation period and may receive its current state.
    online = true;
    const generation = subscriptionGeneration;
    const pending = Promise.resolve().then(() => options.transport.subscribe(receive)).then((remove) => {
      if (typeof remove !== "function") throw new AplgError("E_INVALID_MESSAGE", "The host transport returned an invalid event subscription.");
      if (disposed || generation !== subscriptionGeneration) { try { remove(); } catch { /* A stale subscription cannot block teardown. */ } return; }
      unsubscribe = remove;
    });
    subscribed = pending;
    try { await pending; }
    catch (error) { if (subscribed === pending) subscribed = undefined; throw error; }
  }
  function closeBackend(sessionId: string) {
    return bounded(() => options.transport.call("session.close", { sessionId }), requestTimeoutMs).then(() => {});
  }
  function rawSessionId(raw: unknown): string | undefined {
    if (!validateJson(raw).ok || !raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const id = (raw as Record<string, unknown>).sessionId;
    return typeof id === "string" && /^[\x21-\x7e]{1,128}$/.test(id) ? id : undefined;
  }
  function waitFor<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  return {
    async mount({ pluginId, container }): Promise<PluginView> {
      if (disposed) throw new AplgError("E_SESSION_CLOSED", "The plugin host is closed.");
      if (typeof window === "undefined" || !container?.ownerDocument?.defaultView || !container.isConnected || typeof container.append !== "function") {
        throw new AplgError("E_HOST_UNAVAILABLE", "Plugin mounting requires a connected browser container.");
      }
      if (typeof pluginId !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(pluginId) || pluginId.length > 160) throw new AplgError("E_INVALID_ARGUMENT", "Invalid plugin identifier.");
      if (inUse.has(container)) throw new AplgError("E_INVALID_ARGUMENT", "The container already holds a plugin view.");
      if (views.size + mounts.size >= 64) throw new AplgError("E_LIMIT_EXCEEDED", "Too many plugin views.");
      const origins = allowedAssetOrigins ?? [checkedOrigin(container.ownerDocument.defaultView.location.origin)];
      const controller = new AbortController();
      mounts.set(container, controller); inUse.add(container);
      const timer = setTimeout(() => controller.abort(new AplgError("E_TIMEOUT", "Plugin startup timed out.")), handshakeTimeoutMs);
      let sessionId: string | undefined; let closePromise: Promise<void> | undefined; let managed: ManagedView | undefined;
      const close = () => {
        if (closePromise) return closePromise;
        if (!sessionId || sessionOwners.get(sessionId) !== controller) return Promise.resolve();
        const ownedId = sessionId;
        closePromise = closeBackend(ownedId).catch(() => {}).finally(() => {
          if (sessionOwners.get(ownedId) === controller) sessionOwners.delete(ownedId);
        });
        return closePromise;
      };
      try {
        await waitFor(ensureSubscribed(), controller.signal);
        if (!online) throw new AplgError("E_HOST_UNAVAILABLE", "The host transport is disconnected.");
        const opening = Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason;
          return options.transport.call<unknown>("session.open", { pluginId });
        }).then((raw) => {
          const id = rawSessionId(raw);
          if (id && !sessionOwners.has(id)) { sessionOwners.set(id, controller); sessionId = id; }
          if (controller.signal.aborted || disposed) { void close(); throw controller.signal.reason ?? new AplgError("E_SESSION_CLOSED", "The plugin host closed."); }
          return raw;
        });
        const raw = await waitFor(opening, controller.signal);
        const result = validateSessionDescriptor(raw);
        if (!result.ok) throw new AplgError("E_PROTOCOL_MISMATCH", "The host returned an invalid plugin session.");
        const descriptor: SessionDescriptor = JSON.parse(JSON.stringify(result.value));
        if (sessionOwners.get(descriptor.sessionId) !== controller || views.has(descriptor.sessionId)) throw new AplgError("E_PROTOCOL_MISMATCH", "The backend reused an active session.");
        if (descriptor.manifest.id !== pluginId) throw new AplgError("E_PROTOCOL_MISMATCH", "The backend returned a different plugin identity.");
        if (recentlyClosed.has(descriptor.sessionId)) throw new AplgError("E_SESSION_CLOSED", "The plugin session closed during startup.");
        requireAssetOrigin(descriptor.assetUrl, origins);
        if (controller.signal.aborted || disposed || !container.isConnected || !online) throw controller.signal.reason ?? new AplgError("E_SESSION_CLOSED", "The plugin container is no longer available.");
        managed = createManagedView({
          descriptor, container, transport: options.transport, handshakeTimeoutMs, requestTimeoutMs,
          closeSession: close,
          onDisposed() { if (views.get(descriptor.sessionId) === managed) views.delete(descriptor.sessionId); inUse.delete(container); releaseListenerIfIdle(); },
        });
        views.set(descriptor.sessionId, managed);
        const view = await waitFor(managed.ready, controller.signal);
        if (controller.signal.aborted || disposed) throw controller.signal.reason ?? new AplgError("E_SESSION_CLOSED", "The plugin host closed.");
        return view;
      } catch (error) {
        if (managed) { views.delete(sessionId!); void managed.dispose(error instanceof Error ? error : undefined); }
        else if (sessionId) void close();
        inUse.delete(container);
        throw error;
      } finally {
        clearTimeout(timer); mounts.delete(container);
        if (mounts.size === 0) recentlyClosed.clear();
        releaseListenerIfIdle();
      }
    },
    dispose() {
      if (disposing) return disposing;
      disposed = true;
      for (const controller of mounts.values()) controller.abort(new AplgError("E_SESSION_CLOSED", "The plugin host closed."));
      const closing = [...views.values()].map((view) => view.dispose());
      views.clear(); mounts.clear(); inUse.clear(); releaseListenerIfIdle();
      disposing = Promise.allSettled(closing).then(() => {});
      return disposing;
    },
  };
}
