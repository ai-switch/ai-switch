import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApiRouteCredential,
  deleteRouteCredential,
  listRouteCredentials,
  setRouteCredentialStatuses,
  updateRouteCredential,
} from "../src/lib/api/client";
import type { RouteCredential } from "../src/lib/api/types";
import { I18nProvider } from "../src/lib/i18n";
import { createQueryClient } from "../src/lib/query/queryClient";
import { VideoChannelsScreen } from "../src/screens/VideoChannelsScreen";

vi.mock("../src/lib/api/client", () => ({
  createApiRouteCredential: vi.fn(),
  deleteRouteCredential: vi.fn(),
  listRouteCredentials: vi.fn(),
  setRouteCredentialStatuses: vi.fn(),
  updateRouteCredential: vi.fn(),
}));

function credential(overrides: Partial<RouteCredential> & { id: string; platform: string }) {
  return {
    kind: "api",
    display_name: overrides.id,
    status: "ok",
    sort_order: 0,
    route_priority: 0,
    max_concurrency: 3,
    secret_payload_json: JSON.stringify({ api_key: "sk-upstream" }),
    config_json: JSON.stringify({
      base_url: "https://api.example.com/v1",
      interface_format: "openai",
      model_mappings: [
        { from: "kling-v1", to: "kling-v1", capabilities: ["video.generate"] },
      ],
    }),
    preview_json: "{}",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  } as RouteCredential;
}

function renderScreen() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider initialLanguage="zh-CN">
        <VideoChannelsScreen />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/** `listRouteCredentials` 会按 5 个方言各调一次，这里按 platform 分别给数据。 */
function mockLists(byPlatform: Record<string, RouteCredential[]>) {
  vi.mocked(listRouteCredentials).mockImplementation(async (platform: string) =>
    byPlatform[platform] ?? [],
  );
}

describe("VideoChannelsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteRouteCredential).mockResolvedValue(undefined);
    vi.mocked(setRouteCredentialStatuses).mockResolvedValue(undefined);
  });

  it("merges every video dialect into one list and tags each row with its protocol", async () => {
    mockLists({
      "video:kling": [credential({ id: "kling-a", platform: "video:kling", display_name: "可灵主号" })],
      "video:ark": [credential({ id: "ark-a", platform: "video:ark", display_name: "方舟号" })],
    });

    renderScreen();

    expect(await screen.findByText("可灵主号")).toBeTruthy();
    expect(screen.getByText("方舟号")).toBeTruthy();

    // 5 个方言都要查一次（合并成一屏的前提）
    expect(listRouteCredentials).toHaveBeenCalledTimes(5);

    // 每行的 TAG 显示它自己的上游协议，而不是笼统的「视频」
    const klingRow = screen.getByText("可灵主号").closest("article")!;
    expect(within(klingRow).getByText("Kling")).toBeTruthy();
    const arkRow = screen.getByText("方舟号").closest("article")!;
    expect(within(arkRow).getByText("Seedance")).toBeTruthy();
  });

  it("shows the empty state when no video channel exists", async () => {
    mockLists({});
    renderScreen();
    expect(await screen.findByText("还没有视频渠道")).toBeTruthy();
  });

  it("refuses to save model mappings without the video.generate capability", async () => {
    mockLists({});
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新增渠道" }));

    const nameField = screen.getByLabelText("名称");
    await user.type(nameField, "新渠道");
    await user.type(screen.getByLabelText("Base URL"), "https://api.example.com/v1");
    await user.type(screen.getByLabelText("API Key"), "sk-new");

    // 少了 video.generate：网关在账号池里根本选不到这个账号，必须在界面上拦住
    fireEvent.change(screen.getByLabelText("模型映射"), {
      target: {
        value:
          '[{"from":"kling-v1","to":"kling-v1","capabilities":["image.generate"]}]',
      },
    });

    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "每条映射都必须声明 video.generate 能力",
    );
    expect(createApiRouteCredential).not.toHaveBeenCalled();
  });

  it("creates a channel with the chosen protocol and a bearer interface format", async () => {
    mockLists({});
    vi.mocked(createApiRouteCredential).mockResolvedValue(
      credential({ id: "new", platform: "video:sora" }),
    );
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新增渠道" }));
    await user.selectOptions(screen.getByLabelText("协议"), "video:sora");
    await user.type(screen.getByLabelText("名称"), "Sora 号");
    await user.type(screen.getByLabelText("Base URL"), "https://api.openai.com/v1");
    await user.type(screen.getByLabelText("API Key"), "sk-sora");

    fireEvent.change(screen.getByLabelText("模型映射"), {
      target: { value: '[{"from":"sora-2","capabilities":["video.generate"]}]' },
    });

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createApiRouteCredential).toHaveBeenCalledTimes(1));
    const input = vi.mocked(createApiRouteCredential).mock.calls[0][0];
    expect(input.platform).toBe("video:sora");
    expect(input.display_name).toBe("Sora 号");
    expect(input.base_url).toBe("https://api.openai.com/v1");
    // 五家上游都用 Authorization: Bearer
    expect(input.interface_format).toBe("openai");
    // `to` 缺省时补成 `from`，能力原样保留
    expect(JSON.parse(input.model_mappings_json)).toEqual([
      { from: "sora-2", to: "sora-2", capabilities: ["video.generate"] },
    ]);
  });

  it("toggles a channel between paused and ok", async () => {
    mockLists({
      "video:kling": [credential({ id: "kling-a", platform: "video:kling", display_name: "可灵主号" })],
    });
    renderScreen();
    const user = userEvent.setup();

    const row = (await screen.findByText("可灵主号")).closest("article")!;
    await user.click(within(row).getByRole("button", { name: "已停用" }));

    await waitFor(() =>
      expect(setRouteCredentialStatuses).toHaveBeenCalledWith(["kling-a"], "paused"),
    );
  });

  it("edits an existing channel without touching its platform", async () => {
    const existing = credential({
      id: "kling-a",
      platform: "video:kling",
      display_name: "可灵主号",
    });
    mockLists({ "video:kling": [existing] });
    vi.mocked(updateRouteCredential).mockResolvedValue(existing);
    renderScreen();
    const user = userEvent.setup();

    const row = (await screen.findByText("可灵主号")).closest("article")!;
    await user.click(within(row).getByRole("button", { name: "编辑" }));

    // 平台不可改：`update_route_credential` 没有 platform 字段
    expect(screen.getByLabelText("协议")).toBeDisabled();

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "可灵备用");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateRouteCredential).toHaveBeenCalledTimes(1));
    const [id, input] = vi.mocked(updateRouteCredential).mock.calls[0];
    expect(id).toBe("kling-a");
    expect(input.display_name).toBe("可灵备用");
    // 没动 key 就不能把它清掉
    expect(JSON.parse(input.secret_payload_json).api_key).toBe("sk-upstream");
  });
});
