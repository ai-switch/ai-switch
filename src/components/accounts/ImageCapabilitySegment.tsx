import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { EndpointRow } from "./ConfigWriteTargetsDialog";
import { getRouteProxyKey, getRouteProxyStatus } from "../../lib/api/client";
import { useI18n } from "../../lib/i18n";
import { imageGenerationEndpoint } from "../../lib/routeProxyEndpoint";

/**
 * 「生图」段的**接入信息**。
 *
 * 生图没有自己的平台：它是池里账号的一个能力，端点是 `/v1/images/generations`，
 * 与文本共用同一个 Base URL 和同一张 key。这一段只负责把**那个能力**摊出来
 * —— 端点是什么、用哪张 key、编辑有什么限制。
 *
 * **账号本身由同一个段里的账号管理屏负责**：`CodexChannelsScreen` 把 `AccountsScreen`
 * 用 `capabilityFilter="image.generate"` 挂在下面，于是生图段有和「通用」段一样的
 * 增删改查，只是列表被能力筛过。
 *
 * 这里此前是一个**只读**列表，理由是「生图账号就是文本账号」。那个判断是错的：
 * 专业生图模型（`gpt-image-2` 之类）走的是**独立的生图端点**，与 chat 模型不是
 * 一回事 —— 同一个上游也应当分开建账号，否则「这个账号是给文本用的还是给生图用的」
 * 在界面上无从表达。
 */
export function ImageCapabilitySegment({
  imageGenerationEnabled,
  onOpenImageStudio,
}: {
  imageGenerationEnabled: boolean;
  onOpenImageStudio?: () => void;
}) {
  const { t } = useI18n();
  const statusQuery = useQuery({
    queryKey: ["route-proxy-status"],
    queryFn: getRouteProxyStatus,
  });
  const keyQuery = useQuery({
    queryKey: ["image-segment-key", "codex"],
    queryFn: () => getRouteProxyKey("codex"),
  });

  const status = statusQuery.data;
  const ready = Boolean(status?.running && status?.route_access_enabled);
  const endpoint =
    ready && status?.base_url ? imageGenerationEndpoint(status.base_url, "codex") : null;

  return (
    <section className="space-y-3">
      <div className="border-b border-stone-200 px-1 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
          {t("codex.segment.image")}
        </p>
        <p className="mt-1 max-w-2xl text-[12px] text-stone-500">
          {t("imageSegment.subtitle")}
        </p>
      </div>

      <div className="grid gap-2.5 rounded-lg border border-stone-200 bg-white px-3.5 py-3">
        {endpoint ? (
          <EndpointRow label={t("imageSegment.endpoint")} value={endpoint} />
        ) : (
          <p className="text-[12px] text-amber-700">{t("imageSegment.pending")}</p>
        )}
        <EndpointRow
          label={t("imageSegment.key")}
          secret
          value={keyQuery.data ?? null}
        />
        <p className="text-[11px] leading-5 text-stone-500">
          {t("imageSegment.editCaveat")}
        </p>
      </div>

      <p className="text-[11px] leading-5 text-stone-500">
        {t("imageSegment.manageHint")}
      </p>

      <div className="flex items-center gap-2">
        {imageGenerationEnabled ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white motion-control hover:bg-stone-800"
            onClick={onOpenImageStudio}
            type="button"
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            {t("imageSegment.workspace")}
          </button>
        ) : (
          <p className="text-[11px] text-stone-500">{t("imageSegment.workspaceOff")}</p>
        )}
      </div>
    </section>
  );
}
