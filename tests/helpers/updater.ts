import type { Update } from "@tauri-apps/plugin-updater";
import { vi } from "vitest";

// Only the host IPC resource is substituted; components still own its lifetime.
export function availableUpdate(overrides: Partial<Update> = {}): Update {
  return {
    rid: 1,
    available: true,
    currentVersion: "0.18.2",
    version: "0.19.0-rc.1",
    body: undefined,
    date: undefined,
    rawJson: { version: "0.19.0-rc.1" },
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Update;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}
