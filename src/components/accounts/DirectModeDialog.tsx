import { Link2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export const DIRECT_MODE_NOTICE_KEY = "ai-switch:direct-mode-notice:v1";

export function hasAcceptedDirectModeNotice(): boolean {
  try { return localStorage.getItem(DIRECT_MODE_NOTICE_KEY) === "accepted"; } catch { return false; }
}

export function rememberDirectModeNotice() {
  try { localStorage.setItem(DIRECT_MODE_NOTICE_KEY, "accepted"); } catch { /* 下次仍显示说明，不影响已成功的配置写入。 */ }
}

type Props = {
  accountName: string;
  clientName: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function DirectModeDialog({ accountName, clientName, loading, error, onClose, onConfirm }: Props) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => { previous?.focus(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !loading) { event.stopPropagation(); onClose(); }
          if (event.key !== "Tab") return;
          const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']") ?? []);
          const first = focusable[0];
          const last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-stone-950">
            <Link2 aria-hidden="true" className="h-5 w-5 text-amber-600" />启用直连模式
          </h2>
          <button aria-label="关闭直连说明" disabled={loading} onClick={onClose} type="button"
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-40"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-sm text-stone-700">将 {clientName} 直接连接到账号「{accountName}」。</p>
        <div className="mt-4 space-y-3 text-[13px] leading-6 text-stone-600">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
            建议优先使用算力池「精确模式」：指定账号与模型，同时保留代理统计和故障处理能力。
          </p>
          <p>特殊兼容需求可使用直连模式：每个客户端一次只启用一个账号，不经过代理，不使用代理的自动重试和故障切换。</p>
          <p>本操作只修改对应的原生客户端；其他客户端仍保持原配置，算力池服务不会停止。共享同一配置目录的 CLI、IDE 插件等会一起切换。</p>
          <p>直连请求不会进入代理请求日志；本机会话扫描仍可能统计用量。官方账号由原生客户端负责刷新登录，代理只读取最新凭据。</p>
          <p>将备份原配置与认证。切换后请重启客户端；需要恢复算力池时，在「写入路由配置」中勾选该客户端，未勾选的客户端不会被覆盖。</p>
        </div>
        {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancel} disabled={loading} onClick={onClose} type="button" className="rounded-xl border border-stone-200 px-4 py-2 text-sm text-stone-700 disabled:opacity-40">取消</button>
          <button disabled={loading} onClick={onConfirm} type="button" className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{loading ? "正在写入…" : "确认启用直连"}</button>
        </div>
      </div>
    </div>
  );
}
