import { describe, expect, it } from "vitest";
import {
  AGENT_VISIBILITY_STORAGE_KEY,
  createDefaultAgentVisibility,
  readAgentVisibility,
  resolveVisibleAgentScreen,
  writeAgentVisibility,
} from "../../src/lib/agentVisibility";

describe("agent visibility preferences", () => {
  it("defaults every supported agent to visible and merges stored choices", () => {
    const storage = new Map<string, string>();
    storage.set(AGENT_VISIBILITY_STORAGE_KEY, JSON.stringify({ claude: false, unknown: false }));

    const visibility = readAgentVisibility({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    });

    // 以「默认全可见」为基准再覆盖被存过的那个：这样断言仍然在测
    // 「默认全可见 + 合并已存选择 + 丢掉不认识的键」，但以后新增平台不用再改这里。
    expect(visibility).toEqual({
      ...createDefaultAgentVisibility(),
      claude: false,
    });
  });

  it("persists visibility and falls back when the active agent is hidden", () => {
    const storage = new Map<string, string>();
    const visibility = {
      ...createDefaultAgentVisibility(),
      codex: false,
      claude: false,
    };

    writeAgentVisibility(visibility, {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    });

    expect(JSON.parse(storage.get(AGENT_VISIBILITY_STORAGE_KEY) ?? "{}")).toEqual(visibility);
    expect(resolveVisibleAgentScreen("Claude", visibility)).toBe("Grok");
    expect(resolveVisibleAgentScreen("Settings", visibility)).toBe("Settings");
  });

  it("uses Settings when every agent is hidden", () => {
    const visibility = Object.fromEntries(
      Object.keys(createDefaultAgentVisibility()).map((platform) => [platform, false]),
    ) as ReturnType<typeof createDefaultAgentVisibility>;

    expect(resolveVisibleAgentScreen("Codex", visibility)).toBe("Settings");
  });
});
