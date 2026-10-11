export type AgentPlatform =
  | "codex"
  | "claude"
  | "grok"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "hermes"
;

export type AgentVisibility = Record<AgentPlatform, boolean>;

export const agentPlatforms: AgentPlatform[] = [
  "codex",
  "claude",
  "grok",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
];

export const agentScreenByPlatform: Record<AgentPlatform, string> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
};

export const platformByAgentScreen: Record<string, AgentPlatform> = {
  Codex: "codex",
  Claude: "claude",
  Grok: "grok",
  Gemini: "gemini",
  OpenCode: "opencode",
  OpenClaw: "openclaw",
  Hermes: "hermes",
};

export const AGENT_VISIBILITY_STORAGE_KEY = "ai-switch.agent-visibility";

/// 多模态渠道（视频 / 音频 / 生图）**不再是导航目的地**：它们收进了 codex 页的
/// 模态分段器（见 `screens/CodexChannelsScreen`），所以 `agentPlatforms` 只剩池身份。
/// 视频 / 音频仍然是独立的**平台值**（`lib/videoPlatforms` / `lib/audioPlatforms`），
/// 只是不再各占一个侧边栏入口。

type VisibilityStorage = Pick<Storage, "getItem" | "setItem">;

export function createDefaultAgentVisibility(): AgentVisibility {
  return Object.fromEntries(agentPlatforms.map((platform) => [platform, true])) as AgentVisibility;
}

export function readAgentVisibility(storage?: VisibilityStorage): AgentVisibility {
  const visibility = createDefaultAgentVisibility();
  if (!storage && typeof window === "undefined") return visibility;

  try {
    const stored = JSON.parse(
      (storage ?? window.localStorage).getItem(AGENT_VISIBILITY_STORAGE_KEY) ?? "{}",
    ) as Partial<AgentVisibility>;
    for (const platform of agentPlatforms) {
      if (typeof stored[platform] === "boolean") visibility[platform] = stored[platform];
    }
  } catch {
    return visibility;
  }
  return visibility;
}

export function writeAgentVisibility(
  visibility: AgentVisibility,
  storage?: VisibilityStorage,
) {
  if (!storage && typeof window === "undefined") return;
  try {
    (storage ?? window.localStorage).setItem(
      AGENT_VISIBILITY_STORAGE_KEY,
      JSON.stringify(visibility),
    );
  } catch {
    // Storage may be unavailable in restricted webviews.
  }
}

export function resolveVisibleAgentScreen(
  activeScreen: string,
  visibility: AgentVisibility,
) {
  const activePlatform = platformByAgentScreen[activeScreen];
  if (!activePlatform || visibility[activePlatform]) return activeScreen;

  const nextPlatform = agentPlatforms.find((platform) => visibility[platform]);
  return nextPlatform ? agentScreenByPlatform[nextPlatform] : "Settings";
}
