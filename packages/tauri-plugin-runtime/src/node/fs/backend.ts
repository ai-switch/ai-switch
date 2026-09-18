import { AplgError } from "../../protocol/errors.js";
import { validateCapabilityRequest, validateCapabilityResult } from "../../protocol/capabilities.js";
import { validateJson } from "../../protocol/json-safety.js";
import type { JsonValue } from "../../protocol/types.js";
import { boundedOperation, type FileContext } from "./lifecycle.js";
import type { CapabilityCall, FsMethod, FsRequest, FsResult } from "./types.js";

export interface FsBackend {
  invoke<M extends FsMethod>(context: FileContext, method: M, params: FsRequest<M>, observe?: (result: unknown, late: boolean) => void): Promise<FsResult<M>>;
  abort(handle: string): Promise<boolean>;
}
export function createBackend(call: CapabilityCall): FsBackend {
  return {
    async invoke(context, method, params, observe) {
      if (!context.info.capabilities["aplg.fs"].methods.includes(method)) throw new AplgError("E_CAPABILITY_UNAVAILABLE", "The filesystem method is unavailable.");
      const checked = validateCapabilityRequest("aplg.fs", method, params);
      if (!checked.ok) throw Object.assign(new Error("Invalid filesystem request."), { code: checked.diagnostics[0]?.code ?? "E_INVALID_ARGUMENT" });
      const raw = await boundedOperation(
        (signal) => call("aplg.fs", method, params as JsonValue, { signal, timeoutMs: 30_000 }),
        context.signal, 30_000, (result) => observe?.(result, true),
      );
      observe?.(raw, false);
      const result = validateCapabilityResult("aplg.fs", method, raw);
      if (!result.ok) throw new AplgError("E_INVALID_MESSAGE", "The filesystem backend returned an invalid result.");
      return raw as FsResult<typeof method>;
    },
    async abort(handle) {
      try {
        const result = await boundedOperation((signal) => call("aplg.fs", "transfer.abort", { handle }, { signal, timeoutMs: 1000 }), undefined, 1000);
        return result === null;
      } catch { return false; }
    },
  };
}
export function responseHandle(value: unknown): string | undefined {
  if (!validateJson(value).ok || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const handle = (value as Record<string, unknown>).handle;
  return typeof handle === "string" && /^[\x21-\x7e]{1,128}$/.test(handle) ? handle : undefined;
}
