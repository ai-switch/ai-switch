import { Update } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkUpdate } from "../../src/lib/api/client";
import { __resetTransportForTests } from "../../src/lib/transport";

const runtimeWindow = window as Window & {
  __TAURI_INTERNALS__?: {
    invoke: ReturnType<typeof vi.fn>;
    transformCallback: ReturnType<typeof vi.fn>;
  };
};

const metadata = {
  rid: 23,
  currentVersion: "0.18.2",
  version: "0.19.0-rc.1",
  date: null,
  body: "中文\n\n-----------------------------\n\nEnglish",
  rawJson: { version: "0.19.0-rc.1", platforms: {} },
};

describe("channel-aware updater client", () => {
  beforeEach(() => __resetTransportForTests());
  afterEach(() => {
    delete runtimeWindow.__TAURI_INTERNALS__;
    __resetTransportForTests();
  });

  it("reuses the host resource id for the plugin download and resource close commands", async () => {
    const invoke = vi.fn(async (command: string) => command === "check_update" ? metadata : undefined);
    runtimeWindow.__TAURI_INTERNALS__ = { invoke, transformCallback: vi.fn(() => 7) };
    const update = await checkUpdate();
    expect(update).toBeInstanceOf(Update);
    expect(update).toMatchObject({ rid: 23, currentVersion: "0.18.2", version: "0.19.0-rc.1", body: metadata.body });
    await update!.downloadAndInstall();
    expect(invoke).toHaveBeenCalledWith("plugin:updater|download_and_install", expect.objectContaining({ rid: 23 }), undefined);
    await update!.close();
    expect(invoke).toHaveBeenCalledWith("plugin:resources|close", { rid: 23 }, undefined);
  });

  it("returns no resource when the host finds no newer release", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    runtimeWindow.__TAURI_INTERNALS__ = { invoke, transformCallback: vi.fn() };
    await expect(checkUpdate()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("check_update", {});
  });
});
