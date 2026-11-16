import type { buildTrafficModel } from "./trafficState";

export type TrafficModel = ReturnType<typeof buildTrafficModel>;
export type TrafficSelection = { kind: "client" | "account"; key: string } | null;

export function trafficRowLimit(height: number, maximum: number): number {
  if (!height || !Number.isFinite(height)) return maximum;
  return Math.max(1, Math.min(maximum, Math.floor((height - 27 - 18 + 4) / 26)));
}

function visibleRows<T>(rows: T[], limit: number, selected: string | undefined, key: (row: T) => string): T[] {
  const visible = rows.slice(0, Math.max(1, limit));
  if (selected && !visible.some((row) => key(row) === selected)) {
    const pinned = rows.find((row) => key(row) === selected);
    if (pinned) visible.splice(visible.length - 1, 1, pinned);
  }
  return visible;
}

export function buildTrafficViewport(
  model: TrafficModel,
  limits: { clientLimit: number; accountLimit: number },
  selection: TrafficSelection,
) {
  const clients = visibleRows(model.clients, limits.clientLimit,
    selection?.kind === "client" ? selection.key : undefined, (row) => row.client_key);
  const accounts = visibleRows(model.all_accounts, limits.accountLimit,
    selection?.kind === "account" ? selection.key : undefined, (row) => row.id);
  const clientIds = new Set(clients.map((row) => row.client_key));
  const accountIds = new Set(accounts.map((row) => row.id));
  const hiddenClients = model.clients.filter((row) => !clientIds.has(row.client_key));
  const hiddenAccounts = model.all_accounts.filter((row) => !accountIds.has(row.id));
  return {
    clients, accounts,
    edges: model.edges.filter((edge) => clientIds.has(edge.client_key) && accountIds.has(edge.credential_id)),
    hidden_clients: hiddenClients.length,
    hidden_busy_clients: hiddenClients.filter((row) => row.active_count > 0).length,
    hidden_accounts: hiddenAccounts.length,
    hidden_busy_accounts: hiddenAccounts.filter((row) => row.active_count > 0).length,
  };
}
