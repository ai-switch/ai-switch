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
  AccountsScreen: ({
    platform,
    capabilityFilter,
  }: {
    platform?: string;
    capabilityFilter?: string;
  }) => (
    <div>
      accounts:{platform}
      {capabilityFilter ? `:${capabilityFilter}` : ""}
    </div>
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
    // P4b：向量是导航预留位（功能未做），先占住分段位。
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "通用",
      "图片",
      "视频",
      "音频",
      "向量",
    ]);
    expect(screen.getByRole("tab", { name: "通用" })).toHaveAttribute("aria-selected", "true");
    // 「通用」段就是 codex 池的完整管理
    expect(screen.getByText("accounts:codex")).toBeInTheDocument();
  });

  /// 四段**全部**复用同一个账号管理屏，区别只在 `capabilityFilter` —— 视频 / 音频 /
  /// 生图都不是平台，它们只是 codex 池里的一部分账号。
  it("swaps the body by filtering the same account screen on capability", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("tab", { name: "图片" }));
    expect(screen.getByText("image-segment")).toBeInTheDocument();
    expect(screen.getByText("accounts:codex:image.generate")).toBeInTheDocument();
    expect(screen.queryByText("accounts:codex")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "视频" }));
    expect(screen.getByText("accounts:codex:video.generate")).toBeInTheDocument();
    expect(screen.queryByText("image-segment")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "音频" }));
    expect(screen.getByText("accounts:codex:audio.generate")).toBeInTheDocument();
    expect(screen.queryByText("accounts:codex:video.generate")).not.toBeInTheDocument();
  });

  /// 记住上次选的段：常切的人不用每次重新点，也不至于每次进 codex 都被弹走。
  it("remembers the last segment across mounts", async () => {
    const first = renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "视频" }));
    expect(window.localStorage.getItem(CODEX_SEGMENT_STORAGE_KEY)).toBe("video");
    first.unmount();

    renderScreen();
    expect(screen.getByText("accounts:codex:video.generate")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "视频" })).toHaveAttribute("aria-selected", "true");
  });

  /// P4b：左侧模态导航直达对应段 —— initialSegment 只影响本次挂载，
  /// 之后仍按「记住上次选择」的规则走。
  it("opens the segment the sidebar navigation pointed at", async () => {
    render(
      <I18nProvider initialLanguage="zh-CN">
        <CodexChannelsScreen imageGenerationEnabled initialSegment="video" />
      </I18nProvider>,
    );
    expect(screen.getByRole("tab", { name: "视频" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("accounts:codex:video.generate")).toBeInTheDocument();

    // 手动切换后存的是新段，不受 initialSegment 覆盖。
    await userEvent.click(screen.getByRole("tab", { name: "音频" }));
    expect(window.localStorage.getItem(CODEX_SEGMENT_STORAGE_KEY)).toBe("audio");
  });

  /// 向量段是导航预留位：入口存在但功能未做，占位文案不能假装修可用。
  it("shows the vector placeholder and does not render any account list", () => {
    render(
      <I18nProvider initialLanguage="zh-CN">
        <CodexChannelsScreen imageGenerationEnabled initialSegment="vector" />
      </I18nProvider>,
    );
    expect(screen.getByRole("tab", { name: "向量" })).toBeInTheDocument();
    expect(screen.getByText(/尚未开放/)).toBeInTheDocument();
    expect(screen.queryByText(/accounts:codex/)).not.toBeInTheDocument();
  });

  it("follows controlled sidebar modality changes without keeping a stale segment", () => {
    const view = (modality: "video" | "audio" | "vector") => (
      <I18nProvider initialLanguage="zh-CN">
        <CodexChannelsScreen imageGenerationEnabled modality={modality} hideSegmentTabs />
      </I18nProvider>
    );
    const { rerender } = render(view("video"));
    expect(screen.getByText("accounts:codex:video.generate")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    rerender(view("audio"));
    expect(screen.getByText("accounts:codex:audio.generate")).toBeInTheDocument();
    expect(screen.queryByText("accounts:codex:video.generate")).not.toBeInTheDocument();
    rerender(view("vector"));
    expect(screen.getByText(/尚未开放/)).toBeInTheDocument();
    expect(screen.queryByText(/accounts:codex/)).not.toBeInTheDocument();
  });

  /// 存的值是脏的（手改过、或来自旧版本）时退回「通用」，不能白屏。
  it("falls back to the general segment for an unknown stored value", () => {
    window.localStorage.setItem(CODEX_SEGMENT_STORAGE_KEY, "nope");
    renderScreen();
    expect(screen.getByText("accounts:codex")).toBeInTheDocument();
  });
});
