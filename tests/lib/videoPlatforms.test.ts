import { describe, expect, it } from "vitest";
import {
  VIDEO_CAPABILITY,
  VIDEO_DIALECTS,
  VIDEO_DIALECT_VALUES,
  isVideoDialect,
  videoDialectLabel,
} from "../../src/lib/videoPlatforms";

describe("videoPlatforms", () => {
  /// 视频账号靠**能力**被识别，不靠平台 —— 平台只剩池身份。
  it("identifies a video account by its dialect, not by a platform value", () => {
    expect(VIDEO_CAPABILITY).toBe("video.generate");
    for (const dialect of VIDEO_DIALECT_VALUES) {
      expect(isVideoDialect(dialect)).toBe(true);
    }
    // 文本线协议不是视频方言
    expect(isVideoDialect("openai")).toBe(false);
    expect(isVideoDialect("anthropic")).toBe(false);
    expect(isVideoDialect("nope")).toBe(false);
  });

  it("carries the provider in the interface format, not the platform", () => {
    expect(VIDEO_DIALECT_VALUES).toEqual(["kling", "ark", "minimax", "zhipu", "sora"]);
    for (const item of VIDEO_DIALECTS) {
      expect(videoDialectLabel(item.dialect)).toBe(item.label);
    }
  });

  it("shows the name users recognise for Ark (Seedance)", () => {
    expect(videoDialectLabel("ark")).toBe("Seedance");
  });

  it("accepts aliases case-insensitively and falls back to the raw value", () => {
    expect(videoDialectLabel("  KLING ")).toBe("Kling");
    expect(videoDialectLabel("newthing")).toBe("newthing");
  });
});
