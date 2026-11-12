import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle, Plug } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { EndpointRow } from "../components/accounts/EndpointRow";
import { ClaudeSlotSettingsDialog } from "../components/accounts/ClaudeSlotSettingsDialog";
import {
  getClaudeSlotPlan,
  getClientDirectModes,
  getRoutePool,
  getRouteProxyKey,
  getRouteProxyStatus,
  getSettings,
  listConfigWriteClients,
  listRouteCredentials,
  routeConfigWriteIsStale,
  saveSettings,
  setRoutePoolModelMode,
  writeRouteProxyConfigs,
} from "../lib/api/client";
import type {
  ConfigWriteClientStatus,
  ConfigWriteOutcome,
  RouteCredential,
  RoutePoolModelMode,
} from "../lib/api/types";
import {
  CLAUDE_CODE_CLIENT_KEY,
  ClientIcon,
  DEFAULT_AGENT_PLATFORM,
  MESSAGES_AGENT_PLATFORM,
  defaultAgentInterfaceFormat,
  interfaceFormatHints,
  interfaceFormatLabels,
  platformForInterfaceFormat,
  type AgentInterfaceFormat,
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

/**
 * A fresh page preselects only the primary first-party CLI, matching the old
 * Codex tab's default. Claude Code is opt-in: it has its own settings file and
 * fixed `/model` slots, so writing it without an explicit choice would surprise
 * users who only wanted their Codex CLI configured.
 */
function defaultSelectedClientKeys(clients: ConfigWriteClientStatus[]): string[] {
  const firstNative = clients.find(
    (client) => client.native && client.platform === DEFAULT_AGENT_PLATFORM,
  );
  return firstNative ? [firstNative.client_key] : [];
}

/**
 * Chinese copy for config-write failures whose backend message does not convey
 * the consequence. Keyed by error code so the wording stays with the reason.
 */
const configWriteErrorMessages: Record<string, string> = {
  "validation.route_config_existing_invalid":
    "现有配置文件无法解析，已拒绝覆盖以免丢失你的 provider 配置。请先修复该文件再重试。",
  "config.concurrent_modification": "配置文件在写入期间被其他程序修改，未做改动。请重试。",
  "config.pool_models_empty": "算力池中没有可用模型，请先向池中加入账号。",
  "config.client_unavailable": "所选客户端不支持当前接口格式。",
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

function configWriteErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const outer = (error as { code?: unknown }).code;
  const code = typeof outer === "string" ? outer : "";
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

function formatConfigWriteError(error: unknown): string {
  const code = configWriteErrorCode(error);
  return configWriteErrorMessages[code] ?? formatApiError(error, "配置写入失败。");
}

/** A client plus the wire format the gateway writes into its config file. */
type UnifiedClient = ConfigWriteClientStatus & {
  interface_format: AgentInterfaceFormat;
};

type WriteGroup = { platform: string; clientKeys: string[] };

/**
 * One page, but two protocol families under the hood: Codex / Chat clients are
 * written by the `codex` adapters, Anthropic Messages clients by the `claude`
 * adapters. Each family has its own adapters, config path shape and access key.
 * Splitting here keeps the backend wire contracts untouched.
 */
function groupsForClients(clients: UnifiedClient[], keys: string[] | null): WriteGroup[] {
  const byKey = new Map(clients.map((client) => [client.client_key, client]));
  const chosen = keys ?? defaultSelectedClientKeys(clients);
  const groups = new Map<string, string[]>();
  for (const key of chosen) {
    const client = byKey.get(key);
    if (!client) continue;
    const platform = platformForInterfaceFormat(client.interface_format);
    groups.set(platform, [...(groups.get(platform) ?? []), key]);
  }
  return [...groups].map(([platform, clientKeys]) => ({ platform, clientKeys }));
}

/**
 * Aggregate versus precise, above the client cards because it decides the model
 * list everywhere: what gets written into a client config, what a client that
 * discovers models over `/v1/models` sees, and which ids the Claude slot dialog
 * may offer. Routing (precise) mode is first and is the fresh-install default.
 */
const modelModeOptions: { mode: RoutePoolModelMode; label: string; hint: string }[] = [
  {
    mode: "precise",
    label: "路由模式",
    hint: "每个 API 账号各出「账号/模型」，请求钉在该账号；官方账号合并为「official/模型」继续轮换。",
  },
  {
    mode: "aggregate",
    label: "聚合模式",
    hint: "同名模型合并成一条，请求在池内轮换。",
  },
];

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
              if (mode !== option.mode) onChange(option.mode);
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
  /** Legacy deep-link field: the page no longer has platform tabs. */
  platform?: string | null;
  clientKey?: string | null;
};

type ClientSetupScreenProps = {
  focus?: ClientSetupFocus | null;
  onFocusConsumed?: () => void;
  /** Claude Code 槽位弹窗的「去调整映射」：跳到账号页并按来源筛选。 */
  onOpenAccounts?: (provider: string) => void;
};

export function ClientSetupScreen({
  focus = null,
  onFocusConsumed,
  onOpenAccounts,
}: ClientSetupScreenProps) {
  const queryClient = useQueryClient();
  const desktop = isDesktop();
  // `null` until the user picks, so the page defaults to the first-party CLIs.
  const [selection, setSelection] = useState<string[] | null>(null);
  const [focusClientKey, setFocusClientKey] = useState<string | null>(focus?.clientKey ?? null);
  const [deepSeekHarnessPathOverride, setDeepSeekHarnessPathOverride] = useState<string | null>(null);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [slotSettingsError, setSlotSettingsError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ConfigWriteOutcome[]>([]);

  // 深链：外部入口指定客户端时，只应用一次，之后由用户自由切换。
  useEffect(() => {
    if (!focus) return;
    setFocusClientKey(focus.clientKey ?? null);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus 对象由 App 每次 new，依赖它即可。
  }, [focus]);

  const capabilitiesQuery = usePlatformCapabilities();
  const configWriteRule = findPlatformCapability(
    capabilitiesQuery.data,
    DEFAULT_AGENT_PLATFORM,
  )?.operations.config_write;
  const configWriteEnabled =
    capabilitiesQuery.isSuccess && Boolean(configWriteRule) && operationEnabled(configWriteRule);
  const configWriteReason = capabilityReason(configWriteRule);
  const capabilityDisabledReason = configWriteEnabled ? null : configWriteReason;

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  /** The old Codex client list plus Claude Code; every other agent appears once. */
  const clientsQuery = useQuery<UnifiedClient[]>({
    queryKey: ["config-write-clients-unified"],
    queryFn: async () => {
      const [codex, claude] = await Promise.all([
        listConfigWriteClients(DEFAULT_AGENT_PLATFORM),
        listConfigWriteClients(MESSAGES_AGENT_PLATFORM),
      ]);
      const claudeCode =
        claude.find((client) => client.client_key === CLAUDE_CODE_CLIENT_KEY) ??
        claude.find((client) => client.client_key === "claude") ??
        claude.find((client) => client.native);
      const merged = [...codex];
      if (claudeCode && !merged.some((client) => client.client_key === claudeCode.client_key)) {
        merged.push(claudeCode);
      }
      return merged.map((client) => ({
        ...client,
        interface_format: defaultAgentInterfaceFormat(client.client_key),
      }));
    },
  });
  const routeProxyQuery = useQuery({
    queryKey: ["route-proxy-status"],
    queryFn: getRouteProxyStatus,
    refetchInterval: 10_000,
  });
  const routeServiceReady =
    Boolean(routeProxyQuery.data?.route_access_enabled) && Boolean(routeProxyQuery.data?.running);
  // 主接入 Key（Codex / Chat 协议族）。Messages 客户端的 Key 由写入流程自己铸。
  const routeProxyKeyQuery = useQuery({
    queryKey: ["route-proxy-key", DEFAULT_AGENT_PLATFORM],
    queryFn: () => getRouteProxyKey(DEFAULT_AGENT_PLATFORM),
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
    queryKey: ["route-pool", DEFAULT_AGENT_PLATFORM, "active"],
    queryFn: () => getRoutePool(DEFAULT_AGENT_PLATFORM),
    placeholderData: keepPreviousData,
  });
  // 生图没有自己的平台：能否出图只能从账号映射里读出来。
  const allCredentialsQuery = useQuery<RouteCredential[]>({
    queryKey: ["route-credentials-all", DEFAULT_AGENT_PLATFORM],
    queryFn: () => listRouteCredentials(DEFAULT_AGENT_PLATFORM),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const poolImageModels = useMemo(
    () => poolImageModelsOf(allCredentialsQuery.data ?? []),
    [allCredentialsQuery.data],
  );
  const claudeSlotPlanQuery = useQuery({
    queryKey: ["claude-slot-plan", routePoolQuery.data?.model_mode ?? "precise"],
    queryFn: getClaudeSlotPlan,
    enabled: slotDialogOpen,
  });

  const clients = clientsQuery.data ?? [];
  const clientByTargetKey = useMemo(() => {
    const map = new Map<string, ConfigWriteClientStatus>();
    for (const client of clients) map.set(client.target_key, client);
    return map;
  }, [clients]);

  const storedClientSelection = useMemo<string[] | null>(() => {
    const raw = settingsQuery.data?.config_write_clients_json;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const keys = [
        ...(Array.isArray(parsed[DEFAULT_AGENT_PLATFORM]) ? parsed[DEFAULT_AGENT_PLATFORM] : []),
        ...(Array.isArray(parsed[MESSAGES_AGENT_PLATFORM]) ? parsed[MESSAGES_AGENT_PLATFORM] : []),
      ];
      return keys.length ? [...new Set(keys)] : null;
    } catch {
      return null;
    }
  }, [settingsQuery.data?.config_write_clients_json]);

  const initialSelection = focusClientKey ? [focusClientKey] : storedClientSelection;
  const selected = selection ?? initialSelection ?? defaultSelectedClientKeys(clients);

  const directClientKeys = useMemo(
    () => (directModesQuery.data ?? []).map((item) => item.client_key),
    [directModesQuery.data],
  );

  const httpEndpoint =
    routeProxyEndpointForPlatform(routeProxyQuery.data?.base_url ?? "", DEFAULT_AGENT_PLATFORM) ||
    null;
  const httpsEndpoint =
    routeProxyEndpointForPlatform(routeProxyQuery.data?.https_base_url ?? "", DEFAULT_AGENT_PLATFORM) ||
    null;
  const imageEndpoint = poolImageModels.length
    ? imageGenerationEndpoint(routeProxyQuery.data?.base_url ?? "", DEFAULT_AGENT_PLATFORM)
    : "";
  const restartClients = clients.filter(
    (client) => client.restart_required && selected.includes(client.client_key),
  );
  const directSelectedClients = clients.filter(
    (client) => selected.includes(client.client_key) && directClientKeys.includes(client.client_key),
  );
  const deepSeekHarnessSelected = selected.some((clientKey) =>
    clientKey.startsWith("deepseek_harness"),
  );
  const deepSeekHarnessPath =
    deepSeekHarnessPathOverride ?? settingsQuery.data?.deepseek_harness_config_path ?? "";

  const toggle = (clientKey: string) => {
    setSelection((current) => {
      const base = current ?? initialSelection ?? defaultSelectedClientKeys(clients);
      return base.includes(clientKey)
        ? base.filter((key) => key !== clientKey)
        : [...base, clientKey];
    });
  };

  const setModelModeMutation = useMutation({
    mutationFn: (mode: RoutePoolModelMode) =>
      setRoutePoolModelMode({ platform: DEFAULT_AGENT_PLATFORM, mode }),
    onSuccess: (state) => {
      queryClient.setQueryData(["route-pool", DEFAULT_AGENT_PLATFORM, "active"], state);
      void queryClient.invalidateQueries({ queryKey: ["route-config-stale"] });
      void queryClient.invalidateQueries({ queryKey: ["claude-slot-plan"] });
    },
    onError: (error) => setWriteError(formatApiError(error, "切换模型清单模式失败。")),
  });

  const saveSlotSettingsMutation = useMutation({
    mutationFn: async (payload: {
      overridesJson: string;
      clientConfigJson: string | null;
    }) => {
      const settings = settingsQuery.data;
      if (!settings) throw new Error("设置尚未加载完成。");
      return saveSettings({
        ...settings,
        claude_slot_overrides_json: payload.overridesJson,
        claude_client_config_json: payload.clientConfigJson,
      });
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings"], settings);
      setSlotSettingsError(null);
      setSlotDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["route-config-stale"] });
      void queryClient.invalidateQueries({ queryKey: ["claude-slot-plan"] });
    },
    onError: (error) => setSlotSettingsError(formatApiError(error, "保存槽位设置失败。")),
  });

  const writeConfigsMutation = useMutation({
    mutationFn: async ({
      clientKeys,
      deepSeekHarnessConfigPath,
    }: {
      clientKeys: string[];
      deepSeekHarnessConfigPath: string | null;
    }) => {
      if (!configWriteEnabled) throw new Error(configWriteReason);
      let settings = settingsQuery.data;
      if (
        deepSeekHarnessConfigPath !== (settings?.deepseek_harness_config_path ?? null) &&
        (settings || deepSeekHarnessConfigPath !== null)
      ) {
        if (!settings) throw new Error("设置尚未加载，无法保存 DSH 配置路径。");
        const pathUpdated = await saveSettings({
          ...settings,
          deepseek_harness_config_path: deepSeekHarnessConfigPath,
        });
        queryClient.setQueryData(["settings"], pathUpdated);
        settings = pathUpdated;
      }

      const groups = groupsForClients(clients, clientKeys);
      const writeOutcomes: ConfigWriteOutcome[] = [];
      for (const group of groups) {
        const results = await writeRouteProxyConfigs(
          routeProxyQuery.data?.base_url ?? null,
          group.platform,
          group.clientKeys,
        );
        writeOutcomes.push(...results);
      }

      if (settings) {
        let existing: Record<string, string[]> = {};
        try {
          existing = settings.config_write_clients_json
            ? (JSON.parse(settings.config_write_clients_json) as Record<string, string[]>)
            : {};
        } catch {
          existing = {};
        }
        const byPlatform = new Map(groups.map((group) => [group.platform, group.clientKeys]));
        const updated = await saveSettings({
          ...settings,
          config_write_clients_json: JSON.stringify({
            ...existing,
            [DEFAULT_AGENT_PLATFORM]: byPlatform.get(DEFAULT_AGENT_PLATFORM) ?? [],
            [MESSAGES_AGENT_PLATFORM]: byPlatform.get(MESSAGES_AGENT_PLATFORM) ?? [],
          }),
        });
        queryClient.setQueryData(["settings"], updated);
      }
      return writeOutcomes;
    },
    onMutate: () => setWriteError(null),
    onSuccess: (writeOutcomes) => {
      setOutcomes(writeOutcomes);
      setFocusClientKey(null);
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
      void queryClient.invalidateQueries({ queryKey: ["config-write-clients-unified"] });
    },
    onError: (error) => {
      setWriteError(formatConfigWriteError(error));
      void queryClient.invalidateQueries({ queryKey: ["client-direct-modes"] });
    },
  });

  const configWriteStaleQuery = useQuery({
    queryKey: [
      "route-config-stale",
      routeProxyQuery.data?.base_url ?? null,
      allCredentialsQuery.dataUpdatedAt,
      settingsQuery.data?.claude_client_config_json ?? null,
      settingsQuery.data?.claude_slot_overrides_json ?? null,
      storedClientSelection,
      routePoolQuery.data?.model_mode ?? null,
    ],
    queryFn: async () => {
      const groups = groupsForClients(clients, storedClientSelection);
      const results = await Promise.all(
        groups.map((group) =>
          routeConfigWriteIsStale(
            routeProxyQuery.data?.base_url ?? null,
            group.platform,
            group.clientKeys,
          ),
        ),
      );
      return results.some(Boolean);
    },
    enabled: routeServiceReady && configWriteEnabled,
    staleTime: 0,
  });
  const configWriteStale = configWriteStaleQuery.data === true;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!configWriteEnabled || writeConfigsMutation.isPending || selected.length === 0) return;
    const customDeepSeekHarnessPath = deepSeekHarnessPath.trim();
    writeConfigsMutation.mutate({
      clientKeys: clients
        .map((client) => client.client_key)
        .filter((clientKey) => selected.includes(clientKey)),
      deepSeekHarnessConfigPath: customDeepSeekHarnessPath ? customDeepSeekHarnessPath : null,
    });
  };

  const writing = writeConfigsMutation.isPending;

  const renderClientCard = (client: UnifiedClient): ReactNode => {
    const checked = selected.includes(client.client_key);
    const direct = directClientKeys.includes(client.client_key);
    const isClaudeCode =
      client.interface_format === "messages" &&
      (client.client_key === CLAUDE_CODE_CLIENT_KEY || client.client_key === "claude");
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
          <ClientIcon className="h-9 w-9 shrink-0" clientKey={client.client_key} />
          <div className="grid min-w-0 flex-1 gap-1">
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
                aria-label={`接口格式 ${interfaceFormatLabels[client.interface_format]}`}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800"
                title={interfaceFormatHints[client.interface_format]}
              >
                {interfaceFormatLabels[client.interface_format]}
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
            <span className="text-[10px] leading-4 text-stone-400">
              {interfaceFormatHints[client.interface_format]}
            </span>
            {client.error_code ? (
              <span className="font-mono text-[11px] text-red-700">{client.error_code}</span>
            ) : null}
          </div>
          {isClaudeCode ? (
            <button
              aria-label="设置 Claude Code 槽位映射"
              className="shrink-0 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={() => {
                setSlotSettingsError(null);
                setSlotDialogOpen(true);
              }}
              type="button"
            >
              设置
            </button>
          ) : null}
        </div>
      </li>
    );
  };

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
            把同一个算力池接入常用 Agent：勾选要写入的客户端一键写入；其他工具手动复制端点参数。
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
          mode={routePoolQuery.data?.model_mode ?? "precise"}
          onChange={(mode) => setModelModeMutation.mutate(mode)}
        />

        <div className="grid gap-1.5">
          <span className="text-[11px] font-semibold text-stone-600">智能体接入目标</span>
          <p className="text-[11px] leading-5 text-stone-500">
            账号池始终只有同一个。卡片上的接口格式决定写入时走哪组适配器与哪把接入 Key；
            Claude Code 只有固定的 /model 槽位，需要单独设置。
          </p>
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
            暂无可写入的客户端。
          </p>
        ) : (
          <ul className="grid list-none gap-2 sm:grid-cols-2">{clients.map(renderClientCard)}</ul>
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
              {httpsEndpoint ? <EndpointRow label="HTTPS Base URL" value={httpsEndpoint} /> : null}
              <EndpointRow label="API Key" secret value={routeServiceReady ? routeProxyKeyQuery.data ?? null : null} />
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
              这里给出的是主接入 Key（Codex / Chat 协议族）。勾选写入时，网关会按每个客户端的接口格式自动填入对应的
              Key；Anthropic Messages 客户端使用另一把 Key，已随配置一并写入，无需手工复制。
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

      {slotDialogOpen ? (
        <ClaudeSlotSettingsDialog
          clientConfigJson={settingsQuery.data?.claude_client_config_json}
          error={slotSettingsError}
          onClose={() => setSlotDialogOpen(false)}
          onOpenAccounts={() => onOpenAccounts?.("claude")}
          onSave={(payload) => saveSlotSettingsMutation.mutate(payload)}
          overridesJson={settingsQuery.data?.claude_slot_overrides_json}
          plan={claudeSlotPlanQuery.data}
          saving={saveSlotSettingsMutation.isPending}
        />
      ) : null}
    </div>
  );
}
