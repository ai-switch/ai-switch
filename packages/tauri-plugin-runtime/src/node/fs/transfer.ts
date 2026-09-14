import { Buffer } from "../buffer.js";
import { AplgError } from "../../protocol/errors.js";
import { checkSignal, type FileContext } from "./lifecycle.js";
import { responseHandle, type FsBackend } from "./backend.js";

export function createTransferClient(backend: FsBackend) {
  let active = 0; let unsafe = false;
  const waiters: Array<() => void> = [];
  const handles = new Set<string>();
  function acquire(context: FileContext): Promise<() => void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => { clearTimeout(timer); context.signal.removeEventListener("abort", abort); const index = waiters.indexOf(wake); if (index >= 0) waiters.splice(index, 1); };
      const abort = () => { if (!settled) { settled = true; finish(); reject(context.signal.reason); } };
      const timer = setTimeout(() => { if (!settled) { settled = true; finish(); reject(new AplgError("E_TIMEOUT", "The filesystem transfer queue timed out.")); } }, 30_000);
      const wake = () => {
        if (settled) return;
        if (unsafe) { settled = true; finish(); reject(new AplgError("E_SESSION_CLOSED", "File transfer cleanup could not be confirmed.")); return; }
        if (active >= context.info.limits.fileTransfers) return;
        if (context.signal.aborted) { abort(); return; }
        settled = true; finish(); active++;
        let released = false;
        resolve(() => { if (released) return; released = true; active--; for (const pending of [...waiters]) pending(); });
      };
      waiters.push(wake); context.signal.addEventListener("abort", abort, { once: true });
      if (context.signal.aborted) abort(); else wake();
    });
  }
  function chunkLimit(context: FileContext) {
    // Reserve more than the largest v1 envelope + request ID + handle overhead.
    const envelopeBudget = context.info.limits.controlBytes - 768;
    const limit = Math.min(context.info.limits.fileChunkBytes, Math.floor(envelopeBudget / 4) * 3);
    if (limit < 1) throw new AplgError("E_LIMIT_EXCEEDED", "The negotiated message budget is too small for file transfers.");
    return limit;
  }
  async function usingHandle<T>(context: FileContext, open: (observe: (raw: unknown, late: boolean) => void) => Promise<unknown>, perform: (handle: string, opened: unknown, chunk: number) => Promise<T>): Promise<T> {
    const chunk = chunkLimit(context);
    const release = await acquire(context); let handle: string | undefined; let committed = false;
    const observe = (raw: unknown, late: boolean) => {
      const candidate = responseHandle(raw);
      if (!candidate) return;
      if (late) {
        if (!handles.has(candidate)) void backend.abort(candidate).then((confirmed) => { if (!confirmed) { unsafe = true; for (const pending of [...waiters]) pending(); } });
        return;
      }
      if (handles.has(candidate)) throw new AplgError("E_INVALID_MESSAGE", "The host reused an active file transfer handle.");
      handles.add(candidate); handle = candidate;
    };
    try {
      checkSignal(context.signal);
      const opened = await open(observe);
      if (!handle) throw new AplgError("E_INVALID_MESSAGE", "The host did not return a file transfer handle.");
      checkSignal(context.signal);
      const result = await perform(handle, opened, chunk);
      await backend.invoke(context, "transfer.finish", { handle }); committed = true;
      return result;
    } finally {
      if (handle) {
        if (!committed && !await backend.abort(handle) && !context.signal.aborted) unsafe = true;
        handles.delete(handle);
      }
      release();
    }
  }
  return {
    read(context: FileContext, path: string): Promise<Buffer> {
      return usingHandle(context, (observe) => backend.invoke(context, "transfer.openRead", { path }, observe), async (handle, opened, chunk) => {
        const size = (opened as { size: number }).size;
        if (size > context.info.limits.fileBytes) throw new AplgError("E_LIMIT_EXCEEDED", "The file exceeds the negotiated size limit.");
        const output = Buffer.alloc(size);
        for (let offset = 0; offset < size;) {
          checkSignal(context.signal);
          const length = Math.min(chunk, size - offset);
          const result = await backend.invoke(context, "transfer.pull", { handle, offset, length });
          const bytes = Buffer.from(result.dataBase64, "base64");
          if (result.offset !== offset || bytes.length !== length || bytes.toString("base64") !== result.dataBase64) {
            throw new AplgError("E_INVALID_MESSAGE", "The host returned an incomplete or uncorrelated file chunk.");
          }
          output.set(bytes, offset); offset += bytes.length;
        }
        return output;
      });
    },
    async write(context: FileContext, path: string, data: Buffer, mode: "w" | "wx" | "a" | "ax"): Promise<void> {
      if (data.length > context.info.limits.fileBytes) throw new AplgError("E_LIMIT_EXCEEDED", "The file exceeds the negotiated size limit.");
      await usingHandle(context, (observe) => backend.invoke(context, "transfer.openWrite", { path, size: data.length, mode }, observe), async (handle, _opened, chunk) => {
        for (let offset = 0; offset < data.length;) {
          checkSignal(context.signal);
          const length = Math.min(chunk, data.length - offset);
          const result = await backend.invoke(context, "transfer.push", { handle, offset, dataBase64: data.subarray(offset, offset + length).toString("base64") });
          if (result.written !== length) throw new AplgError("E_INVALID_MESSAGE", "The host did not acknowledge the complete file chunk.");
          offset += length;
        }
      });
    },
  };
}
