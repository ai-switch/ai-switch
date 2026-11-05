import type { PlatformId } from "./api/types";

// 客户端身份用于接入配置与会话来源，不代表账号池或导航入口。
export const clientPlatforms: PlatformId[] = [
  "codex", "claude", "grok", "gemini", "opencode", "openclaw", "hermes",
];
