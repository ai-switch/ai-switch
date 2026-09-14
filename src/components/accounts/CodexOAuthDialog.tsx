import { Globe, KeyRound, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cancelCodexOAuth, getCodexOAuthStatus, startCodexOAuth } from "../../lib/api/client";
import type { CodexOAuthMethod, CodexOAuthStatus, ImportedCodexAccount } from "../../lib/api/types";
import { openExternal } from "../../lib/openExternal";
import { copySensitiveText } from "../../lib/routeCredentialTransfer";

const terminalPhases = new Set(["succeeded", "cancelled", "failed", "expired"]);
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-[13px] font-semibold text-stone-700 motion-control hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50";

function loginError(error: unknown, fallback: string): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const messages: Record<string, string> = {
    "codex_oauth.cli_not_found": "未找到官方 Codex CLI。请先安装或更新 Codex CLI，并重启 AI Switch。",
    "codex_oauth.unsupported_cli": "当前 Codex CLI 不支持此登录协议，请更新后重试。",
    "codex_oauth.start_failed": "无法启动 Codex CLI，请检查安装后重试。",
    "codex_oauth.start_timeout": "登录启动超时，请检查网络连接和 Codex CLI。",
    "codex_oauth.storage_policy": "Codex 管理策略不允许隔离的文件凭据存储，请联系管理员或改用 JSON 导入。",
    "codex_oauth.busy": "已有 Codex 登录正在进行，请先完成或取消该登录。",
    "codex_oauth.expired": "授权已超时，请重新选择登录方式。",
    "codex_oauth.login_failed": "授权未完成或被拒绝，请重试；设备码登录需先在账号设置中启用。",
    "codex_oauth.invalid_credentials": "Codex 未生成完整的登录凭据，请更新 CLI 后重试。",
    "codex_oauth.import_failed": "账号导入失败，本次批量未保存，请重试。",
    "codex_oauth.process_exited": "Codex CLI 意外退出，请检查安装后重试。",
    "codex_oauth.cleanup_failed": "临时登录目录未能完全清理，请重启 AI Switch 后再试。",
    "codex_oauth.unsafe_url": "Codex 返回了非预期授权地址，已停止登录。",
  };
  // Do not echo arbitrary protocol/transport errors which may contain credentials.
  return messages[code] ?? fallback;
}

export function CodexOAuthDialog({ batchName, onClose, onImported }: {
  batchName: string;
  onClose: () => void;
  onImported: (account: ImportedCodexAccount) => Promise<void> | void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const sessionId = useRef<string | null>(null);
  const latest = useRef<CodexOAuthStatus | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPromise = useRef<Promise<CodexOAuthStatus> | null>(null);
  const completed = useRef(false);
  const openedUrl = useRef<string | null>(null);
  const closingRef = useRef(false);
  const callbacks = useRef({ onClose, onImported });
  callbacks.current = { onClose, onImported };
  const [snapshot, setSnapshot] = useState<CodexOAuthStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function stopPolling() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      mounted.current = false;
      generation.current += 1;
      stopPolling();
      const id = sessionId.current;
      if (id && !closingRef.current && !completed.current && !terminalPhases.has(latest.current?.status ?? "")) {
        void cancelCodexOAuth(id).catch(() => undefined);
      }
      previousFocus?.focus();
    };
  }, []);

  async function finish(status: CodexOAuthStatus) {
    if (!mounted.current || completed.current || !status.account) return;
    completed.current = true;
    sessionId.current = null;
    stopPolling();
    setCompleting(true);
    try {
      await callbacks.current.onImported(status.account);
      if (mounted.current) callbacks.current.onClose();
    } catch {
      if (mounted.current) setError("账号已导入，但列表或分组同步失败。请关闭弹窗并刷新账号列表，勿重复登录导入。");
    } finally {
      if (mounted.current) setCompleting(false);
    }
  }

  async function openAuthorization(url: string) {
    try {
      await openExternal(url);
      if (mounted.current) setError(null);
    } catch {
      if (mounted.current) setError("无法打开浏览器，请点击“打开授权页面”重试。");
    }
  }

  async function acceptStatus(status: CodexOAuthStatus, token: number) {
    if (!mounted.current || generation.current !== token) return;
    latest.current = status;
    setSnapshot(status);
    setStarting(false);
    if (status.status === "succeeded") {
      if (!status.account) {
        setError("登录已完成，但未返回账号信息，请刷新账号列表后再试。");
        return;
      }
      await finish(status);
      return;
    }
    if (terminalPhases.has(status.status)) {
      sessionId.current = null;
      setError(status.error ? loginError(status.error, "登录未完成，请重试。") : null);
      return;
    }
    if (status.status === "waiting" && status.method === "browser" && status.authorization_url && openedUrl.current !== status.authorization_url) {
      openedUrl.current = status.authorization_url;
      void openAuthorization(status.authorization_url);
    }
    timer.current = setTimeout(() => { void poll(status.session_id, token); }, 500);
  }

  async function poll(id: string, token: number) {
    if (!mounted.current || generation.current !== token) return;
    try {
      const status = await getCodexOAuthStatus(id);
      await acceptStatus(status, token);
    } catch {
      if (!mounted.current || generation.current !== token) return;
      // Stop the backend as well as the timer; a lost frontend must not leave a
      // hidden login capable of importing an account after the user retries.
      try {
        const status = await cancelCodexOAuth(id);
        if (!mounted.current || generation.current !== token) return;
        latest.current = status;
        setSnapshot(status);
        sessionId.current = null;
        if (status.status === "succeeded") { await finish(status); return; }
      } catch {
        if (!mounted.current || generation.current !== token) return;
        // Retain sessionId so Cancel can retry cleanup; do not enable new logins.
      }
      if (mounted.current) setError("登录状态获取失败，请检查连接后重试；若仍在运行，请先取消登录。");
    }
  }

  async function start(method: CodexOAuthMethod) {
    if (startPromise.current || sessionId.current || completed.current) return;
    const name = batchName.trim();
    if (!name) { setError("批量名称不能为空，请返回填写批量名称。"); return; }
    const token = ++generation.current;
    stopPolling();
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    setStarting(true);
    setError(null);
    setNotice(null);
    setSnapshot(null);
    latest.current = null;
    openedUrl.current = null;
    const promise = startCodexOAuth({ method, batch_name: name });
    startPromise.current = promise;
    try {
      const status = await promise;
      if (!mounted.current) {
        await cancelCodexOAuth(status.session_id).catch(() => undefined);
        return;
      }
      sessionId.current = status.session_id;
      if (generation.current !== token) return; // Close owns the late response.
      await acceptStatus(status, token);
    } catch (cause) {
      if (mounted.current && generation.current === token) setError(loginError(cause, "Codex 登录启动失败，请检查 CLI 安装后重试。"));
    } finally {
      if (startPromise.current === promise) startPromise.current = null;
      if (mounted.current) setStarting(false);
    }
  }

  async function close() {
    if (closingRef.current || completing) return;
    closingRef.current = true;
    setClosing(true);
    generation.current += 1;
    stopPolling();
    try {
      let id = sessionId.current;
      if (!id && startPromise.current) {
        const pending = await startPromise.current.catch(() => null);
        id = pending?.session_id ?? null;
      }
      if (id && !completed.current) {
        const status = await cancelCodexOAuth(id);
        if (!mounted.current) return;
        latest.current = status;
        setSnapshot(status);
        if (status.status === "succeeded") { await finish(status); return; }
        if (!terminalPhases.has(status.status)) throw new Error("not stopped");
        if (status.error?.code === "codex_oauth.cleanup_failed") {
          sessionId.current = null;
          setError(loginError(status.error, "临时登录目录未能完全清理。"));
          return;
        }
      }
      sessionId.current = null;
      if (mounted.current) callbacks.current.onClose();
    } catch (cause) {
      if (mounted.current) setError(loginError(cause, "取消登录失败，请重试；后台登录会在超时后自动停止。"));
    } finally {
      closingRef.current = false;
      if (mounted.current) setClosing(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void close(); }
    if (event.key !== "Tab") return;
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), [tabindex='0']");
    if (!controls?.length) { event.preventDefault(); return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const active = starting || closing || completing || (snapshot !== null && !terminalPhases.has(snapshot.status));
  const disabled = active || completed.current;
  const waiting = snapshot?.status === "waiting";
  const statusText = closing ? "正在取消登录并清理临时文件…"
    : completing || snapshot?.status === "importing" ? "授权成功，正在导入账号…"
    : starting || snapshot?.status === "starting" ? "正在启动官方 Codex CLI…"
    : waiting ? snapshot.method === "device_code" ? "等待设备码授权…" : "等待浏览器授权…"
    : snapshot?.status === "succeeded" ? "账号已导入。" : "选择一种登录方式。";

  return (
    <div className="motion-overlay fixed inset-0 z-[60] grid place-items-center bg-stone-950/35 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) void close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown} tabIndex={-1} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h3 id={titleId} className="text-lg font-semibold text-stone-950">OAuth 登录 Codex</h3>
          <button type="button" aria-label="关闭 OAuth 登录" className={buttonClass} disabled={closing || completing} onClick={() => void close()}><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-[13px] leading-6 text-stone-600">使用已安装的官方 Codex CLI 完成授权。登录在独立临时目录中进行，不会覆盖本机 Codex 登录。</p>
        <p className="mt-2 break-all text-[13px] text-stone-600">导入批量：<span className="font-semibold text-stone-900">{batchName.trim() || "未填写"}</span></p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button className={buttonClass} type="button" disabled={disabled} onClick={() => void start("browser")}><Globe className="h-4 w-4" />浏览器授权</button>
          <button className={buttonClass} type="button" disabled={disabled} onClick={() => void start("device_code")}><KeyRound className="h-4 w-4" />设备码授权</button>
        </div>
        <p className="mt-3 text-xs leading-5 text-stone-500">浏览器授权需要本机回调；若回调受阻，可使用设备码授权（需在账号安全设置中启用）。授权最多等待 10 分钟。</p>
        <div role="status" aria-live="polite" className="mt-4 flex items-center gap-2 text-[13px] text-stone-700">{active && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}{statusText}</div>
        {waiting && snapshot.user_code && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-center">
          <p className="text-xs text-blue-800">请在授权页面输入以下一次性设备码，勿分享给他人</p>
          <code className="my-3 block select-all text-2xl font-semibold tracking-widest text-blue-900">{snapshot.user_code}</code>
          <button type="button" className={buttonClass} disabled={closing} onClick={() => {
            void copySensitiveText(snapshot.user_code!).then(() => { if (mounted.current) setNotice("设备码已复制。"); }).catch(() => { if (mounted.current) setError("复制失败，请手动选中设备码复制。"); });
          }}>复制设备码</button>
        </div>}
        {waiting && snapshot.authorization_url && <button type="button" className={`${buttonClass} mt-3 w-full border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100`} disabled={closing} onClick={() => void openAuthorization(snapshot.authorization_url!)}>打开授权页面</button>}
        {notice && <p className="mt-3 text-xs text-emerald-700" aria-live="polite">{notice}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] leading-5 text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end"><button type="button" className={buttonClass} disabled={closing || completing} onClick={() => void close()}>{active ? "取消登录" : "关闭"}</button></div>
      </div>
    </div>
  );
}
