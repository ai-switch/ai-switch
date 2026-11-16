import { useEffect, useState } from "react";
import { getRouteProxyActiveAttempts } from "./api/client";
import type { ActiveProxyAttemptEvent, ActiveProxyAttemptSnapshot } from "./api/types";
import { getTransport, type Unsubscribe } from "./transport";
import { applyTrafficEvent, applyTrafficSnapshot } from "./trafficState";

export function useTrafficActivity() {
  const [snapshot, setSnapshot] = useState<ActiveProxyAttemptSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: Unsubscribe | undefined;
    let current: ActiveProxyAttemptSnapshot | null = null;
    let pending = false;
    let buffered: ActiveProxyAttemptEvent[] = [];
    const retiredEpochs = new Set<string>();

    const publish = (next: ActiveProxyAttemptSnapshot) => {
      if (disposed) return;
      if (current && current.epoch !== next.epoch) retiredEpochs.add(current.epoch);
      current = next;
      setSnapshot(next);
    };

    const refresh = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        const incoming = await getRouteProxyActiveAttempts();
        if (disposed) return;
        if (retiredEpochs.has(incoming.epoch)) return;
        // Events may describe a short-lived intermediate runtime. The
        // authoritative snapshot is not pinned to an epoch mentioned by events.
        let next = applyTrafficSnapshot(current, incoming);
        const events = buffered;
        buffered = [];
        for (const event of events.filter((row) => row.epoch === next.epoch).sort((a, b) => a.sequence - b.sequence)) {
          const result = applyTrafficEvent(next, event);
          if (result.needsSnapshot) {
            buffered.push(event);
          } else if (result.state) {
            next = result.state;
          }
        }
        publish(next);
        setError(null);
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        // A stale host snapshot must not trigger a tight retry loop. Unresolved
        // events stay buffered until the next visibility/three-second check.
        pending = false;
      }
    };

    const onEvent = (event: ActiveProxyAttemptEvent) => {
      if (disposed || retiredEpochs.has(event.epoch)) return;
      if (!current || pending) {
        buffered.push(event);
        // The native event queue is bounded too. A snapshot repairs any discarded
        // prefix without letting a hidden view accumulate an unbounded replay.
        if (buffered.length > 2048) buffered = buffered.slice(-2048);
        return;
      }
      const result = applyTrafficEvent(current, event);
      if (result.needsSnapshot) {
        buffered.push(event);
        void refresh();
      } else if (result.state) {
        publish(result.state);
      }
    };

    void getTransport().subscribe<ActiveProxyAttemptEvent>("route-proxy-active-attempt", onEvent)
      .then((release) => {
        if (disposed) {
          void release();
          return;
        }
        unsubscribe = release;
        void refresh();
      })
      .catch((reason) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      });

    const interval = window.setInterval(() => {
      if (unsubscribe && document.visibilityState !== "hidden") void refresh();
    }, 3000);
    const onVisible = () => {
      if (unsubscribe && document.visibilityState !== "hidden") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      if (unsubscribe) void unsubscribe();
    };
  }, [refreshToken]);

  return { snapshot, error, refresh: () => setRefreshToken((current) => current + 1) };
}
