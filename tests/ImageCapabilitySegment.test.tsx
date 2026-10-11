import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageCapabilitySegment } from "../src/components/accounts/ImageCapabilitySegment";
import {
  getRouteProxyKey,
  getRouteProxyStatus,
  listRouteCredentials,
} from "../src/lib/api/client";
import type { RouteCredential } from "../src/lib/api/types";
import { I18nProvider } from "../src/lib/i18n";
import { createQueryClient } from "../src/lib/query/queryClient";

vi.mock("../src/lib/api/client", () => ({
  getRouteProxyKey: vi.fn(),
  getRouteProxyStatus: vi.fn(),
  listRouteCredentials: vi.fn(),
}));

function credential(
  id: string,
  platform: string,
  mappings: Array<{ from: string; capabilities?: string[] }>,
): RouteCredential {
  return {
    id,
    platform,
    kind: "api",
    display_name: id,
    status: "ok",
    sort_order: 0,
    route_priority: 0,
    max_concurrency: 1,
    secret_payload_json: JSON.stringify({ api_key: "sk-upstream" }),
    config_json: JSON.stringify({
      base_url: "https://api.example.com/v1",
      interface_format: "openai",
      model_mappings: mappings,
    }),
    preview_json: "{}",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  } as RouteCredential;
}

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
    vi.mocked(listRouteCredentials).mockResolvedValue([]);
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

  /// 只列**声明了 image.generate** 的账号，并且标出它在哪个池里 —— 同一个上游可能在
  /// codex 池和 gemini 池各有一个账号。
  it("lists only the accounts that declare image generation", async () => {
    vi.mocked(listRouteCredentials).mockImplementation(async (platform: string) =>
      platform === "codex"
        ? [
            credential("文本号", "codex", [{ from: "gpt-5" }]),
            credential("出图号", "codex", [
              { from: "gpt-image-1", capabilities: ["image.generate"] },
            ]),
          ]
        : [credential("Gemini 出图号", "gemini", [
            { from: "imagen-3", capabilities: ["image.generate"] },
          ])],
    );
    renderScreen();

    expect(await screen.findByText("出图号")).toBeInTheDocument();
    expect(screen.getByText("Gemini 出图号")).toBeInTheDocument();
    // 没有生图能力的账号不进这个视图
    expect(screen.queryByText("文本号")).not.toBeInTheDocument();
    // 模型名要列出来，否则用户不知道能用哪个
    expect(screen.getByText("gpt-image-1")).toBeInTheDocument();
    expect(screen.getByText("imagen-3")).toBeInTheDocument();
  });

  it("says so when no account declares image generation", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([
      credential("文本号", "codex", [{ from: "gpt-5" }]),
    ]);
    renderScreen();

    expect(await screen.findByText("本池还没有账号声明 image.generate")).toBeInTheDocument();
  });

  it("points at the plugin setting when Image Studio is off", async () => {
    const view = renderScreen(false);
    expect(
      await screen.findByText(/生图插件未启用/),
    ).toBeInTheDocument();
    expect(within(view.container).queryByText("打开生图工作台")).not.toBeInTheDocument();
  });
});
