import { describe, expect, it } from "vitest";
import {
  AUDIO_CAPABILITY,
  AUDIO_DIALECTS,
  AUDIO_DIALECT_VALUES,
  audioDialectLabel,
} from "../../src/lib/audioPlatforms";

describe("audioPlatforms", () => {
  /// 音频账号**不能**靠 `interface_format` 识别 —— 音频的方言是 `openai`，与文本的
  /// 线协议同名。唯一的判据是 `model_mappings` 里有没有声明 `audio.generate`。
  /// 这就是它和视频（方言与文本不相交，可按方言判）的结构差别。
  it("identifies an audio account by capability, not by dialect", () => {
    expect(AUDIO_CAPABILITY).toBe("audio.generate");
    expect(AUDIO_DIALECT_VALUES).toEqual(["openai"]);
  });

  it("carries the provider in the interface format, not the platform", () => {
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
