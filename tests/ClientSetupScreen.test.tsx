import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientSetupScreen } from "../src/screens/ClientSetupScreen";
import { createQueryClient } from "../src/lib/query/queryClient";
import type {
  ClaudeSlotPlan,
  ConfigWriteClientStatus,
  ConfigWriteOutcome,
  PlatformCapability,
  PlatformId,
  RoutePoolState,
} from "../src/lib/api/types";

vi.mock("../src/lib/api/client", () => ({
  getClaudeSlotPlan: vi.fn(),
  getClientDirectModes: vi.fn(),
  getRoutePool: vi.fn(),
  getRouteProxyKey: vi.fn(),
  getRouteProxyStatus: vi.fn(),
  getSettings: vi.fn(),
  listConfigWriteClients: vi.fn(),
  listPlatformCapabilities: vi.fn(),
  listRouteCredentials: vi.fn(),
  routeConfigWriteIsStale: vi.fn(),
  saveSettings: vi.fn(),
  setRoutePoolModelMode: vi.fn(),
  writeRouteProxyConfigs: vi.fn(),
}));

vi.mock("../src/lib/transport", () => ({
  getTransport: () => ({ subscribe: vi.fn() }),
  isDesktop: vi.fn(() => true),
  isTauriRuntime: () => false,
}));

import {
  getClaudeSlotPlan,
  getClientDirectModes,
  getRoutePool,
  getRouteProxyKey,
  getRouteProxyStatus,
  getSettings,
  listConfigWriteClients,
  listPlatformCapabilities,
  listRouteCredentials,
  routeConfigWriteIsStale,
  saveSettings,
  setRoutePoolModelMode,
  writeRouteProxyConfigs,
} from "../src/lib/api/client";
import { settingsFixture } from "../src/test/fixtures";

/** Call after `userEvent.setup()`: it installs a clipboard stub of its own. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

const codexClients: ConfigWriteClientStatus[] = [
  {
    client_key: "codex",
    display_name: "Codex CLI",
    native: true,
    restart_required: false,
    target_key: "codex",
    platform: "codex",
    config_path: "/home/u/.codex/config.toml",
    file_status: "managed",
    error_code: null,
  },
  {
    client_key: "zcode",
    display_name: "ZCode",
    native: false,
    restart_required: true,
    target_key: "zcode_codex",
    platform: "codex",
    config_path: "/home/u/.zcode/v2/config.json",
    file_status: "unmanaged",
    error_code: null,
  },
];

const claudeClients: ConfigWriteClientStatus[] = [
  {
    client_key: "claude_code",
    display_name: "Claude Code",
    native: true,
    restart_required: false,
    target_key: "claude_code",
    platform: "claude",
    config_path: "/home/u/.claude/settings.json",
    file_status: "managed",
    error_code: null,
  },
];

const slotPlan: ClaudeSlotPlan = {
  slots: [
    { alias: "claude-sonnet-alias", model_env_key: "ANTHROPIC_DEFAULT_SONNET_MODEL", model: "claude-sonnet-alias[1M]", display_name: "Sonnet" },
    { alias: "claude-opus-alias", model_env_key: "ANTHROPIC_DEFAULT_OPUS_MODEL", model: null, display_name: null },
    { alias: "claude-fable-alias", model_env_key: "ANTHROPIC_DEFAULT_FABLE_MODEL", model: null, display_name: null },
    { alias: "claude-haiku-alias", model_env_key: "ANTHROPIC_DEFAULT_HAIKU_MODEL", model: null, display_name: null },
  ],
  subagent_model: "claude-subagent",
  fallback_model: null,
  model_mode: "precise",
  available_models: ["AcctA/claude-sonnet-alias", "AcctA/claude-haiku-alias"],
};

function capabilityOf(platform: PlatformId, display_name: string): PlatformCapability {
  const rule = (availability: "supported" | "unavailable"): PlatformCapability["operations"]["config_write"] => ({
    availability,
    reason_code: null,
    credential_kinds: [],
    requires_base_url: false,
    requires_api_dialect: false,
  });
  return {
    platform,
    display_name,
    support_level: "supported",
    operations: {
      route_credentials: rule("supported"),
      generic_api_routing: rule("supported"),
      config_write: rule("supported"),
      official_import: rule("supported"),
      official_account_routing: rule("supported"),
      deeplink_import: rule("supported"),
      official_quota: rule("supported"),
      model_test: rule("supported"),
      terminal_launch: rule("supported"),
      session_resume: rule("supported"),
    },
  };
}

const writeOutcomes: ConfigWriteOutcome[] = [
  {
    operation_id: "op-1",
    snapshot_id: "snap-1",
    target_key: "zcode_codex",
    platform: "codex",
    path: "/home/u/.zcode/v2/config.json",
    status: "succeeded",
    before_hash: "aa",
    after_hash: "bb",
    error_code: null,
  },
];

function setup(
  overrides: {
    focus?: { platform?: string | null; clientKey?: string | null } | null;
    onOpenAccounts?: (provider: string) => void;
    onFocusConsumed?: () => void;
  } = {},
) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ClientSetupScreen
        focus={overrides.focus ?? null}
        onOpenAccounts={overrides.onOpenAccounts}
        onFocusConsumed={overrides.onFocusConsumed}
      />
    </QueryClientProvider>,
  );
}

describe("ClientSetupScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRouteProxyStatus).mockResolvedValue({
      running: true,
      route_access_enabled: true,
      bind_host: "127.0.0.1",
      port: 43111,
      base_url: "http://127.0.0.1:43111",
      https_port: null,
      https_base_url: null,
      https_error: null,
      shared_listener: true,
    });
    vi.mocked(getRouteProxyKey).mockResolvedValue("sk-ai-switch-codex-key");
    vi.mocked(listConfigWriteClients).mockImplementation(async (platform: string) =>
      platform === "claude" ? claudeClients : codexClients,
    );
    vi.mocked(getSettings).mockResolvedValue(settingsFixture);
    vi.mocked(saveSettings).mockImplementation(async (settings) => settings);
    vi.mocked(getRoutePool).mockResolvedValue({ model_mode: "precise" } as RoutePoolState);
    vi.mocked(getClientDirectModes).mockResolvedValue([]);
    vi.mocked(listRouteCredentials).mockResolvedValue([]);
    vi.mocked(routeConfigWriteIsStale).mockResolvedValue(false);
    vi.mocked(writeRouteProxyConfigs).mockResolvedValue([]);
    vi.mocked(getClaudeSlotPlan).mockResolvedValue(slotPlan);
    vi.mocked(listPlatformCapabilities).mockResolvedValue([
      capabilityOf("codex", "Codex"),
      capabilityOf("claude", "Claude"),
      capabilityOf("gemini", "Gemini"),
      capabilityOf("grok", "Grok"),
    ]);
  });

  it("lists every client as a card with its file status and path", async () => {
    setup();

    expect(await screen.findByRole("checkbox", { name: "写入 Codex CLI" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "写入 ZCode" })).toBeInTheDocument();
    // Claude Code joins the former Codex list on the same page.
    expect(screen.getByRole("checkbox", { name: "写入 Claude Code" })).toBeInTheDocument();
    // Both first-party CLIs are "managed" in this fixture; third-party is not.
    expect(screen.getAllByText("已接管").length).toBeGreaterThan(0);
    expect(screen.getByText("未接管")).toBeInTheDocument();
    expect(screen.getByTitle("/home/u/.zcode/v2/config.json")).toBeInTheDocument();
    // Every card names the wire format the gateway writes for it.
    expect(screen.getByLabelText("接口格式 Responses")).toBeInTheDocument();
    expect(screen.getByLabelText("接口格式 Chat")).toBeInTheDocument();
    expect(screen.getByLabelText("接口格式 Messages")).toBeInTheDocument();
  });

  it("checks only the primary CLI by default and leaves Claude Code opt-in", async () => {
    setup();

    expect(await screen.findByRole("checkbox", { name: "写入 Codex CLI" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "写入 ZCode" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "写入 Claude Code" })).not.toBeChecked();
  });

  it("restores a stored selection", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...settingsFixture,
      config_write_clients_json: JSON.stringify({ codex: ["zcode"] }),
    });
    setup();

    expect(await screen.findByRole("checkbox", { name: "写入 Codex CLI" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "写入 ZCode" })).toBeChecked();
  });

  it("submits the checked client keys for the active platform", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 ZCode" }));
    await user.click(screen.getByRole("button", { name: "写入" }));

    await waitFor(() =>
      expect(writeRouteProxyConfigs).toHaveBeenCalledWith(
        "http://127.0.0.1:43111",
        "codex",
        ["codex", "zcode"],
      ),
    );
  });

  it("shows the write outcome panel and repeats the restart requirement", async () => {
    const user = userEvent.setup();
    vi.mocked(writeRouteProxyConfigs).mockResolvedValue(writeOutcomes);
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 ZCode" }));
    await user.click(screen.getByRole("button", { name: "写入" }));

    expect(await screen.findByText("配置写入结果")).toBeInTheDocument();
    expect(screen.getByText(/ZCode · codex/)).toBeInTheDocument();
    expect(screen.getAllByText(/写入后需重启 ZCode/).length).toBeGreaterThan(0);
  });

  it("marks direct-mode clients and scopes the restore warning to the checked ones", async () => {
    const user = userEvent.setup();
    vi.mocked(getClientDirectModes).mockResolvedValue([
      {
        platform: "codex",
        client_key: "codex",
        credential_id: "cred-1",
        credential_kind: "official",
        status: "active",
        updated_at: "2026-11-06T00:00:00Z",
        restart_required: false,
      },
    ]);
    setup();

    expect(await screen.findByText("直连中")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Codex CLI");

    await user.click(screen.getByRole("checkbox", { name: "写入 Codex CLI" }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows the restart notice only while a restart-required client is checked", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    expect(screen.queryByText(/写入后需重启 ZCode/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "写入 ZCode" }));
    expect(screen.getByText(/写入后需重启 ZCode/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "写入 ZCode" }));
    expect(screen.queryByText(/写入后需重启 ZCode/)).not.toBeInTheDocument();
  });

  it("saves a custom DeepSeek Harness config path before the write", async () => {
    const user = userEvent.setup();
    vi.mocked(listConfigWriteClients).mockImplementation(async (platform: string) =>
      platform === "claude"
        ? claudeClients
        : [
            {
              client_key: "deepseek_harness",
              display_name: "DeepSeek Harness",
              native: false,
              restart_required: true,
              target_key: "deepseek_harness_codex",
              platform: "codex",
              config_path: "/home/u/.dsh/settings.yaml",
              file_status: "missing",
              error_code: null,
            },
          ],
    );
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 DeepSeek Harness" }));
    await user.type(screen.getByLabelText("DSH 配置文件路径"), "D:\\Portable\\settings.yaml");
    await user.click(screen.getByRole("button", { name: "写入" }));

    await waitFor(() =>
      expect(writeRouteProxyConfigs).toHaveBeenCalledWith(
        "http://127.0.0.1:43111",
        "codex",
        ["deepseek_harness"],
      ),
    );
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ deepseek_harness_config_path: "D:\\Portable\\settings.yaml" }),
    );
    expect(vi.mocked(saveSettings).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeRouteProxyConfigs).mock.invocationCallOrder[0],
    );
  });

  it("refuses to submit with nothing checked", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 ZCode" }));
    await user.click(screen.getByRole("checkbox", { name: "写入 Codex CLI" }));
    await user.click(screen.getByRole("checkbox", { name: "写入 ZCode" }));
    expect(screen.getByRole("button", { name: "写入" })).toBeDisabled();
    expect(writeRouteProxyConfigs).not.toHaveBeenCalled();
  });

  it("disables the write and explains why when the platform cannot write config", async () => {
    const user = userEvent.setup();
    const disabled = capabilityOf("codex", "Codex");
    vi.mocked(listPlatformCapabilities).mockResolvedValue([
      {
        ...disabled,
        operations: {
          ...disabled.operations,
          config_write: {
            availability: "unavailable",
            reason_code: "capability.config_write_unavailable",
            credential_kinds: [],
            requires_base_url: false,
            requires_api_dialect: false,
          },
        },
      },
      capabilityOf("claude", "Claude"),
      capabilityOf("gemini", "Gemini"),
      capabilityOf("grok", "Grok"),
    ]);
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    expect(screen.getByRole("alert")).toHaveTextContent("该接入方式暂不支持此功能。");
    expect(screen.getByRole("button", { name: "写入" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "写入 Codex CLI" }));
    expect(screen.getByRole("checkbox", { name: "写入 Codex CLI" })).toBeDisabled();
  });

  it("keeps the endpoint parameters one disclosure away and copies them", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    // Codex reads the base URL as-is and appends /responses, so the endpoint the
    // user copies has to carry /v1 exactly like the written config does.
    const manual = screen.getByText("手动配置参数（内置支持之外的 Agent）").closest("details");
    expect(manual).not.toHaveAttribute("open");
    await user.click(screen.getByText("手动配置参数（内置支持之外的 Agent）"));
    expect(manual).toHaveAttribute("open");

    expect(screen.getByLabelText("Base URL")).toHaveValue("http://127.0.0.1:43111/v1");
    await user.click(screen.getByLabelText("复制 Base URL"));
    expect(writeText).toHaveBeenLastCalledWith("http://127.0.0.1:43111/v1");

    await user.click(screen.getByLabelText("复制 API Key"));
    expect(writeText).toHaveBeenLastCalledWith("sk-ai-switch-codex-key");
  });

  it("keeps the key masked until revealed, and names the client family it belongs to", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByText("手动配置参数（内置支持之外的 Agent）"));

    expect(screen.getByText(/主接入 Key（Codex \/ Chat 协议族）/)).toBeInTheDocument();
    expect(screen.getByText(/Anthropic Messages 客户端使用另一把 Key/)).toBeInTheDocument();
    const key = screen.getByLabelText("API Key");
    expect(key).toHaveAttribute("type", "password");
    await user.click(screen.getByLabelText("显示 API Key"));
    expect(key).toHaveAttribute("type", "text");
    await user.click(screen.getByLabelText("隐藏 API Key"));
    expect(key).toHaveAttribute("type", "password");
  });

  it("renders one unified agent list instead of platform tabs", async () => {
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("智能体接入目标")).toBeInTheDocument();
    expect(screen.getByText(/账号池始终只有同一个/)).toBeInTheDocument();
    // Both halves of the old, wrong copy must be gone with the tabs.
    expect(screen.queryByText(/每个平台的算力池/)).not.toBeInTheDocument();
    expect(screen.queryByText(/切换平台后要各自复制/)).not.toBeInTheDocument();
  });

  it("shows the Codex /v1 endpoint and the Claude Code card in the same list", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    expect(screen.getByRole("checkbox", { name: "写入 Claude Code" })).toBeInTheDocument();
    await user.click(screen.getByText("手动配置参数（内置支持之外的 Agent）"));
    expect(screen.getByLabelText("Base URL")).toHaveValue("http://127.0.0.1:43111/v1");
  });

  it("writes Messages clients through the Claude adapters in the same action", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByRole("checkbox", { name: "写入 Claude Code" }));
    await user.click(screen.getByRole("button", { name: "写入" }));

    await waitFor(() => expect(writeRouteProxyConfigs).toHaveBeenCalledTimes(2));
    expect(writeRouteProxyConfigs).toHaveBeenCalledWith("http://127.0.0.1:43111", "codex", [
      "codex",
    ]);
    expect(writeRouteProxyConfigs).toHaveBeenCalledWith("http://127.0.0.1:43111", "claude", [
      "claude_code",
    ]);
  });

  it("opens the Claude Code slot dialog and links to the account mappings", async () => {
    const user = userEvent.setup();
    const onOpenAccounts = vi.fn();
    setup({ onOpenAccounts });

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByRole("button", { name: "设置 Claude Code 槽位映射" }));

    const dialog = await screen.findByRole("dialog", {
      name: "设置 Claude Code 模型槽位映射",
    });
    expect(dialog).toHaveTextContent("路由模式");
    expect(dialog).toHaveTextContent("Sonnet");
    expect(dialog).toHaveTextContent("Subagent");
    expect(dialog).toHaveTextContent("默认兜底模型");
    expect(screen.getByTestId("claude-slot-editor")).toBeInTheDocument();
    expect(screen.getByText(/可选模型 2 个/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "去调整账号映射" }));
    expect(onOpenAccounts).toHaveBeenCalledWith("claude");
  });

  it("saves Claude slot overrides under the active model mode only", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByRole("button", { name: "设置 Claude Code 槽位映射" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("checkbox", { name: "Sonnet 自动解析" }));
    fireEvent.change(screen.getByLabelText("Sonnet 模型"), {
      target: { value: "AcctA/claude-haiku-alias" },
    });
    await user.click(screen.getByRole("button", { name: "保存槽位设置" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    const payload = vi.mocked(saveSettings).mock.calls[0][0];
    const saved = JSON.parse(payload.claude_slot_overrides_json ?? "{}");
    expect(saved.precise.slots["claude-sonnet-alias"].model).toBe("AcctA/claude-haiku-alias");
    expect(saved.aggregate).toBeUndefined();
  });

  it("validates and saves the global client config JSON from the dialog", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByRole("button", { name: "设置 Claude Code 槽位映射" }));
    await screen.findByRole("dialog");

    const editor = screen.getByLabelText("全局客户端配置 JSON");
    fireEvent.change(editor, { target: { value: "not-json" } });
    await user.click(screen.getByRole("button", { name: "保存槽位设置" }));
    expect(screen.getByRole("alert")).toHaveTextContent("不是合法的 JSON。");
    expect(saveSettings).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: "[1,2]" } });
    await user.click(screen.getByRole("button", { name: "保存槽位设置" }));
    expect(screen.getByRole("alert")).toHaveTextContent("需要一个 JSON 对象");
    expect(saveSettings).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: '{"includeCoAuthoredBy": false}' } });
    await user.click(screen.getByRole("button", { name: "保存槽位设置" }));
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          claude_client_config_json: '{"includeCoAuthoredBy": false}',
        }),
      ),
    );
  });

  it("shows the staleness banner when a rewrite is pending", async () => {
    vi.mocked(routeConfigWriteIsStale).mockResolvedValue(true);
    setup();

    expect(await screen.findByRole("status")).toHaveTextContent("配置已变更，需重新写入");
  });

  it("defaults to routing mode, puts it first, and reports a switch to aggregate", async () => {
    const user = userEvent.setup();
    vi.mocked(setRoutePoolModelMode).mockImplementation(async () => ({
      model_mode: "aggregate",
    } as never));
    setup();

    expect(await screen.findByRole("radio", { name: "路由模式" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getAllByRole("radio")[0]).toHaveTextContent("路由模式");
    expect(screen.queryByRole("radio", { name: "精确模式" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "聚合模式" }));
    await waitFor(() =>
      expect(setRoutePoolModelMode).toHaveBeenCalledWith({ platform: "codex", mode: "aggregate" }),
    );
  });

  it("preselects the deep-linked client on the unified list", async () => {
    const onFocusConsumed = vi.fn();
    setup({ focus: { platform: "claude", clientKey: "claude_code" }, onFocusConsumed });

    expect(await screen.findByRole("checkbox", { name: "写入 Claude Code" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "写入 Codex CLI" })).not.toBeChecked();
    await waitFor(() => expect(onFocusConsumed).toHaveBeenCalled());
  });

  it("lists the HTTPS endpoint beside the HTTP one and reads the platform key", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    vi.mocked(getRouteProxyStatus).mockResolvedValue({
      running: true,
      route_access_enabled: true,
      bind_host: "127.0.0.1",
      port: 19527,
      base_url: "http://127.0.0.1:19527",
      https_port: 19528,
      https_base_url: "https://127.0.0.1:19528",
      https_error: null,
      shared_listener: true,
    });
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByText("手动配置参数（内置支持之外的 Agent）"));

    expect(screen.getByLabelText("Base URL")).toHaveValue("http://127.0.0.1:19527/v1");
    expect(screen.getByLabelText("HTTPS Base URL")).toHaveValue("https://127.0.0.1:19528/v1");
    await user.click(screen.getByLabelText("复制 HTTPS Base URL"));
    expect(writeText).toHaveBeenLastCalledWith("https://127.0.0.1:19528/v1");

    // The key is per platform, so the page reads the active tab's own key.
    await waitFor(() => expect(screen.getByLabelText("API Key")).toHaveValue("sk-ai-switch-codex-key"));
    expect(getRouteProxyKey).toHaveBeenCalledWith("codex");
    expect(screen.getByText(/必须信任本地根证书/)).toBeInTheDocument();
  });

  it("hands out the image endpoint when the pool declares image models", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    vi.mocked(listRouteCredentials).mockResolvedValue([
      {
        id: "cred-image-1",
        platform: "codex",
        kind: "api",
        provider: "custom",
        display_name: "Image Account",
        email: null,
        status: "ok",
        sort_order: 0,
        batch_id: null,
        batch_name: null,
        secret_payload_json: "{}",
        config_json: JSON.stringify({
          base_url: "https://api.example.com/v1",
          interface_format: "openai",
          model_mappings: [
            { from: "gpt-5", to: "gpt-5" },
            { from: "gpt-image-1", to: "gpt-image-1", capabilities: ["image.generate"] },
          ],
        }),
        preview_json: "{}",
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
    ] as never);
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByText("手动配置参数（内置支持之外的 Agent）"));

    // codex 的 Base URL 已经带 /v1，所以图片端点接在它后面
    expect(screen.getByLabelText("图片端点")).toHaveValue(
      "http://127.0.0.1:43111/v1/images/generations",
    );
    await user.click(screen.getByLabelText("复制 图片端点"));
    expect(writeText).toHaveBeenLastCalledWith(
      "http://127.0.0.1:43111/v1/images/generations",
    );
    // 声明了 image.generate 的模型名要列出来，否则用户不知道能用哪个。
    expect(screen.getByText(/可用的生图模型/)).toHaveTextContent("gpt-image-1");
  });

  it("keeps the write outcome panel until the user dismisses it", async () => {
    const user = userEvent.setup();
    vi.mocked(writeRouteProxyConfigs).mockResolvedValue(writeOutcomes);
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 ZCode" }));
    await user.click(screen.getByRole("button", { name: "写入" }));
    expect(await screen.findByText("配置写入结果")).toBeInTheDocument();

    await user.click(screen.getByLabelText("关闭配置写入结果"));
    expect(screen.queryByText("配置写入结果")).not.toBeInTheDocument();
  });

  it("labels write results by client name rather than target key", async () => {
    const user = userEvent.setup();
    vi.mocked(writeRouteProxyConfigs).mockResolvedValue([
      {
        operation_id: "operation-1",
        snapshot_id: "snapshot-1",
        target_app_id: "target-zcode",
        target_key: "zcode_codex",
        platform: "codex",
        path: "/home/u/.zcode/v2/config.json",
        status: "succeeded",
        before_hash: null,
        after_hash: "after-hash",
        error_code: null,
      },
    ]);
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 ZCode" }));
    await user.click(screen.getByRole("button", { name: "写入" }));

    expect(await screen.findByText("配置写入结果")).toBeInTheDocument();
    // `zcode_codex` is an internal key and means nothing to the user.
    expect(screen.queryByText(/zcode_codex/)).not.toBeInTheDocument();
    expect(screen.getByText(/ZCode · codex/)).toBeInTheDocument();
    // The user may switch windows right after writing, so repeat the notice here.
    expect(screen.getAllByText(/需重启 ZCode/).length).toBeGreaterThan(0);
    // Same guarantee the outcome panel always made: no credential in it.
    expect(screen.queryByText(/sk-ai-switch/)).not.toBeInTheDocument();
  });

  it("flags a client that failed while another one succeeded", async () => {
    const user = userEvent.setup();
    // The backend resolves a group as long as one client got written, so a
    // partial failure never reaches onError — the banner is the only trace.
    vi.mocked(writeRouteProxyConfigs).mockResolvedValue([
      {
        operation_id: "operation-1",
        snapshot_id: "snapshot-1",
        target_app_id: "target-codex",
        target_key: "codex",
        platform: "codex",
        path: "/home/u/.codex/config.toml",
        status: "succeeded",
        before_hash: null,
        after_hash: "after-hash",
        error_code: null,
      },
      {
        operation_id: "operation-2",
        snapshot_id: null,
        target_app_id: "target-zcode",
        target_key: "zcode_codex",
        platform: "codex",
        path: "/home/u/.zcode/v2/config.json",
        status: "failed",
        before_hash: null,
        after_hash: null,
        error_code: "config.pool_models_empty",
      },
    ]);
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 ZCode" }));
    await user.click(screen.getByRole("button", { name: "写入" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("没有写入成功");
    // Named by client, with the code to look up, not by internal target key.
    expect(alert).toHaveTextContent("ZCode");
    expect(alert).toHaveTextContent("config.pool_models_empty");
  });

  it("explains that a corrupt ZCode config was refused rather than overwritten", async () => {
    const user = userEvent.setup();
    vi.mocked(writeRouteProxyConfigs).mockRejectedValue({
      code: "validation.route_config_existing_invalid",
      message: "Existing CLI configuration is invalid; refusing to overwrite it",
      details: "/home/u/.zcode/v2/config.json (JSON): syntax is invalid",
      recoverable: true,
    });
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 ZCode" }));
    await user.click(screen.getByRole("button", { name: "写入" }));

    // The stakes are specific here: a bad parse makes ZCode fall back and lose
    // every provider, so the message has to say we did not touch the file.
    expect(
      await screen.findByText(/现有配置文件无法解析，已拒绝覆盖以免丢失你的 provider 配置/),
    ).toBeInTheDocument();
  });

  it("surfaces the code a grouped write nested instead of the generic failure", async () => {
    const user = userEvent.setup();
    // A grouped write reports one wrapper code for the whole batch and parks the
    // real reason in `details.cause_code`. Reading only the outer code would show
    // "配置写入失败。" and hide the actionable part.
    vi.mocked(writeRouteProxyConfigs).mockRejectedValue({
      code: "filesystem.route_config_write",
      message: "Could not complete grouped configuration writes",
      details: JSON.stringify({
        operation_id: "operation-1",
        cause_code: "config.codex_login_not_chatgpt",
        targets: [
          {
            target_key: "codex",
            status: "failed",
            error_code: "config.codex_login_not_chatgpt",
          },
        ],
      }),
      recoverable: true,
    });
    setup();

    // Codex CLI 是原生默认勾选，直接写入即可。
    await user.click(await screen.findByRole("button", { name: "写入" }));

    expect(
      await screen.findByText(/当前 Codex 只有 API Key 登录、没有 ChatGPT 登录态/),
    ).toBeInTheDocument();
  });

  it("persists the checked clients so the next write does not re-ask", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole("checkbox", { name: "写入 ZCode" }));
    await user.click(screen.getByRole("button", { name: "写入" }));

    await waitFor(() =>
      expect(vi.mocked(saveSettings)).toHaveBeenCalledWith(
        expect.objectContaining({
          config_write_clients_json: JSON.stringify({
            codex: ["codex", "zcode"],
            claude: [],
          }),
        }),
      ),
    );
  });

  it("clears the global client config when emptied", async () => {
    const user = userEvent.setup();
    vi.mocked(getSettings).mockResolvedValue({
      ...settingsFixture,
      claude_client_config_json: '{"includeCoAuthoredBy":false}',
    });
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByRole("button", { name: "设置 Claude Code 槽位映射" }));
    await screen.findByRole("dialog");

    const editor = screen.getByLabelText("全局客户端配置 JSON");
    expect(editor).toHaveValue('{"includeCoAuthoredBy":false}');
    await user.clear(editor);
    await user.click(screen.getByRole("button", { name: "保存槽位设置" }));

    // null, not "" — the writer treats absent and empty the same, but null is
    // the honest representation of "manage nothing".
    await waitFor(() =>
      expect(vi.mocked(saveSettings)).toHaveBeenCalledWith(
        expect.objectContaining({ claude_client_config_json: null }),
      ),
    );
  });

  it("prefers the deep-link client over the stored selection", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...settingsFixture,
      config_write_clients_json: JSON.stringify({ codex: ["zcode"] }),
    });
    setup({ focus: { platform: "codex", clientKey: "codex" } });

    expect(await screen.findByRole("checkbox", { name: "写入 Codex CLI" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "写入 ZCode" })).not.toBeChecked();
  });

  it("renders a brand monogram for third-party agents instead of a generic icon", async () => {
    setup();

    const zcode = await screen.findByTestId("client-card-zcode");
    expect(zcode.querySelector('[title="ZCode"]')).not.toBeNull();
    // The two first-party CLIs keep their real brand SVG.
    expect(screen.getByTestId("client-card-codex").querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("client-card-claude_code").querySelector("svg")).not.toBeNull();
  });

  it("keeps aggregate-mode slot overrides separate from routing mode", async () => {
    vi.mocked(getClaudeSlotPlan).mockResolvedValue({
      ...slotPlan,
      model_mode: "aggregate",
      available_models: ["claude-sonnet-alias", "claude-haiku-alias"],
    });
    vi.mocked(getSettings).mockResolvedValue({
      ...settingsFixture,
      claude_slot_overrides_json: JSON.stringify({
        precise: { slots: { "claude-sonnet-alias": { model: "AcctA/x" } } },
      }),
    });
    const user = userEvent.setup();
    setup();

    await screen.findByRole("checkbox", { name: "写入 Codex CLI" });
    await user.click(screen.getByRole("button", { name: "设置 Claude Code 槽位映射" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("聚合模式");
    // A precise-mode override must not leak into the aggregate branch.
    expect(screen.getByRole("checkbox", { name: "Sonnet 自动解析" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "保存槽位设置" }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    const saved = JSON.parse(
      vi.mocked(saveSettings).mock.calls[0][0].claude_slot_overrides_json ?? "{}",
    );
    expect(saved.precise.slots["claude-sonnet-alias"].model).toBe("AcctA/x");
    expect(saved.aggregate).toBeDefined();
  });
});
