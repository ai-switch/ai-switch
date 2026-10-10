import { describe, expect, it } from "vitest";
import {
  VIDEO_PLATFORMS,
  VIDEO_PROTOCOLS,
  isVideoPlatform,
  videoProtocolLabel,
} from "../../src/lib/videoPlatforms";

describe("video platform table", () => {
  it("covers exactly the five upstream dialects with canonical platform strings", () => {
    expect(VIDEO_PLATFORMS).toEqual([
      "video:kling",
      "video:ark",
      "video:minimax",
      "video:zhipu",
      "video:sora",
    ]);
    // 每个 protocol 的 platform 串必须是 `video:<protocol>`
    for (const item of VIDEO_PROTOCOLS) {
      expect(item.platform).toBe(`video:${item.protocol}`);
    }
  });

  it("labels each stored platform string", () => {
    expect(videoProtocolLabel("video:kling")).toBe("Kling");
    // 方舟上的视频模型是 Seedance，展示名用用户更认的那个
    expect(videoProtocolLabel("video:ark")).toBe("Seedance");
    expect(videoProtocolLabel("video:minimax")).toBe("MiniMax");
    expect(videoProtocolLabel("video:zhipu")).toBe("Zhipu");
    expect(videoProtocolLabel("video:sora")).toBe("Sora");
  });

  it("falls back to the raw suffix for an unknown video protocol", () => {
    // 后端将来加了新方言而前端还没跟上时，至少不要把整串糊在界面上
    expect(videoProtocolLabel("video:newthing")).toBe("newthing");
  });

  it("distinguishes video platforms from text platforms", () => {
    expect(isVideoPlatform("video:kling")).toBe(true);
    expect(isVideoPlatform("codex")).toBe(false);
    // 裸 `video` 不是合法平台值（后端也拒绝：缺协议段无法定方言）
    expect(isVideoPlatform("video")).toBe(false);
  });
});
