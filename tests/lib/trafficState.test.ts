import { describe, expect, it } from "vitest";
import type { ActiveProxyAttempt, ActiveProxyAttemptEvent, ActiveProxyAttemptSnapshot, RouteProxyAccountSummary } from "../../src/lib/api/types";
import { applyTrafficEvent, applyTrafficSnapshot, buildTrafficModel, type TrafficCatalog } from "../../src/lib/trafficState";

const attempt = (id: string, client: string, account: string, requestId = id): ActiveProxyAttempt => ({
  request_id: requestId, attempt_id: id, platform: "codex", client_key: client,
  credential_id: account, credential_name: `Account ${account}`, started_at: "2026-11-15T00:00:00Z",
});
const snapshot = (sequence: number, active: ActiveProxyAttempt[], epoch = "epoch-a"): ActiveProxyAttemptSnapshot => ({ epoch, sequence, active });
const account = (id: string, priority = 1): RouteProxyAccountSummary => ({
  id, platform: "codex", display_name: `Account ${id}`, route_priority: priority,
  kind: "api", status: "ok", max_concurrency: 4, active_request_count: 0,
});
const catalog: TrafficCatalog = {
  clients: [
    { client_key: "zcode", display_name: "ZCode", platforms: ["codex", "claude"], file_status: "managed" },
    { client_key: "workbuddy", display_name: "WorkBuddy", platforms: ["codex"], file_status: "managed" },
  ],
  accounts: Array.from({ length: 14 }, (_, i) => account(String(i), 14 - i)),
};

describe("traffic state", () => {
  it("applies real start and finish transitions without reviving duplicate or stale events", () => {
    const state = snapshot(3, [attempt("one", "zcode", "0")]);
    const started: ActiveProxyAttemptEvent = { epoch: "epoch-a", sequence: 4, action: "started", attempt: attempt("two", "workbuddy", "1") };
    const next = applyTrafficEvent(state, started);
    expect(next.state?.active.map((row) => row.attempt_id)).toEqual(["one", "two"]);
    const finished = applyTrafficEvent(next.state, { ...started, sequence: 5, action: "finished" });
    expect(finished.state?.active.map((row) => row.attempt_id)).toEqual(["one"]);
    expect(applyTrafficEvent(finished.state, started).state).toBe(finished.state);
    expect(finished.needsSnapshot).toBe(false);
  });

  it("requests a snapshot for dropped events or a changed runtime epoch", () => {
    const state = snapshot(3, []);
    const event: ActiveProxyAttemptEvent = { epoch: "epoch-a", sequence: 6, action: "started", attempt: attempt("x", "zcode", "0") };
    expect(applyTrafficEvent(state, event).needsSnapshot).toBe(true);
    expect(applyTrafficEvent(state, { ...event, epoch: "epoch-b", sequence: 1 }).needsSnapshot).toBe(true);
  });

  it("does not let a delayed snapshot overwrite newer event state but accepts a new runtime", () => {
    const state = snapshot(5, [attempt("one", "zcode", "0")]);
    expect(applyTrafficSnapshot(state, snapshot(4, []))).toBe(state);
    const restarted = applyTrafficSnapshot(state, snapshot(0, [], "epoch-b"));
    expect(restarted.epoch).toBe("epoch-b");
    expect(restarted.active).toEqual([]);
  });

  it("sorts active accounts by attempts and fills the view with idle pool members to twelve", () => {
    const model = buildTrafficModel(catalog, [
      attempt("a", "zcode", "0"), attempt("b", "zcode", "0", "a"), attempt("c", "workbuddy", "2"),
    ]);
    expect(model.accounts.map((row) => row.id)).toEqual(["0", "2", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4"]);
    expect(model.clients.find((row) => row.client_key === "zcode")?.active_count).toBe(1);
    expect(model.accounts[0].active_count).toBe(2);
    expect(model.edges.find((row) => row.client_key === "zcode" && row.credential_id === "0")?.count).toBe(2);
    expect(model.total_attempts).toBe(3);
  });

  it("retains unknown-source and active non-pool accounts without fake client attribution", () => {
    const model = buildTrafficModel(catalog, [attempt("external", "unknown", "outside")]);
    expect(model.clients.find((row) => row.client_key === "unknown")?.active_count).toBe(1);
    expect(model.accounts[0].id).toBe("outside");
    expect(model.edges[0].client_key).toBe("unknown");
  });

  it("keeps all active accounts when there are more than twelve and deduplicates summaries", () => {
    const model = buildTrafficModel({ ...catalog, accounts: [...catalog.accounts, account("0")] },
      catalog.accounts.map((row) => attempt(`request-${row.id}`, "zcode", row.id)));
    expect(model.accounts).toHaveLength(14);
    expect(new Set(model.accounts.map((row) => row.id)).size).toBe(14);
  });

  it("shows all available accounts without fabricating live pool members when fewer than twelve exist", () => {
    const model = buildTrafficModel({ ...catalog, accounts: [account("one"), account("two")] }, []);
    expect(model.accounts.map((row) => row.id)).toEqual(["one", "two"]);
  });

  it("retains all sorted account summaries for overflow without changing the default twelve rows", () => {
    const model = buildTrafficModel(catalog, []);
    expect(model.accounts).toHaveLength(12);
    expect(model.all_accounts.map((row) => row.id)).toEqual(["13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"]);
  });

  it("keeps idle nodes with zero activity and no animated edges", () => {
    const model = buildTrafficModel(catalog, []);
    expect(model.accounts).toHaveLength(12);
    expect(model.clients).toHaveLength(2);
    expect(model.edges).toEqual([]);
    expect(model.total_attempts).toBe(0);
  });
});
