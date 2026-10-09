import { describe, expect, it } from "vitest";
import { requestCompressionMatchedHost, requestCompressionModeFromConfig, writeRequestCompressionMode } from "../src/lib/requestCompression";

describe("Brotli request compression configuration", () => {
  it.each([
    [undefined, "auto"], [null, "auto"], ["auto", "auto"], ["on", "on"], ["off", "off"],
    ["invalid", "off"], [true, "off"], [1, "off"], [{}, "off"],
  ] as const)("normalizes mode %j to %s without accidentally opting in", (value, expected) => {
    expect(requestCompressionModeFromConfig({ request_brotli_compression: value })).toBe(expected);
  });

  it.each([
    ["https://ps.air-outer.com/v1", "ps.air-outer.com"],
    [" HTTPS://PS.AIR-OUTER.COM:443/ ", "ps.air-outer.com"],
    ["https://ps.air-outer.com.evil.test/v1", null],
    ["https://ps.air-outer.com@evil.test/v1", null],
    ["https://sub.ps.air-outer.com/v1", null],
    ["https://ps.air-outer.com:8443/v1", null],
    ["http://ps.air-outer.com/v1", null],
    ["https://other.example/v1", null],
    ["not a URL", null],
  ] as const)("matches only the verified automatic site for %s", (url, expected) => {
    expect(requestCompressionMatchedHost(url)).toBe(expected);
  });

  it("persists manual choices and removes only its own key when auto is restored", () => {
    const config: Record<string, unknown> = { unrelated: "keep" };
    writeRequestCompressionMode(config, "on");
    expect(config).toEqual({ unrelated: "keep", request_brotli_compression: "on" });
    writeRequestCompressionMode(config, "off");
    expect(config).toEqual({ unrelated: "keep", request_brotli_compression: "off" });
    writeRequestCompressionMode(config, "auto");
    expect(config).toEqual({ unrelated: "keep" });
  });
});
