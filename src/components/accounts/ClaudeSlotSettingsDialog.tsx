import { X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ClaudeAggregateRow,
  ClaudeSlotAccount,
  ClaudeSlotPlan,
  ModelMapping,
} from "../../lib/api/types";
import {
  CLAUDE_FALLBACK_ALIAS,
  CLAUDE_ROLES,
  CLAUDE_SUBAGENT_ALIAS,
  claudeRoleLabel,
} from "../../lib/claude-roles";

/**
 * Claude Code cannot discover models from the pool: its `/model` menu is four
 * fixed env slots plus a subagent and a fallback key.
 *
 * - Aggregate mode: the bare aliases fan out across the pool. There is nothing
 *   to set here — the dialog only shows where each role currently lands.
 * - Routing (precise) mode: each slot writes `<account>/<alias>`, so every slot
 *   can be pinned to a different account. Selecting an account pre-fills that
 *   slot from the account's configured role mapping; edits are saved back to
 *   that account's `model_mappings` (the source of truth shared with the
 *   account form's ClaudeCode tab).
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
  /** Account this slot is pinned to in precise mode. Empty means unset. */
  accountId: string;
  /** Model id written to the client env key (`<account>/<alias>` in precise mode). */
  model: string;
  displayName: string;
  supports1m: boolean;
  /** Upstream model saved to the pinned account's model_mappings. */
  upstreamModel: string;
};

export type ClaudeSlotSettingsPayload = {
  overridesJson: string;
  clientConfigJson: string | null;
  /** Precise mode: persist each touched account's role mappings. */
  accountSlotMappings?: Array<{ accountId: string; mappingsJson: string }> | null;
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

/** Prefixes the proxy accepts; never guess from a bare display name alone. */
function accountPrefixes(account: ClaudeSlotAccount | undefined): string[] {
  if (!account) return [];
  return account.model_prefixes?.length ? account.model_prefixes : [account.display_name];
}

/** Model id the proxy accepts for one role of an account in precise mode. */
function preciseModelId(
  availableModels: string[],
  account: ClaudeSlotAccount | undefined,
  alias: string,
): string {
  const prefixes = accountPrefixes(account);
  if (prefixes.length === 0) return "";
  for (const prefix of prefixes) {
    const named = `${prefix}/${alias}`;
    if (availableModels.includes(named)) return named;
  }
  // Still this account's prefix — falling back to any `*/alias` here would
  // silently pin the slot to a different account.
  return `${prefixes[0]}/${alias}`;
}

/** Which account a persisted `<prefix>/<alias>` override points at. */
function accountIdForPersistedModel(
  plan: ClaudeSlotPlan | null | undefined,
  alias: string,
  model: string | null | undefined,
): string {
  if (!model?.trim()) return "";
  const expected = model.trim().toLowerCase();
  const match = (plan?.accounts ?? []).find((account) =>
    accountPrefixes(account).some(
      (prefix) => `${prefix}/${alias}`.toLowerCase() === expected,
    ),
  );
  return match?.id ?? "";
}

function roleMappingToModelMapping(
  mapping: ClaudeSlotAccount["mappings"][number],
): ModelMapping {
  return {
    from: mapping.alias,
    to: mapping.model,
    label: mapping.label,
    supports_1m: mapping.supports_1m,
  };
}

/**
 * Seed each slot independently: a persisted precise override wins, otherwise
 * fall back to the first account that already declares that role.
 */
function initialRows(
  plan: ClaudeSlotPlan | null | undefined,
  overridesJson: string | null | undefined,
): SlotRow[] {
  const accounts = plan?.accounts ?? [];
  const available = plan?.available_models ?? [];
  const precise = parseOverrides(overridesJson).precise;
  return CLAUDE_ROLES.map((role) => {
    const savedValue = precise?.slots?.[role.alias];
    const savedModel =
      role.alias === CLAUDE_SUBAGENT_ALIAS
        ? precise?.subagent_model
        : role.alias === CLAUDE_FALLBACK_ALIAS
          ? precise?.fallback_model
          : savedValue?.model;
    const account =
      accounts.find((item) => item.id === accountIdForPersistedModel(plan, role.alias, savedModel)) ??
      accounts.find((item) => item.mappings.some((mapping) => mapping.alias === role.alias));
    const mapping = account?.mappings.find((item) => item.alias === role.alias);
    return {
      alias: role.alias,
      label: role.label,
      hint: role.hint,
      editableLabel: role.editableLabel,
      supportsOneM: role.supportsOneM,
      accountId: account?.id ?? "",
      model: account && mapping ? preciseModelId(available, account, role.alias) : "",
      displayName: savedValue?.display_name ?? mapping?.label ?? "",
      supports1m: savedValue?.supports_1m ?? mapping?.supports_1m ?? false,
      upstreamModel: mapping?.model ?? "",
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
  const routingMode = plan?.model_mode === "precise";
  const accounts = plan?.accounts ?? [];
  const availableModels = plan?.available_models ?? [];
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [clientConfigDraft, setClientConfigDraft] = useState(clientConfigJson ?? "");
  const [configError, setConfigError] = useState<string | null>(null);

  // Seed once the plan arrives. Later refetches must not wipe in-progress edits.
  useEffect(() => {
    if (!routingMode || !plan || initialized) return;
    setRows(initialRows(plan, overridesJson));
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routingMode, plan, initialized]);

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

  /** Switching one slot's account only re-reads that slot, never its neighbours. */
  const changeAccount = (alias: string, accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    const mapping = account?.mappings.find((item) => item.alias === alias);
    setRows((current) =>
      current.map((row) =>
        row.alias === alias
          ? {
              ...row,
              accountId,
              model: account && mapping ? preciseModelId(availableModels, account, alias) : "",
              displayName: mapping?.label ?? "",
              supports1m: mapping?.supports_1m ?? false,
              upstreamModel: mapping?.model ?? "",
            }
          : row,
      ),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = clientConfigDraft.trim();
    if (trimmed) {
      let parsedClientConfig: unknown;
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
    let accountSlotMappings: ClaudeSlotSettingsPayload["accountSlotMappings"] = null;

    if (routingMode) {
      const slots: Record<string, SlotOverrideValue> = {};
      let subagent_model: string | undefined;
      let fallback_model: string | undefined;
      // Backend replaces all six role rows for an account, so every account we
      // touch must be sent its complete role set — not just the edited slots.
      const mergedByAccount = new Map<string, ModelMapping[]>(
        accounts.map((account) => [
          account.id,
          account.mappings.map(roleMappingToModelMapping),
        ]),
      );
      const touched = new Set<string>();

      for (const row of rows) {
        const upstream = row.upstreamModel.trim();
        if (!row.accountId || !upstream) continue;
        const account = accounts.find((item) => item.id === row.accountId);
        if (!account) continue;
        const modelId = preciseModelId(availableModels, account, row.alias);
        if (!modelId) continue;

        if (row.alias === CLAUDE_SUBAGENT_ALIAS) {
          subagent_model = modelId;
        } else if (row.alias === CLAUDE_FALLBACK_ALIAS) {
          fallback_model = modelId;
        } else {
          slots[row.alias] = {
            model: modelId,
            display_name: row.displayName.trim() || null,
            supports_1m: row.supports1m,
          };
        }

        const list = mergedByAccount.get(account.id) ?? [];
        const edited: ModelMapping = {
          from: row.alias,
          to: upstream,
          label: row.displayName.trim() || null,
          supports_1m: row.supports1m,
        };
        const index = list.findIndex((mapping) => mapping.from.trim() === row.alias);
        if (index >= 0) list[index] = edited;
        else list.push(edited);
        mergedByAccount.set(account.id, list);
        touched.add(account.id);
      }

      if (touched.size === 0) {
        setConfigError("请至少为一个槽位选择路由账号并填写上游模型。");
        return;
      }

      const set: SlotOverrideSet = { slots };
      if (subagent_model !== undefined) set.subagent_model = subagent_model;
      if (fallback_model !== undefined) set.fallback_model = fallback_model;
      existing.precise = set;
      accountSlotMappings = Array.from(touched, (accountId) => ({
        accountId,
        mappingsJson: JSON.stringify(mergedByAccount.get(accountId) ?? []),
      }));
    }
    // Aggregate mode: nothing to set — leave the aggregate override branch as-is.

    onSave({
      overridesJson: JSON.stringify(existing),
      clientConfigJson: trimmed || null,
      accountSlotMappings,
    });
  };

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
                ? "每个槽位可单独选择路由账号，写入的 id 形如「账号/别名」，请求经代理钉在该账号。"
                : "模型 id 是裸别名，同名模型在池内轮换，无需在这里设置。"}
            </p>
          </div>

          {routingMode ? (
            <>
              <div className="mt-3 grid gap-2" data-testid="claude-slot-editor">
                {rows.map((row) => (
                  <div
                    className="grid gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5"
                    key={row.alias}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-stone-900">{row.label}</span>
                      <span
                        className="font-mono text-[10px] text-stone-400"
                        title={row.alias}
                      >
                        {row.alias}
                      </span>
                      {row.hint ? (
                        <span className="text-[10px] text-stone-500">{row.hint}</span>
                      ) : null}
                      <span
                        className="ml-auto truncate font-mono text-[10px] text-blue-600"
                        title={row.model}
                      >
                        {row.model || "未选择账号"}
                      </span>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_auto] sm:items-end">
                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold text-stone-600">路由账号</span>
                        <select
                          aria-label={`${row.label} 路由账号`}
                          className="h-8 w-full rounded-md border border-stone-300 bg-white px-2 text-[11px] text-stone-900 outline-none focus:border-blue-400"
                          onChange={(event) => changeAccount(row.alias, event.target.value)}
                          value={row.accountId}
                        >
                          <option value="">不设置此槽位</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.display_name}
                              {account.mappings.some((mapping) => mapping.alias === row.alias)
                                ? "（已配置该角色）"
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold text-stone-600">
                          上游模型（写入账号映射）
                        </span>
                        <input
                          aria-label={`${row.label} 上游模型`}
                          className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 font-mono text-[11px] text-stone-800 outline-none focus:border-blue-400"
                          list="claude-slot-model-choices"
                          onChange={(event) => update(row.alias, { upstreamModel: event.target.value })}
                          placeholder="留空表示该角色不配置"
                          value={row.upstreamModel}
                        />
                      </label>

                      {row.editableLabel ? (
                        <label className="grid gap-1">
                          <span className="text-[10px] font-semibold text-stone-600">菜单显示名</span>
                          <input
                            aria-label={`${row.label} 显示名`}
                            className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-[11px] text-stone-800 outline-none focus:border-blue-400"
                            onChange={(event) => update(row.alias, { displayName: event.target.value })}
                            placeholder="留空则用别名"
                            value={row.displayName}
                          />
                        </label>
                      ) : (
                        <span className="hidden sm:block" />
                      )}

                      {row.supportsOneM ? (
                        <label className="flex h-8 items-center gap-1.5 text-[11px] text-stone-600">
                          <input
                            aria-label={`${row.label} 1M 上下文`}
                            checked={row.supports1m}
                            className="accent-stone-900"
                            onChange={(event) => update(row.alias, { supports1m: event.target.checked })}
                            type="checkbox"
                          />
                          1M
                        </label>
                      ) : (
                        <span className="hidden sm:block" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <datalist id="claude-slot-model-choices">
                {availableModels.map((model) => <option key={model} value={model} />)}
              </datalist>
            </>
          ) : (
            <AggregateView rows={plan?.aggregate_rows ?? []} />
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              className="w-fit rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={onOpenAccounts}
              type="button"
            >
              去调整账号映射
            </button>
            <span className="text-[11px] text-stone-500">
              {routingMode
                ? `池内账号 ${accounts.length} 个；每个槽位可钉到不同账号。`
                : "聚合模式无需设置；下方为当前各角色的聚合去向。"}
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

/** Read-only fan-out view for aggregate mode. */
function AggregateView({ rows }: { rows: ClaudeAggregateRow[] }) {
  return (
    <div className="mt-3 grid gap-2" data-testid="claude-aggregate-view">
      <p className="text-[11px] font-semibold text-stone-600">
        各角色当前聚合去向（只读）
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white px-3 py-4 text-center text-[12px] font-medium text-stone-500">
          暂无已配置的 Claude 角色映射。请先在账号编辑的 ClaudeCode 专用映射里配置。
        </p>
      ) : (
        rows.map((row) => (
          <div className="rounded-lg border border-stone-200 bg-white px-3 py-2.5" key={row.alias}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-stone-900">
                {claudeRoleLabel(row.alias)}
              </span>
              <span className="font-mono text-[10px] text-stone-400">{row.alias}</span>
              <span className="ml-auto text-[10px] text-stone-500">
                写入值：<span className="font-mono text-stone-700">{row.consensus_model ?? "未配置"}</span>
                {row.consensus_display_name ? ` · 显示名 ${row.consensus_display_name}` : ""}
              </span>
            </div>
            {row.accounts.length === 0 ? (
              <p className="mt-1 text-[11px] text-stone-400">无账号声明该角色</p>
            ) : (
              <ul className="mt-1.5 grid gap-1">
                {row.accounts.map((account) => {
                  const mapping = account.mappings[0];
                  return (
                    <li className="flex items-center gap-2 text-[11px] text-stone-600" key={account.id}>
                      <span className="min-w-0 truncate font-semibold text-stone-700">
                        {account.display_name}
                      </span>
                      <span className="text-stone-300">→</span>
                      <span className="min-w-0 truncate font-mono text-stone-800">{mapping?.model}</span>
                      {mapping?.supports_1m ? (
                        <span className="rounded bg-blue-50 px-1 text-[9px] font-semibold text-blue-700">1M</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))
      )}
    </div>
  );
}
