import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageCapabilitySegment } from "../src/components/accounts/ImageCapabilitySegment";
import { getRouteProxyKey, getRouteProxyStatus } from "../src/lib/api/client";
import { I18nProvider } from "../src/lib/i18n";
import { createQueryClient } from "../src/lib/query/queryClient";

vi.mock("../src/lib/api/client", () => ({
  getRouteProxyKey: vi.fn(),
  getRouteProxyStatus: vi.fn(),
}));

function renderScreen(imageGenerationEnabled = false) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider initialLanguage="zh-CN">
        <ImageCapabilitySegment imageGenerationEnabled={imageGenerationEnabled} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("ImageCapabilitySegment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRouteProxyStatus).mockResolvedValue({
      running: true,
      route_access_enabled: true,
      bind_host: "127.0.0.1",
      base_url: "http://127.0.0.1:43111",
    });
    vi.mocked(getRouteProxyKey).mockResolvedValue("sk-ai-switch-codex");
  });

  /// 生图没有独立平台，端点是**绝对路径**接在池的 Base URL 之后 —— codex 的 Base URL
  /// 已经带 /v1，所以这里不会出现两个 /v1。
  it("hands out the image endpoint and the pool key", async () => {
    renderScreen();

    await waitFor(() =>
      expect(screen.getByLabelText("图片端点")).toHaveValue(
        "http://127.0.0.1:43111/v1/images/generations",
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("渠道密钥")).toHaveValue("sk-ai-switch-codex"),
    );
    expect(vi.mocked(getRouteProxyKey)).toHaveBeenCalledWith("codex");
  });

  /// 这一段**不再自己列账号** —— 账号由同一段里的账号管理屏负责（`AccountsScreen`
  /// 传 `capabilityFilter="image.generate"`）。所以这里要断言的是「它没有重复一份
  /// 只读列表」，否则同一屏里会出现两个账号列表。
  it("does not render its own account list", async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("图片端点")).toBeInTheDocument());
    expect(screen.queryByText("支持生图的账号")).not.toBeInTheDocument();
  });

  it("points at the plugin setting when Image Studio is off", async () => {
    const view = renderScreen(false);
    expect(await screen.findByText(/生图插件未启用/)).toBeInTheDocument();
    expect(within(view.container).queryByText("打开生图工作台")).not.toBeInTheDocument();
  });

  it("offers the Image Studio entry point when the plugin is on", async () => {
    renderScreen(true);
    expect(await screen.findByText("打开生图工作台")).toBeInTheDocument();
  });
});
