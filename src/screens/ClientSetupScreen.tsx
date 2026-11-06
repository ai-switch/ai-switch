import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, HelpCircle, Plug } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { EndpointRow } from "../components/accounts/EndpointRow";
import { AgentIcon } from "../components/brand/AgentIcon";
import {
  getClaudeSlotPlan,
  getClientDirectModes,
  getSettings,
  getRoutePool,
  getRouteProxyKey,
  getRouteProxyStatus,
  listConfigWriteClients,
  listRouteCredentials,
  routeConfigWriteIsStale,
  saveSettings,
  setRoutePoolModelMode,
  writeRouteProxyConfigs,
} from "../lib/api/client";
import type {
  AppSettingsView,
  ClaudeSlotPlan,
  ConfigWriteClientStatus,
  ConfigWriteOutcome,
  DirectModeStatus,
  RouteCredential,
  RoutePoolModelMode,
} from "../lib/api/types";
import { claudeRoleForAlias } from "../lib/claude-roles";
import {
  ClientIcon,
  clientSetupPlatformLabels,
  clientSetupPlatformOf,
  clientSetupPlatforms,
  type ClientSetupPlatform,
} from "../lib/clientSetup";
import { poolImageModels as poolImageModelsOf } from "../lib/imageCapability";
import {
  capabilityReason,
  findPlatformCapability,
  operationEnabled,
} from "../lib/platformCapabilities";
import { usePlatformCapabilities } from "../lib/query/platformCapabilities";
import { imageGenerationEndpoint, routeProxyEndpointForPlatform } from "../lib/routeProxyEndpoint";
import { isDesktop } from "../lib/transport";

const fileStatusLabels: Record<string, string> = {
  missing: "未建立",
  managed: "已接管",
  unmanaged: "未接管",
  invalid: "无法解析",
  error: "无法读取",
};

const fileStatusTones: Record<string, string> = {
  managed: "bg-emerald-50 text-emerald-800",
  missing: "bg-stone-100 text-stone-600",
  unmanaged: "bg-amber-50 text-amber-800",
  invalid: "bg-red-50 text-red-700",
  error: "bg-red-50 text-red-700",
};

/** The platform's first-party CLI: what a user who never chose gets today. */
function nativeClientKeys(clients: ConfigWriteClientStatus[]): string[] {
  return clients.filter((client) => client.native).map((client) => client.client_key);
}

/**
 * Chinese copy for config-write failures whose backend message does not convey
 * the consequence. Keyed by error code so the wording stays with the reason.
 */
/**
 * Codes that describe a *single target's* failure inside a grouped write.
 *
 * A grouped write reports one `filesystem.route_config_write` for the whole
 * batch and parks the real reason in `details.cause_code` / `targets[].error_code`,
 * so a message keyed only on the outer code is always the generic fallback.
 */
const configWriteErrorMessages: Record<string, string> = {
  // A failed parse makes a client fall back to its defaults and end up with an
  // empty provider list, so "we did not touch it" is the load-bearing part.
  "validation.route_config_existing_invalid":
    "现有配置文件无法解析，已拒绝覆盖以免丢失你的 provider 配置。请先修复该文件再重试。",
  "config.concurrent_modification":
    "配置文件在写入期间被其他程序修改，未做改动。请重试。",
  "config.pool_models_empty": "算力池中没有可用模型，请先向池中加入账号。",
  "config.client_unavailable": "所选客户端不支持当前平台。",
  // Keeping the Codex login hands authentication to `auth.json`; without a
  // ChatGPT login there is nothing to hand it to and the client would fail every
  // request. The write is refused instead, so say how to fix it.
  "config.codex_login_missing":
    "已开启「保持 Codex 登录态」，但未找到 Codex 登录文件。请先在 Codex 中登录后再写入。",
  "config.codex_login_not_chatgpt":
    "已开启「保持 Codex 登录态」，但当前 Codex 只有 API Key 登录、没有 ChatGPT 登录态。请先执行 codex login 登录，或关闭该开关。",
  "config.codex_login_unreadable":
    "Codex 登录文件无法读取，已拒绝写入以免配置无法鉴权。请检查该文件后重试。",
};

function formatApiError(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  const details = (error as { details?: unknown } | null)?.details;
  const message =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? (error as { message: string }).message
      : "";
  const detailText =
    typeof details === "string" && details.trim() && details !== message ? `（${details}）` : "";
  if (typeof code === "string" && code) return `${fallback}[${code}]${detailText}`;
  return message ? `${message}${detailText}` : fallback;
}

/**
 * Best-effort read of the failure code, including the code a grouped write
 * nested inside its `details` payload.
 */
function configWriteErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const outer = (error as { code?: unknown }).code;
  const code = typeof outer === "string" ? outer : "";
  // A direct code is already the most specific thing we have.
  if (code && configWriteErrorMessages[code]) return code;

  const details = (error as { details?: unknown }).details;
  let parsed: unknown = details;
  if (typeof details === "string") {
    try {
      parsed = JSON.parse(details) as unknown;
    } catch {
      parsed = null;
    }
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { cause_code?: unknown; targets?: unknown };
    if (typeof record.cause_code === "string" && configWriteErrorMessages[record.cause_code]) {
      return record.cause_code;
    }
    if (Array.isArray(record.targets)) {
      for (const target of record.targets) {
        const targetCode =
          target && typeof target === "object"
            ? (target as { error_code?: unknown }).error_code
            : null;
        if (typeof targetCode === "string" && configWriteErrorMessages[targetCode]) {
          return targetCode;
        }
      }
    }
  }
  return code;
}

/** Prefers a code-specific Chinese message over the backend's raw text. */
function formatConfigWriteError(error: unknown): string {
  const code = configWriteErrorCode(error);
  return configWriteErrorMessages[code] ?? formatApiError(error, "配置写入失败。");
}

const modelModeOptions: { mode: RoutePoolModelMode; label: string; hint: string }[] = [
  {
    mode: "aggregate",
    label: "聚合模式",
    hint: "同名模型合并成一条，请求在池内轮换。",
  },
  {
    mode: "precise",
    label: "精确模式",
    hint: "每个 API 账号各出「账号/模型」，请求钉在该账号；官方账号合并为「official/模型」继续轮换。",
  },
];

/**
 * Aggregate versus precise, above the platform tabs because it decides the model
 * list everywhere: what gets written into a client config, and what a client that
 * discovers models over `/v1/models` sees.
 *
 * Saved on toggle rather than on 写入 — it is a pool-level setting, the pool's own
 * model list changes at once, and the 「配置已过期」hint then nudges the user to
 * rewrite the client configs.
 */
function ModelModePicker({
  mode,
  disabled,
  onChange,
}: {
  mode: RoutePoolModelMode;
  disabled: boolean;
  onChange: (mode: RoutePoolModelMode) => void;
}) {
  const active = modelModeOptions.find((option) => option.mode === mode) ?? modelModeOptions[0];

  return (
    <div className="grid gap-2 rounded-xl bg-stone-50 px-3.5 py-3">
      <span className="text-[11px] font-semibold text-stone-600">模型清单</span>
      <div
        aria-label="模型清单模式"
        className="flex w-fit rounded-md bg-white p-1 shadow-inner"
        role="radiogroup"
      >
        {modelModeOptions.map((option) => (
          <button
            key={option.mode}
            aria-checked={mode === option.mode}
            className={`rounded px-3 py-1.5 text-xs font-semibold motion-control focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${
              mode === option.mode ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-950"
            }`}
            disabled={disabled}
            onClick={() => {
              if (mode !== option.mode) {
                onChange(option.mode);
              }
            }}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-5 text-stone-500">{active.hint}</p>
    </div>
  );
}

export type ClientSetupFocus = {
  platform?: string | null;
  clientKey?: string | null;
};

type ClientSetupScreenProps = {
  /** Deep-link target (sidebar / 账号页 / 直连恢复)：预选平台 tab 与客户端。 */
  focus?: ClientSetupFocus | null;
  onFocusConsumed?: () => void;
  /** Claude 槽位面板的「去调整映射」：跳到账号页并按来源筛选。 */
  onOpenAccounts?: (provider: string) => void;
};

export function ClientSetupScreen({
  focus = null,
  onFocusConsumed,
  onOpenAccounts,
}: ClientSetupScreenProps) {
  const queryClient = useQueryClient();
  const desktop = isDesktop();
  const [platform, setPlatform] = useState<ClientSetupPlatform>(() =>
    clientSetupPlatformOf(focus?.platform),
  );
  // 每个平台 tab 各记一份勾选：null 表示用户没碰过，按「内置客户端」默认。
  const [selectionByPlatform, setSelectionByPlatform] = useState<
    Partial<Record<ClientSetupPlatform, string[] | null>>
  >({});
  const [focusClientKey, setFocusClientKey] = useState<string | null>(
    focus?.clientKey ?? null,
  );
  const [deepSeekHarnessPathOverride, setDeepSeekHarnessPathOverride] = useState<string | null>(null);
  const [slotPanelOpen, setSlotPanelOpen] = useState(false);
  const [clientConfigDraft, setClientConfigDraft] = useState("");
  const [clientConfigError, setClientConfigError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ConfigWriteOutcome[]>([]);

  // 深链：外部入口指定平台/客户端时，只应用一次，之后由用户自由切换。
  useEffect(() => {
    if (!focus) return;
    if (focus.platform) {
      setPlatform(clientSetupPlatformOf(focus.platform));
    }
    setFocusClientKey(focus.clientKey ?? null);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus 对象由 App 每次 new，依赖它即可。
  }, [focus]);

  const capabilitiesQuery = usePlatformCapabilities();
  const tabCapability = findPlatformCapability(capabilitiesQuery.data, platform);
  const capabilityReady = capabilitiesQuery.isSuccess && Boolean(tabCapability);
  const configWriteRule = tabCapability?.operations.config_write;
  const configWriteEnabled = capabilityReady && operationEnabled(configWriteRule);
  const configWriteReason = capabilityReason(configWriteRule);
  const capabilityDisabledReason = configWriteEnabled ? null : configWriteReason;

  // Pool-wide client behavior switches. Claude Code reads these from its own
  // settings file, which the whole pool shares, so they cannot be per-account.
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const clientsQuery = useQuery({
    queryKey: ["config-write-clients", platform],
    queryFn: () => listConfigWriteClients(platform),
  });
  const routeProxyQuery = useQuery({
    queryKey: ["route-proxy-status"],
    queryFn: getRouteProxyStatus,
    refetchInterval: 10_000,
  });
  const routeServiceReady =
    Boolean(routeProxyQuery.data?.route_access_enabled) && Boolean(routeProxyQuery.data?.running);
  // 每个平台一把池 key：读即铸造，页面挂载即代表用户有写入意图。
  const routeProxyKeyQuery = useQuery({
    queryKey: ["route-proxy-key", platform],
    queryFn: () => getRouteProxyKey(platform),
    enabled: routeServiceReady,
  });
  const directModesQuery = useQuery({
    queryKey: ["client-direct-modes"],
    queryFn: getClientDirectModes,
    enabled: desktop,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const routePoolQuery = useQuery({
    queryKey: ["route-pool", platform, "active"],
    queryFn: () => getRoutePool(platform),
    placeholderData: keepPreviousData,
  });
  // 生图没有自己的平台：能否出图只能从账号映射里读出来。
  const allCredentialsQuery = useQuery<RouteCredential[]>({
    queryKey: ["route-credentials-all", "codex"],
    queryFn: () => listRouteCredentials("codex"),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const poolImageModels = useMemo(
    () => poolImageModelsOf(allCredentialsQuery.data ?? []),
    [allCredentialsQuery.data],
  );
  const claudeSlotPlanQuery = useQuery({
    queryKey: ["claude-slot-plan"],
    queryFn: getClaudeSlotPlan,
    enabled: platform === "claude",
  });

  const clients = clientsQuery.data ?? [];
  const clientByTargetKey = useMemo(() => {
    const map = new Map<string, ConfigWriteClientStatus>();
    for (const client of clients) {
      map.set(client.target_key, client);
    }
    return map;
  }, [clients]);

  const storedClientSelection = useMemo<string[] | null>(() => {
    const raw = settingsQuery.data?.config_write_clients_json;
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const stored = parsed[platform];
      return Array.isArray(stored) && stored.length > 0 ? stored : null;
    } catch {
      // A corrupt preference must not block writing.
      return null;
    }
  }, [settingsQuery.data?.config_write_clients_json, platform]);

  /** `null` until the user picks, so the tab defaults to the native client. */
  const initialSelection = focusClientKey ? [focusClientKey] : storedClientSelection;
  const selected = selectionByPlatform[platform] ?? initialSelection ?? nativeClientKeys(clients);

  const directClientKeys = useMemo(
    () => (directModesQuery.data ?? []).map((item) => item.client_key),
    [directModesQuery.data],
  );

  // `null` rather than `""` so `EndpointRow` shows its "reading..." placeholder
  // instead of an empty field before the proxy status arrives.
  const httpEndpoint = routeProxyEndpointForPlatform(routeProxyQuery.data?.base_url ?? "", platform) || null;
  const httpsEndpoint = routeProxyEndpointForPlatform(routeProxyQuery.data?.https_base_url ?? "", platform) || null;
  // 只有池里真有账号声明了生图能力、且代理地址已就绪时才给这一行：摊一个调不通的
  // 端点比不摊更糟。
  const imageEndpoint = poolImageModels.length
    ? imageGenerationEndpoint(routeProxyQuery.data?.base_url ?? "", platform)
    : "";
  const restartClients = clients.filter(
    (client) => client.restart_required && selected.includes(client.client_key),
  );
  const directSelectedClients = clients.filter(
    (client) => selected.includes(client.client_key) && directClientKeys.includes(client.client_key),
  );
  const deepSeekHarnessSelected = selected.some((clientKey) => clientKey.startsWith("deepseek_harness"));
  const deepSeekHarnessPath = deepSeekHarnessPathOverride ?? settingsQuery.data?.deepseek_harness_config_path ?? "";

  const toggle = (clientKey: string) => {
    setSelectionByPlatform((current) => {
      const base = current[platform] ?? initialSelection ?? nativeClientKeys(clients);
      const next = base.includes(clientKey)
        ? base.filter((key) => key !== clientKey)
        : [...base, clientKey];
      return { ...current, [platform]: next };
    });
  };

  // The pool's own `/v1/models` changes the moment this is saved, so it is its own
  // mutation rather than a parameter of the write: a user whose clients discover
  // models over HTTP never clicks 写入 at all.
  const setModelModeMutation = useMutation({
    mutationFn: (mode: RoutePoolModelMode) => setRoutePoolModelMode({ platform, mode }),
    onSuccess: (state) => {
      queryClient.setQueryData(["route-pool", platform, "active"], state);
      // The rendered client config now differs from disk, which is exactly what
      // the staleness hint is for.
      void queryClient.invalidateQueries({ queryKey: ["route-config-stale"] });
    },
    onError: (error) => setWriteError(formatApiError(error, "切换模型清单模式失败。")),
  });

  const saveClientConfigMutation = useMutation({
    mutationFn: async (configJson: string | null) => {
      const settings = settingsQuery.data;
      if (!settings) {
        throw new Error("设置尚未加载完成。");
      }
      return saveSettings({ ...settings, claude_client_config_json: configJson });
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings"], settings);
      setClientConfigError(null);
      void queryClient.invalidateQueries({ queryKey: ["route-config-stale"] });
    },
    onError: (error) => setClientConfigError(formatApiError(error, "保存全局配置失败。")),
  });

  const submitClientConfig = () => {
    const trimmed = clientConfigDraft.trim();
    if (!trimmed) {
      setClientConfigError(null);
      saveClientConfigMutation.mutate(null);
      return;
    }
    // Validate here rather than at write time: a malformed value is ignored by
    // the writer, which would look like the setting silently doing nothing.
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      setClientConfigError("不是合法的 JSON。");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setClientConfigError("需要一个 JSON 对象，例如 {\"includeCoAuthoredBy\": false}。");
      return;
    }
    setClientConfigError(null);
    saveClientConfigMutation.mutate(trimmed);
  };

  const writeConfigsMutation = useMutation({
    mutationFn: async ({
      clientKeys,
      deepSeekHarnessConfigPath,
    }: {
      clientKeys: string[];
      deepSeekHarnessConfigPath: string | null;
    }) => {
      if (!configWriteEnabled) {
        throw new Error(configWriteReason);
      }
      let settings = settingsQuery.data;
      if (
        deepSeekHarnessConfigPath !== (settings?.deepseek_harness_config_path ?? null) &&
        (settings || deepSeekHarnessConfigPath !== null)
      ) {
        if (!settings) {
          throw new Error("设置尚未加载，无法保存 DSH 配置路径。");
        }
        const pathUpdated = await saveSettings({
          ...settings,
          deepseek_harness_config_path: deepSeekHarnessConfigPath,
        });
        queryClient.setQueryData(["settings"], pathUpdated);
        settings = pathUpdated;
      }
      const writeOutcomes = await writeRouteProxyConfigs(
        routeProxyQuery.data?.base_url ?? null,
        platform,
        clientKeys,
      );
      // Remember the choice so the next write does not need re-picking, and so
      // the staleness nudge covers exactly the clients that were written.
      if (settings) {
        let existing: Record<string, string[]> = {};
        try {
          existing = settings.config_write_clients_json
            ? (JSON.parse(settings.config_write_clients_json) as Record<string, string[]>)
            : {};
        } catch {
          // A corrupt preference must not block writing.
          existing = {};
        }
        const updated = await saveSettings({
          ...settings,
          config_write_clients_json: JSON.stringify({
            ...existing,
            [platform]: clientKeys,
          }),
        });
        queryClient.setQueryData(["settings"], updated);
      }
      return writeOutcomes;
    },
    onMutate: () => {
      setWriteError(null);
    },
    onSuccess: (writeOutcomes) => {
      setOutcomes(writeOutcomes);
      setFocusClientKey(null);
      // A group resolves as long as one client succeeded, so a partial failure
      // arrives here rather than in `onError`. Without this the only trace is
      // the result panel.
      const failed = writeOutcomes.filter((outcome) => outcome.status !== "succeeded");
      if (failed.length > 0) {
        const names = failed.map((outcome) => {
          const label =
            clientByTargetKey.get(outcome.target_key)?.display_name ?? outcome.target_key;
          return outcome.error_code ? `${label}（${outcome.error_code}）` : label;
        });
        setWriteError(`以下客户端没有写入成功：${names.join("、")}`);
      }
      void queryClient.invalidateQueries({ queryKey: ["client-direct-modes"] });
      void queryClient.invalidateQueries({ queryKey: ["route-config-stale"] });
      void queryClient.invalidateQueries({ queryKey: ["config-write-clients", platform] });
    },
    onError: (error) => {
      setWriteError(formatConfigWriteError(error));
      // 配置可能已写成、但保存勾选偏好失败；模式以文件和后端状态为准。
      void queryClient.invalidateQueries({ queryKey: ["client-direct-modes"] });
    },
  });

  // Config is written on demand, so mapping and client-config edits sit unapplied
  // until the user asks for a write. The backend answers this by rendering through
  // the real adapter and diffing against disk, so the hint cannot drift from what
  // a write would actually produce.
  const configWriteStaleQuery = useQuery({
    queryKey: [
      "route-config-stale",
      platform,
      routeProxyQuery.data?.base_url ?? null,
      allCredentialsQuery.dataUpdatedAt,
      settingsQuery.data?.claude_client_config_json ?? null,
      storedClientSelection,
      routePoolQuery.data?.model_mode ?? null,
    ],
    queryFn: () =>
      routeConfigWriteIsStale(
        routeProxyQuery.data?.base_url ?? null,
        platform,
        storedClientSelection,
      ),
    enabled: routeServiceReady && configWriteEnabled,
    staleTime: 0,
  });
  const configWriteStale = configWriteStaleQuery.data === true;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // An empty write would report success and change nothing.
    if (!configWriteEnabled || writeConfigsMutation.isPending || selected.length === 0) {
      return;
    }
    // Submit in list order so the result panel lists clients predictably.
    const customDeepSeekHarnessPath = deepSeekHarnessPath.trim();
    writeConfigsMutation.mutate({
      clientKeys: clients
        .map((client) => client.client_key)
        .filter((clientKey) => selected.includes(clientKey)),
      deepSeekHarnessConfigPath: customDeepSeekHarnessPath ? customDeepSeekHarnessPath : null,
    });
  };

  const openClaudeSettings = () => {
    setClientConfigDraft(settingsQuery.data?.claude_client_config_json ?? "");
    setClientConfigError(null);
    setSlotPanelOpen(true);
  };

  const slotPlan = claudeSlotPlanQuery.data;
  const slotRows: { label: string; alias: string; model: string | null; display_name: string | null }[] =
    slotPlan
      ? [
          ...slotPlan.slots.map((slot) => ({
            label: claudeRoleForAlias(slot.alias)?.label ?? slot.alias,
            alias: slot.alias,
            model: slot.model,
            display_name: slot.display_name,
          })),
          {
            label: claudeRoleForAlias("claude-subagent")?.label ?? "Subagent",
            alias: "claude-subagent",
            model: slotPlan.subagent_model,
            display_name: null,
          },
          {
            label: claudeRoleForAlias("claude-model")?.label ?? "默认兜底模型",
            alias: "claude-model",
            model: slotPlan.fallback_model,
            display_name: null,
          },
        ]
      : [];

  const writing = writeConfigsMutation.isPending;
  const hasSettingsButton = (client: ConfigWriteClientStatus) =>
    client.client_key === "claude" || client.client_key.startsWith("deepseek_harness");

  const renderClientCard = (client: ConfigWriteClientStatus): ReactNode => {
    const checked = selected.includes(client.client_key);
    const direct = directClientKeys.includes(client.client_key);
    return (
      <li
        className={`rounded-xl border bg-white p-3 ${
          checked ? "border-stone-300 shadow-sm" : "border-stone-200"
        }`}
        data-testid={`client-card-${client.client_key}`}
        key={client.client_key}
      >
        <div className="flex items-start gap-3">
          <input
            aria-label={`写入 ${client.display_name}`}
            checked={checked}
            className="mt-1.5 h-4 w-4 shrink-0 accent-stone-900"
            disabled={Boolean(capabilityDisabledReason) || writing}
            onChange={() => toggle(client.client_key)}
            type="checkbox"
          />
          <ClientIcon clientKey={client.client_key} className="h-8 w-8 shrink-0" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-stone-950">
                {client.display_name}
                {client.client_key === "codex" ? (
                  <span
                    aria-label="Codex CLI、ChatGPT 桌面版、VS Code 扩展、Codeg 等都会读取这个官方路径的配置，通常只需配置这一个。"
                    className="inline-flex"
                    title="Codex CLI、ChatGPT 桌面版、VS Code 扩展、Codeg 等都会读取这个官方路径的配置，通常只需配置这一个。"
                  >
                    <HelpCircle aria-hidden="true" className="h-3.5 w-3.5 text-stone-400" />
                  </span>
                ) : null}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  fileStatusTones[client.file_status] ?? "bg-stone-100 text-stone-600"
                }`}
              >
                {fileStatusLabels[client.file_status] ?? client.file_status}
              </span>
              {client.native ? (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                  内置
                </span>
              ) : null}
              {client.restart_required ? (
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800">
                  需重启
                </span>
              ) : null}
              {direct ? (
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                  直连中
                </span>
              ) : null}
            </div>
            {client.config_path ? (
              <span
                className="truncate font-mono text-[11px] text-stone-500"
                title={client.config_path}
              >
                {client.config_path}
              </span>
            ) : null}
            {client.error_code ? (
              <span className="font-mono text-[11px] text-red-700">{client.error_code}</span>
            ) : null}
          </div>
          {client.client_key === "claude" ? (
            <button
              aria-label="设置 Claude 槽位映射"
              aria-expanded={slotPanelOpen}
              className="shrink-0 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={() => (slotPanelOpen ? setSlotPanelOpen(false) : openClaudeSettings())}
              type="button"
            >
              设置
            </button>
          ) : null}
        </div>
        {client.client_key === "claude" && slotPanelOpen ? renderClaudeSlotPanel() : null}
      </li>
    );
  };

  const renderClaudeSlotPanel = (): ReactNode => (
    <div className="mt-3 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="grid gap-1">
        <p className="text-[11px] font-semibold text-stone-600">模型槽位映射</p>
        <p className="text-[11px] leading-5 text-stone-500">
          槽位从池内 API 账号的模型映射别名自动解析；写入时落到 Claude Code
          settings.json 的对应 env。没有映射的槽位会被清空。
        </p>
      </div>
      {claudeSlotPlanQuery.isLoading ? (
        <p className="text-[11px] text-stone-500">读取中...</p>
      ) : claudeSlotPlanQuery.isError ? (
        <p className="text-[11px] text-red-700" role="alert">
          槽位信息读取失败。
        </p>
      ) : (
        <ul className="grid list-none gap-1" data-testid="claude-slot-plan">
          {slotRows.map((row) => (
            <li
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-white px-2.5 py-1.5 text-[12px]"
              key={row.alias}
            >
              <span className="font-semibold text-stone-950">{row.label}</span>
              <span className="font-mono text-[11px] text-stone-400">{row.alias}</span>
              <span aria-hidden="true" className="text-stone-300">
                →
              </span>
              {row.model ? (
                <span className="font-mono text-[11px] text-stone-800">{row.model}</span>
              ) : (
                <span className="text-[11px] text-stone-400">未映射（写入时清空）</span>
              )}
              {row.display_name ? (
                <span className="text-[11px] text-stone-500">菜单显示「{row.display_name}」</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <button
        className="w-fit rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => onOpenAccounts?.("claude")}
        type="button"
      >
        去调整映射
      </button>
      <label className="grid gap-1.5">
        <span className="text-[11px] font-semibold text-stone-600">
          全局客户端配置（整池共用，写入配置时合并进 settings.json 根级）
        </span>
        <textarea
          aria-label="全局客户端配置 JSON"
          className="min-h-28 rounded-md border border-stone-200 bg-white px-2.5 py-2 font-mono text-[11px] leading-5 text-stone-800 outline-none focus:border-blue-400"
          onChange={(event) => setClientConfigDraft(event.target.value)}
          placeholder='{"includeCoAuthoredBy": false}'
          value={clientConfigDraft}
        />
      </label>
      {clientConfigError ? (
        <p className="text-[11px] text-red-700" role="alert">
          {clientConfigError}
        </p>
      ) : null}
      <button
        className="w-fit rounded-md bg-stone-900 px-2.5 py-1.5 text-[12px] font-semibold text-white motion-control hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!settingsQuery.data || saveClientConfigMutation.isPending}
        onClick={submitClientConfig}
        type="button"
      >
        {saveClientConfigMutation.isPending ? "保存中..." : "保存全局配置"}
      </button>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-stone-900 text-white">
          <Plug aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight tracking-tight text-stone-950">
            客户端接入
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-stone-600">
            把算力池接入常用 Agent：勾选要写入的客户端一键写入；其他工具手动复制端点参数。
          </p>
        </div>
      </header>

      {configWriteStale ? (
        <p
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-950"
          role="status"
        >
          配置已变更，需重新写入才会生效。
        </p>
      ) : null}

      {outcomes.length > 0 ? (
        <div className="mt-4 space-y-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[12px] text-stone-600">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-stone-950">配置写入结果</p>
            <button
              aria-label="关闭配置写入结果"
              className="text-stone-400 motion-control hover:text-stone-700"
              onClick={() => setOutcomes([])}
              type="button"
            >
              ✕
            </button>
          </div>
          {outcomes.map((outcome) => (
            <div
              className="rounded-lg border border-stone-200 bg-white px-2.5 py-2"
              key={`${outcome.operation_id}:${outcome.target_key}:${outcome.snapshot_id ?? "none"}`}
            >
              <p>
                {clientByTargetKey.get(outcome.target_key)?.display_name ?? outcome.target_key} ·{" "}
                {outcome.platform}: {outcome.path || "未解析路径"} ({outcome.status})
              </p>
              <p className="mt-1 font-mono text-[11px] text-stone-500">
                operation {outcome.operation_id} · snapshot {outcome.snapshot_id ?? "none"}
              </p>
              {outcome.error_code ? (
                <p className="mt-1 font-mono text-[11px] text-red-600">{outcome.error_code}</p>
              ) : null}
            </div>
          ))}
          {/* The write page may be left afterwards, so the restart requirement has
              to be repeated right here. */}
          {outcomes.some(
            (outcome) => clientByTargetKey.get(outcome.target_key)?.restart_required,
          ) ? (
            <p className="text-[11px] text-stone-500">
              写入后需重启{" "}
              {Array.from(
                new Set(
                  outcomes
                    .map((outcome) => clientByTargetKey.get(outcome.target_key))
                    .filter((client) => client?.restart_required)
                    .map((client) => client?.display_name ?? ""),
                ),
              ).join("、")}{" "}
              才生效（它不监听配置文件变化）。
            </p>
          ) : null}
        </div>
      ) : null}

      {writeError ? (
        <div
          className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700"
          role="alert"
        >
          <p>{writeError}</p>
          <button
            aria-label="关闭配置写入错误"
            className="text-red-400 motion-control hover:text-red-700"
            onClick={() => setWriteError(null)}
            type="button"
          >
            ✕
          </button>
        </div>
      ) : null}

      <form className="mt-4 grid gap-4" onSubmit={submit}>
        <ModelModePicker
          disabled={writing || setModelModeMutation.isPending}
          mode={routePoolQuery.data?.model_mode ?? "aggregate"}
          onChange={(mode) => setModelModeMutation.mutate(mode)}
        />

        <div
          aria-label="写入平台"
          className="flex w-fit flex-wrap items-center gap-1 rounded-lg bg-stone-100 p-1"
          role="tablist"
        >
          {clientSetupPlatforms.map((item) => {
            const active = platform === item;
            return (
              <button
                aria-selected={active}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold motion-control focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  active ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-950"
                }`}
                key={item}
                onClick={() => setPlatform(item)}
                role="tab"
                type="button"
              >
                <AgentIcon className="h-3.5 w-3.5" platform={item} />
                {clientSetupPlatformLabels[item]}
              </button>
            );
          })}
        </div>

        {capabilityDisabledReason ? (
          <p
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-950"
            role="alert"
          >
            {capabilityDisabledReason}
          </p>
        ) : null}

        {clientsQuery.isLoading ? (
          <p className="text-[12px] text-stone-500">读取客户端列表中...</p>
        ) : clients.length === 0 ? (
          <p className="rounded-xl bg-stone-50 px-3.5 py-3 text-xs leading-5 text-stone-600">
            该平台暂无可写入的客户端。
          </p>
        ) : (
          <ul className="grid list-none gap-2">{clients.map(renderClientCard)}</ul>
        )}

        {deepSeekHarnessSelected ? (
          <label className="grid gap-1.5 rounded-xl bg-stone-50 px-3.5 py-3 text-xs text-stone-700">
            <span className="text-[11px] font-semibold text-stone-600">DSH 配置文件路径</span>
            <input
              aria-label="DSH 配置文件路径"
              className="h-8 rounded-md border border-stone-200 bg-white px-2.5 font-mono text-[11px] text-stone-800 outline-none placeholder:font-sans placeholder:text-stone-400 focus:border-blue-400"
              disabled={Boolean(capabilityDisabledReason) || writing}
              onChange={(event) => setDeepSeekHarnessPathOverride(event.target.value)}
              placeholder={
                selected.includes("deepseek_harness_desktop")
                  ? "留空使用 ~/.dsh/profiles/desktop/cordis.patch.yml"
                  : "留空使用 ~/.dsh/settings.yaml"
              }
              type="text"
              value={deepSeekHarnessPath}
            />
            <span className="text-[11px] leading-5 text-stone-500">
              需要绝对路径；留空时写回 DeepSeek Harness 默认位置。
            </span>
          </label>
        ) : null}

        {directSelectedClients.length > 0 ? (
          <p
            className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-950"
            role="note"
          >
            本次写入成功后将结束{" "}
            {directSelectedClients.map((client) => client.display_name).join("、")}
            {" "}的直连模式，切回算力池；请重启该客户端。未勾选的客户端配置与认证保持不变。
          </p>
        ) : null}
        {restartClients.length > 0 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-950">
            写入后需重启 {restartClients.map((client) => client.display_name).join("、")}{" "}
            才生效（它不监听配置文件变化）。
          </p>
        ) : null}

        <details className="rounded-xl border border-stone-200 bg-white px-3.5 py-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-stone-700">
            手动配置参数（内置支持之外的 Agent）
          </summary>
          <div className="mt-3 grid gap-2.5">
            <p className="text-xs leading-5 text-stone-500">
              把下面的参数手动填进它自己的设置里，一样走当前算力池。
            </p>
            <div className="grid gap-2.5 rounded-md bg-stone-50 px-3.5 py-3">
              <EndpointRow label="Base URL" value={httpEndpoint} />
              {/* HTTPS has its own port and is never written into a config:
                  clients that ship their own CA bundle (curl, Node-based CLIs)
                  cannot see the local root certificate in the system trust store,
                  so an https:// address would simply break them. Rendered only
                  when it exists, so the row never sits empty. */}
              {httpsEndpoint ? <EndpointRow label="HTTPS Base URL" value={httpsEndpoint} /> : null}
              <EndpointRow label="API Key" secret value={routeServiceReady ? routeProxyKeyQuery.data ?? null : null} />
              {/* 生图与文本共用这个池和这张 key，只是路径不同。 */}
              {imageEndpoint ? <EndpointRow label="图片端点" value={imageEndpoint} /> : null}
            </div>
            {imageEndpoint ? (
              <p className="text-[11px] leading-5 text-stone-500">
                图片端点走同一个池、同一张 key。可用的生图模型：
                {poolImageModels.join("、")}。图片编辑（/v1/images/edits）目前只支持
                interface_format 为 openai 的账号。
              </p>
            ) : null}
            <p className="text-[11px] leading-5 text-stone-500">
              {httpsEndpoint
                ? "正常情况用上面的 Base URL（HTTP）即可。HTTPS 端点只给确实需要 TLS 的特殊场景，且客户端必须信任本地根证书。"
                : routeProxyQuery.data?.https_error
                  ? "正常情况用上面的 Base URL（HTTP）即可。HTTPS 端点本次未能启动，原因见设置里的 HTTPS 面板。"
                  : "正常情况用上面的 Base URL（HTTP）即可。需要 TLS 的特殊场景可在设置里开启 HTTPS，它会另占一个端口。"}
            </p>
            <p className="text-[11px] leading-5 text-amber-800">
              {`注意：每个平台的算力池端点 API Key 都不一样。这里给出的是 ${clientSetupPlatformLabels[platform]} 平台的 Key，切换平台后要各自复制。`}
            </p>
          </div>
        </details>

        <div className="flex items-center justify-end gap-2 border-t border-stone-200 pt-3">
          <span className="mr-auto text-[11px] text-stone-500">
            只写入勾选的客户端，其他客户端的配置文件不会被改动。
          </span>
          <button
            className="h-9 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white motion-control hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(capabilityDisabledReason) || writing || selected.length === 0}
            type="submit"
          >
            {writing ? "写入中..." : "写入"}
          </button>
        </div>
      </form>
    </div>
  );
}
