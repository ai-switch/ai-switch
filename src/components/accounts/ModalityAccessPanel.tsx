import { useQuery } from "@tanstack/react-query";
import { EndpointRow } from "./EndpointRow";
import { NativeErrorNotice } from "./NativeErrorNotice";
import { getRouteProxyKey, getRouteProxyStatus } from "../../lib/api/client";
import type { AccountModality } from "../../lib/accountModalities";
import { useI18n, type TranslationKey } from "../../lib/i18n";
import { DEFAULT_ROUTE_PROXY_BASE_URL, routeProxyApiEndpoint } from "../../lib/routeProxyEndpoint";

export type MediaModality = Exclude<AccountModality, "general">;

const endpointRows: Record<MediaModality, ReadonlyArray<{ label: TranslationKey; path: string }>> = {
  image: [
    { label: "imageSegment.endpoint", path: "/v1/images/generations" },
    { label: "modalityAccess.imageEdits", path: "/v1/images/edits" },
  ],
  video: [
    { label: "modalityAccess.videoGenerations", path: "/v1/video/generations" },
    { label: "modalityAccess.videos", path: "/v1/videos" },
  ],
  audio: [
    { label: "modalityAccess.audioSpeech", path: "/v1/audio/speech" },
    { label: "modalityAccess.audioTranscriptions", path: "/v1/audio/transcriptions" },
    { label: "modalityAccess.audioTranslations", path: "/v1/audio/translations" },
  ],
  // Native does not implement embeddings: never advertise a working endpoint.
  vector: [],
};

const titleKeys: Record<MediaModality, TranslationKey> = {
  image: "modalityAccess.image",
  video: "modalityAccess.video",
  audio: "modalityAccess.audio",
  vector: "modalityAccess.vector",
};

/** Parameters come from the host's native transport, not a browser localhost fetch. */
export function ModalityAccessPanel({ modality }: { modality: MediaModality }) {
  const { t } = useI18n();
  const statusQuery = useQuery({ queryKey: ["route-proxy-status"], queryFn: getRouteProxyStatus });
  const keyQuery = useQuery({ queryKey: ["route-proxy-key", "codex"], queryFn: () => getRouteProxyKey("codex") });
  const status = statusQuery.data;
  const nativeAddress = status?.base_url?.trim();
  const baseUrl = nativeAddress || DEFAULT_ROUTE_PROXY_BASE_URL;
  const ready = Boolean(status?.running && status.route_access_enabled && nativeAddress && !statusQuery.isError);
  const statusKey: TranslationKey = !status || statusQuery.isError
    ? "modalityAccess.checking"
    : !status.running
      ? "modalityAccess.stopped"
      : !status.route_access_enabled
        ? "modalityAccess.disabled"
        : ready ? "modalityAccess.ready" : "modalityAccess.checking";
  const retry = () => { void statusQuery.refetch(); void keyQuery.refetch(); };

  return (
    <section aria-label={t(titleKeys[modality])} className="min-w-0 shrink-0 border-b border-stone-200 bg-white/80 px-3 py-2" role="region">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-[12px] font-semibold text-stone-700">{t(titleKeys[modality])}</h2>
        {modality !== "vector" ? <p className={`text-[11px] ${ready ? "text-emerald-700" : "text-amber-700"}`} role="status">
          {t(statusKey)} {!nativeAddress ? t("modalityAccess.defaultAddress") : ""}
        </p> : null}
      </div>
      <div className="mt-2 grid min-w-0 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {endpointRows[modality].map(({ label, path }) => (
          <EndpointRow key={path} label={t(label)} value={routeProxyApiEndpoint(baseUrl, path)} />
        ))}
        <EndpointRow label={t("imageSegment.key")} secret value={keyQuery.data ?? null} />
      </div>
      {modality === "vector" ? (
        <p className="mt-2 text-[12px] font-medium text-stone-500">{t("codex.segment.vectorPending")}</p>
      ) : (
        <p className="mt-1.5 text-[11px] leading-4 text-stone-500">
          {t("modalityAccess.sharedKey")}{modality === "image" ? ` ${t("imageSegment.editCaveat")}` : ""}
        </p>
      )}
      {statusQuery.error ? <div className="mt-2"><NativeErrorNotice title={t("modalityAccess.statusError")} error={statusQuery.error} onRetry={retry} retryLabel={t("modalityAccess.retry")} retrying={statusQuery.isFetching || keyQuery.isFetching} /></div> : null}
      {keyQuery.error ? <div className="mt-2"><NativeErrorNotice title={t("modalityAccess.keyError")} error={keyQuery.error} onRetry={retry} retryLabel={t("modalityAccess.retry")} retrying={statusQuery.isFetching || keyQuery.isFetching} /></div> : null}
    </section>
  );
}
