import { AplgError } from "../../../src/protocol/errors.js";
import type { HostTransport } from "../../../src/protocol/wire.js";
import type { HostEvent, SessionDescriptor } from "../../../src/protocol/generated/types.generated.js";
import type { JsonObject, JsonValue } from "../../../src/protocol/types.js";
import { makeSession } from "../../fixtures/session.js";

type Sub = { sessionId: string; id: string; seq: number };
export function memoryTransport(mode: string, render: (counts: Record<string, number>) => void) {
  const sessions = new Map<string, SessionDescriptor>();
  const storage = new Map<string, Map<string, JsonValue>>();
  const subscribers = new Set<(event: HostEvent) => void>();
  const subs = new Map<string, Sub>(); const stale: Sub[] = [];
  const pendingOpens: Array<() => void> = [];
  const waiting = new Map<string, { sessionId: string; reject(error: Error): void }>();
  let opens = 0; let closes = 0; let cancels = 0; let writes = 0; let denied = 0; let subId = 0;
  const update = () => render({ active: sessions.size, subscriptions: subs.size, listeners: subscribers.size, opens, closes, waiting: waiting.size, cancels, writes, denied });
  const emit = (event: HostEvent) => { for (const callback of [...subscribers]) callback(event); };
  const findA = () => [...sessions.values()].find((session) => session.manifest.id === "io.example.a")?.sessionId;
  function deleteSession(id: string) {
    sessions.delete(id);
    for (const [key, sub] of subs) if (sub.sessionId === id) subs.delete(key);
    for (const [key, pending] of waiting) if (pending.sessionId === id) { waiting.delete(key); pending.reject(new AplgError("E_SESSION_CLOSED", "Session closed.")); }
  }
  async function call(operation: string, args: JsonObject): Promise<unknown> {
    if (operation === "session.open") {
      const descriptor = makeSession() as SessionDescriptor;
      const existing = [...sessions.values()][0];
      const id = `session-${++opens}`;
      if (mode === "duplicate-session" && existing) { update(); return existing; }
      if (mode === "concurrent-duplicate" && existing) { update(); return new Promise((resolve) => pendingOpens.push(() => resolve(existing))); }
      descriptor.sessionId = id; descriptor.manifest.id = args.pluginId as string; descriptor.info.plugin.id = args.pluginId as string;
      descriptor.assetUrl = mode.startsWith("attack-") ? "http://127.0.0.1:43172/hostile-plugin.html#/notes" : mode === "no-handshake" ? "http://127.0.0.1:43172/silent-plugin.html" : "http://127.0.0.1:43172/managed-plugin.html#/notes";
      descriptor.manifest.requires = { "aplg.storage": "^1.0.0", "example.feed": "^1.0.0", "example.wait": "^1.0.0" };
      descriptor.info.capabilities = {
        "aplg.storage": { version: "1.0.0", methods: ["get", "set", "remove"] },
        "example.feed": { version: "1.0.0", methods: ["status"] },
        "example.wait": { version: "1.0.0", methods: ["wait"] },
      };
      sessions.set(id, descriptor); update();
      if (mode === "close-history-overflow") {
        emit({ kind: "session.closed", sessionId: id, reason: "closed before open result" });
        for (let index = 0; index < 260; index++) emit({ kind: "session.closed", sessionId: `foreign-${index}`, reason: "noise" });
        deleteSession(id); update();
      }
      if (mode === "early-close") { emit({ kind: "session.closed", sessionId: id, reason: "early" }); deleteSession(id); update(); }
      if (mode === "slow-open" || mode === "concurrent-duplicate") return new Promise((resolve) => pendingOpens.push(() => resolve(descriptor)));
      return descriptor;
    }
    const sessionId = args.sessionId as string;
    if (operation === "session.close") { closes++; deleteSession(sessionId); update(); return null; }
    if (operation === "request.cancel") {
      const requestId = args.requestId as string; const pending = waiting.get(requestId);
      if (pending?.sessionId === sessionId) { cancels++; waiting.delete(requestId); pending.reject(new AplgError("E_CANCELLED", "Cancelled.")); update(); }
      return null;
    }
    if (operation === "subscription.close") {
      const id = args.subscriptionId as string;
      if (subs.get(id)?.sessionId === sessionId) { stale.push(subs.get(id)!); subs.delete(id); update(); }
      return null;
    }
    const session = sessions.get(sessionId);
    if (!session) throw new AplgError("E_SESSION_CLOSED", "Unknown session.");
    if (operation === "subscription.open") {
      const id = `backend-${++subId}`; const sub = { id, sessionId, seq: 0 }; subs.set(id, sub); update();
      if (mode === "early-event") emit({ kind: "capability.event", sessionId, subscriptionId: id, seq: ++sub.seq, payload: "early" });
      return { subscriptionId: id };
    }
    if (operation === "capability.call") {
      if (args.capability === "example.wait") return new Promise((_resolve, reject) => { waiting.set(args.requestId as string, { sessionId, reject }); update(); });
      if (args.capability === "example.feed") return "ok";
      if (args.capability !== "aplg.storage") { denied++; update(); throw new AplgError("E_PERMISSION_DENIED", "Unknown capability."); }
      const state = storage.get(session.manifest.id) ?? new Map<string, JsonValue>(); storage.set(session.manifest.id, state);
      const params = args.params as { key: string; value?: JsonValue };
      if (args.method === "get") return state.get(params.key) ?? null;
      if (args.method === "set") { state.set(params.key, params.value!); writes++; update(); return null; }
      if (args.method === "remove") { state.delete(params.key); return null; }
    }
    throw new Error("Unexpected fixture operation");
  }
  const transport: HostTransport = {
    call: call as HostTransport["call"],
    async subscribe(callback) {
      subscribers.add(callback); update();
      const remove = () => { subscribers.delete(callback); update(); if (mode === "throwing-unsubscribe") throw new Error("Fixture teardown failure"); };
      if (mode === "slow-listener") return new Promise<() => void>((resolve) => pendingOpens.push(() => resolve(remove)));
      return remove;
    },
  };
  return {
    transport,
    resolveOpens() { pendingOpens.splice(0).forEach((resolve) => resolve()); },
    closeA() { const id = findA(); if (id) { deleteSession(id); emit({ kind: "session.closed", sessionId: id, reason: "disabled" }); update(); } },
    disconnect() { emit({ kind: "transport.state", state: "disconnected" }); },
    reconnect() { emit({ kind: "transport.state", state: "connected" }); },
    emitA(kind: "next" | "stale" | "duplicate") {
      const sessionId = findA(); const sub = kind === "stale" ? stale.find((value) => value.sessionId === sessionId) : [...subs.values()].find((value) => value.sessionId === sessionId);
      if (sub) emit({ kind: "capability.event", sessionId: sub.sessionId, subscriptionId: sub.id, seq: kind === "duplicate" ? sub.seq : ++sub.seq, payload: kind });
    },
  };
}
