import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, ArrowLeft, ArrowRightLeft, FlaskConical, HelpCircle, Network, RefreshCw, Server } from "lucide-react";
import { AgentLogo } from "../components/brand/AgentLogo";
import { AiSwitchLogo } from "../components/brand/AiSwitchLogo";
import { TrafficDialog } from "../components/traffic/TrafficDialog";
import {
  getRouteProxyPoolMemberIds, getRouteProxyStatus, listConfigWriteClients,
  listPlatformCapabilities, listRouteProxyAccountSummaries,
} from "../lib/api/client";
import { agentClientInfo } from "../lib/agentClients";
import { useI18n } from "../lib/i18n";
import { buildTrafficModel, type TrafficCatalog, type TrafficClient } from "../lib/trafficState";
import { buildTrafficViewport, trafficRowLimit, type TrafficSelection } from "../lib/trafficLayout";
import { useTrafficActivity } from "../lib/useTrafficActivity";
import { useTrafficGeometry } from "../lib/useTrafficGeometry";
import { buildTrafficSimulation } from "../lib/trafficSimulation";
import "./TrafficScreen.css";

async function loadTrafficCatalog(): Promise<TrafficCatalog & { warnings: string[] }> {
  const platforms = (await listPlatformCapabilities())
    .filter((row) => row.operations.generic_api_routing.availability !== "unavailable");
  const [memberIds, summaries] = await Promise.all([
    getRouteProxyPoolMemberIds(), listRouteProxyAccountSummaries("codex"),
  ]);
  const members = new Set(memberIds);
  const results = await Promise.allSettled(platforms.map(async ({ platform }) => ({
    platform, clients: await listConfigWriteClients(platform),
  })));
  const clients = new Map<string, TrafficClient>();
  const accounts = new Map(summaries.filter((row) => members.has(row.id)).map((row) => [row.id, row]));
  const warnings: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      warnings.push(`${platforms[index].display_name}: ${String(result.reason)}`);
      return;
    }
    const catalog = result.value;
    for (const client of catalog.clients) {
      const current = clients.get(client.client_key);
      if (current) {
        if (!current.platforms.includes(catalog.platform)) current.platforms.push(catalog.platform);
        if (client.file_status === "managed") current.file_status = "managed";
      } else {
        clients.set(client.client_key, {
          client_key: client.client_key, display_name: client.display_name,
          platforms: [catalog.platform], file_status: client.file_status,
        });
      }
    }
  });
  return { clients: [...clients.values()], accounts: [...accounts.values()], account_summaries: summaries, warnings };
}

function FlowPath({ d, color, delay = 0, pair, muted }: {
  d: string; color: string; delay?: number; pair?: string; muted: boolean;
}) {
  return (
    <g data-active-pair={pair} data-link-state="active" className={`traffic-active-path ${muted ? "traffic-flow-muted" : ""}`} style={{ color }}>
      <path d={d} />
      <circle className="traffic-dot" r="2.6" style={{ offsetPath: `path("${d}")`, animationDelay: `${delay}s` }} />
      <circle className="traffic-dot traffic-dot-secondary" r="1.8" style={{ offsetPath: `path("${d}")`, animationDelay: `${delay - 1.4}s` }} />
    </g>
  );
}

export function TrafficScreen({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const catalog = useQuery({ queryKey: ["traffic-catalog"], queryFn: loadTrafficCatalog, staleTime: 0, refetchOnMount: "always" });
  const status = useQuery({
    queryKey: ["route-proxy-status"], queryFn: getRouteProxyStatus,
    refetchInterval: 5000, refetchIntervalInBackground: false,
  });
  const activity = useTrafficActivity();
  const [simulationFrame, setSimulationFrame] = useState<number | null>(null);
  const [selection, setSelection] = useState<TrafficSelection>(null);
  const [dialog, setDialog] = useState<"clients" | "accounts" | "help" | "error" | null>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const [boardHeight, setBoardHeight] = useState(0);
  const simulating = simulationFrame !== null;
  useEffect(() => {
    if (!simulating) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        setSimulationFrame((frame) => frame === null ? null : frame + 1);
      }
    }, 1800);
    return () => window.clearInterval(interval);
  }, [simulating]);
  const simulation = useMemo(() => simulationFrame === null ? null : buildTrafficSimulation(
    catalog.data, simulationFrame, (number) => t("traffic.demoAccount", { number }),
  ), [catalog.data, simulationFrame, t]);
  const confirmed = simulating || (activity.snapshot !== null && !activity.error);
  const model = useMemo(() => buildTrafficModel(
    simulation?.catalog ?? catalog.data ?? { clients: [], accounts: [] },
    simulation?.active ?? activity.snapshot?.active ?? [],
  ), [catalog.data, activity.snapshot, simulation]);
  const ready = Boolean(status.data?.running && status.data.route_access_enabled !== false);
  const animated = simulating || (confirmed && ready);
  const selected = selection && (selection.kind === "client"
    ? model.clients.some((row) => row.client_key === selection.key)
    : model.all_accounts.some((row) => row.id === selection.key)) ? selection : null;
  useEffect(() => { if (selection && !selected) setSelection(null); }, [selection, selected]);
  const view = useMemo(() => buildTrafficViewport(model, {
    clientLimit: trafficRowLimit(boardHeight, 15), accountLimit: trafficRowLimit(boardHeight, 12),
  }, selected), [model, boardHeight, selected]);
  const geometry = useTrafficGeometry(view.clients.map((row) => row.client_key), view.accounts.map((row) => row.id));
  useEffect(() => { if (geometry.measured) setBoardHeight(geometry.height); }, [geometry.height, geometry.measured]);
  const error = [activity.error, catalog.error?.message, status.error?.message, ...(catalog.data?.warnings ?? [])]
    .filter(Boolean).join(" · ");
  const refresh = () => { void catalog.refetch(); void status.refetch(); activity.refresh(); };
  const choose = (kind: "client" | "account", key: string) => {
    setSelection((current) => current?.kind === kind && current.key === key ? null : { kind, key });
  };
  const reveal = (kind: "client" | "account", key: string) => { setSelection({ kind, key }); setDialog(null); };
  const related = (clientKey: string, accountId?: string) => !selected || (selected.kind === "client"
    ? selected.key === clientKey
    : accountId === selected.key || !accountId && model.edges.some((edge) => edge.client_key === clientKey && edge.credential_id === selected.key));
  const clientRelated = (key: string) => !selected || selected.kind === "client" && selected.key === key
    || selected.kind === "account" && model.edges.some((edge) => edge.client_key === key && edge.credential_id === selected.key);
  const accountRelated = (id: string) => !selected || selected.kind === "account" && selected.key === id
    || selected.kind === "client" && model.edges.some((edge) => edge.client_key === selected.key && edge.credential_id === id);
  const clientName = (key: string, name: string) => key === "unknown" ? t("traffic.unknown") : name;
  const selectionName = selected?.kind === "client"
    ? clientName(selected.key, model.clients.find((row) => row.client_key === selected.key)?.display_name ?? selected.key)
    : model.all_accounts.find((row) => row.id === selected?.key)?.display_name;
  const dialogTitle = dialog === "clients" ? t("traffic.clients") : dialog === "accounts" ? t("traffic.pool")
    : dialog === "error" ? t("traffic.errorDetails") : t("traffic.help");

  return <section className="traffic-screen" aria-label={t("traffic.title")} data-traffic-mode={simulating ? "simulation" : "live"}
    onKeyDown={(event) => { if (event.key === "Escape" && selected) { event.stopPropagation(); setSelection(null); } }}>
    <header className="traffic-heading">
      <div className="traffic-heading-copy"><Network size={17} aria-hidden="true" /><h1>{t("traffic.title")}</h1>
        {simulating && <span className="traffic-simulation-notice" role="status" title={t("traffic.simulationHint")}>
          <strong>{t("traffic.simulationMode")}</strong><span className="sr-only">{t("traffic.simulationHint")}</span>
        </span>}
      </div>
      <div className="traffic-toolbar">
        {onBack && <button type="button" onClick={onBack} aria-label={t("traffic.accounts")} title={t("traffic.accounts")}><ArrowLeft size={15} /><span className="traffic-button-label">{t("traffic.accounts")}</span></button>}
        <button type="button" aria-pressed={simulating} className={simulating ? "traffic-simulation-active" : undefined}
          onClick={() => { setSimulationFrame((frame) => frame === null ? 0 : null); setSelection(null); }} title={t("traffic.simulationHint")}>
          <FlaskConical size={14} />{t(simulating ? "traffic.stopSimulation" : "traffic.simulate")}
        </button>
        <button type="button" onClick={refresh} aria-label={t("traffic.refresh")} title={t("traffic.refresh")} className="traffic-icon-button">
          <RefreshCw size={15} className={catalog.isFetching ? "traffic-refreshing" : undefined} />
        </button>
        <button ref={helpRef} type="button" onClick={() => setDialog("help")} aria-label={t("traffic.help")} title={t("traffic.help")} className="traffic-icon-button"><HelpCircle size={15} /></button>
        {error && <button type="button" onClick={() => setDialog("error")} className="traffic-error" role="alert" aria-label={t("traffic.viewError")} title={error}>
          <AlertTriangle size={15} /><span className="sr-only">{error}</span>
        </button>}
      </div>
    </header>

    <div className="traffic-network" ref={geometry.boardRef}>
      <svg className="traffic-links" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">
        {view.clients.map((row) => geometry.clientPaths.has(row.client_key) && <path key={`idle-client:${row.client_key}`} className="traffic-idle-path" data-link-state="idle" d={geometry.clientPaths.get(row.client_key)} />)}
        {view.accounts.map((row) => geometry.accountPaths.has(row.id) && <path key={`idle-account:${row.id}`} className="traffic-idle-path" data-link-state="idle" d={geometry.accountPaths.get(row.id)} />)}
        {animated && view.clients.map((row, index) => row.active_count > 0 && geometry.clientPaths.has(row.client_key)
          && <FlowPath key={`flow-client:${row.client_key}`} d={geometry.clientPaths.get(row.client_key)!} color={agentClientInfo(row.client_key).color} delay={-index * .23} muted={!related(row.client_key)} />)}
        {animated && view.edges.map((edge, index) => geometry.accountPaths.has(edge.credential_id)
          && <FlowPath key={JSON.stringify([edge.client_key, edge.credential_id])} d={geometry.accountPaths.get(edge.credential_id)!}
            color={agentClientInfo(edge.client_key).color} delay={-index * .29} pair={`${edge.client_key}:${edge.credential_id}`} muted={!related(edge.client_key, edge.credential_id)} />)}
      </svg>

      <div className="traffic-column traffic-client-column">
        <div className="traffic-column-title"><span>{t("traffic.clients")}</span>
          {view.hidden_clients > 0 ? <button type="button" aria-label={t("traffic.viewClients", { count: model.clients.length })} onClick={() => setDialog("clients")}>＋{view.hidden_clients}</button> : <small>{model.clients.length}</small>}
        </div>
        <div className="traffic-node-list" style={{ gridTemplateRows: `repeat(${view.clients.length || 1}, minmax(0, 1fr))` }}>
          {view.clients.map((client) => <button key={client.client_key} type="button" data-testid="traffic-client"
            ref={(node) => { if (node) geometry.clientRefs.current.set(client.client_key, node); else geometry.clientRefs.current.delete(client.client_key); }}
            className={`traffic-node traffic-client ${animated && client.active_count > 0 ? "traffic-node-active" : ""} ${clientRelated(client.client_key) ? "" : "traffic-node-muted"}`}
            style={{ "--client-color": agentClientInfo(client.client_key).color } as CSSProperties}
            aria-label={clientName(client.client_key, client.display_name)} aria-pressed={selected?.kind === "client" && selected.key === client.client_key}
            title={`${client.display_name} · ${confirmed ? t("traffic.activeRequests", { count: client.active_count }) : t("traffic.syncing")}`}
            onClick={() => choose("client", client.client_key)}>
            <AgentLogo clientKey={client.client_key} className="traffic-client-logo" />
            <strong className="traffic-node-name">{clientName(client.client_key, client.display_name)}</strong>
            <span className="traffic-count">{confirmed ? client.active_count : "—"}</span><i className="traffic-port" />
          </button>)}
        </div>
        {confirmed && view.hidden_busy_clients > 0 && <button className="traffic-hidden-busy" type="button" onClick={() => setDialog("clients")}>{t("traffic.hiddenBusy", { count: view.hidden_busy_clients })}</button>}
      </div>

      <div className="traffic-center">
        <span className="traffic-center-title">{t("traffic.gateway")}</span>
        <div className={`traffic-hub ${animated && model.total_attempts > 0 ? "traffic-hub-active" : ""}`} ref={geometry.hubRef}>
          <AiSwitchLogo className="traffic-hub-logo" /><h2>AI Switch</h2>
          <div className="traffic-hub-count"><ArrowRightLeft size={12} />{confirmed ? model.total_attempts : "—"}<small>{t(simulating ? "traffic.simulationMode" : "traffic.inFlight")}</small></div>
          <div className={`traffic-hub-status ${ready ? "traffic-online" : "traffic-offline"}`}><i />{status.isPending ? t("traffic.syncing") : ready ? t("traffic.online") : t("traffic.stopped")}</div>
        </div>
        <div className="traffic-selection-note">{selected ? <><span>{t("traffic.selectionHint", { name: selectionName ?? selected.key })}</span><button type="button" onClick={() => setSelection(null)}>{t("traffic.clearSelection")}</button></> : t("traffic.nodeHint")}</div>
      </div>

      <div className="traffic-column traffic-account-column">
        <div className="traffic-column-title"><span>{t("traffic.pool")} <small className="traffic-sort-label" title={t("traffic.sorted")}>{t("traffic.sorted")}</small></span>
          {view.hidden_accounts > 0 && <button type="button" aria-label={t("traffic.viewAccounts", { count: model.all_accounts.length })} onClick={() => setDialog("accounts")}>＋{view.hidden_accounts}</button>}
        </div>
        <div className="traffic-node-list" style={{ gridTemplateRows: `repeat(${view.accounts.length || 1}, minmax(0, 1fr))` }}>
          {view.accounts.map((account) => {
            const edges = model.edges.filter((edge) => edge.credential_id === account.id);
            const color = edges[0] ? agentClientInfo(edges[0].client_key).color : "#64748b";
            return <button key={account.id} type="button" data-testid="traffic-account"
              ref={(node) => { if (node) geometry.accountRefs.current.set(account.id, node); else geometry.accountRefs.current.delete(account.id); }}
              className={`traffic-node traffic-account ${animated && account.active_count > 0 ? "traffic-node-active" : ""} ${accountRelated(account.id) ? "" : "traffic-node-muted"}`}
              style={{ "--client-color": color } as CSSProperties} aria-label={account.display_name}
              aria-pressed={selected?.kind === "account" && selected.key === account.id} onClick={() => choose("account", account.id)}
              title={`${account.display_name} · P${account.route_priority} · ${confirmed ? t("traffic.concurrency", { count: account.active_count }) : t("traffic.syncing")} · ${account.max_concurrency > 0 ? account.max_concurrency : "∞"}`}>
              <i className="traffic-port" /><Server size={16} className="traffic-account-icon" />
              <strong className="traffic-node-name">{account.display_name}</strong>
              <span className="traffic-account-count"><strong>{confirmed ? account.active_count : "—"}</strong><small>{account.max_concurrency > 0 ? `/ ${account.max_concurrency}` : ""}</small></span>
              {edges.length > 0 && <span className="traffic-account-clients">{edges.map((edge) => <i key={edge.client_key} style={{ background: agentClientInfo(edge.client_key).color }} title={`${agentClientInfo(edge.client_key).label} × ${edge.count}`} />)}</span>}
            </button>;
          })}
        </div>
        {confirmed && view.hidden_busy_accounts > 0 && <button className="traffic-hidden-busy" type="button" onClick={() => setDialog("accounts")}>{t("traffic.hiddenBusy", { count: view.hidden_busy_accounts })}</button>}
        {!catalog.isPending && view.accounts.length === 0 && <p className="traffic-empty-pool">{t("traffic.emptyPool")}</p>}
      </div>
      {catalog.isPending && !simulating && <p className="traffic-placeholder">{t("traffic.syncing")}</p>}
    </div>

    <footer className="traffic-network-footer"><div className="traffic-legend">
      <span><i className="traffic-legend-static" />{t("traffic.legendStatic")}</span>
      <span><i className="traffic-legend-active" />{t(simulating ? "traffic.simulatedLegend" : "traffic.legendActive")}</span>
    </div><span className="traffic-account-totals">{t("traffic.accountTotals", { shown: view.accounts.length, total: model.all_accounts.length })}</span></footer>

    {dialog && <TrafficDialog title={dialogTitle} onClose={() => setDialog(null)} returnFocusRef={helpRef}>
      {dialog === "help" ? <div className="traffic-help-copy"><p>{t("traffic.subtitle")}</p><p>{t("traffic.legacyHint")}</p><p>{t("traffic.hiddenExplanation")}</p><p>{t("traffic.readOnly")}</p><p>{t("traffic.simulationHint")}</p></div>
        : dialog === "error" ? <p className="traffic-error-details">{error}</p>
          : <><p className="traffic-overflow-hint">{t("traffic.hiddenExplanation")}</p><div className="traffic-overflow-list">
            {dialog === "clients" ? model.clients.map((client) => <button key={client.client_key} type="button" aria-label={clientName(client.client_key, client.display_name)} onClick={() => reveal("client", client.client_key)}>
              <AgentLogo clientKey={client.client_key} className="traffic-client-logo" /><strong>{clientName(client.client_key, client.display_name)}</strong><span>{confirmed ? client.active_count : "—"}</span>
            </button>) : model.all_accounts.map((account) => <button key={account.id} type="button" aria-label={account.display_name} onClick={() => reveal("account", account.id)}>
              <Server size={16} /><strong>{account.display_name}</strong><small>P{account.route_priority}</small><span>{confirmed ? account.active_count : "—"}{account.max_concurrency > 0 ? ` / ${account.max_concurrency}` : ""}</span>
            </button>)}
          </div></>}
    </TrafficDialog>}
  </section>;
}
