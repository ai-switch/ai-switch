export type AgentPlatform =
  | "codex"
  | "claude"
  | "grok"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "hermes"
  /// 视频渠道（G-P1）。**不是**一个真实平台值：视频的供应商住在账号的
  /// `interface_format` 里，前端把它们合成一个入口，所以这里用 `video` 作为
  /// 「导航用的伪平台」。真正传给后端的平台串来自 `lib/videoPlatforms`。
  | "video"
  /// 音频渠道（TTS）。与 `video` 同构的伪平台，平台串来自 `lib/audioPlatforms`。
  | "audio";

export type AgentVisibility = Record<AgentPlatform, boolean>;

export const agentPlatforms: AgentPlatform[] = [
  "codex",
  "claude",
  "grok",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
  "video",
  "audio",
];

export const agentScreenByPlatform: Record<AgentPlatform, string> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  video: "Video",
  audio: "Audio",
};

export const platformByAgentScreen: Record<string, AgentPlatform> = {
  Codex: "codex",
  Claude: "claude",
  Grok: "grok",
  Gemini: "gemini",
  OpenCode: "opencode",
  OpenClaw: "openclaw",
  Hermes: "hermes",
  Video: "video",
  Audio: "audio",
};

export const AGENT_VISIBILITY_STORAGE_KEY = "ai-switch.agent-visibility";

/// 导航用的**媒体伪平台**。
///
/// 它们不是真实的平台值，而是「一个模态一屏」合成出来的导航入口。两处必须排除
/// 它们，理由各不相同但都成立：
///   - `AccountsScreen` 的 `platform` 是**真实平台值**（要拿去查账号池）；
///   - 「会话筛选」里它们没有会话（生成会话模型还没做），列出来只会是个恒为 0
///     的死选项。
export const mediaPseudoPlatforms = ["video", "audio"] as const satisfies readonly AgentPlatform[];

/// 伪平台的联合类型。写成 `as const` 是为了让下面的谓词能**收窄联合类型**：
/// `App.tsx` 里 `!isMediaPseudoPlatform(x)` 之后 `x` 必须是 7 个文本平台之一，
/// 才能交给 `AccountsScreen`（它的 `platform` 是真实的 `PlatformId`）。
export type MediaPseudoPlatform = (typeof mediaPseudoPlatforms)[number];

export function isMediaPseudoPlatform(
  platform: AgentPlatform | undefined,
): platform is MediaPseudoPlatform {
  return platform !== undefined && (mediaPseudoPlatforms as readonly string[]).includes(platform);
}

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
