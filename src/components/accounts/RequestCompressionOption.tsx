import { useId } from "react";
import { useI18n } from "../../lib/i18n";
import { requestCompressionMatchedHost, type RequestCompressionMode } from "../../lib/requestCompression";

type Props = {
  mode: RequestCompressionMode;
  baseUrl: string;
  onChange: (mode: RequestCompressionMode) => void;
};

export function RequestCompressionOption({ mode, baseUrl, onChange }: Props) {
  const { t } = useI18n();
  const id = useId();
  const matched = requestCompressionMatchedHost(baseUrl);
  const label = t("accounts.brotliCompression.label");
  const effective = mode === "auto"
    ? matched
      ? t("accounts.brotliCompression.autoMatched", { host: matched })
      : t("accounts.brotliCompression.autoUnmatched")
    : t(mode === "on" ? "accounts.brotliCompression.manualOn" : "accounts.brotliCompression.manualOff");
  return (
    <div className="grid gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-700">
      <label className="flex items-center justify-between gap-3 font-medium">
        <span>{label}</span>
        <select
          aria-label={label}
          aria-describedby={id + "-status " + id + "-hint"}
          value={mode}
          className="shrink-0 cursor-pointer rounded-md border border-stone-200 bg-white px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          onChange={(event) => onChange(event.target.value as RequestCompressionMode)}
        >
          <option value="auto">{t("accounts.brotliCompression.auto")}</option>
          <option value="on">{t("accounts.brotliCompression.on")}</option>
          <option value="off">{t("accounts.brotliCompression.off")}</option>
        </select>
      </label>
      <p id={id + "-status"} className="text-[11px] font-medium text-stone-600" aria-live="polite">{effective}</p>
      <p id={id + "-hint"} className="text-[11px] leading-5 text-stone-500">{t("accounts.brotliCompression.hint")}</p>
    </div>
  );
}
