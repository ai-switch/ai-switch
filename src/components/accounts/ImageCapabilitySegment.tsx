import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { EndpointRow } from "./ConfigWriteTargetsDialog";
import { getRouteProxyKey, getRouteProxyStatus, listRouteCredentials } from "../../lib/api/client";
import { imageCapableModels } from "../../lib/imageCapability";
import { useI18n } from "../../lib/i18n";
import { imageGenerationEndpoint } from "../../lib/routeProxyEndpoint";

/// 生图段服务的池。生图**没有自己的平台**，它挂在文本池上 —— 这两个是唯一有生图
/// 桥接分支的方言（openai 直通 / openai-responses 转 Responses / gemini 转
/// generateContent，见 `route_protocol_bridge`）。
const IMAGE_POOLS = ["codex", "gemini"] as const;

/**
 * 「生图」段：本池的生图能力视图 + 接入信息。
 *
 * 与「视频」「TTS」两段不同，这一屏**不管理账号** —— 因为生图账号就是文本账号
 * （同一个 key、同一个 Base URL），在「通用」段里勾一下模型映射的「图片生成」能力
 * 就够了。这里要做的是把**那个能力**摊出来：端点是什么、哪些账号有、能用哪些模型。
 *
 * 这也是生图此前最大的问题：链路一直是通的，但界面上没有地方能知道
 * `/v1/images/generations` 存在（那个「生图」导航入口是站内工作台，还被插件开关
 * 挡着）。所以这一屏的重点是**可发现性**，不是增删改。
 */
export function ImageCapabilitySegment({
  imageGenerationEnabled,
  onOpenImageStudio,
}: {
  imageGenerationEnabled: boolean;
  onOpenImageStudio?: () => void;
}) {
  const { t } = useI18n();
  // 生图挂在文本池上，所以两个池都要看：用户可能在 codex 池里配，也可能在 gemini 池里。
  const codexQuery = useQuery({
    queryKey: ["image-segment-credentials", "codex"],
    queryFn: () => listRouteCredentials("codex"),
  });
  const geminiQuery = useQuery({
    queryKey: ["image-segment-credentials", "gemini"],
    queryFn: () => listRouteCredentials("gemini"),
  });
  const statusQuery = useQuery({
    queryKey: ["route-proxy-status"],
    queryFn: getRouteProxyStatus,
  });
  const keyQuery = useQuery({
    queryKey: ["image-segment-key", "codex"],
    queryFn: () => getRouteProxyKey("codex"),
  });

  const pools = IMAGE_POOLS.map((platform) => {
    const credentials = (platform === "codex" ? codexQuery.data : geminiQuery.data) ?? [];
    const accounts = credentials
      .map((credential) => ({
        credential,
        models: imageCapableModels(credential.config_json),
      }))
      .filter((item) => item.models.length > 0);
    return { platform, accounts };
  });
  const totalAccounts = pools.reduce((sum, pool) => sum + pool.accounts.length, 0);

  const status = statusQuery.data;
  const ready = Boolean(status?.running && status?.route_access_enabled);
  const endpoint = ready && status?.base_url
    ? imageGenerationEndpoint(status.base_url, "codex")
    : null;

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

      <div className="border border-stone-200 bg-white px-3 py-3 shadow-sm">
        <h2 className="text-[13px] font-semibold text-stone-950">
          {t("imageSegment.accounts")}
        </h2>
        {totalAccounts === 0 ? (
          <p className="mt-1 text-[12px] text-stone-500">{t("imageSegment.noAccounts")}</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {pools.map((pool) =>
              pool.accounts.map(({ credential, models }) => (
                <div
                  className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-1.5 text-[12px]"
                  key={`${pool.platform}-${credential.id}`}
                >
                  <span className="font-semibold text-stone-800">
                    {credential.display_name}
                  </span>
                  {/* 池名要标出来：同一个上游可能在 codex 池和 gemini 池各有一个账号 */}
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-600">
                    {pool.platform}
                  </span>
                  <span className="font-mono text-[11px] text-stone-500">
                    {models.join("、")}
                  </span>
                </div>
              )),
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-5 text-stone-500">
          {t("imageSegment.manageHint")}
        </p>
      </div>

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
