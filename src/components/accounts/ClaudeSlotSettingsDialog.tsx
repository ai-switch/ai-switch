import { X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { ClaudeSlotPlan } from "../../lib/api/types";
import {
  CLAUDE_FALLBACK_ALIAS,
  CLAUDE_SUBAGENT_ALIAS,
  claudeRoleForAlias,
} from "../../lib/claude-roles";

/**
 * Claude Code cannot discover models from the pool: its `/model` menu is four
 * fixed env slots plus a subagent and a fallback key. This dialog is the only
 * place a user can pin them.
 *
 * The row layout mirrors the old Claude-platform account mapping form in
 * `AccountsScreen` (role / requested model / display name / 1M flag). That form
 * became unreachable when the account pool was unified to `platform="codex"`,
 * so the slot editor now lives here instead.
 *
 * Overrides are stored per model mode: routing (precise) mode only accepts
 * `<account>/<alias>` ids while aggregate mode accepts bare `<alias>` ids, and
 * a choice made in one mode must never leak into the other.
 */

type SlotOverrideValue = {
  model?: string | null;
  display_name?: string | null;
  supports_1m?: boolean;
};

type SlotOverrideSet = {
  slots?: Record<string, SlotOverrideValue>;
  subagent_model?: string | null;
  fallback_model?: string | null;
};

type SlotOverrides = {
  aggregate?: SlotOverrideSet;
  precise?: SlotOverrideSet;
};

type SlotRow = {
  alias: string;
  label: string;
  hint: string | null;
  editableLabel: boolean;
  supportsOneM: boolean;
  /** True = leave this row to the automatic pool-consensus resolver. */
  auto: boolean;
  model: string;
  displayName: string;
  supports1m: boolean;
};

export type ClaudeSlotSettingsPayload = {
  overridesJson: string;
  clientConfigJson: string | null;
};

export type ClaudeSlotSettingsDialogProps = {
  plan: ClaudeSlotPlan | null | undefined;
  overridesJson?: string | null;
  clientConfigJson?: string | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (payload: ClaudeSlotSettingsPayload) => void;
  onOpenAccounts: () => void;
};

function parseOverrides(raw: string | null | undefined): SlotOverrides {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as SlotOverrides;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function initialRows(plan: ClaudeSlotPlan | null | undefined, raw: string | null | undefined): SlotRow[] {
  const mode = plan?.model_mode === "precise" ? "precise" : "aggregate";
  const saved = parseOverrides(raw)[mode];
  const slots = new Map(plan?.slots.map((slot) => [slot.alias, slot]) ?? []);

  const aliases = [
    ...(plan?.slots.map((slot) => slot.alias) ?? []),
    CLAUDE_SUBAGENT_ALIAS,
    CLAUDE_FALLBACK_ALIAS,
  ];

  return aliases.map((alias) => {
    const role = claudeRoleForAlias(alias);
    const slot = slots.get(alias);
    const override = saved?.slots?.[alias];
    const extraOverride =
      alias === CLAUDE_SUBAGENT_ALIAS
        ? saved?.subagent_model
        : alias === CLAUDE_FALLBACK_ALIAS
          ? saved?.fallback_model
          : undefined;
    const hasOverride = override !== undefined || extraOverride !== undefined;
    const automaticModel =
      slot?.model ??
      (alias === CLAUDE_SUBAGENT_ALIAS ? plan?.subagent_model : plan?.fallback_model) ??
      null;
    const model = override?.model ?? extraOverride ?? automaticModel ?? "";
    return {
      alias,
      label: role?.label ?? alias,
      hint: role?.hint ?? null,
      editableLabel: role?.editableLabel ?? true,
      supportsOneM: role?.supportsOneM ?? true,
      auto: !hasOverride,
      model: model ?? "",
      displayName: override?.display_name ?? slot?.display_name ?? "",
      supports1m: override?.supports_1m ?? false,
    };
  });
}

export function ClaudeSlotSettingsDialog({
  plan,
  overridesJson,
  clientConfigJson,
  saving = false,
  error,
  onClose,
  onSave,
  onOpenAccounts,
}: ClaudeSlotSettingsDialogProps) {
  const [rows, setRows] = useState<SlotRow[]>(() => initialRows(plan, overridesJson));
  const [clientConfigDraft, setClientConfigDraft] = useState(clientConfigJson ?? "");
  const [configError, setConfigError] = useState<string | null>(null);

  // Switching the pool's model mode changes which ids are valid; reload the
  // saved branch instead of carrying a `<account>/<alias>` into aggregate mode.
  const mode = plan?.model_mode === "precise" ? "precise" : "aggregate";
  useEffect(() => {
    setRows(initialRows(plan, overridesJson));
    // `overridesJson` is intentionally omitted: receiving a freshly saved value
    // must not reset rows the user is still editing in this open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, plan?.available_models.join("|")]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  const update = (alias: string, patch: Partial<SlotRow>) => {
    setRows((current) => current.map((row) => (row.alias === alias ? { ...row, ...patch } : row)));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let parsedClientConfig: unknown;
    const trimmed = clientConfigDraft.trim();
    if (trimmed) {
      try {
        parsedClientConfig = JSON.parse(trimmed);
      } catch {
        setConfigError("不是合法的 JSON。");
        return;
      }
      if (
        typeof parsedClientConfig !== "object" ||
        parsedClientConfig === null ||
        Array.isArray(parsedClientConfig)
      ) {
        setConfigError('需要一个 JSON 对象，例如 {"includeCoAuthoredBy": false}。');
        return;
      }
    }
    setConfigError(null);

    const existing = parseOverrides(overridesJson);
    const slots: Record<string, SlotOverrideValue> = {};
    let subagent_model: string | undefined;
    let fallback_model: string | undefined;
    for (const row of rows) {
      if (row.auto) continue;
      if (row.alias === CLAUDE_SUBAGENT_ALIAS) {
        subagent_model = row.model.trim();
        continue;
      }
      if (row.alias === CLAUDE_FALLBACK_ALIAS) {
        fallback_model = row.model.trim();
        continue;
      }
      slots[row.alias] = {
        model: row.model.trim(),
        display_name: row.displayName.trim() || null,
        supports_1m: row.supports1m,
      };
    }
    const set: SlotOverrideSet = { slots };
    if (subagent_model !== undefined) set.subagent_model = subagent_model;
    if (fallback_model !== undefined) set.fallback_model = fallback_model;

    onSave({
      overridesJson: JSON.stringify({ ...existing, [mode]: set }),
      clientConfigJson: trimmed || null,
    });
  };

  const routingMode = mode === "precise";

  return (
    <div
      className="motion-overlay fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        aria-label="设置 Claude Code 模型槽位映射"
        aria-modal="true"
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-stone-300/70"
        noValidate
        onSubmit={submit}
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 bg-stone-50 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-stone-950">
              设置 Claude Code 模型槽位映射
            </h2>
            <p className="mt-0.5 text-[11px] leading-5 text-stone-500">
              Claude Code 只有固定的 /model 槽位，不能像其他 Agent 那样自由扩展模型清单。
            </p>
          </div>
          <button
            aria-label="关闭 Claude Code 槽位设置"
            className="grid h-7 w-7 shrink-0 place-items-center text-stone-500 motion-control hover:bg-stone-200 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="rounded-lg bg-stone-50 px-3 py-2 text-[11px] leading-5 text-stone-600">
            <p>
              当前模型清单：<span className="font-semibold text-stone-900">
                {routingMode ? "路由模式" : "聚合模式"}
              </span>
              。{routingMode
                ? "模型 id 形如「账号/别名」，请求会钉在该账号。"
                : "模型 id 是裸别名，同名模型在池内轮换。"}
            </p>
            <p className="mt-0.5">
              槽位映射按模式分别保存，切换后互不影响；「自动」的行由账号模型映射共识解析，新增账号会自动生效。
            </p>
          </div>

          <div className="mt-3 grid gap-2" data-testid="claude-slot-editor">
            {rows.map((row) => (
              <div
                className="grid gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] sm:items-center"
                key={row.alias}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-stone-900">{row.label}</span>
                    <label className="flex items-center gap-1 text-[11px] text-stone-600">
                      <input
                        aria-label={`${row.label} 自动解析`}
                        checked={row.auto}
                        className="accent-stone-900"
                        onChange={(event) => update(row.alias, { auto: event.target.checked })}
                        type="checkbox"
                      />
                      自动
                    </label>
                  </div>
                  <span className="block truncate font-mono text-[10px] text-stone-400" title={row.alias}>
                    {row.alias}
                  </span>
                  {row.hint ? (
                    <span className="block text-[10px] text-stone-500">{row.hint}</span>
                  ) : null}
                </div>

                <label className="grid gap-1">
                  <span className="text-[10px] font-semibold text-stone-600">模型 id</span>
                  <input
                    aria-label={`${row.label} 模型`}
                    className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 font-mono text-[11px] text-stone-800 outline-none focus:border-blue-400 disabled:bg-stone-50 disabled:text-stone-400"
                    disabled={row.auto}
                    list="claude-slot-model-choices"
                    onChange={(event) => update(row.alias, { model: event.target.value })}
                    placeholder={row.auto ? "由账号映射自动解析" : "留空清空该槽位"}
                    value={row.model}
                  />
                </label>

                <div className="grid gap-1.5">
                  {row.editableLabel ? (
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold text-stone-600">菜单显示名</span>
                      <input
                        aria-label={`${row.label} 显示名`}
                        className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-[11px] text-stone-800 outline-none focus:border-blue-400 disabled:bg-stone-50"
                        disabled={row.auto}
                        onChange={(event) => update(row.alias, { displayName: event.target.value })}
                        placeholder="留空则用别名"
                        value={row.displayName}
                      />
                    </label>
                  ) : null}
                  {row.supportsOneM ? (
                    <label className="flex items-center gap-1.5 text-[11px] text-stone-600">
                      <input
                        aria-label={`${row.label} 1M 上下文`}
                        checked={row.supports1m}
                        className="accent-stone-900"
                        disabled={row.auto}
                        onChange={(event) => update(row.alias, { supports1m: event.target.checked })}
                        type="checkbox"
                      />
                      追加 [1M] 上下文标记
                    </label>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <datalist id="claude-slot-model-choices">
            {plan?.available_models.map((model) => <option key={model} value={model} />)}
          </datalist>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              className="w-fit rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={onOpenAccounts}
              type="button"
            >
              去调整账号映射
            </button>
            <span className="text-[11px] text-stone-500">
              可选模型 {plan?.available_models.length ?? 0} 个，来源：当前模式下的账号池模型清单
            </span>
          </div>

          <label className="mt-3 grid gap-1.5">
            <span className="text-[11px] font-semibold text-stone-600">
              全局客户端配置（整池共用，写入配置时合并进 settings.json 根级）
            </span>
            <textarea
              aria-label="全局客户端配置 JSON"
              className="min-h-20 rounded-md border border-stone-200 bg-white px-2.5 py-2 font-mono text-[11px] leading-5 text-stone-800 outline-none focus:border-blue-400"
              onChange={(event) => {
                setClientConfigDraft(event.target.value);
                setConfigError(null);
              }}
              placeholder='{"includeCoAuthoredBy": false}'
              value={clientConfigDraft}
            />
          </label>
          {configError || error ? (
            <p className="mt-1 text-[11px] text-red-700" role="alert">
              {configError ?? error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 bg-stone-50 px-4 py-3">
          <button
            className="h-9 rounded-md border border-stone-300 bg-white px-3 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-100"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="h-9 rounded-md bg-stone-900 px-4 text-[12px] font-semibold text-white motion-control hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
            type="submit"
          >
            {saving ? "保存中..." : "保存槽位设置"}
          </button>
        </footer>
      </form>
    </div>
  );
}
