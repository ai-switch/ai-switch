import type { ReactNode } from "react";

export function formatApiError(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; details?: unknown; code?: unknown };
    const message = typeof record.message === "string" ? record.message.trim() : "";
    const details = typeof record.details === "string" ? record.details.trim() : "";
    if (message && details) return `${message} (${details})`;
    if (message) return message;
    if (details) return details;
    if (typeof record.code === "string" && record.code.trim()) return record.code;
  }
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

/** Keep the native diagnosis visible; a failed read is not an empty/success state. */
export function NativeErrorNotice({
  title,
  error,
  onRetry,
  retryLabel,
  retrying = false,
  children,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  children?: ReactNode;
}) {
  const record = error && typeof error === "object"
    ? error as { message?: unknown; details?: unknown; code?: unknown }
    : null;
  const code = typeof record?.code === "string" ? record.code.trim() : "";
  const details = typeof record?.details === "string" ? record.details.trim() : "";
  const summary = details && typeof record?.message === "string" && record.message.trim()
    ? formatApiError({ message: record.message }, title)
    : formatApiError(error, title);

  return (
    <div aria-label={title} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 break-words">
          <p><span className="font-semibold">{title}：</span>{summary}</p>
          {code ? <p className="mt-1 font-mono text-[11px]">{code}</p> : null}
        </div>
        {onRetry ? (
          <button className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1 font-semibold motion-control hover:bg-red-100 disabled:opacity-50" disabled={retrying} onClick={onRetry} type="button">
            {retryLabel}
          </button>
        ) : null}
      </div>
      {details ? (
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold">诊断详情</summary>
          <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{details}</pre>
        </details>
      ) : null}
      {children}
    </div>
  );
}
