import { describe, expect, it } from "vitest";
import { formatSubscriptionType } from "../src/lib/subscriptionType";

describe("formatSubscriptionType", () => {
  it("maps the self-serve Business ProLite slug to a friendly label", () => {
    const display = formatSubscriptionType("self_serve_business_prolite");

    expect(display).not.toBeNull();
    expect(display?.raw).toBe("self_serve_business_prolite");
    expect(display?.label).toBe("Business 高级版");
    expect(display?.title).toContain("订阅类型：Business 高级版");
    expect(display?.title).toContain("原始订阅类型：self_serve_business_prolite");
    expect(display?.ariaLabel).toContain("self_serve_business_prolite");
  });

  it("formats an unknown slug without losing the original value", () => {
    const display = formatSubscriptionType("unknown_plan_type");

    expect(display?.label).toBe("Unknown Plan Type");
    expect(display?.title).toContain("unknown_plan_type");
    expect(display?.ariaLabel).toContain("unknown_plan_type");
  });

  it.each([null, undefined, "", "  "])('ignores empty input %j', (raw) => {
    expect(formatSubscriptionType(raw)).toBeNull();
  });
});
