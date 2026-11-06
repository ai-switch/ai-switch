import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copySensitiveText } from "../../lib/routeCredentialTransfer";

type EndpointRowProps = {
  label: string;
  /** `null` while the value is still being read. */
  value: string | null;
  /** Masked behind a reveal toggle: the pool key routes to every pooled account. */
  secret?: boolean;
};

/** One copyable connection parameter for clients we cannot write directly. */
export function EndpointRow({ label, value, secret = false }: EndpointRowProps) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const copy = async () => {
    if (!value) {
      return;
    }
    try {
      await copySensitiveText(value);
      setError(null);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setError("复制失败：剪贴板不可用。");
    }
  };

  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-semibold text-stone-600">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          aria-label={label}
          autoComplete="off"
          className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2.5 font-mono text-[11px] text-stone-800 outline-none placeholder:font-sans placeholder:text-stone-400"
          onKeyDown={(event) => {
            // The field lives inside the write form, where Enter would submit it.
            if (event.key === "Enter") {
              event.preventDefault();
            }
          }}
          placeholder="读取中..."
          readOnly
          type={secret && !revealed ? "password" : "text"}
          value={value ?? ""}
        />
        {secret ? (
          <button
            aria-label={revealed ? `隐藏 ${label}` : `显示 ${label}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-stone-200 bg-white text-stone-600 motion-control hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={() => setRevealed((current) => !current)}
            title={revealed ? "隐藏" : "显示"}
            type="button"
          >
            {revealed ? (
              <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Eye aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
        <button
          aria-label={`复制 ${label}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-stone-200 bg-white text-stone-600 motion-control hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!value}
          onClick={() => void copy()}
          title={value ? `复制 ${label}` : "本地路由代理尚未就绪"}
          type="button"
        >
          {copied ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {error ? (
        <p className="text-[11px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
