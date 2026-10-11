import { describe, expect, it } from "vitest";
import {
  AUDIO_DIALECTS,
  AUDIO_DIALECT_VALUES,
  AUDIO_PLATFORM,
  audioDialectLabel,
  isAudioPlatform,
} from "../../src/lib/audioPlatforms";

describe("audioPlatforms", () => {
  it("has exactly one platform", () => {
    expect(AUDIO_PLATFORM).toBe("audio");
    expect(isAudioPlatform("audio")).toBe(true);
    expect(isAudioPlatform("AUDIO")).toBe(true);
    // 旧模型（供应商当平台）不再算音频平台
    expect(isAudioPlatform("audio:minimax")).toBe(false);
    // 视频平台不能落进音频里
    expect(isAudioPlatform("video")).toBe(false);
    expect(isAudioPlatform("codex")).toBe(false);
  });

  it("carries the provider in the interface format, not the platform", () => {
    expect(AUDIO_DIALECT_VALUES).toEqual(["openai"]);
    for (const item of AUDIO_DIALECTS) {
      expect(audioDialectLabel(item.dialect)).toBe(item.label);
    }
  });

  /// 音频**认** `openai`，而视频刻意**不认**（视频那边收了它
  /// `interface_format: "openai"` 会静默变成「Sora」）。两处结论相反是刻意的，
  /// 所以把音频这一侧钉住。
  it("accepts openai as a first-class audio dialect", () => {
    expect(audioDialectLabel("openai")).toBe("OpenAI");
    expect(audioDialectLabel("  OPENAI ")).toBe("OpenAI");
  });

  it("falls back to the raw value for unknown dialects", () => {
    expect(audioDialectLabel("minimax")).toBe("minimax");
    expect(audioDialectLabel("kling")).toBe("kling");
  });
});
