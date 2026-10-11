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
import { useI18n } from "../lib/i18n";
import {
  VIDEO_DIALECTS,
  VIDEO_PLATFORM,
  videoDialectLabel,
  type VideoDialect,
} from "../lib/videoPlatforms";

/// 视频账号必须声明这个能力，网关才会在账号池里选到它
/// （对应后端 `requested_video_capability` → `video.generate`）。
const VIDEO_CAPABILITY = "video.generate";

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

/** 表单里那串 JSON 的校验：必须是数组，且每条都带 `video.generate`。 */
function parseMappingText(
  text: string,
): { rows: MappingRow[]; errorKey: "video.invalidModels" | "video.requiresVideoGenerate" | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], errorKey: "video.invalidModels" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { rows: [], errorKey: "video.invalidModels" };
  }
  const rows: MappingRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      return { rows: [], errorKey: "video.invalidModels" };
    }
    const row = item as Record<string, unknown>;
    const from = typeof row.from === "string" ? row.from.trim() : "";
    if (!from) return { rows: [], errorKey: "video.invalidModels" };
    const capabilities = Array.isArray(row.capabilities)
      ? row.capabilities.filter((value): value is string => typeof value === "string")
      : [];
    if (!capabilities.includes(VIDEO_CAPABILITY)) {
      return { rows: [], errorKey: "video.requiresVideoGenerate" };
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
 * 视频渠道管理。
 *
 * 视频账号和其它平台的账号同属账号池（`route_credentials`），只是 `platform`
 * 是 `video:kling` 这类「模态:协议」取值。这里把它们**合在一屏**里管理，
 * 每行用一个 TAG 标出上游协议——因为视频的 5 个方言对使用者来说是一件事
 * （「视频」），没必要在侧边栏摊成 5 个入口。
 *
 * 刻意不做的：官方账号导入、写 CLI 配置、模型测试、终端/会话。
 * 后端的能力矩阵（`platform_capability_service`）对这四项给的就是
 * `unavailable`，所以界面上也不该出现。
 */
export function VideoChannelsScreen() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ credential: RouteCredential | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RouteCredential | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  // 视频只有一个平台：供应商在账号的 `interface_format` 里，所以一次查询就够。
  const channelsQuery = useQuery({
    queryKey: ["video-channels"],
    queryFn: async () => {
      const list = await listRouteCredentials(VIDEO_PLATFORM);
      return list.sort(
        (left, right) =>
          readStringField(left.config_json, "interface_format").localeCompare(
            readStringField(right.config_json, "interface_format"),
          ) || left.sort_order - right.sort_order,
      );
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["video-channels"] });

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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
            {t("video.kicker")}
          </p>
          <h1 className="mt-0.5 text-lg font-semibold text-stone-950">{t("video.title")}</h1>
          <p className="mt-1 max-w-2xl text-[12px] text-stone-500">{t("video.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-100"
            onClick={() => setConnectOpen(true)}
            type="button"
          >
            <Plug aria-hidden="true" className="h-3.5 w-3.5" />
            {t("video.connect")}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white motion-control hover:bg-stone-800"
            onClick={() => setEditing({ credential: null })}
            type="button"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {t("video.add")}
          </button>
        </div>
      </div>

      {channelsQuery.isLoading ? (
        <p className="px-1 text-sm text-stone-500">{t("video.title")}…</p>
      ) : null}
      {channelsQuery.error ? (
        <p className="px-1 text-sm text-red-700" role="alert">
          {t("video.loadFailed")}
        </p>
      ) : null}
      {channelsQuery.isSuccess && channels.length === 0 ? (
        <p className="px-1 text-sm text-stone-500">{t("video.empty")}</p>
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
                  <span className="inline-flex border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                    {videoDialectLabel(readStringField(channel.config_json, "interface_format"))}
                  </span>
                  <span
                    className={`inline-flex border px-2 py-0.5 text-[10px] font-semibold ${
                      enabled
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-stone-200 bg-stone-50 text-stone-600"
                    }`}
                  >
                    {enabled ? t("video.enabled") : t("video.disabled")}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-stone-500">
                  {readStringField(channel.config_json, "base_url") || "—"}
                </p>
                <p className="mt-0.5 text-[11px] text-stone-500">
                  {t("video.modelCount")}: {mappings.length}
                  {mappings.length
                    ? ` · ${mappings.map((row) => row.from).join(", ")}`
                    : ""}
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
                  {enabled ? t("video.disabled") : t("video.enabled")}
                </button>
                <button
                  aria-label={t("video.edit")}
                  className="grid h-7 w-7 place-items-center rounded-lg text-stone-500 motion-control hover:bg-stone-100 hover:text-stone-900"
                  onClick={() => setEditing({ credential: channel })}
                  title={t("video.edit")}
                  type="button"
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label={t("video.delete")}
                  className="grid h-7 w-7 place-items-center rounded-lg text-stone-500 motion-control hover:bg-red-50 hover:text-red-700"
                  onClick={() => setPendingDelete(channel)}
                  title={t("video.delete")}
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
        <VideoChannelDialog
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

      {connectOpen ? <VideoConnectDialog onClose={() => setConnectOpen(false)} /> : null}
    </section>
  );
}

/// 「接入信息」：把端点与渠道的 key 摊开给用户。
///
/// 视频只有**一个平台、一张 key**（`sk-ai-switch-video`，与文本平台的
/// `sk-ai-switch-codex` 是同一套 `route_proxy_keys`）。客户端只需
/// `Authorization: Bearer <key>`，**不需要任何自定义请求头** ——
/// 这正是「OpenAI 兼容」的落点。
///
/// 端点摊两个：网关同时提供 new-api 契约（`/v1/video/generations`）与
/// OpenAI 原生契约（`/v1/videos`），指向同一套任务。客户端按自己写的那套调，
/// 不需要知道另一套的存在。
///
/// key 只在打开这个对话框时读取：读取会在 key 不存在时创建它，
/// 不该因为用户路过这一屏就凭空签发（与 `AccountsScreen` 同策略）。
function VideoConnectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const proxyQuery = useQuery({
    queryKey: ["route-proxy-status"],
    queryFn: getRouteProxyStatus,
  });
  // 视频只有一张 key：平台是 `video`，落到哪家由请求里的 `model` 名决定。
  const keysQuery = useQuery({
    queryKey: ["video-channel-key"],
    queryFn: () => getRouteProxyKey(VIDEO_PLATFORM),
  });

  const status = proxyQuery.data;
  const ready = Boolean(status?.running && status?.route_access_enabled);
  const baseUrl = ready ? status?.base_url : null;
  const endpoint = baseUrl ? `${baseUrl}/v1/video/generations` : null;
  const openaiEndpoint = baseUrl ? `${baseUrl}/v1/videos` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-stone-950/40 px-4 py-10">
      <div
        aria-label={t("video.connectTitle")}
        aria-modal="true"
        className="w-full max-w-xl border border-stone-200 bg-white shadow-xl"
        role="dialog"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-[14px] font-semibold text-stone-950">
            {t("video.connectTitle")}
          </h2>
          <button
            aria-label={t("video.connectClose")}
            className="grid h-7 w-7 place-items-center rounded-lg text-stone-500 motion-control hover:bg-stone-100 hover:text-stone-900"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 px-4 py-4">
          <p className="text-[12px] leading-5 text-stone-600">{t("video.connectIntro")}</p>

          {endpoint && openaiEndpoint ? (
            <>
              <EndpointRow label={t("video.connectEndpoint")} value={endpoint} />
              <EndpointRow label={t("video.connectEndpointOpenai")} value={openaiEndpoint} />
              <span className="text-[11px] text-stone-400">
                {t("video.connectEndpointHint")}
              </span>
            </>
          ) : (
            <p className="text-[12px] text-amber-700">{t("video.connectPending")}</p>
          )}

          {keysQuery.isError ? (
            <p className="text-[12px] text-red-700" role="alert">
              {t("video.loadFailed")}
            </p>
          ) : null}
          <EndpointRow
            label={t("video.connectKey")}
            secret
            value={keysQuery.data ?? null}
          />
        </div>
      </div>
    </div>
  );
}

function VideoChannelDialog({
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
  // 供应商住在 `interface_format` 里（平台恒为 `video`）。
  const [dialect, setDialect] = useState<VideoDialect>(() => {
    const stored = credential
      ? readStringField(credential.config_json, "interface_format").toLowerCase()
      : "";
    const known = VIDEO_DIALECTS.find((item) => item.dialect === stored);
    return known?.dialect ?? VIDEO_DIALECTS[0].dialect;
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
      : [{ from: "", to: "", capabilities: [VIDEO_CAPABILITY] }];
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
      if (!trimmedName) throw new Error(t("video.name"));
      const trimmedBaseUrl = baseUrl.trim();
      if (!trimmedBaseUrl) throw new Error(t("video.baseUrl"));
      const trimmedKey = apiKey.trim();
      if (!editing && !trimmedKey) throw new Error(t("video.apiKeyRequired"));

      // 保留 config 里我们不认识的字段，只改我们负责的三项。
      const config = credential ? parseJsonObject(credential.config_json) : {};
      config.base_url = trimmedBaseUrl;
      // 供应商就是接口格式：上游请求体形状、路径、状态解析全由它决定。
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
        // 平台恒为 video；供应商由 `interface_format` 承载。
        platform: VIDEO_PLATFORM,
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
            {editing ? t("video.editTitle") : t("video.createTitle")}
          </h2>
          <button
            aria-label={t("video.cancel")}
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
              被算进可访问名（读屏会念成「协议 决定上游请求体形状…」），
              测试里也没法按精确名字定位。 */}
          <div className="grid gap-1">
            <label className={labelClass} htmlFor="video-dialect">
              {t("video.protocol")}
            </label>
            <select
              className={fieldClass}
              id="video-dialect"
              onChange={(event) => {
                const next = VIDEO_DIALECTS.find(
                  (item) => item.dialect === event.target.value,
                );
                if (next) setDialect(next.dialect);
              }}
              value={dialect}
            >
              {VIDEO_DIALECTS.map((item) => (
                <option key={item.dialect} value={item.dialect}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className={hintClass}>{t("video.protocolHelp")}</span>
          </div>

          <div className="grid gap-1">
            <label className={labelClass} htmlFor="video-name">
              {t("video.name")}
            </label>
            <input
              className={fieldClass}
              id="video-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>

          <div className="grid gap-1">
            <label className={labelClass} htmlFor="video-base-url">
              {t("video.baseUrl")}
            </label>
            <input
              className={fieldClass}
              id="video-base-url"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              value={baseUrl}
            />
          </div>

          <div className="grid gap-1">
            <label className={labelClass} htmlFor="video-api-key">
              {t("video.apiKey")}
            </label>
            <input
              className={fieldClass}
              id="video-api-key"
              onChange={(event) => setApiKey(event.target.value)}
              value={apiKey}
            />
            {editing ? <span className={hintClass}>{t("video.apiKeyKeep")}</span> : null}
          </div>

          <div className="grid gap-1">
            <label className={labelClass} htmlFor="video-models">
              {t("video.models")}
            </label>
            <textarea
              className={`${fieldClass} min-h-[9rem] font-mono text-[12px]`}
              id="video-models"
              onChange={(event) => setMappingsText(event.target.value)}
              spellCheck={false}
              value={mappingsText}
            />
            <span className={hintClass}>{t("video.modelsHelp")}</span>
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
            {t("video.cancel")}
          </button>
          <button
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white motion-control hover:bg-stone-800 disabled:opacity-50"
            disabled={saveMutation.isPending}
            type="submit"
          >
            {t("video.save")}
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
          <h2 className="text-[14px] font-semibold text-stone-950">{t("video.deleteConfirm")}</h2>
          <p className="mt-1 text-[12px] text-stone-500">{label}</p>
        </div>
        <footer className="flex items-center justify-end gap-2 bg-stone-50 px-4 py-3">
          <button
            className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 ring-1 ring-stone-300 motion-control hover:bg-stone-100 disabled:opacity-50"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            {t("video.cancel")}
          </button>
          <button
            className="rounded-lg bg-red-700 px-3 py-1.5 text-[12px] font-semibold text-white motion-control hover:bg-red-800 disabled:opacity-50"
            disabled={saving}
            onClick={onConfirm}
            type="button"
          >
            {t("video.delete")}
          </button>
        </footer>
      </div>
    </div>
  );
}
