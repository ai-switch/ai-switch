import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2, X } from "lucide-react";

export type CodexBaselineModelsDialogProps = {
  models: readonly string[];
  defaultModels: readonly string[];
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (models: string[]) => void;
};

function normalizedRows(rows: readonly string[]) {
  return rows.map((row) => row.trim()).filter(Boolean);
}

function duplicateModel(rows: readonly string[]) {
  const seen = new Set<string>();
  for (const row of normalizedRows(rows)) {
    const key = row.toLowerCase();
    if (seen.has(key)) {
      return row;
    }
    seen.add(key);
  }
  return null;
}

export function CodexBaselineModelsDialog({
  models,
  defaultModels,
  loading = false,
  error = null,
  onClose,
  onSave,
}: CodexBaselineModelsDialogProps) {
  const [rows, setRows] = useState<string[]>(() => [...models]);
  const [localError, setLocalError] = useState<string | null>(null);

  // The dialog may open before the route-pool query resolves. Re-seed when the
  // loaded configuration arrives so saving cannot silently overwrite it with [].
  useEffect(() => {
    setRows([...models]);
    setLocalError(null);
  }, [models]);

  const updateRow = (index: number, value: string) => {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? value : row)));
    setLocalError(null);
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    setRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setLocalError(null);
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
    setLocalError(null);
  };

  const save = () => {
    const duplicate = duplicateModel(rows);
    if (duplicate) {
      setLocalError(`模型 ID 不能重复：${duplicate}`);
      return;
    }
    onSave(normalizedRows(rows));
  };

  return (
    <div
      className="motion-overlay fixed inset-0 z-50 grid place-items-center bg-stone-950/35 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div
        aria-label="Codex 基线模型"
        className="w-full max-w-xl rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
              Codex
            </p>
            <h3 className="mt-0.5 text-lg font-semibold text-stone-950">Codex 基线模型</h3>
            <p className="mt-1 text-[12px] leading-5 text-stone-500">
              未配置模型映射的账号会贡献这些基线模型；保存后算力池模型清单立即使用新顺序。
            </p>
          </div>
          <button
            aria-label="关闭 Codex 基线模型配置"
            className="rounded-xl border border-stone-200 p-1.5 text-stone-500 motion-control hover:bg-stone-50 disabled:opacity-50"
            disabled={loading}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid max-h-[45vh] gap-2 overflow-y-auto pr-1">
          {rows.map((row, index) => (
            <div className="flex items-center gap-1.5" key={`${index}-${rows.length}`}>
              <input
                aria-label={`基线模型 ${index + 1}`}
                className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-[12px] text-stone-900 outline-none motion-control focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => updateRow(index, event.target.value)}
                value={row}
              />
              <button
                aria-label={`上移 ${index + 1}`}
                className="grid h-8 w-8 place-items-center rounded-lg border border-stone-200 text-stone-500 motion-control hover:bg-stone-50 disabled:opacity-30"
                disabled={index === 0}
                onClick={() => moveRow(index, -1)}
                type="button"
              >
                <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label={`下移 ${index + 1}`}
                className="grid h-8 w-8 place-items-center rounded-lg border border-stone-200 text-stone-500 motion-control hover:bg-stone-50 disabled:opacity-30"
                disabled={index === rows.length - 1}
                onClick={() => moveRow(index, 1)}
                type="button"
              >
                <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label={`删除 ${index + 1}`}
                className="grid h-8 w-8 place-items-center rounded-lg border border-stone-200 text-stone-500 motion-control hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                onClick={() => removeRow(index)}
                type="button"
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-center text-[12px] text-stone-500">
              还没有模型，添加一个或恢复默认。
            </p>
          ) : null}
        </div>

        {localError || error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-800" role="alert">
            {localError ?? error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3">
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-50"
              onClick={() => {
                setRows((current) => [...current, ""]);
                setLocalError(null);
              }}
              type="button"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              添加模型
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12px] font-semibold text-stone-700 motion-control hover:bg-stone-50"
              onClick={() => {
                setRows([...defaultModels]);
                setLocalError(null);
              }}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              恢复默认
            </button>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-[13px] font-semibold text-stone-700 motion-control hover:bg-stone-50 disabled:opacity-50"
              disabled={loading}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              aria-label="保存"
              className="rounded-xl bg-stone-900 px-3 py-2 text-[13px] font-semibold text-white shadow-sm motion-control hover:bg-stone-800 disabled:opacity-50"
              disabled={loading}
              onClick={save}
              type="button"
            >
              {loading ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
