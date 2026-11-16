import type { ActiveProxyAttempt, RouteProxyAccountSummary } from "./api/types";
import { agentClientInfo } from "./agentClients";
import { MIN_TRAFFIC_ACCOUNTS, type TrafficCatalog, type TrafficClient } from "./trafficState";

const DEMO_CLIENT_KEYS = ["zcode", "workbuddy", "claude_code"];

/** Display-only traffic: never submitted to the gateway or written to history. */
export function buildTrafficSimulation(
  catalog: TrafficCatalog | undefined,
  frame: number,
  demoAccountName: (number: number) => string,
): { catalog: TrafficCatalog; active: ActiveProxyAttempt[] } {
  const clients: TrafficClient[] = catalog?.clients.length ? catalog.clients : DEMO_CLIENT_KEYS.map((client_key) => ({
    client_key, display_name: agentClientInfo(client_key).label,
    platforms: [client_key === "claude_code" ? "claude" : "codex"], file_status: "demo",
  }));
  const accounts: RouteProxyAccountSummary[] = [...(catalog?.accounts ?? [])]
    .sort((a, b) => a.route_priority - b.route_priority
      || a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id));
  while (accounts.length < MIN_TRAFFIC_ACCOUNTS) {
    const number = accounts.length + 1;
    accounts.push({
      id: `simulation-account-${number}`, platform: "codex", display_name: demoAccountName(number),
      route_priority: number, kind: "api", status: "demo", max_concurrency: 5, active_request_count: 0,
    });
  }
  const selected = [...clients].sort((a, b) => {
    const rank = (key: string) => {
      const index = DEMO_CLIENT_KEYS.indexOf(key);
      return index < 0 ? DEMO_CLIENT_KEYS.length : index;
    };
    return rank(a.client_key) - rank(b.client_key) || a.display_name.localeCompare(b.display_name);
  }).slice(0, 3);
  const active: ActiveProxyAttempt[] = [];
  for (const [index, client] of selected.entries()) {
    const account = accounts[(frame + index) % accounts.length];
    const desired = 1 + ((2 - index + frame) % 3);
    const count = Math.min(desired, account.max_concurrency > 0 ? account.max_concurrency : desired);
    for (let slot = 0; slot < count; slot += 1) {
      const id = `simulation-${frame}-${client.client_key}-${slot}`;
      active.push({
        request_id: id, attempt_id: id, platform: client.platforms[0] ?? "codex", client_key: client.client_key,
        credential_id: account.id, credential_name: account.display_name, started_at: new Date().toISOString(),
      });
    }
  }
  return { catalog: { clients, accounts, account_summaries: catalog?.account_summaries }, active };
}
