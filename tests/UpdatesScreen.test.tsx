import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/lib/i18n";
import { isDesktop } from "../src/lib/transport";
import { createQueryClient } from "../src/lib/query/queryClient";
import { UpdatesScreen } from "../src/screens/UpdatesScreen";
import { settingsFixture } from "../src/test/fixtures";
import { availableUpdate, deferred } from "./helpers/updater";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

// The check goes through the host command so it can honour the beta channel.
vi.mock("../src/lib/api/client", () => ({
  checkUpdate: mocks.check,
  getSettings: mocks.getSettings,
  saveSettings: mocks.saveSettings,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  Update: class {
    downloadAndInstall = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("../src/lib/transport", () => ({ isDesktop: vi.fn(() => true) }));

function renderScreen(language: "zh-CN" | "en" = "zh-CN", client = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLanguage={language}>
        <UpdatesScreen />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const BILINGUAL_BODY = [
  "中文发布说明",
  "",
  "修复",
  "- 修正了更新日志显示为空的问题。",
  "",
  "-".repeat(29),
  "",
  "English Release Notes",
  "",
  "Fixes",
  "- Show the changelog instead of a bare compare link.",
].join("\n");

describe("UpdatesScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.check.mockReset();
    mocks.getSettings.mockReset();
    mocks.saveSettings.mockReset();
    mocks.getSettings.mockResolvedValue({ ...settingsFixture, beta_updates_enabled: false });
    mocks.saveSettings.mockImplementation(async (settings) => settings);
    vi.mocked(isDesktop).mockReturnValue(true);
  });

  it("renders the update workflow in Simplified Chinese", () => {
    renderScreen();

    expect(screen.getByText("更新")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "应用更新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
    expect(screen.getByText("尚未选择更新")).toBeInTheDocument();
    expect(screen.getByText("发布来源")).toBeInTheDocument();
  });

  it("renders the release notes as markdown in the interface language", async () => {
    mocks.check.mockResolvedValue(availableUpdate({ version: "0.7.2", body: BILINGUAL_BODY }));

    renderScreen();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    });

    expect(screen.getByText("修复")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("修正了更新日志显示为空的问题。");
    expect(screen.queryByText("English Release Notes")).not.toBeInTheDocument();
  });

  it("does not call the updater in a browser and says why", async () => {
    // In a browser check() throws "Cannot read properties of undefined", and
    // putting that sentence in the error banner tells the user nothing.
    vi.mocked(isDesktop).mockReturnValue(false);

    renderScreen();

    const button = screen.getByRole("button", { name: "检查更新" });
    expect(button).toBeDisabled();
    expect(screen.getByText("此功能仅桌面端可用。")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("does not save incomplete settings before the channel has loaded", async () => {
    const settings = deferred<typeof settingsFixture>();
    mocks.getSettings.mockReturnValue(settings.promise);
    renderScreen();
    expect(screen.queryByRole("checkbox", { name: /Beta 更新频道/ })).not.toBeInTheDocument();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    await act(async () => settings.resolve(settingsFixture));
  });

  it("clears a beta candidate when switching back to stable even if the next check fails", async () => {
    const candidate = availableUpdate();
    mocks.getSettings.mockResolvedValue({ ...settingsFixture, beta_updates_enabled: true });
    mocks.check.mockResolvedValueOnce(candidate).mockRejectedValueOnce(new Error("stable unavailable"));
    renderScreen();
    const toggle = await screen.findByRole("checkbox", { name: /Beta 更新频道/ });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "检查更新" })));
    expect(screen.getByRole("heading", { name: "0.19.0-rc.1" })).toBeInTheDocument();
    await act(async () => fireEvent.click(toggle));
    expect(screen.queryByRole("heading", { name: "0.19.0-rc.1" })).not.toBeInTheDocument();
    expect(candidate.close).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("stable unavailable")).toBeInTheDocument();
  });

  it("shows a failed channel save without changing the persisted channel", async () => {
    mocks.saveSettings.mockRejectedValue(new Error("settings write failed"));
    renderScreen();
    const toggle = await screen.findByRole("checkbox", { name: /Beta 更新频道/ });
    await act(async () => fireEvent.click(toggle));
    expect(await screen.findByText("settings write failed")).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("disables the channel toggle while an update check is in flight", async () => {
    const pending = deferred<null>();
    mocks.check.mockReturnValue(pending.promise);
    renderScreen();
    const toggle = await screen.findByRole("checkbox", { name: /Beta 更新频道/ });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "检查更新" })));
    expect(toggle).toBeDisabled();
    await act(async () => pending.resolve(null));
  });

  it("releases a replaced update and the selected resource when unmounted", async () => {
    const first = availableUpdate();
    const second = availableUpdate({ rid: 2, version: "0.19.0-rc.2" });
    mocks.check.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const view = renderScreen();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "检查更新" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "检查更新" })));
    expect(first.close).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("discards a manual result when a previous page's channel save completes", async () => {
    const saved = deferred<typeof settingsFixture>();
    const oldCheck = deferred<ReturnType<typeof availableUpdate> | null>();
    const stale = availableUpdate();
    const stable = availableUpdate({ rid: 2, version: "0.19.0" });
    const client = createQueryClient();
    mocks.getSettings.mockResolvedValue({ ...settingsFixture, beta_updates_enabled: true });
    mocks.saveSettings.mockReturnValue(saved.promise);
    const firstView = renderScreen("zh-CN", client);
    const toggle = await screen.findByRole("checkbox", { name: /Beta 更新频道/ });
    await act(async () => fireEvent.click(toggle));
    firstView.unmount();

    mocks.check.mockReturnValueOnce(oldCheck.promise).mockResolvedValue(stable);
    renderScreen("zh-CN", client);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "检查更新" })));
    await act(async () => saved.resolve({ ...settingsFixture, beta_updates_enabled: false }));
    await act(async () => oldCheck.resolve(stale));
    expect(screen.queryByRole("heading", { name: "0.19.0-rc.1" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "0.19.0" })).toBeInTheDocument();
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox", { name: /Beta 更新频道/ })).not.toBeChecked();
  });

  it("shows the stable endpoint by default and switches to beta when enabled", async () => {
    renderScreen();

    // The aside names the endpoint the current channel actually fetches.
    expect(
      screen.getByText(
        "https://github.com/ai-switch/ai-switch/releases/latest/download/latest.json",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("https://raw.githubusercontent.com/ai-switch/ai-switch/beta/beta.json"),
    ).not.toBeInTheDocument();

    const toggle = await screen.findByRole("checkbox", { name: /Beta 更新频道/ });
    expect(toggle).not.toBeChecked();

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ beta_updates_enabled: true }),
    );
    // Enabled state comes back from the saved settings, so the aside and the
    // checkbox both follow the persisted flag rather than the click.
    expect(
      await screen.findByText("https://raw.githubusercontent.com/ai-switch/ai-switch/beta/beta.json"),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Beta 更新频道/ })).toBeChecked();
  });
});
