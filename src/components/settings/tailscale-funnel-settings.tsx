import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  QrCode,
  RefreshCcw,
} from "lucide-react";
import {
  cancelTailscaleFunnelOperation,
  createMobilePairing,
  disableTailscaleFunnel,
  enableTailscaleFunnel,
  getTailscaleFunnelStatus,
  startTailscaleLogin,
  startTailscaleWithAuthKey,
} from "../../lib/api/client";
import type { MobilePairingPayload, TailscaleFunnelStatus } from "../../lib/api/types";
import { ApiClientError } from "../../lib/api/errors";
import { useI18n, type TranslationKey } from "../../lib/i18n";
import { openExternal } from "../../lib/openExternal";
import { isDesktop } from "../../lib/transport";

const ERROR_CODES = [
  "notInstalled",
  "unavailable",
  "needsLogin",
  "stopped",
  "conflict",
  "permissionDenied",
  "timeout",
  "invalidResponse",
  "failed",
  "cancelled",
  "unsupportedBind",
  "busy",
  "cleanupFailed",
  "notOwned",
  "dnsNotReady",
  "deviceApproval",
] as const;

type ErrorCode = (typeof ERROR_CODES)[number];
type Operation = "enable" | "disable" | "cancel";
type Stage = "startWebService" | "connect" | "authorize" | "publish";
type SetupFlow = {
  request: number;
  stopIntent: number;
  abort: AbortController;
  openedUrls: Set<string>;
  mutated: boolean;
};

const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-stone-700 motion-control hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-60";

const PRIMARY_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-xl bg-stone-900 px-3 py-2 text-[13px] font-semibold text-white motion-control hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60";

function errorCode(error: unknown): ErrorCode | null {
  const code =
    error instanceof ApiClientError
      ? error.code
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
  return ERROR_CODES.includes(code as ErrorCode) ? (code as ErrorCode) : null;
}

function isPending(status: TailscaleFunnelStatus | null) {
  return status?.state === "starting" || status?.state === "authorizing";
}

// Only a confirmed HTTPS origin belongs in the service address display. In
// particular, authorization links and credentials never enter that list.
function publicAddress(status: TailscaleFunnelStatus): string | null {
  if (!status.enabled || !status.url) return null;
  try {
    const url = new URL(status.url);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function authorizationAddress(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === "login.tailscale.com" || url.hostname === "tailscale.com")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function needsConnection(status: TailscaleFunnelStatus) {
  return (
    status.prerequisite === "login" ||
    status.prerequisite === "connect" ||
    (!status.prerequisite &&
      (status.state === "needsLogin" || status.state === "stopped"))
  );
}

function needsManualSetup(status: TailscaleFunnelStatus) {
  return (
    !status.installed ||
    status.prerequisite === "install" ||
    status.prerequisite === "startDaemon" ||
    status.prerequisite === "approveDevice" ||
    status.prerequisite === "configureDns" ||
    status.error === "deviceApproval" ||
    status.error === "dnsNotReady" ||
    status.state === "unavailable" ||
    status.state === "conflict"
  );
}

export function TailscaleFunnelSettings({
  onAddressChange,
  refreshVersion,
  serviceRunning,
  serviceBusy,
  ensureWebServiceRunning,
  stopIntent,
  stopIntentVersion,
}: {
  onAddressChange: (
    url: string | null,
    select: "initial" | "enabled" | null,
  ) => void;
  refreshVersion: number;
  serviceRunning: boolean;
  serviceBusy: boolean;
  ensureWebServiceRunning: () => Promise<boolean>;
  stopIntent: { readonly current: number };
  stopIntentVersion: number;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<TailscaleFunnelStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [failure, setFailure] = useState<ErrorCode | "loadFailed" | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [authKey, setAuthKey] = useState("");
  const [copiedAuth, setCopiedAuth] = useState(false);
  const [pairingPayload, setPairingPayload] = useState<MobilePairingPayload | null>(null);
  const [pairingQr, setPairingQr] = useState("");
  const [pairingError, setPairingError] = useState<ApiClientError | null>(null);
  const flow = useRef<SetupFlow | null>(null);
  const handledStopIntent = useRef(stopIntentVersion);
  const mounted = useRef(false);
  const revision = useRef(0);
  const refreshInFlight = useRef(false);
  const operationInFlight = useRef<Operation | null>(null);
  const initialRead = useRef(true);
  const selectWhenEnabled = useRef(false);
  const refreshedVersion = useRef(refreshVersion);
  const refreshRequired = useRef(false);
  const selfStartRefresh = useRef(false);
  const copiedUrlTimer = useRef<number | null>(null);

  const acceptStatus = useCallback(
    (next: TailscaleFunnelStatus) => {
      const url = publicAddress(next);
      onAddressChange(
        url,
        url && selectWhenEnabled.current
          ? "enabled"
          : url && initialRead.current
            ? "initial"
            : null,
      );
      // Autostart restoration can take several status reads before publishing
      // a URL. Retain its initial-selection intent until it settles.
      if (url || (!isPending(next) && !next.desiredEnabled) || next.error) {
        initialRead.current = false;
        if (url || !flow.current) selectWhenEnabled.current = false;
      }
      setStatus(next);
      setFailure(next.error ? (errorCode(next.error) ?? "failed") : null);
    },
    [onAddressChange],
  );

  const refresh = useCallback(async () => {
    if (refreshInFlight.current || operationInFlight.current) return;
    refreshInFlight.current = true;
    const request = ++revision.current;
    const intent = stopIntent.current;
    setRefreshing(true);
    try {
      const next = await getTailscaleFunnelStatus();
      if (
        mounted.current &&
        request === revision.current &&
        intent === stopIntent.current &&
        !refreshRequired.current
      )
        acceptStatus(next);
    } catch (error) {
      if (mounted.current && request === revision.current) {
        initialRead.current = false;
        setFailure(errorCode(error) ?? "loadFailed");
      }
    } finally {
      if (mounted.current && request === revision.current) {
        refreshInFlight.current = false;
        setRefreshing(false);
      }
    }
  }, [acceptStatus, stopIntent]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      const ownedFlow = flow.current;
      ownedFlow?.abort.abort();
      flow.current = null;
      // Leaving a background restoration alone is intentional. Only this
      // page's user-initiated operation belongs to this cleanup.
      if (ownedFlow?.mutated) {
        void cancelTailscaleFunnelOperation().catch(() => {});
      }
      if (copiedUrlTimer.current !== null) {
        window.clearTimeout(copiedUrlTimer.current);
      }
      revision.current += 1;
      refreshInFlight.current = false;
      operationInFlight.current = null;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const pending = isPending(status);
  const active = status?.enabled || status?.desiredEnabled;
  useEffect(() => {
    if (operation || serviceBusy || (!pending && !active)) return;
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      pending ? 2000 : 10000,
    );
    return () => window.clearInterval(timer);
  }, [active, pending, refresh, operation, serviceBusy]);

  useEffect(() => {
    if (handledStopIntent.current === stopIntentVersion) return;
    handledStopIntent.current = stopIntentVersion;
    // The parent's ref changes synchronously, before stopWebServer awaits.
    // This effect only clears presentation and any waiting timer.
    flow.current?.abort.abort();
    flow.current = null;
    revision.current += 1;
    operationInFlight.current = null;
    refreshInFlight.current = false;
    selectWhenEnabled.current = false;
    setOperation(null);
    setStage(null);
    setRefreshing(false);
    setPairingPayload(null);
  }, [stopIntentVersion]);

  useEffect(() => {
    let activeEffect = true;
    if (!pairingPayload) {
      setPairingQr("");
      return () => {
        activeEffect = false;
      };
    }
    void QRCode.toDataURL(JSON.stringify(pairingPayload), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
    })
      .then((value) => {
        if (activeEffect) setPairingQr(value);
      })
      .catch(() => {
        if (activeEffect) setPairingQr("");
      });
    return () => {
      activeEffect = false;
    };
  }, [pairingPayload]);

  function isCurrent(setup: SetupFlow) {
    return (
      mounted.current &&
      flow.current === setup &&
      setup.request === revision.current &&
      setup.stopIntent === stopIntent.current &&
      !setup.abort.signal.aborted
    );
  }

  async function openAuthorization(url: string, request = revision.current) {
    try {
      await openExternal(url);
    } catch {
      if (mounted.current && request === revision.current) setOpenFailed(true);
    }
  }

  // Each wait belongs to the initiating sequence. Background effects only read
  // status; they never start login, retry enable, or open authorization pages.
  async function waitUntilSettled(
    setup: SetupFlow,
    next: TailscaleFunnelStatus,
    pendingStage: Stage,
  ): Promise<TailscaleFunnelStatus | null> {
    while (isCurrent(setup)) {
      acceptStatus(next);
      const url = authorizationAddress(next.authUrl ?? null);
      if (isPending(next)) setStage(url ? "authorize" : pendingStage);
      if (
        setup.mutated &&
        url &&
        !next.error &&
        isDesktop() &&
        !setup.openedUrls.has(url)
      ) {
        setup.openedUrls.add(url);
        void openAuthorization(url, setup.request);
      }
      if (!isPending(next) || next.error) return next;
      await new Promise<void>((resolve) => {
        const signal = setup.abort.signal;
        const done = () => {
          window.clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = window.setTimeout(done, 2000);
        signal.addEventListener("abort", done, { once: true });
      });
      if (!isCurrent(setup)) return null;
      next = await getTailscaleFunnelStatus();
    }
    return null;
  }

  async function enablePublicAccess() {
    if (!status || serviceBusy || refreshInFlight.current || operationInFlight.current)
      return;
    const setup: SetupFlow = {
      request: ++revision.current,
      stopIntent: stopIntent.current,
      abort: new AbortController(),
      openedUrls: new Set(),
      mutated: false,
    };
    flow.current = setup;
    operationInFlight.current = "enable";
    selectWhenEnabled.current = true;
    setOperation("enable");
    setFailure(null);
    setOpenFailed(false);
    let loggedIn = false;
    try {
      let next = status;
      if (!serviceRunning) {
        setStage("startWebService");
        selfStartRefresh.current = true;
        const started = await ensureWebServiceRunning();
        if (!isCurrent(setup) || !started) return;
        // A stopped old backend cannot identify which service was stopped.
        // Re-read after our Web start before deciding whether to connect.
        next = await getTailscaleFunnelStatus();
        if (!isCurrent(setup)) return;
        acceptStatus(next);
      }
      if (needsManualSetup(next)) {
        acceptStatus(next);
        return;
      }
      if (isPending(next)) {
        const settled = await waitUntilSettled(setup, next, "publish");
        if (!settled || !isCurrent(setup)) return;
        next = settled;
        if (next.error || needsManualSetup(next)) return;
      }
      const connect = async () => {
        loggedIn = true;
        setup.mutated = true;
        setStage("connect");
        return waitUntilSettled(setup, await startTailscaleLogin(), "connect");
      };
      if (needsConnection(next)) {
        const connected = await connect();
        if (!connected || !isCurrent(setup)) return;
        next = connected;
        if (next.error || needsManualSetup(next) || needsConnection(next)) return;
      }
      if (!isCurrent(setup) || next.enabled) return;
      setStage("publish");
      setup.mutated = true;
      let published = await waitUntilSettled(
        setup,
        await enableTailscaleFunnel(),
        "publish",
      );
      if (!published || !isCurrent(setup)) return;
      // Tailscale can discover login is needed only on enable. One login and
      // one post-login enable are allowed; no retry loop follows errors.
      if (
        !loggedIn &&
        !needsManualSetup(published) &&
        published.state === "needsLogin" &&
        (!published.error || published.error === "needsLogin")
      ) {
        const connected = await connect();
        if (
          !connected ||
          !isCurrent(setup) ||
          connected.error ||
          needsManualSetup(connected) ||
          needsConnection(connected)
        )
          return;
        setStage("publish");
        published = await waitUntilSettled(
          setup,
          await enableTailscaleFunnel(),
          "publish",
        );
        if (!published || !isCurrent(setup)) return;
      }
    } catch (error) {
      if (isCurrent(setup)) setFailure(errorCode(error) ?? "failed");
    } finally {
      if (isCurrent(setup)) {
        flow.current = null;
        operationInFlight.current = null;
        selectWhenEnabled.current = false;
        setOperation(null);
        setStage(null);
      }
    }
  }

  // Headless-friendly alternative to the browser authorization flow: submit a
  // Tailscale auth key once; the key is never stored.
  async function connectWithAuthKey() {
    const key = authKey.trim();
    if (!key || !status || operationInFlight.current || serviceBusy) return;
    const setup: SetupFlow = {
      request: ++revision.current,
      stopIntent: stopIntent.current,
      abort: new AbortController(),
      openedUrls: new Set(),
      mutated: true,
    };
    flow.current = setup;
    operationInFlight.current = "enable";
    selectWhenEnabled.current = true;
    setOperation("enable");
    setFailure(null);
    setOpenFailed(false);
    try {
      setStage("connect");
      const connected = await waitUntilSettled(
        setup,
        await startTailscaleWithAuthKey(key),
        "connect",
      );
      if (connected) setAuthKey("");
      if (!connected || !isCurrent(setup) || connected.error) return;
      if (!isCurrent(setup) || connected.enabled) return;
      setStage("publish");
      await waitUntilSettled(setup, await enableTailscaleFunnel(), "publish");
    } catch (error) {
      if (isCurrent(setup)) setFailure(errorCode(error) ?? "failed");
    } finally {
      if (isCurrent(setup)) {
        flow.current = null;
        operationInFlight.current = null;
        selectWhenEnabled.current = false;
        setOperation(null);
        setStage(null);
      }
    }
  }

  async function runOperation(kind: "disable" | "cancel") {
    if (operationInFlight.current === "cancel") return;
    if (
      kind !== "cancel" &&
      (serviceBusy || refreshInFlight.current || operationInFlight.current)
    )
      return;
    flow.current?.abort.abort();
    flow.current = null;
    operationInFlight.current = kind;
    const request = ++revision.current;
    const intent = stopIntent.current;
    refreshInFlight.current = false;
    selectWhenEnabled.current = false;
    setRefreshing(false);
    setStage(null);
    setOperation(kind);
    setFailure(null);
    try {
      const next = await (kind === "cancel"
        ? cancelTailscaleFunnelOperation()
        : disableTailscaleFunnel());
      if (
        mounted.current &&
        request === revision.current &&
        intent === stopIntent.current
      )
        acceptStatus(next);
    } catch (error) {
      if (mounted.current && request === revision.current)
        setFailure(errorCode(error) ?? "failed");
    } finally {
      if (mounted.current && request === revision.current) {
        operationInFlight.current = null;
        setOperation(null);
      }
    }
  }

  const busy = refreshing || operation !== null || serviceBusy;
  useEffect(() => {
    if (refreshedVersion.current !== refreshVersion) {
      refreshedVersion.current = refreshVersion;
      // Our sequence already reads status after starting Web. A second read
      // here could overwrite its confirmed URL with an older observation.
      refreshRequired.current = !selfStartRefresh.current;
      selfStartRefresh.current = false;
    }
    if (refreshRequired.current && !busy) {
      refreshRequired.current = false;
      void refresh();
    }
  }, [busy, refresh, refreshVersion]);

  const canCancel = pending || operation === "enable";
  const canDisable = status?.owned || status?.desiredEnabled;
  const canEnable = status?.installed && !status.enabled;
  const authUrl = authorizationAddress(status?.authUrl ?? null);
  const publicUrl = status ? publicAddress(status) : null;
  const prerequisite =
    status?.prerequisite ??
    (status?.state === "notInstalled"
      ? "install"
      : status?.state === "needsLogin"
        ? "login"
        : status?.state === "stopped"
          ? serviceRunning
            ? "connect"
            : "startWebService"
          : null);
  const copyAuthUrl = async () => {
    if (!authUrl || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(authUrl);
    setCopiedAuth(true);
    if (copiedUrlTimer.current !== null) window.clearTimeout(copiedUrlTimer.current);
    copiedUrlTimer.current = window.setTimeout(() => setCopiedAuth(false), 1600);
  };

  const copyPublicUrl = async (url: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(url);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-stone-950">
            {t("settings.webService.funnel.title")}
          </h3>
          <p className="text-[12px] text-stone-500">
            {t("settings.webService.funnel.description")}
          </p>
        </div>
        <button
          aria-label={t("settings.webService.funnel.refresh")}
          className={BUTTON_CLASS}
          disabled={busy}
          onClick={() => void refresh()}
          title={t("settings.webService.funnel.refresh")}
          type="button"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-600">
        <p className="text-[13px] text-stone-900" role="status">
          {stage
            ? t(`settings.webService.funnel.stages.${stage}` as TranslationKey)
            : operation
              ? t("settings.webService.funnel.processing")
              : status
                ? t(`settings.webService.funnel.states.${status.state}` as TranslationKey)
                : t("settings.webService.funnel.loading")}
        </p>
        {prerequisite && !stage ? (
          <p className="mt-1 text-stone-500">
            {t(`settings.webService.funnel.hints.${prerequisite}` as TranslationKey)}
          </p>
        ) : null}
        {stage === "authorize" ? (
          <p className="mt-1 text-stone-500">
            {t("settings.webService.funnel.authorizationHint")}
          </p>
        ) : null}
        {openFailed ? (
          <p className="mt-1 text-red-700" role="alert">
            {t("settings.webService.funnel.openAuthFailed")}
          </p>
        ) : null}
        {status?.enabled && !status.owned && !status.desiredEnabled ? (
          <p className="mt-1 text-stone-500">
            {t("settings.webService.funnel.externalManaged")}
          </p>
        ) : null}
        {failure ? (
          <p className="mt-1 text-red-700" role="alert">
            {failure === "loadFailed"
              ? t("settings.webService.funnel.loadFailed")
              : t(`settings.webService.funnel.errors.${failure}` as TranslationKey)}
          </p>
        ) : null}
        {publicUrl ? (
          <p className="mt-1 font-mono text-[12px] text-emerald-700">{publicUrl}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {status?.state === "notInstalled" ? (
          <button
            className={BUTTON_CLASS}
            onClick={() => void openExternal("https://tailscale.com/download")}
            type="button"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("settings.webService.funnel.install")}
          </button>
        ) : null}
        {canEnable && !canCancel ? (
          <button
            className={PRIMARY_BUTTON_CLASS}
            disabled={busy || (!!status && needsManualSetup(status))}
            onClick={() => void enablePublicAccess()}
            type="button"
          >
            {t("settings.webService.funnel.enable")}
          </button>
        ) : null}
        {canDisable && !canCancel ? (
          <button
            className={BUTTON_CLASS}
            disabled={busy}
            onClick={() => void runOperation("disable")}
            type="button"
          >
            {t("settings.webService.funnel.disable")}
          </button>
        ) : null}
        {canCancel ? (
          <button
            className={BUTTON_CLASS}
            disabled={operation === "cancel" || (serviceBusy && operation !== "enable")}
            onClick={() => void runOperation("cancel")}
            type="button"
          >
            {t("settings.webService.funnel.cancel")}
          </button>
        ) : null}
      </div>

      {authUrl ? (
        <div className="space-y-2">
          <code className="block select-all break-all text-[11px] text-stone-700">{authUrl}</code>
          <div className="flex flex-wrap gap-2">
            <button
              className={BUTTON_CLASS}
              onClick={() => void openAuthorization(authUrl)}
              type="button"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("settings.webService.funnel.openAuth")}
            </button>
            <button className={BUTTON_CLASS} onClick={() => void copyAuthUrl()} type="button">
              {copiedAuth ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {t("settings.webService.funnel.copyAuth")}
            </button>
          </div>
        </div>
      ) : null}

      {status?.installed && needsConnection(status) && !authUrl ? (
        <div className="space-y-2">
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-stone-600">
            <span>{t("settings.webService.funnel.authKey")}</span>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label={t("settings.webService.funnel.authKey")}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-900 outline-none motion-control focus:border-stone-400 focus:ring-2 focus:ring-stone-100"
                onChange={(event) => setAuthKey(event.target.value)}
                placeholder={t("settings.webService.funnel.authKeyPlaceholder")}
                type="password"
                value={authKey}
              />
              <button
                className={PRIMARY_BUTTON_CLASS}
                disabled={busy || authKey.trim().length === 0}
                onClick={() => void connectWithAuthKey()}
                type="button"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {t("settings.webService.funnel.connectAuthKey")}
              </button>
            </div>
          </label>
          <p className="text-[11px] text-stone-500">
            {t("settings.webService.funnel.authKeyHint")}
          </p>
        </div>
      ) : null}

      {publicUrl ? (
        <div className="space-y-2 rounded-xl border border-stone-200 bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-stone-800">
              {t("settings.webService.funnel.mobilePairing")}
            </p>
            <button
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={() => {
                void createMobilePairing(false)
                  .then((payload) => {
                    setPairingError(null);
                    setPairingPayload(payload);
                  })
                  .catch((error) => {
                    setPairingPayload(null);
                    setPairingError(
                      error instanceof ApiClientError ? error : null,
                    );
                  });
              }}
              type="button"
            >
              <QrCode className="h-3 w-3" />
              {t("settings.webService.funnel.showPairingQr")}
            </button>
          </div>
          <ul className="space-y-1.5">
            <li className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-2.5 py-1.5 text-[12px] text-stone-700">
              <span className="min-w-0 truncate font-mono">{publicUrl}</span>
              <button
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:border-stone-300"
                onClick={() => void copyPublicUrl(publicUrl)}
                type="button"
              >
                <Copy className="h-3 w-3" />
                {t("settings.webService.funnel.copyUrl")}
              </button>
            </li>
          </ul>
          {pairingError ? (
            <div className="space-y-1.5">
              <p className="text-[12px] text-red-700">
                {pairingError.code === "mobile_pairing.remote_url_unreachable"
                  ? t("settings.webService.funnel.pairingUnreachable")
                  : t("settings.webService.funnel.pairingError")}
              </p>
              {pairingError.details ?? pairingError.message ? (
                <p className="break-all text-[11px] text-stone-500">
                  {pairingError.details ?? pairingError.message}
                </p>
              ) : null}
              {pairingError.code === "mobile_pairing.remote_url_unreachable" ? (
                <button
                  className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy}
                  onClick={() => {
                    void createMobilePairing(true)
                      .then((payload) => {
                        setPairingError(null);
                        setPairingPayload(payload);
                      })
                      .catch(() => {});
                  }}
                  type="button"
                >
                  {t("settings.webService.funnel.pairingForce")}
                </button>
              ) : null}
            </div>
          ) : null}
          {pairingPayload ? (
            <div className="flex flex-wrap items-start gap-3 rounded-lg border border-sky-100 bg-sky-50/60 p-2.5">
              {pairingQr ? (
                <img
                  alt={t("settings.webService.funnel.pairingQrAlt")}
                  className="h-40 w-40 rounded-lg bg-white p-1"
                  src={pairingQr}
                />
              ) : (
                <div className="grid h-40 w-40 place-items-center rounded-lg bg-white text-[11px] text-stone-500">
                  {t("settings.webService.funnel.pairingQrLoading")}
                </div>
              )}
              <div className="min-w-[180px] flex-1 space-y-1 text-[12px] text-stone-700">
                <p className="font-semibold text-stone-900">
                  {t("settings.webService.funnel.pairingTitle")}
                </p>
                <p>
                  {t("settings.webService.funnel.pairingCode", {
                    value: pairingPayload.pairingCode,
                  })}
                </p>
                <p>
                  {t("settings.webService.funnel.pairingExpires", {
                    value: new Date(pairingPayload.expiresAt).toLocaleTimeString(),
                  })}
                </p>
                <p className="text-stone-500">
                  {t("settings.webService.funnel.pairingHint")}
                </p>
                <button
                  className="mt-1 inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:border-stone-300"
                  onClick={() => setPairingPayload(null)}
                  type="button"
                >
                  {t("settings.webService.funnel.closePairing")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
