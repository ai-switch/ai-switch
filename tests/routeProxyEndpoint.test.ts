import { describe, expect, it } from "vitest";
import {
  imageGenerationEndpoint,
  routeProxyApiEndpoint,
  routeProxyEndpointForPlatform,
} from "../src/lib/routeProxyEndpoint";

describe("routeProxyEndpointForPlatform", () => {
  it("appends /v1 for the platforms whose clients append a bare endpoint", () => {
    // Codex calls {base}/responses; the other three reach the pool through
    // {base}/chat/completions. Either way the /v1 has to be in the base URL.
    for (const platform of ["codex", "opencode", "openclaw", "hermes"]) {
      expect(routeProxyEndpointForPlatform("http://127.0.0.1:19527", platform)).toBe(
        "http://127.0.0.1:19527/v1",
      );
    }
    expect(routeProxyEndpointForPlatform("https://127.0.0.1:19528", "codex")).toBe(
      "https://127.0.0.1:19528/v1",
    );
  });

  it("does not double the suffix", () => {
    expect(routeProxyEndpointForPlatform("http://127.0.0.1:19527/v1/", "codex")).toBe(
      "http://127.0.0.1:19527/v1",
    );
    expect(routeProxyEndpointForPlatform("http://127.0.0.1:19527/v1", "hermes")).toBe(
      "http://127.0.0.1:19527/v1",
    );
  });

  it("leaves the other platforms bare", () => {
    // Claude / Gemini / Grok clients append their own versioned paths.
    for (const platform of ["claude", "gemini", "grok"]) {
      expect(routeProxyEndpointForPlatform("http://127.0.0.1:19527/", platform)).toBe(
        "http://127.0.0.1:19527",
      );
    }
  });

  it("returns an empty string for a missing address", () => {
    expect(routeProxyEndpointForPlatform("   ", "codex")).toBe("");
  });
});

describe("routeProxyApiEndpoint", () => {
  it.each([
    ["http://127.0.0.1:43111", "/v1/images/edits", "http://127.0.0.1:43111/v1/images/edits"],
    [" http://127.0.0.1:43111/v1/ ", "/v1/video/generations", "http://127.0.0.1:43111/v1/video/generations"],
    ["https://host.example/api/v1", "/v1/audio/speech", "https://host.example/api/v1/audio/speech"],
    ["", "/v1/videos", ""],
  ])("joins %s and %s without repeating the version", (base, path, expected) => {
    expect(routeProxyApiEndpoint(base, path)).toBe(expected);
  });
});

describe("imageGenerationEndpoint", () => {
  /// 生图与文本共用同一个池，所以端点要接在**平台 Base URL 之后**，而不是自己拼
  /// `{host}/v1/...`：codex 的 Base URL 已经带 `/v1`（客户端自己接 `/responses`），
  /// gemini 的是裸的（客户端自己接 `/v1beta/...`）。
  it("attaches the absolute path after the platform base URL", () => {
    expect(imageGenerationEndpoint("http://127.0.0.1:19527", "codex")).toBe(
      "http://127.0.0.1:19527/v1/images/generations",
    );
    expect(imageGenerationEndpoint("http://127.0.0.1:19527", "gemini")).toBe(
      "http://127.0.0.1:19527/v1/images/generations",
    );
  });

  it("does not double the /v1 segment", () => {
    expect(imageGenerationEndpoint("http://127.0.0.1:19527/v1/", "codex")).toBe(
      "http://127.0.0.1:19527/v1/images/generations",
    );
  });

  it("returns an empty string until the proxy address is known", () => {
    expect(imageGenerationEndpoint("", "codex")).toBe("");
    expect(imageGenerationEndpoint("   ", "gemini")).toBe("");
  });
});
