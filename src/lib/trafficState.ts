import type {
  ActiveProxyAttempt, ActiveProxyAttemptEvent, ActiveProxyAttemptSnapshot,
  RouteProxyAccountSummary,
} from "./api/types";
import { agentClientInfo } from "./agentClients";

export const MIN_TRAFFIC_ACCOUNTS = 12;

export type TrafficClient = {
  client_key: string;
  display_name: string;
  platforms: string[];
  file_status: string;
};

export type TrafficCatalog = {
  clients: TrafficClient[];
  accounts: RouteProxyAccountSummary[];
  account_summaries?: RouteProxyAccountSummary[];
};

export function applyTrafficSnapshot(
  current: ActiveProxyAttemptSnapshot | null,
  incoming: ActiveProxyAttemptSnapshot,
): ActiveProxyAttemptSnapshot {
  if (current?.epoch === incoming.epoch && current.sequence > incoming.sequence) return current;
  return incoming;
}

export function applyTrafficEvent(
  current: ActiveProxyAttemptSnapshot | null,
  event: ActiveProxyAttemptEvent,
): { state: ActiveProxyAttemptSnapshot | null; needsSnapshot: boolean } {
  if (!current || current.epoch !== event.epoch) return { state: current, needsSnapshot: true };
  if (event.sequence <= current.sequence) return { state: current, needsSnapshot: false };
  const active = current.active.filter((row) => row.attempt_id !== event.attempt.attempt_id);
  if (event.action === "started") active.push(event.attempt);
  return {
    state: { ...current, sequence: event.sequence, active },
    needsSnapshot: event.sequence !== current.sequence + 1,
  };
}

export function buildTrafficModel(catalog: TrafficCatalog, active: ActiveProxyAttempt[]) {
  const clients = new Map(catalog.clients.map((client) => [client.client_key, client]));
  const accounts = new Map(catalog.accounts.map((account) => [account.id, account]));
  const summaries = new Map((catalog.account_summaries ?? []).map((account) => [account.id, account]));
  const clientRequests = new Map<string, Set<string>>();
  const accountCounts = new Map<string, number>();
  const edges = new Map<string, { client_key: string; credential_id: string; count: number }>();
  for (const attempt of active) {
    if (!clients.has(attempt.client_key)) {
      clients.set(attempt.client_key, {
        client_key: attempt.client_key, display_name: agentClientInfo(attempt.client_key).label,
        platforms: [attempt.platform], file_status: "unknown",
      });
    }
    if (!accounts.has(attempt.credential_id)) {
      accounts.set(attempt.credential_id, summaries.get(attempt.credential_id) ?? {
        id: attempt.credential_id, platform: attempt.platform,
        display_name: attempt.credential_name || attempt.credential_id,
        route_priority: 0, kind: "api", status: "ok", max_concurrency: 0, active_request_count: 0,
      });
    }
    const requests = clientRequests.get(attempt.client_key) ?? new Set<string>();
    requests.add(attempt.request_id);
    clientRequests.set(attempt.client_key, requests);
    accountCounts.set(attempt.credential_id, (accountCounts.get(attempt.credential_id) ?? 0) + 1);
    const key = JSON.stringify([attempt.client_key, attempt.credential_id]);
    const edge = edges.get(key) ?? { client_key: attempt.client_key, credential_id: attempt.credential_id, count: 0 };
    edge.count += 1;
    edges.set(key, edge);
  }
  const sortedAccounts = [...accounts.values()]
    .map((account) => ({ ...account, active_count: accountCounts.get(account.id) ?? 0 }))
    .sort((a, b) => b.active_count - a.active_count || a.route_priority - b.route_priority
      || a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id));
  const busy = sortedAccounts.filter((account) => account.active_count > 0).length;
  return {
    clients: [...clients.values()]
      .map((client) => ({ ...client, active_count: clientRequests.get(client.client_key)?.size ?? 0 }))
      .sort((a, b) => b.active_count - a.active_count || a.display_name.localeCompare(b.display_name)),
    accounts: sortedAccounts.slice(0, Math.max(MIN_TRAFFIC_ACCOUNTS, busy)),
    all_accounts: sortedAccounts,
    edges: [...edges.values()],
    total_attempts: active.length,
    total_accounts: accounts.size,
    busy_accounts: busy,
  };
}
