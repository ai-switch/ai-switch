import { describe, expect, it } from "vitest";
import {
  createDefaultModalityVisibility,
  readModalityVisibility,
  resolveVisibleModalityScreen,
  writeModalityVisibility,
} from "../../src/lib/accountModalities";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("account modality navigation", () => {
  it("does not hide the unified pool because of legacy agent preferences", () => {
    const local = storage();
    local.setItem("ai-switch.agent-visibility", JSON.stringify({ codex: false, claude: false }));
    expect(readModalityVisibility(local)).toEqual({ general: true, image: true, video: true, audio: true, vector: true });
  });

  it("persists each modality independently and ignores malformed stored fields", () => {
    const local = storage();
    const visibility = { ...createDefaultModalityVisibility(), video: false };
    writeModalityVisibility(visibility, local);
    expect(readModalityVisibility(local)).toEqual({ general: true, image: true, video: false, audio: true, vector: true });
    local.setItem("ai-switch.modality-visibility", JSON.stringify({ video: false, audio: "false", unknown: false }));
    expect(readModalityVisibility(local)).toEqual({ general: true, image: true, video: false, audio: true, vector: true });
  });

  it("moves away from a hidden modality and keeps settings available when all are hidden", () => {
    const visibility = { ...createDefaultModalityVisibility(), general: false, video: false };
    expect(resolveVisibleModalityScreen("PoolVideo", visibility)).toBe("PoolImage");
    expect(resolveVisibleModalityScreen("MCP", visibility)).toBe("MCP");
    expect(resolveVisibleModalityScreen("PoolImage", visibility)).toBe("PoolImage");
    expect(resolveVisibleModalityScreen("PoolAudio", { general: false, image: false, video: false, audio: false, vector: false })).toBe("Settings");
  });
});
