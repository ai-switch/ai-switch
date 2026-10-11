import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plug, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { EndpointRow } from "../components/accounts/ConfigWriteTargetsDialog";
import {
  createApiRouteCredential,
  deleteRouteCredential,
  getRouteProxyKey,
  getRouteProxyStatus,
  listRouteCredentials,
  setRouteCredentialStatuses,
  updateRouteCredential,
} from "../lib/api/client";
import type { AccountStatus, RouteCredential } from "../lib/api/types";
import {
  AUDIO_DIALECTS,
  AUDIO_PLATFORM,
  audioDialectLabel,
  type AudioDialect,
} from "../lib/audioPlatforms";
import { useI18n } from "../lib/i18n";

/// 音频账号必须声明这个能力，网关才会在账号池里选到它
/// （对应后端 `requested_audio_capability` → `audio.generate`）。
const AUDIO_CAPABILITY = "audio.generate";

type MappingRow = { from: string; to: string; capabilities: string[] };

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** 读出我们关心的映射字段；认不出的条目直接丢掉，不抛。 */
function readMappings(configJson: string): MappingRow[] {
  const mappings = parseJsonObject(configJson).model_mappings;
  if (!Array.isArray(mappings)) return [];
  return mappings.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const from = typeof row.from === "string" ? row.from.trim() : "";
    if (!from) return [];
    return [
      {
        from,
        to: typeof row.to === "string" && row.to.trim() ? row.to.trim() : from,
        capabilities: Array.isArray(row.capabilities)
          ? row.capabilities.filter((value): value is string => typeof value === "string")
          : [],
      },
    ];
  });
}

function readStringField(json: string, key: string): string {
  const value = parseJsonObject(json)[key];
  return typeof value === "string" ? value : "";
}

/** 表单里那串 JSON 的校验：必须是数组，且每条都带 `audio.generate`。 */
function parseMappingText(
  text: string,
): { rows: MappingRow[]; errorKey: "audio.invalidModels" | "audio.requiresAudioGenerate" | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], errorKey: "audio.invalidModels" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { rows: [], errorKey: "audio.invalidModels" };
  }
  const rows: MappingRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      return { rows: [], errorKey: "audio.invalidModels" };
    }
    const row = item as Record<string, unknown>;
    const from = typeof row.from === "string" ? row.from.trim() : "";
    if (!from) return { rows: [], errorKey: "audio.invalidModels" };
    const capabilities = Array.isArray(row.capabilities)
      ? row.capabilities.filter((value): value is string => typeof value === "string")
      : [];
    if (!capabilities.includes(AUDIO_CAPABILITY)) {
      return { rows: [], errorKey: "audio.requiresAudioGenerate" };
    }
    rows.push({
      from,
      to: typeof row.to === "string" && row.to.trim() ? row.to.trim() : from,
      capabilities,
    });
  }
  return { rows, errorKey: null };
}

/**
 * 音频渠道管理（TTS）。
 *
 * 与「视频」屏同构：音频账号和其它平台的账号同属账号池（`route_credentials`），
 * 只是 `platform` 是 `audio`，供应商住在账号的 `interface_format` 里。
 *
 * 目前只有一个方言（`openai` 兼容），所以这一屏比视频那屏简单——但结构一致，
 * 加第二家（MiniMax / 火山 / Azure / ElevenLabs）时不需要改这里。
 *
 * 刻意不做的：官方账号导入、写 CLI 配置、模型测试、终端/会话。后端的能力矩阵
 * （`platform_capability_service`）对这四项给的就是 `unavailable`。
 */
export function AudioChannelsScreen({
  embedded = false,
  hint,
}: {
  /// 嵌在 codex 页的分段器里时置真：由外层提供标题，这里只留一句说明。
  embedded?: boolean;
  /// 覆盖默认副标题（分段器用它讲清「这些账号属于另一个池」）。
  hint?: string;
} = {}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ credential: RouteCredential | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RouteCredential | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const channelsQuery = useQuery({
    queryKey: ["audio-channels"],
    queryFn: async () => {
      const list = await listRouteCredentials(AUDIO_PLATFORM);
      return list.sort(
        (left, right) =>
          readStringField(left.config_json, "interface_format").localeCompare(
            readStringField(right.config_json, "interface_format"),
          ) || left.sort_order - right.sort_order,
      );
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["audio-channels"] });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AccountStatus }) =>
      setRouteCredentialStatuses([id], status),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRouteCredential(id),
    onSuccess: async () => {
      setPendingDelete(null);
      await invalidate();
    },
  });

  const channels = channelsQuery.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-1 pb-3">
        <div>
          {/* 嵌在分段器里时标题由外层给；这里只留一句说明 —— 视频 / 音频是
              独立平台，段内要讲清这一点，免得用户以为它们属于 codex 池。 */}
          {embedded ? null : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                {t("audio.kicker")}
              </p>
              <h1 className="mt-0.5 text-lg font-semibold text-stone-950">{t("audio.title")}</h1>
            </>
          )}
          <p className="mt-1 max-w-2xl text-[12px] text-stone-500">{hint ?? t("audio.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-100"
            onClick={() => setConnectOpen(true)}
            type="button"
          >
            <Plug aria-hidden="true" className="h-3.5 w-3.5" />
            {t("audio.connect")}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white motion-control hover:bg-stone-800"
            onClick={() => setEditing({ credential: null })}
            type="button"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {t("audio.add")}
          </button>
        </div>
      </div>

      {channelsQuery.isLoading ? (
        <p className="px-1 text-sm text-stone-500">{t("audio.title")}…</p>
      ) : null}
      {channelsQuery.error ? (
        <p className="px-1 text-sm text-red-700" role="alert">
          {t("audio.loadFailed")}
        </p>
      ) : null}
      {channelsQuery.isSuccess && channels.length === 0 ? (
        <p className="px-1 text-sm text-stone-500">{t("audio.empty")}</p>
      ) : null}

      <div className="space-y-2">
        {channels.map((channel) => {
          const mappings = readMappings(channel.config_json);
          const enabled = channel.status !== "paused";
          return (
            <article
              className="flex items-start justify-between gap-3 border border-stone-200 bg-white px-3 py-3 shadow-sm"
              key={channel.id}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[14px] font-semibold text-stone-950">
                    {channel.display_name}
                  </h2>
                  {/* TAG：这个账号走的是哪个上游（供应商 = interface_format） */}
                  <span className="inline-flex border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
                    {audioDialectLabel(readStringField(channel.config_json, "interface_format"))}
                  </span>
                  <span
                    className={`inline-flex border px-2 py-0.5 text-[10px] font-semibold ${
                      enabled
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-stone-200 bg-stone-50 text-stone-600"
                    }`}
                  >
                    {enabled ? t("audio.enabled") : t("audio.disabled")}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-stone-500">
                  {readStringField(channel.config_json, "base_url") || "—"}
                </p>
                <p className="mt-0.5 text-[11px] text-stone-500">
                  {t("audio.modelCount")}: {mappings.length}
                  {mappings.length ? ` · ${mappings.map((row) => row.from).join(", ")}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold text-stone-600 motion-control hover:bg-stone-100"
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({ id: channel.id, status: enabled ? "paused" : "ok" })
                  }
                  type="button"
                >
                  {enabled ? t("audio.disabled") : t("audio.enabled")}
                </button>
                <button
                  aria-label={t("audio.edit")}
                  className="grid h-7 w-7 place-items-center rounded-lg text-stone-500 motion-control hover:bg-stone-100 hover:text-stone-900"
                  onClick={() => setEditing({ credential: channel })}
                  title={t("audio.edit")}
                  type="button"
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label={t("audio.delete")}
                  className="grid h-7 w-7 place-items-center rounded-lg text-stone-500 motion-control hover:bg-red-50 hover:text-red-700"
                  onClick={() => setPendingDelete(channel)}
                  title={t("audio.delete")}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {editing ? (
        <AudioChannelDialog
          credential={editing.credential}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await invalidate();
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDeleteDialog
          label={pendingDelete.display_name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          saving={deleteMutation.isPending}
        />
      ) : null}

      {connectOpen ? <AudioConnectDialog onClose={() => setConnectOpen(false)} /> : null}
    </section>
  );
}

/// 「接入信息」：把端点与渠道的 key 摊开给用户。
///
/// 音频只有**一个平台、一张 key**（`sk-ai-switch-audio`，与文本平台的
/// `sk-ai-switch-codex` 是同一套 `route_proxy_keys`）。客户端只需
/// `Authorization: Bearer <key>`，**不需要任何自定义请求头** —— 这正是
/// 「OpenAI 兼容」的落点。
///
/// key 只在打开这个对话框时读取：读取会在 key 不存在时创建它，不该因为用户路过
/// 这一屏就凭空签发（与 `AccountsScreen` 同策略）。
function AudioConnectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const proxyQuery = useQuery({
    queryKey: ["route-proxy-status"],
    queryFn: getRouteProxyStatus,
  });
  const keysQuery = useQuery({
    queryKey: ["audio-channel-key"],
    queryFn: () => getRouteProxyKey(AUDIO_PLATFORM),
  });

  const status = proxyQuery.data;
  const ready = Boolean(status?.running && status?.route_access_enabled);
  const endpoint =
    ready && status?.base_url ? `${status.base_url}/v1/audio/speech` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-stone-950/40 px-4 py-10">
      <div
        aria-label={t("audio.connectTitle")}
        aria-modal="true"
        className="w-full max-w-xl border border-stone-200 bg-white shadow-xl"
        role="dialog"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-[14px] font-semibold text-stone-950">
            {t("audio.connectTitle")}
          </h2>
          <button
            aria-label={t("audio.connectClose")}
            className="grid h-7 w-7 place-items-center rounded-lg text-stone-500 motion-control hover:bg-stone-100 hover:text-stone-900"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 px-4 py-4">
          <p className="text-[12px] leading-5 text-stone-600">{t("audio.connectIntro")}</p>

          {endpoint ? (
            <EndpointRow label={t("audio.connectEndpoint")} value={endpoint} />
          ) : (
            <p className="text-[12px] text-amber-700">{t("audio.connectPending")}</p>
          )}

          {keysQuery.isError ? (
            <p className="text-[12px] text-red-700" role="alert">
              {t("audio.loadFailed")}
            </p>
          ) : null}
          <EndpointRow
            label={t("audio.connectKey")}
            secret
            value={keysQuery.data ?? null}
          />
        </div>
      </div>
    </div>
  );
}

function AudioChannelDialog({
  credential,
  onClose,
  onSaved,
}: {
  credential: RouteCredential | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const editing = credential !== null;
  // 供应商住在 `interface_format` 里（平台恒为 `audio`）。
  const [dialect, setDialect] = useState<AudioDialect>(() => {
    const stored = credential
      ? readStringField(credential.config_json, "interface_format").toLowerCase()
      : "";
    const known = AUDIO_DIALECTS.find((item) => item.dialect === stored);
    return known?.dialect ?? AUDIO_DIALECTS[0].dialect;
  });
  const [name, setName] = useState(credential?.display_name ?? "");
  const [baseUrl, setBaseUrl] = useState(
    credential ? readStringField(credential.config_json, "base_url") : "",
  );
  const [apiKey, setApiKey] = useState(
    credential ? readStringField(credential.secret_payload_json, "api_key") : "",
  );
  const [mappingsText, setMappingsText] = useState(() => {
    const existing = credential ? readMappings(credential.config_json) : [];
    const rows = existing.length
      ? existing
      : [{ from: "", to: "", capabilities: [AUDIO_CAPABILITY] }];
    return JSON.stringify(rows, null, 2);
  });
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = parseMappingText(mappingsText);
      if (parsed.errorKey) throw new Error(t(parsed.errorKey));
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(t("audio.name"));
      const trimmedBaseUrl = baseUrl.trim();
      if (!trimmedBaseUrl) throw new Error(t("audio.baseUrl"));
      const trimmedKey = apiKey.trim();
      if (!editing && !trimmedKey) throw new Error(t("audio.apiKeyRequired"));

      // 保留 config 里我们不认识的字段，只改我们负责的三项。
      const config = credential ? parseJsonObject(credential.config_json) : {};
      config.base_url = trimmedBaseUrl;
      // 供应商就是接口格式：上游路径、鉴权头、回程解码全由它决定。
      config.interface_format = dialect;
      config.model_mappings = parsed.rows;
      const configJson = JSON.stringify(config, null, 2);

      if (credential) {
        // key 留空就沿用已存的（编辑时我们把它预填出来了，所以空 = 用户手动清空，
        // 这里按「不改动」处理，避免误清）。
        const secret = parseJsonObject(credential.secret_payload_json);
        if (trimmedKey) secret.api_key = trimmedKey;
        await updateRouteCredential(credential.id, {
          display_name: trimmedName,
          email: null,
          status: credential.status,
          route_priority: credential.route_priority,
          max_concurrency: credential.max_concurrency,
          secret_payload_json: JSON.stringify(secret),
          config_json: configJson,
          preview_json: credential.preview_json || "{}",
        });
        return;
      }

      await createApiRouteCredential({
        // 平台恒为 audio；供应商由 `interface_format` 承载。
        platform: AUDIO_PLATFORM,
        display_name: trimmedName,
        api_key: trimmedKey,
        base_url: trimmedBaseUrl,
        interface_format: dialect,
        model_mappings_json: JSON.stringify(parsed.rows),
      });
    },
    onSuccess: () => {
      void onSaved();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    saveMutation.mutate();
  };

  const fieldClass =
    "w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[13px] text-stone-900 outline-none motion-control focus:border-blue-400 focus:ring-2 focus:ring-blue-200";
  const labelClass = "text-[11px] font-semibold text-stone-600";
  const hintClass = "text-[11px] text-stone-400";

  return (
    <div
      className="motion-overlay fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saveMutation.isPending) onClose();
      }}
    >
      <form
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-2xl ring-1 ring-stone-300/70"
        noValidate
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 bg-stone-50 px-4 py-3">
          <h2 className="mt-0.5 text-[14px] font-semibold text-stone-950">
            {editing ? t("audio.editTitle") : t("audio.createTitle")}
          </h2>
          <button
            aria-label={t("audio.cancel")}
            className="grid h-7 w-7 shrink-0 place-items-center text-stone-500 motion-control hover:bg-stone-200 hover:text-stone-900 disabled:opacity-50"
            disabled={saveMutation.isPending}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-3 px-4 py-4">
          {/* 用显式 htmlFor/id 而不是把控件包在 <label> 里：说明文字在 label 内会
              被算进可访问名（读屏会念成「协议 决定上游路径…」），测试里也没法按
              精确名字定位。 */}
          <div className="grid gap-1">
            <label className={labelClass} htmlFor="audio-dialect">
              {t("audio.protocol")}
            </label>
            <select
              className={fieldClass}
              id="audio-dialect"
              onChange={(event) => {
                const next = AUDIO_DIALECTS.find(
                  (item) => item.dialect === event.target.value,
                );
                if (next) setDialect(next.dialect);
              }}
              value={dialect}
            >
              {AUDIO_DIALECTS.map((item) => (
                <option key={item.dialect} value={item.dialect}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className={hintClass}>{t("audio.protocolHelp")}</span>
          </div>

          <div className="grid gap-1">
            <label className={labelClass} htmlFor="audio-name">
              {t("audio.name")}
            </label>
            <input
              className={fieldClass}
              id="audio-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>

          <div className="grid gap-1">
            <label className={labelClass} htmlFor="audio-base-url">
              {t("audio.baseUrl")}
            </label>
            <input
              className={fieldClass}
              id="audio-base-url"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              value={baseUrl}
            />
          </div>

          <div className="grid gap-1">
            <label className={labelClass} htmlFor="audio-api-key">
              {t("audio.apiKey")}
            </label>
            <input
              className={fieldClass}
              id="audio-api-key"
              onChange={(event) => setApiKey(event.target.value)}
              value={apiKey}
            />
            {editing ? <span className={hintClass}>{t("audio.apiKeyKeep")}</span> : null}
          </div>

          <div className="grid gap-1">
            <label className={labelClass} htmlFor="audio-models">
              {t("audio.models")}
            </label>
            <textarea
              className={`${fieldClass} min-h-[9rem] font-mono text-[12px]`}
              id="audio-models"
              onChange={(event) => setMappingsText(event.target.value)}
              spellCheck={false}
              value={mappingsText}
            />
            <span className={hintClass}>{t("audio.modelsHelp")}</span>
          </div>
        </div>

        {error ? (
          <p className="mx-4 mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="flex items-center justify-end gap-2 bg-stone-50 px-4 py-3">
          <button
            className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 ring-1 ring-stone-300 motion-control hover:bg-stone-100 disabled:opacity-50"
            disabled={saveMutation.isPending}
            onClick={onClose}
            type="button"
          >
            {t("audio.cancel")}
          </button>
          <button
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white motion-control hover:bg-stone-800 disabled:opacity-50"
            disabled={saveMutation.isPending}
            type="submit"
          >
            {t("audio.save")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ConfirmDeleteDialog({
  label,
  onCancel,
  onConfirm,
  saving,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className="motion-overlay fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <div
        aria-modal="true"
        className="w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-stone-300/70"
        role="dialog"
      >
        <div className="px-4 py-4">
          <h2 className="text-[14px] font-semibold text-stone-950">{t("audio.deleteConfirm")}</h2>
          <p className="mt-1 text-[12px] text-stone-500">{label}</p>
        </div>
        <footer className="flex items-center justify-end gap-2 bg-stone-50 px-4 py-3">
          <button
            className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 ring-1 ring-stone-300 motion-control hover:bg-stone-100 disabled:opacity-50"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            {t("audio.cancel")}
          </button>
          <button
            className="rounded-lg bg-red-700 px-3 py-1.5 text-[12px] font-semibold text-white motion-control hover:bg-red-800 disabled:opacity-50"
            disabled={saving}
            onClick={onConfirm}
            type="button"
          >
            {t("audio.delete")}
          </button>
        </footer>
      </div>
    </div>
  );
}
