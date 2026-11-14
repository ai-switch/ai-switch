import type { Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

export function useUpdateResource() {
  const [update, setUpdate] = useState<Update | null>(null);
  const current = useRef<Update | null>(null);

  const replaceUpdate = useCallback((next: Update | null) => {
    const previous = current.current;
    current.current = next;
    setUpdate(next);
    if (previous && previous !== next) {
      void previous.close().catch(() => {});
    }
  }, []);

  useEffect(() => () => {
    const previous = current.current;
    current.current = null;
    if (previous) void previous.close().catch(() => {});
  }, []);

  return [update, replaceUpdate] as const;
}
