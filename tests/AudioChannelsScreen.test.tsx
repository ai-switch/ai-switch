import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApiRouteCredential,
  deleteRouteCredential,
  getRouteProxyKey,
  getRouteProxyStatus,
  listRouteCredentials,
  setRouteCredentialStatuses,
  updateRouteCredential,
} from "../src/lib/api/client";
import type { RouteCredential } from "../src/lib/api/types";
import { I18nProvider } from "../src/lib/i18n";
import { createQueryClient } from "../src/lib/query/queryClient";
import { AudioChannelsScreen } from "../src/screens/AudioChannelsScreen";

vi.mock("../src/lib/api/client", () => ({
  createApiRouteCredential: vi.fn(),
  deleteRouteCredential: vi.fn(),
  getRouteProxyKey: vi.fn(),
  getRouteProxyStatus: vi.fn(),
  listRouteCredentials: vi.fn(),
  setRouteCredentialStatuses: vi.fn(),
  updateRouteCredential: vi.fn(),
}));

/// 音频账号：**平台恒为 `audio`，供应商在 `interface_format` 里**。
function credential(overrides: Partial<RouteCredential> & { id: string; dialect: string }) {
  const { dialect, ...rest } = overrides;
  return {
    platform: "audio",
    kind: "api",
    display_name: overrides.id,
    status: "ok",
    sort_order: 0,
    route_priority: 0,
    max_concurrency: 3,
    secret_payload_json: JSON.stringify({ api_key: "sk-upstream" }),
    config_json: JSON.stringify({
      base_url: "https://api.example.com/v1",
      interface_format: dialect,
      model_mappings: [{ from: "tts-1", to: "tts-1", capabilities: ["audio.generate"] }],
    }),
    preview_json: "{}",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...rest,
  } as RouteCredential;
}

function renderScreen() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider initialLanguage="zh-CN">
        <AudioChannelsScreen />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("AudioChannelsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteRouteCredential).mockResolvedValue(undefined);
    vi.mocked(setRouteCredentialStatuses).mockResolvedValue(undefined);
    vi.mocked(getRouteProxyStatus).mockResolvedValue({
      running: false,
      route_access_enabled: false,
      bind_host: "127.0.0.1",
      base_url: null,
    });
  });

  it("lists the one audio platform and tags each row with its provider", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([
      credential({ id: "openai-a", dialect: "openai", display_name: "语音主号" }),
    ]);

    renderScreen();

    expect(await screen.findByText("语音主号")).toBeInTheDocument();
    // 供应商来自 interface_format
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    // 只查一个平台，且是 `audio`
    expect(vi.mocked(listRouteCredentials)).toHaveBeenCalledWith("audio");
    expect(vi.mocked(listRouteCredentials)).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when there are no channels", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText("还没有音频渠道")).toBeInTheDocument();
  });

  it("refuses to save model mappings without the audio.generate capability", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([]);
    renderScreen();
    await userEvent.click(await screen.findByRole("button", { name: /新增渠道/ }));

    await userEvent.type(screen.getByLabelText("名称"), "语音主号");
    await userEvent.type(screen.getByLabelText("Base URL"), "https://api.example.com/v1");
    await userEvent.type(screen.getByLabelText("API Key"), "sk-upstream");
    // 少了 audio.generate：网关在账号池里根本选不到这个账号，必须在界面上拦住
    fireEvent.change(screen.getByLabelText("模型映射"), {
      target: {
        value: '[{"from":"tts-1","to":"tts-1","capabilities":["image.generate"]}]',
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    // 用错误文案本身（帮助文案里也含 audio.generate，泛匹配会撞上两个元素）
    expect(
      await screen.findByText("每条映射都必须声明 audio.generate 能力"),
    ).toBeInTheDocument();
    expect(vi.mocked(createApiRouteCredential)).not.toHaveBeenCalled();
  });

  it("creates a channel on the audio platform with the provider as interface_format", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([]);
    vi.mocked(createApiRouteCredential).mockResolvedValue({} as RouteCredential);
    renderScreen();
    await userEvent.click(await screen.findByRole("button", { name: /新增渠道/ }));

    await userEvent.type(screen.getByLabelText("名称"), "语音主号");
    await userEvent.type(screen.getByLabelText("Base URL"), "https://api.example.com/v1");
    await userEvent.type(screen.getByLabelText("API Key"), "sk-upstream");
    fireEvent.change(screen.getByLabelText("模型映射"), {
      target: {
        value: '[{"from":"tts-1","to":"tts-1","capabilities":["audio.generate"]}]',
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(vi.mocked(createApiRouteCredential)).toHaveBeenCalled());
    expect(vi.mocked(createApiRouteCredential)).toHaveBeenCalledWith(
      expect.objectContaining({
        // 平台恒为 audio；供应商由 interface_format 承载
        platform: "audio",
        interface_format: "openai",
        display_name: "语音主号",
      }),
    );
  });

  it("edits an existing channel and writes the provider back into interface_format", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([
      credential({ id: "openai-a", dialect: "openai", display_name: "语音主号" }),
    ]);
    vi.mocked(updateRouteCredential).mockResolvedValue({} as RouteCredential);
    renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await userEvent.clear(screen.getByLabelText("名称"));
    await userEvent.type(screen.getByLabelText("名称"), "语音备号");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(vi.mocked(updateRouteCredential)).toHaveBeenCalled());
    const [, payload] = vi.mocked(updateRouteCredential).mock.calls[0];
    expect(payload.display_name).toBe("语音备号");
    expect(JSON.parse(String(payload.config_json)).interface_format).toBe("openai");
  });

  it("toggles a channel between paused and ok", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([
      credential({ id: "openai-a", dialect: "openai", display_name: "语音主号" }),
    ]);
    renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "已停用" }));
    await waitFor(() =>
      expect(vi.mocked(setRouteCredentialStatuses)).toHaveBeenCalledWith(["openai-a"], "paused"),
    );
  });

  it("hands out the endpoint and the single channel key", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([]);
    vi.mocked(getRouteProxyStatus).mockResolvedValue({
      running: true,
      route_access_enabled: true,
      bind_host: "127.0.0.1",
      base_url: "http://127.0.0.1:8787",
    });
    vi.mocked(getRouteProxyKey).mockResolvedValue("sk-ai-switch-audio");

    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "接入信息" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("端点")).toHaveValue(
      "http://127.0.0.1:8787/v1/audio/speech",
    );
    // 一张 key 覆盖全部供应商
    await waitFor(() =>
      expect(within(dialog).getByLabelText("渠道密钥")).toHaveValue("sk-ai-switch-audio"),
    );
    expect(vi.mocked(getRouteProxyKey)).toHaveBeenCalledWith("audio");
    expect(vi.mocked(getRouteProxyKey)).toHaveBeenCalledTimes(1);
  });

  it("asks the user to start the route proxy when it is not running yet", async () => {
    vi.mocked(listRouteCredentials).mockResolvedValue([]);
    vi.mocked(getRouteProxyKey).mockResolvedValue("sk-ai-switch-audio");

    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "接入信息" }));

    expect(await screen.findByText("启动本地路由代理后即可获得端点。")).toBeInTheDocument();
  });
});
