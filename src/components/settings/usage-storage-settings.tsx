import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Database, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  clearUsageResponseBodies,
  compactUsageHistory,
  getUsageHistoryStorage,
} from "../../lib/api/client";
import { formatByteSize } from "../../lib/byteSize";
import { useI18n } from "../../lib/i18n";
import { isDesktop } from "../../lib/transport";

const STORAGE_QUERY_KEY = ["usage-history-storage"] as const;

/** The preset "older than" windows the cleanup offers, in days; 0 means all. */
const CLEANUP_DAY_OPTIONS = [7, 30, 90, 0] as const;

/**
 * Below this, reclaiming costs more than it is worth.
 *
 * `VACUUM` rewrites the whole database under an exclusive lock, and a file with
 * a megabyte of slack reopens with a megabyte of slack. Offering the button for
 * smaller amounts would invite a multi-second stall to recover nothing the user
 * can perceive.
 */
const WORTH_RECLAIMING_BYTES = 16 * 1024 * 1024;

/**
 * Reports and reclaims the database's unused space.
 *
 * The proxy keeps a response preview per request and `usage_events` is never
 * pruned, so the file grows without bound. Previews have been stored compressed
 * since this shipped, and history is compacted on startup, but neither returns
 * the freed bytes to the filesystem — only a compaction does, and it blocks
 * everything else while it runs. That is why it lives here behind a button
 * rather than happening silently on upgrade.
 */
export function UsageStorageSettings() {
  const desktop = isDesktop();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [cleanupDays, setCleanupDays] = useState<number>(30);
  const storageQuery = useQuery({
    queryKey: STORAGE_QUERY_KEY,
    queryFn: getUsageHistoryStorage,
    enabled: desktop,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const compactMutation = useMutation({
    mutationFn: compactUsageHistory,
    onSuccess: (result) => {
      queryClient.setQueryData(STORAGE_QUERY_KEY, result);
    },
  });
  const cleanupMutation = useMutation({
    mutationFn: () => clearUsageResponseBodies(cleanupDays),
    onSuccess: (result) => {
      // The cleanup reports the fresh freelist size, so keep the compaction
      // card's figure in step without an extra round trip.
      queryClient.setQueryData(STORAGE_QUERY_KEY, {
        reclaimable_bytes: result.reclaimableBytes,
      });
    },
  });

  // The web transport can reach these commands, but compaction stalls the whole
  // app on the machine hosting the database, which is not a call a remote
  // browser should be making. `is_sensitive_command` already requires auth.
  if (!desktop) {
    return null;
  }

  const reclaimable = storageQuery.data?.reclaimable_bytes ?? 0;
  const worthReclaiming = reclaimable >= WORTH_RECLAIMING_BYTES;

  return (
    <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50/70 p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-stone-600 shadow-sm ring-1 ring-stone-200">
          <Database aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-stone-800">
            {t("settings.storage.title")}
          </h3>
          <p className="mt-1 text-[11px] font-medium text-stone-500">
            {t("settings.storage.subtitle")}
          </p>
          <p className="mt-1.5 text-[12px] font-semibold text-stone-700">
            {t("settings.storage.freeable", { size: formatByteSize(reclaimable) })}
          </p>
        </div>
      </div>

      <button
        className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 shadow-sm motion-control hover:border-stone-300 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-55"
        disabled={compactMutation.isPending || storageQuery.isPending}
        onClick={() => compactMutation.mutate()}
        type="button"
      >
        {compactMutation.isPending ? (
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        <span>{t("settings.storage.action")}</span>
      </button>

      {/* `VACUUM` writes a full copy before replacing the original, so a disk
          without room for a second database would fail partway through. */}
      <p className="text-[11px] font-medium text-stone-500">
        {t("settings.storage.hint", { size: formatByteSize(reclaimable) })}
      </p>
      {!worthReclaiming && storageQuery.data ? (
        <p className="text-[11px] font-medium text-stone-500">{t("settings.storage.nothingToDo")}</p>
      ) : null}
      {compactMutation.data && compactMutation.data.reclaimable_bytes === 0 ? (
        <p className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <Check aria-hidden="true" className="h-3 w-3" />
          {t("settings.storage.done")}
        </p>
      ) : null}
      {storageQuery.isError || compactMutation.isError ? (
        <p className="text-[11px] font-medium text-red-700">{t("settings.storage.error")}</p>
      ) : null}

      <div className="mt-1 border-t border-stone-200 pt-3">
        <h4 className="text-[12px] font-semibold text-stone-800">
          {t("settings.storage.cleanup.title")}
        </h4>
        <p className="mt-1 text-[11px] font-medium text-stone-500">
          {t("settings.storage.cleanup.subtitle")}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-medium text-stone-600" htmlFor="cleanup-range">
            {t("settings.storage.cleanup.rangeLabel")}
          </label>
          <select
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[12px] font-medium text-stone-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            disabled={cleanupMutation.isPending}
            id="cleanup-range"
            onChange={(event) => setCleanupDays(Number(event.target.value))}
            value={cleanupDays}
          >
            {CLEANUP_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {t(`settings.storage.cleanup.range.${days}`)}
              </option>
            ))}
          </select>

          <button
            className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 shadow-sm motion-control hover:border-stone-300 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={cleanupMutation.isPending}
            onClick={() => cleanupMutation.mutate()}
            type="button"
          >
            {cleanupMutation.isPending ? (
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            <span>{t("settings.storage.cleanup.action")}</span>
          </button>
        </div>

        {cleanupMutation.data ? (
          cleanupMutation.data.clearedRows > 0 ? (
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
              <Check aria-hidden="true" className="h-3 w-3" />
              {t("settings.storage.cleanup.done", {
                rows: String(cleanupMutation.data.clearedRows),
                size: formatByteSize(cleanupMutation.data.reclaimableBytes),
              })}
            </p>
          ) : (
            <p className="mt-2 text-[11px] font-medium text-stone-500">
              {t("settings.storage.cleanup.doneNothing")}
            </p>
          )
        ) : null}
        {cleanupMutation.isError ? (
          <p className="mt-2 text-[11px] font-medium text-red-700">
            {t("settings.storage.cleanup.error")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
