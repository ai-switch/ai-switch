import { describe, expect, it } from "vitest";
import { computeVisibleSourceFilterCount } from "../../src/lib/sourceFilterOverflow";

describe("computeVisibleSourceFilterCount", () => {
  it("keeps every chip inline whenever the complete row fits", () => {
    expect(computeVisibleSourceFilterCount(600, [80, 90, 70, 60])).toBe(4);
    expect(computeVisibleSourceFilterCount(300, [80, 90, 70, 60])).toBe(4);
    expect(computeVisibleSourceFilterCount(303, [80, 90, 70, 60])).toBe(4);
  });

  it("reserves room for more only when the complete row overflows", () => {
    expect(computeVisibleSourceFilterCount(304, [80, 90, 70, 90])).toBe(3);
    expect(computeVisibleSourceFilterCount(303, [80, 90, 70, 90])).toBe(2);
    expect(computeVisibleSourceFilterCount(299, [80, 90, 70, 60])).toBe(2);
  });

  it("keeps all options in the dropdown when no chip fits beside more", () => {
    expect(computeVisibleSourceFilterCount(100, [80, 90, 70])).toBe(0);
  });

  it("does not hide options before layout measurements are available", () => {
    expect(computeVisibleSourceFilterCount(0, [80, 90])).toBe(2);
    expect(computeVisibleSourceFilterCount(-1, [80, 90])).toBe(2);
    expect(computeVisibleSourceFilterCount(0, [])).toBe(0);
  });

  it("uses the measured width of the more trigger", () => {
    expect(computeVisibleSourceFilterCount(170, [80, 90, 80], 40)).toBe(1);
    expect(computeVisibleSourceFilterCount(170, [80, 90, 80], 100)).toBe(0);
  });
});
