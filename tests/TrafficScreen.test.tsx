import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/lib/i18n";
import { TrafficScreen } from "../src/screens/TrafficScreen";
import type { ActiveProxyAttempt, ActiveProxyAttemptEvent, ActiveProxyAttemptSnapshot, ConfigWriteClientStatus, PlatformCapability, RoutePoolState } from "../src/lib/api/types";
import { getRouteProxyActiveAttempts, getRouteProxyPoolMemberIds, getRouteProxyStatus, listConfigWriteClients, listPlatformCapabilities, listRouteProxyAccountSummaries } from "../src/lib/api/client";

vi.mock("../src/lib/api/client", () => ({
  getRouteProxyActiveAttempts: vi.fn(), getRouteProxyPoolMemberIds: vi.fn(), getRouteProxyStatus: vi.fn(),
  listConfigWriteClients: vi.fn(), listPlatformCapabilities: vi.fn(), listRouteProxyAccountSummaries: vi.fn(),
}));
const { subscribe, unsubscribe } = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("../src/lib/transport", () => ({ getTransport: () => ({ subscribe }) }));

let onEvent: ((event: ActiveProxyAttemptEvent) => void) | undefined;
const attempt: ActiveProxyAttempt = {
  request_id: "request-zcode", attempt_id: "attempt-zcode", platform: "codex", client_key: "zcode",
  credential_id: "account-6", credential_name: "Account 6", started_at: "2026-11-15T00:00:00Z",
};
const snap = (sequence: number, active: ActiveProxyAttempt[] = []): ActiveProxyAttemptSnapshot => ({ epoch: "test-runtime", sequence, active });

function capability(platform: "codex" | "claude"): PlatformCapability {
  const rule = { availability: "supported" as const, reason_code: null, credential_kinds: ["api"], requires_base_url: false, requires_api_dialect: false };
  return { platform, display_name: platform, support_level: "supported", operations: {
    route_credentials: rule, generic_api_routing: rule, config_write: rule, official_import: rule,
    official_account_routing: rule, deeplink_import: rule, official_quota: rule, model_test: rule,
    terminal_launch: rule, session_resume: rule,
  }};
}
const client = (key: string, name: string, platform: string): ConfigWriteClientStatus => ({
  client_key: key, display_name: name, platform, native: false, restart_required: true,
  target_key: `${key}_${platform}`, file_status: "managed", config_path: null, error_code: null,
});

function mount(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(<QueryClientProvider client={queryClient}><I18nProvider initialLanguage="en"><TrafficScreen /></I18nProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  onEvent = undefined;
  subscribe.mockImplementation(async (topic: string, handler: typeof onEvent) => {
    if (topic === "route-proxy-active-attempt") onEvent = handler;
    return unsubscribe;
  });
  vi.mocked(listPlatformCapabilities).mockResolvedValue([capability("codex"), capability("claude")]);
  vi.mocked(listConfigWriteClients).mockImplementation(async (platform) => platform === "codex"
    ? [client("zcode", "ZCode", "codex"), client("workbuddy", "WorkBuddy", "codex")]
    : [client("zcode", "ZCode", "claude"), client("claude_code", "Claude Code", "claude")]);
  vi.mocked(listRouteProxyAccountSummaries).mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({
    id: `account-${i}`, platform: "codex", display_name: `Account ${i}`, kind: "api", status: "ok",
    route_priority: i, max_concurrency: 4, active_request_count: 0,
  })));
  vi.mocked(getRouteProxyPoolMemberIds).mockResolvedValue(Array.from({ length: 8 }, (_, i) => `account-${i}`));
  vi.mocked(getRouteProxyStatus).mockResolvedValue({ running: true, route_access_enabled: true, bind_host: "127.0.0.1", port: 29527, base_url: "http://127.0.0.1:29527" });
  vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(0));
});
afterEach(() => vi.useRealTimers());

describe("TrafficScreen", () => {
  it("shows the complete account pool in an overflow dialog without growing the twelve-row board", async () => {
    vi.mocked(listRouteProxyAccountSummaries).mockResolvedValue(Array.from({ length: 14 }, (_, i) => ({
      id: `account-${i}`, platform: "codex", display_name: `Account ${i}`, kind: "api", status: "ok",
      route_priority: i, max_concurrency: 4, active_request_count: 0,
    })));
    vi.mocked(getRouteProxyPoolMemberIds).mockResolvedValue(Array.from({ length: 14 }, (_, i) => `account-${i}`));
    const { container } = mount();
    const more = await screen.findByRole("button", { name: "View all 14 accounts" });
    expect(screen.getAllByTestId("traffic-account")).toHaveLength(12);
    expect(container.querySelector(".traffic-network")?.getAttribute("style") ?? "").not.toMatch(/height:/);
    fireEvent.click(more);
    const dialog = screen.getByRole("dialog", { name: "Account pool" });
    expect(within(dialog).getByRole("button", { name: "Account 13" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Account 13" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("traffic-account")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Account 13" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports extra busy accounts without losing total attempts or inventing hidden edges", async () => {
    vi.mocked(listRouteProxyAccountSummaries).mockResolvedValue(Array.from({ length: 14 }, (_, i) => ({
      id: `account-${i}`, platform: "codex", display_name: `Account ${i}`, kind: "api", status: "ok",
      route_priority: i, max_concurrency: 4, active_request_count: 0,
    })));
    vi.mocked(getRouteProxyPoolMemberIds).mockResolvedValue(Array.from({ length: 14 }, (_, i) => `account-${i}`));
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(14, Array.from({ length: 14 }, (_, i) => ({
      ...attempt, request_id: `request-${i}`, attempt_id: `attempt-${i}`, credential_id: `account-${i}`, credential_name: `Account ${i}`,
    }))));
    const { container } = mount();
    await screen.findByText("2 active off-screen");
    expect(screen.getAllByTestId("traffic-account")).toHaveLength(12);
    const hub = screen.getByRole("heading", { name: "AI Switch" }).parentElement!;
    expect(within(hub).getByText("in flight").parentElement).toHaveTextContent("14");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Account 13" })).not.toBeInTheDocument());
    expect(container.querySelector("[data-active-pair='zcode:account-13']")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View all 14 accounts" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Account 13" }));
    expect(container.querySelector("[data-active-pair='zcode:account-13']")).toBeInTheDocument();
  });

  it("highlights a selected client relationship and clears emphasis with Escape", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(2, [attempt, {
      ...attempt, request_id: "workbuddy-request", attempt_id: "workbuddy-attempt", client_key: "workbuddy", credential_id: "account-7", credential_name: "Account 7",
    }]));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("[data-active-pair='workbuddy:account-7']")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "ZCode" }));
    expect(container.querySelector("[data-active-pair='workbuddy:account-7']")).toHaveClass("traffic-flow-muted");
    expect(container.querySelector("[data-active-pair='zcode:account-6']")).not.toHaveClass("traffic-flow-muted");
    fireEvent.keyDown(screen.getByRole("button", { name: "ZCode" }), { key: "Escape" });
    expect(container.querySelectorAll(".traffic-flow-muted")).toHaveLength(0);
  });

  it("moves the legacy-key explanation into an accessible help dialog", async () => {
    mount();
    await screen.findByText("WorkBuddy");
    expect(screen.queryByText(/Rewrite a client's config once/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Routing help" }));
    expect(within(screen.getByRole("dialog", { name: "Routing help" })).getByText(/Rewrite a client's config once/)).toBeInTheDocument();
  });

  it("shows twelve accounts when the pool has enough members", async () => {
    vi.mocked(listRouteProxyAccountSummaries).mockResolvedValue(Array.from({ length: 14 }, (_, i) => ({
      id: `account-${i}`, platform: "codex", display_name: `Account ${i}`, kind: "api", status: "ok",
      route_priority: i, max_concurrency: 4, active_request_count: 0,
    })));
    vi.mocked(getRouteProxyPoolMemberIds).mockResolvedValue(Array.from({ length: 14 }, (_, i) => `account-${i}`));
    const { container } = mount();
    await waitFor(() => expect(screen.getAllByTestId("traffic-account")).toHaveLength(12));
    expect(screen.getByText("Account 11")).toBeInTheDocument();
    expect(screen.queryByText("Account 12")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-link-state='idle']")).toHaveLength(15);
  });

  it("shows counts in the topology without statistics cards above it", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(1, [attempt]));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("[data-active-pair='zcode:account-6']")).toBeInTheDocument());
    const hub = screen.getByRole("heading", { name: "AI Switch" }).parentElement!;
    expect(within(hub).getByText("in flight").parentElement).toHaveTextContent("1");
    expect(within(hub).getByText("Online")).toBeInTheDocument();
    expect(screen.queryByText("Active requests")).not.toBeInTheDocument();
    expect(screen.queryByText("Upstream attempts in flight")).not.toBeInTheDocument();
    expect(screen.queryByText("Clients currently making requests")).not.toBeInTheDocument();
    expect(screen.queryByText("Accounts serving requests")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Simulate traffic" }));
    expect(screen.getByRole("status")).toHaveTextContent("Simulation mode");
    expect(screen.queryByText("Simulated requests")).not.toBeInTheDocument();
    expect(within(hub).getByText("Simulation mode").parentElement).toHaveTextContent("6");
    expect(within(hub).getByText("Online")).toBeInTheDocument();
  });

  it("simulates traffic locally while the gateway is stopped and restores idle routes on stop", async () => {
    vi.mocked(getRouteProxyStatus).mockResolvedValue({ running: false, route_access_enabled: false, bind_host: "127.0.0.1" });
    const { container } = mount();
    await screen.findByText("WorkBuddy");
    expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Simulate traffic" }));
    expect(screen.getByRole("button", { name: "Stop simulation" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Simulation mode");
    expect(screen.getByRole("status")).toHaveTextContent("No real requests");
    expect(container.querySelectorAll(".traffic-dot").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-active-pair='zcode:account-0']")).toBeInTheDocument();
    expect(screen.getAllByTestId("traffic-account")).toHaveLength(12);

    fireEvent.click(screen.getByRole("button", { name: "Stop simulation" }));
    expect(screen.getByRole("button", { name: "Simulate traffic" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0);
    expect(container.querySelectorAll("[data-link-state='idle']")).toHaveLength(11);
  });

  it("keeps live requests separate during simulation and returns to the latest real activity", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(1, [attempt]));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("[data-active-pair='zcode:account-6']")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Simulate traffic" }));
    expect(container.querySelector("[data-active-pair='zcode:account-6']")).not.toBeInTheDocument();
    const incoming = { ...attempt, request_id: "new-live-request", attempt_id: "new-live-attempt", client_key: "workbuddy", credential_id: "account-7", credential_name: "Account 7" };
    act(() => onEvent?.({ epoch: "test-runtime", sequence: 2, action: "started", attempt: incoming }));
    expect(container.querySelector("[data-active-pair='workbuddy:account-7']")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop simulation" }));
    expect(container.querySelector("[data-active-pair='zcode:account-6']")).toBeInTheDocument();
    expect(container.querySelector("[data-active-pair='workbuddy:account-7']")).toBeInTheDocument();
    expect(container.querySelector("[data-active-pair='zcode:account-0']")).not.toBeInTheDocument();
  });

  it("changes simulated routes over time and releases its timer when stopped", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { container } = mount();
    await screen.findByText("WorkBuddy");
    const idleTimers = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", { name: "Simulate traffic" }));
    expect(container.querySelector("[data-active-pair='zcode:account-0']")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(container.querySelector("[data-active-pair='zcode:account-1']")).toBeInTheDocument();
    expect(container.querySelector("[data-active-pair='zcode:account-0']")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop simulation" }));
    expect(vi.getTimerCount()).toBe(idleTimers);
    await act(async () => { await vi.advanceTimersByTimeAsync(3600); });
    expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0);
  });

  it("can demonstrate routes without a native host or configured accounts and does not persist simulation", async () => {
    vi.mocked(listPlatformCapabilities).mockRejectedValue(new Error("Native host unavailable"));
    vi.mocked(getRouteProxyActiveAttempts).mockRejectedValue(new Error("Native host unavailable"));
    vi.mocked(getRouteProxyStatus).mockResolvedValue({ running: false, bind_host: "127.0.0.1" });
    const first = mount();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Simulate traffic" }));
    expect(screen.getByRole("status")).toHaveTextContent("Simulation mode");
    expect(screen.getAllByTestId("traffic-account")).toHaveLength(12);
    expect(screen.getByText("Demo account 1")).toBeInTheDocument();
    expect(first.container.querySelectorAll(".traffic-dot").length).toBeGreaterThan(0);
    first.unmount();
    const second = mount();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Simulate traffic" })).toHaveAttribute("aria-pressed", "false");
    expect(second.container.querySelectorAll(".traffic-dot")).toHaveLength(0);
  });

  it("keeps static dashed links with no animation while idle, merges clients, and shows all eight available accounts", async () => {
    const { container } = mount();
    await screen.findByText("WorkBuddy");
    await waitFor(() => expect(screen.getAllByTestId("traffic-account")).toHaveLength(8));
    expect(screen.getAllByTestId("traffic-client")).toHaveLength(3);
    expect(container.querySelectorAll("[data-link-state='idle']")).toHaveLength(11);
    expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Live routing" })).toBeInTheDocument();
  });

  it("lights the real client's path to the active account and removes dots but not baseline links on finish", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(1, [attempt]));
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".traffic-dot").length).toBeGreaterThan(0));
    const accounts = screen.getAllByTestId("traffic-account");
    expect(within(accounts[0]).getByText("Account 6")).toBeInTheDocument();
    expect(container.querySelector("[data-active-pair='zcode:account-6']")).toBeInTheDocument();
    act(() => onEvent?.({ epoch: "test-runtime", sequence: 2, action: "finished", attempt }));
    await waitFor(() => expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0));
    expect(container.querySelectorAll("[data-link-state='idle']")).toHaveLength(11);
  });

  it("reconciles events that arrive while the initial snapshot is loading", async () => {
    let resolve!: (snapshot: ActiveProxyAttemptSnapshot) => void;
    vi.mocked(getRouteProxyActiveAttempts).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { container } = mount();
    await waitFor(() => expect(onEvent).toBeDefined());
    act(() => onEvent?.({ epoch: "test-runtime", sequence: 2, action: "started", attempt }));
    await act(async () => resolve(snap(1)));
    await waitFor(() => expect(container.querySelector("[data-active-pair='zcode:account-6']")).toBeInTheDocument());
  });

  it("resynchronizes on a sequence gap and handles a runtime restart", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValueOnce(snap(1, [attempt]));
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".traffic-dot").length).toBeGreaterThan(0));
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(5));
    act(() => onEvent?.({ epoch: "test-runtime", sequence: 5, action: "finished", attempt }));
    await waitFor(() => expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0));
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue({ epoch: "new-runtime", sequence: 0, active: [] });
    act(() => onEvent?.({ epoch: "new-runtime", sequence: 1, action: "finished", attempt }));
    await waitFor(() => expect(getRouteProxyActiveAttempts).toHaveBeenCalledTimes(3));
  });

  it("repairs a dropped final finish event at the low-frequency snapshot check", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValueOnce(snap(1, [attempt]));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".traffic-dot").length).toBeGreaterThan(0));
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0);
    expect(container.querySelectorAll("[data-link-state='idle']")).toHaveLength(11);
  });

  it("backs off snapshot retries instead of looping when the host returns a stale sequence", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(1));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    mount();
    await screen.findByText("WorkBuddy");
    await waitFor(() => expect(getRouteProxyActiveAttempts).toHaveBeenCalledOnce());
    act(() => onEvent?.({ epoch: "test-runtime", sequence: 5, action: "started", attempt }));
    // One immediate repair attempt is enough until the next scheduled check.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getRouteProxyActiveAttempts).toHaveBeenCalledTimes(2);
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(5, [attempt]));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(getRouteProxyActiveAttempts).toHaveBeenCalledTimes(3);
  });

  it("accepts the latest authoritative snapshot after two rapid runtime restarts", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValueOnce(snap(1, [attempt]));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".traffic-dot").length).toBeGreaterThan(0));
    // Event B can arrive just before the host restarts again as C. No C request
    // needs to occur: its authoritative empty snapshot must retire A's activity.
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue({ epoch: "runtime-c", sequence: 0, active: [] });
    act(() => onEvent?.({ epoch: "runtime-b", sequence: 1, action: "started", attempt: { ...attempt, attempt_id: "b-attempt" } }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0);
    expect(container.querySelectorAll("[data-link-state='idle']")).toHaveLength(11);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts current authoritative snapshots after a delayed intermediate-epoch event", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValueOnce(snap(1, [attempt]));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".traffic-dot").length).toBeGreaterThan(0));
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue({ epoch: "runtime-c", sequence: 0, active: [] });
    act(() => onEvent?.({ epoch: "runtime-b", sequence: 1, action: "started", attempt }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelectorAll(".traffic-dot")).toHaveLength(0);
    // A delayed B event cannot permanently pin the next reconciliation to B.
    act(() => onEvent?.({ epoch: "runtime-b", sequence: 2, action: "finished", attempt }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue({ epoch: "runtime-c", sequence: 1, active: [attempt] });
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(container.querySelector("[data-active-pair='zcode:account-6']")).toBeInTheDocument();
  });

  it("clears selection when an active non-pool account disappears rather than reselecting it later", async () => {
    vi.mocked(listRouteProxyAccountSummaries).mockResolvedValue([{
      id: "outside-account", platform: "codex", display_name: "External account", kind: "api", status: "ok",
      route_priority: 7, max_concurrency: 5, active_request_count: 0,
    }]);
    vi.mocked(getRouteProxyPoolMemberIds).mockResolvedValue([]);
    const external = { ...attempt, credential_id: "outside-account", credential_name: "External account" };
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(1, [external]));
    mount();
    const account = await screen.findByRole("button", { name: "External account" });
    fireEvent.click(account);
    expect(account).toHaveAttribute("aria-pressed", "true");
    act(() => onEvent?.({ epoch: "test-runtime", sequence: 2, action: "finished", attempt: external }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "External account" })).not.toBeInTheDocument());
    act(() => onEvent?.({ epoch: "test-runtime", sequence: 3, action: "started", attempt: { ...external, request_id: "next-request", attempt_id: "next-attempt" } }));
    expect(await screen.findByRole("button", { name: "External account" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Selected: External account")).not.toBeInTheDocument();
  });

  it("preserves known account metadata for active requests outside the current pool", async () => {
    vi.mocked(listRouteProxyAccountSummaries).mockResolvedValue([{
      id: "outside-account", platform: "codex", display_name: "Known external account", kind: "official",
      status: "warning", route_priority: 7, max_concurrency: 13, active_request_count: 1,
    }]);
    vi.mocked(getRouteProxyPoolMemberIds).mockResolvedValue([]);
    vi.mocked(getRouteProxyActiveAttempts).mockResolvedValue(snap(1, [{
      ...attempt, credential_id: "outside-account", credential_name: "Known external account",
    }]));
    mount();
    const account = await screen.findByTestId("traffic-account");
    await waitFor(() => expect(account).toHaveAttribute("title", expect.stringContaining("P7")));
    expect(account).toHaveTextContent("/ 13");
  });

  it("refreshes changed pool membership on a quick return instead of retaining a fresh cache", async () => {
    const query = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } });
    vi.mocked(getRouteProxyPoolMemberIds).mockResolvedValue(["account-0", "account-1"]);
    const first = mount(query);
    await screen.findByText("Account 0");
    first.unmount();
    vi.mocked(getRouteProxyPoolMemberIds).mockResolvedValue(["account-6", "account-7"]);
    mount(query);
    await waitFor(() => expect(screen.queryByText("Account 0")).not.toBeInTheDocument());
    expect(screen.getByText("Account 6")).toBeInTheDocument();
    expect(screen.getByText("Account 7")).toBeInTheDocument();
  });

  it("releases a subscription that finishes attaching after unmount", async () => {
    let resolve!: (release: typeof unsubscribe) => void;
    subscribe.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const view = mount();
    view.unmount();
    await act(async () => resolve(unsubscribe));
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("shows a recoverable error instead of claiming zero activity when snapshots fail", async () => {
    vi.mocked(getRouteProxyActiveAttempts).mockRejectedValue(new Error("Native host unavailable"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Native host unavailable");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });
});
