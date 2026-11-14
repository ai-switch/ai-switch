import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkUpdate, getSettings, saveSettings } from "../lib/api/client";
import { useI18n, type Language } from "../lib/i18n";
import { isDesktop } from "../lib/transport";
import { BETA_UPDATE_ENDPOINT, STABLE_UPDATE_ENDPOINT, UPDATE_CHANNEL_CHANGED_EVENT } from "../lib/updateChannel";
import { ReleaseNotes } from "../components/updates/ReleaseNotes";
import { useUpdateResource } from "../components/updates/useUpdateResource";

type DownloadState = {
  downloaded: number;
  total?: number;
};

type UpdateStatus =
  | "updates.statusInitial"
  | "updates.statusChecking"
  | "updates.statusAvailable"
  | "updates.statusLatest"
  | "updates.statusDownloading"
  | "updates.statusInstalled"
  | "updates.statusCheckFailed"
  | "updates.statusInstallFailed";

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function releaseDate(update: Update, language: Language, unknownDate: string) {
  const date = update.date ? new Date(update.date) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(date)
    : unknownDate;
}

export function UpdatesScreen() {
  const { language, t } = useI18n();
  // The updater plugin only exists inside the desktop shell; in a browser its
  // calls throw a bare "Cannot read properties of undefined", which is worse
  // than useless in an error banner.
  const desktop = isDesktop();
  const [update, setUpdate] = useUpdateResource();
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [download, setDownload] = useState<DownloadState>({ downloaded: 0 });
  const [status, setStatus] = useState<UpdateStatus>("updates.statusInitial");
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings, enabled: desktop });
  const betaEnabled = settingsQuery.data?.beta_updates_enabled ?? false;
  const requestVersion = useRef(0);
  const checkInProgress = useRef(false);
  const checkRequired = useRef(false);
  const installingRef = useRef(false);
  const installedRef = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);

  const releaseEndpoints = betaEnabled
    ? [BETA_UPDATE_ENDPOINT, STABLE_UPDATE_ENDPOINT]
    : [STABLE_UPDATE_ENDPOINT];

  const progress = download.total ? Math.min(100, Math.round((download.downloaded / download.total) * 100)) : 0;
  const statusText = status === "updates.statusAvailable" && update
    ? t(status, { version: update.version })
    : t(status);

  const handleCheck = useCallback(async function runCheck() {
    if (!desktop || !mounted.current || checkInProgress.current || installingRef.current || installedRef.current) return;

    const request = ++requestVersion.current;
    checkInProgress.current = true;
    setChecking(true);
    setUpdate(null);
    setError(null);
    setInstalled(false);
    setStatus("updates.statusChecking");
    try {
      const nextUpdate = await checkUpdate();
      if (!mounted.current || request !== requestVersion.current) {
        if (nextUpdate) void nextUpdate.close().catch(() => {});
        return;
      }
      setUpdate(nextUpdate);
      setStatus(nextUpdate ? "updates.statusAvailable" : "updates.statusLatest");
    } catch (cause) {
      if (mounted.current && request === requestVersion.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("updates.statusCheckFailed");
      }
    } finally {
      checkInProgress.current = false;
      if (mounted.current) {
        setChecking(false);
        if (checkRequired.current && !installingRef.current && !installedRef.current) {
          checkRequired.current = false;
          void runCheck();
        }
      }
    }
  }, [desktop, setUpdate]);

  useEffect(() => {
    const onChannelChanged = () => {
      if (installedRef.current) return;
      requestVersion.current += 1;
      checkRequired.current = true;
      if (installingRef.current) return;
      setUpdate(null);
      if (!checkInProgress.current) {
        checkRequired.current = false;
        void handleCheck();
      }
    };
    window.addEventListener(UPDATE_CHANNEL_CHANGED_EVENT, onChannelChanged);
    return () => window.removeEventListener(UPDATE_CHANNEL_CHANGED_EVENT, onChannelChanged);
  }, [handleCheck, setUpdate]);

  const channelMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const settings = await getSettings();
      return saveSettings({ ...settings, beta_updates_enabled: enabled });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["settings"], saved);
      window.dispatchEvent(new Event(UPDATE_CHANNEL_CHANGED_EVENT));
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    },
  });

  const handleInstall = async () => {
    if (!update || checking || channelMutation.isPending || installing) {
      return;
    }

    installingRef.current = true;
    setInstalling(true);
    setError(null);
    setInstalled(false);
    setDownload({ downloaded: 0 });
    setStatus("updates.statusDownloading");
    try {
      let downloaded = 0;
      let total: number | undefined;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
          downloaded = 0;
          setDownload({ downloaded, total });
          return;
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setDownload({ downloaded, total });
          return;
        }

        if (event.event === "Finished") {
          setDownload((current) => ({ ...current, downloaded: current.total ?? current.downloaded }));
        }
      });
      installedRef.current = true;
      setInstalled(true);
      setStatus("updates.statusInstalled");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("updates.statusInstallFailed");
    } finally {
      installingRef.current = false;
      setInstalling(false);
      if (checkRequired.current && !installedRef.current) {
        checkRequired.current = false;
        setUpdate(null);
        void handleCheck();
      }
    }
  };

  const handleRelaunch = async () => {
    if (!desktop) {
      return;
    }

    setError(null);
    try {
      await relaunch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-stone-200 bg-white/82 shadow-sm">
        <div className="border-b border-stone-200 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{t("updates.kicker")}</p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-stone-950">{t("updates.title")}</h1>
          <p className="mt-1 text-[13px] text-stone-600">
            {t("updates.subtitle")}
          </p>
        </div>

        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-stone-950">{t("updates.status")}</p>
                <p className="mt-1 text-[13px] text-stone-600">{statusText}</p>
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-3 py-2 text-[13px] font-semibold text-white motion-control hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                disabled={!desktop || checking || installing || installed || channelMutation.isPending}
                onClick={handleCheck}
                title={desktop ? undefined : t("common.desktopOnly")}
                type="button"
              >
                <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
                {checking ? t("updates.checking") : t("updates.check")}
              </button>
            </div>

            {!desktop && <p className="text-[12px] text-stone-500">{t("common.desktopOnly")}</p>}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {update ? (
              <div className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                      {t("updates.availableRelease")}
                    </p>
                    <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-stone-950">{update.version}</h2>
                    <p className="mt-1 text-[13px] text-stone-500">
                      {releaseDate(update, language, t("updates.unknownDate"))}
                    </p>
                  </div>
                  <button
                    className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-3 py-2 text-[13px] font-semibold text-white motion-control hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                    disabled={checking || channelMutation.isPending || installing || installed}
                    onClick={handleInstall}
                    type="button"
                  >
                    <Download className="h-4 w-4" />
                    {installing ? t("updates.installing") : installed ? t("updates.installed") : t("updates.downloadInstall")}
                  </button>
                </div>

                {installing && (
                  <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
                    <div className="flex items-center justify-between text-[12px] font-semibold text-stone-600">
                      <span>{t("updates.downloadProgress")}</span>
                      <span>
                        {formatBytes(download.downloaded)}
                        {download.total ? ` / ${formatBytes(download.total)}` : ""}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200">
                      <div className="h-full rounded-full bg-stone-900 motion-control" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                {update.body && (
                  <div className="mt-4 max-h-[280px] overflow-auto rounded-xl border border-stone-200 bg-stone-50 p-3">
                    <ReleaseNotes notes={update.body} />
                  </div>
                )}
              </div>
            ) : (
              <div className="grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-stone-200 bg-white text-center">
                <div>
                  <CheckCircle2 className="mx-auto h-8 w-8 text-stone-300" />
                  <p className="mt-2 text-sm font-semibold text-stone-950">{t("updates.noSelection")}</p>
                  <p className="mt-1 text-[13px] text-stone-500">{t("updates.noSelectionBody")}</p>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div>
              <p className="text-[13px] font-semibold text-stone-950">{t("updates.releaseSource")}</p>
              {releaseEndpoints.map((endpoint) => (
                <p className="mt-1 break-all text-[12px] text-stone-500" key={endpoint}>{endpoint}</p>
              ))}
            </div>
            {desktop && settingsQuery.isSuccess && (
              <label className="flex items-start gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-700">
                <input
                  checked={betaEnabled}
                  className="mt-0.5"
                  disabled={checking || installing || installed || channelMutation.isPending}
                  onChange={(event) => channelMutation.mutate(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="font-semibold text-stone-900">{t("updates.betaChannel")}</span>
                  <span className="mt-0.5 block text-stone-500">{t("updates.betaChannelHint")}</span>
                </span>
              </label>
            )}
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900">
              {t("updates.requirements")}
            </div>
            {installed && (
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[13px] font-semibold text-stone-800 motion-control hover:bg-stone-50"
                onClick={handleRelaunch}
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
                {t("updates.relaunch")}
              </button>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
