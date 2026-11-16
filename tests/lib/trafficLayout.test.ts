import { describe, expect, it } from "vitest";
import type { ActiveProxyAttempt, RouteProxyAccountSummary } from "../../src/lib/api/types";
import { buildTrafficModel, type TrafficCatalog } from "../../src/lib/trafficState";
import { buildTrafficViewport, trafficRowLimit } from "../../src/lib/trafficLayout";

const accounts: RouteProxyAccountSummary[] = Array.from({ length: 14 }, (_, index) => ({
  id: `account-${index}`, platform: "codex", display_name: `Account ${index}`, route_priority: index,
  kind: "api", status: "ok", max_concurrency: 5, active_request_count: 0,
}));
const catalog: TrafficCatalog = {
  clients: Array.from({ length: 16 }, (_, index) => ({
    client_key: `client-${index}`, display_name: `Client ${index}`, platforms: ["codex"], file_status: "managed",
  })),
  accounts,
};
const attempts: ActiveProxyAttempt[] = accounts.map((account, index) => ({
  request_id: `request-${index}`, attempt_id: `attempt-${index}`, platform: "codex", client_key: "client-0",
  credential_id: account.id, credential_name: account.display_name, started_at: "2026-11-16T00:00:00Z",
}));
const limits = { clientLimit: 15, accountLimit: 12 };

describe("traffic viewport", () => {
  it("bounds the default board while keeping complete activity and labelled hidden busy counts", () => {
    const model = buildTrafficModel(catalog, attempts);
    const view = buildTrafficViewport(model, limits, null);
    expect(view.clients).toHaveLength(15);
    expect(view.accounts).toHaveLength(12);
    expect(view.hidden_clients).toBe(1);
    expect(view.hidden_busy_clients).toBe(0);
    expect(view.hidden_accounts).toBe(2);
    expect(view.hidden_busy_accounts).toBe(2);
    expect(model.total_attempts).toBe(14);
    expect(model.all_accounts).toHaveLength(14);
    expect(view.edges).toHaveLength(12);
    expect(view.edges.some((edge) => edge.credential_id === "account-13")).toBe(false);
  });

  it("reveals a selected hidden account with its real edge and records the displaced account", () => {
    const model = buildTrafficModel(catalog, attempts);
    const view = buildTrafficViewport(model, limits, { kind: "account", key: "account-13" });
    expect(view.accounts).toHaveLength(12);
    expect(view.accounts.at(-1)?.id).toBe("account-13");
    expect(view.accounts.some((account) => account.id === "account-11")).toBe(false);
    expect(view.edges.find((edge) => edge.credential_id === "account-13")?.client_key).toBe("client-0");
    expect(view.hidden_busy_accounts).toBe(2);
  });

  it("reveals a selected hidden client without inventing an account connection", () => {
    const model = buildTrafficModel(catalog, []);
    const view = buildTrafficViewport(model, { clientLimit: 2, accountLimit: 12 }, { kind: "client", key: "client-9" });
    expect(view.clients.map((client) => client.client_key)).toEqual(["client-0", "client-9"]);
    expect(view.edges).toEqual([]);
    expect(view.hidden_clients).toBe(14);
  });

  it("counts hidden active clients and does not render edges whose actual source is hidden", () => {
    const model = buildTrafficModel(catalog, attempts.map((attempt, index) => ({ ...attempt, client_key: `client-${index}` })));
    const view = buildTrafficViewport(model, { clientLimit: 2, accountLimit: 12 }, null);
    expect(view.hidden_busy_clients).toBe(12);
    expect(view.edges.every((edge) => view.clients.some((client) => client.client_key === edge.client_key))).toBe(true);
    expect(model.edges).toHaveLength(14);
  });

  it("keeps readable row limits as the board shrinks and defaults before the first measurement", () => {
    expect(trafficRowLimit(520, 15)).toBe(15);
    expect(trafficRowLimit(520, 12)).toBe(12);
    expect(trafficRowLimit(300, 15)).toBe(9);
    expect(trafficRowLimit(0, 15)).toBe(15);
    expect(trafficRowLimit(40, 12)).toBe(1);
  });
});
