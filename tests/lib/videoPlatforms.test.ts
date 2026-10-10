import { describe, expect, it } from "vitest";
import {
  VIDEO_DIALECTS,
  VIDEO_DIALECT_VALUES,
  VIDEO_PLATFORM,
  isVideoPlatform,
  videoDialectLabel,
} from "../../src/lib/videoPlatforms";

describe("videoPlatforms", () => {
  it("has exactly one platform", () => {
    expect(VIDEO_PLATFORM).toBe("video");
    expect(isVideoPlatform("video")).toBe(true);
    expect(isVideoPlatform("VIDEO")).toBe(true);
    // 旧模型（供应商当平台）不再算视频平台
    expect(isVideoPlatform("video:kling")).toBe(false);
    expect(isVideoPlatform("codex")).toBe(false);
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
