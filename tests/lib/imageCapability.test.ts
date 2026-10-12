import { describe, expect, it } from "vitest";
import {
  declaresCapability,
  declaredCapabilities,
  imageCapableModels,
  poolImageModels,
} from "../../src/lib/imageCapability";

function config(modelMappings: unknown): string {
  return JSON.stringify({
    base_url: "https://api.example.com/v1",
    interface_format: "openai",
    model_mappings: modelMappings,
  });
}

describe("declaredCapabilities", () => {
  it("collects and lowercases every declared capability", () => {
    expect(
      declaredCapabilities(
        config([
          { from: "gpt-5", capabilities: ["text.generate"] },
          { from: "gpt-image-2", capabilities: ["Image.Generate", "image.edit"] },
        ]),
      ).sort(),
    ).toEqual(["image.edit", "image.generate", "text.generate"]);
  });

  it("returns nothing for a mapping without capabilities", () => {
    expect(declaredCapabilities(config([{ from: "gpt-5" }]))).toEqual([]);
  });

  /// 手写的脏 config 不该让渲染路径炸掉 —— 认不出就当没声明。
  it("returns nothing for unparsable or unexpected shapes", () => {
    expect(declaredCapabilities("not json")).toEqual([]);
    expect(declaredCapabilities("{}")).toEqual([]);
    expect(declaredCapabilities(config("not an array"))).toEqual([]);
    expect(declaredCapabilities(config([null, 42, { capabilities: "nope" }]))).toEqual([]);
  });
});

describe("declaresCapability", () => {
  /// 与后端 `push_capability_predicate` 的 `lower(declared.value) = ?` 必须一致 ——
  /// 两边不一致会出现「界面空、后端说有」的分叉。
  it("matches case-insensitively", () => {
    const value = config([{ from: "gpt-image-2", capabilities: ["Image.Generate"] }]);
    expect(declaresCapability(value, "image.generate")).toBe(true);
    expect(declaresCapability(value, "IMAGE.GENERATE")).toBe(true);
    expect(declaresCapability(value, " image.generate ")).toBe(true);
    expect(declaresCapability(value, "video.generate")).toBe(false);
  });

  it("is false for an empty capability rather than matching everything", () => {
    const value = config([{ from: "gpt-5", capabilities: ["text.generate"] }]);
    expect(declaresCapability(value, "")).toBe(false);
    expect(declaresCapability(value, "   ")).toBe(false);
  });
});

describe("imageCapableModels / poolImageModels", () => {
  it("keeps only the models whose mapping declares image generation", () => {
    const value = config([
      { from: "gpt-5" },
      { from: "gpt-image-2", capabilities: ["image.generate"] },
      { from: "gpt-image-1", capabilities: ["IMAGE.GENERATE"] },
    ]);
    expect(imageCapableModels(value)).toEqual(["gpt-image-2", "gpt-image-1"]);
  });

  it("dedupes across accounts, preserving first-seen order", () => {
    expect(
      poolImageModels([
        { config_json: config([{ from: "gpt-image-2", capabilities: ["image.generate"] }]) },
        { config_json: config([{ from: "gpt-image-2", capabilities: ["image.generate"] }]) },
        { config_json: config([{ from: "imagen-3", capabilities: ["image.generate"] }]) },
      ]),
    ).toEqual(["gpt-image-2", "imagen-3"]);
  });
});
