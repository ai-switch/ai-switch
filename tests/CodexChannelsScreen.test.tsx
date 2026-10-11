import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/lib/i18n";
import {
  CODEX_SEGMENT_STORAGE_KEY,
  CodexChannelsScreen,
} from "../src/screens/CodexChannelsScreen";

// 四段的实体各自有测试，这里只测**外壳**：分段器、默认段、记忆、以及每段渲染的是谁。
// 把实体 mock 掉也让这一屏不必拖进 AccountsScreen 那几十个 API 依赖。
vi.mock("../src/screens/AccountsScreen", () => ({
  AccountsScreen: ({ platform }: { platform?: string }) => <div>accounts:{platform}</div>,
}));
vi.mock("../src/screens/VideoChannelsScreen", () => ({
  VideoChannelsScreen: ({ embedded }: { embedded?: boolean }) => (
    <div>video:{String(embedded)}</div>
  ),
}));
vi.mock("../src/screens/AudioChannelsScreen", () => ({
  AudioChannelsScreen: ({ embedded }: { embedded?: boolean }) => (
    <div>audio:{String(embedded)}</div>
  ),
}));
vi.mock("../src/components/accounts/ImageCapabilitySegment", () => ({
  ImageCapabilitySegment: () => <div>image-segment</div>,
}));

function renderScreen() {
  return render(
    <I18nProvider initialLanguage="zh-CN">
      <CodexChannelsScreen imageGenerationEnabled />
    </I18nProvider>,
  );
}

describe("CodexChannelsScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  /// 多模态渠道收进分段器，侧边栏不再有视频 / 音频入口。
  it("offers the four modality segments and opens on the general pool", () => {
    renderScreen();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["通用", "生图", "视频", "TTS"]);
    expect(screen.getByRole("tab", { name: "通用" })).toHaveAttribute("aria-selected", "true");
    // 「通用」段就是 codex 池的完整管理
    expect(screen.getByText("accounts:codex")).toBeInTheDocument();
  });

  /// 视频 / 音频段嵌在 codex 页里，所以要进 `embedded` 模式（标题由外层给）。
  it("swaps the body and embeds the channel screens", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("tab", { name: "生图" }));
    expect(screen.getByText("image-segment")).toBeInTheDocument();
    expect(screen.queryByText("accounts:codex")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "视频" }));
    expect(screen.getByText("video:true")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "TTS" }));
    expect(screen.getByText("audio:true")).toBeInTheDocument();
  });

  /// 记住上次选的段：常切的人不用每次重新点，也不至于每次进 codex 都被弹走。
  it("remembers the last segment across mounts", async () => {
    const first = renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "视频" }));
    expect(window.localStorage.getItem(CODEX_SEGMENT_STORAGE_KEY)).toBe("video");
    first.unmount();

    renderScreen();
    expect(screen.getByText("video:true")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "视频" })).toHaveAttribute("aria-selected", "true");
  });

  /// 存的值是脏的（手改过、或来自旧版本）时退回「通用」，不能白屏。
  it("falls back to the general segment for an unknown stored value", () => {
    window.localStorage.setItem(CODEX_SEGMENT_STORAGE_KEY, "nope");
    renderScreen();
    expect(screen.getByText("accounts:codex")).toBeInTheDocument();
  });
});
