import type { AgentIconPlatform } from "../components/brand/AgentIcon";

export type AgentClientInfo = {
  label: string;
  color: string;
  platform?: AgentIconPlatform;
};

const CLIENTS: Record<string, AgentClientInfo> = {
  codex: { label: "Codex CLI", color: "#6366f1", platform: "codex" },
  chatgpt: { label: "ChatGPT", color: "#10a37f", platform: "codex" },
  claude_code: { label: "Claude Code", color: "#d97757", platform: "claude" },
  claude: { label: "Claude", color: "#d97757", platform: "claude" },
  gemini_cli: { label: "Gemini CLI", color: "#4285f4", platform: "gemini" },
  gemini: { label: "Gemini", color: "#4285f4", platform: "gemini" },
  grok: { label: "Grok", color: "#475569", platform: "grok" },
  opencode: { label: "OpenCode", color: "#a855f7", platform: "opencode" },
  openclaw: { label: "OpenClaw", color: "#ef4444", platform: "openclaw" },
  hermes: { label: "Hermes Agent", color: "#d69e35", platform: "hermes" },
  zcode: { label: "ZCode", color: "#5b5bd6" },
  deepseek_harness: { label: "DeepSeek Harness", color: "#4d6bfe" },
  deepseek_harness_desktop: { label: "DeepSeek Harness Desktop", color: "#3c55d9" },
  workbuddy: { label: "WorkBuddy", color: "#f2662a" },
  workbuddy_ai: { label: "WorkBuddy AI", color: "#d9531e" },
  codebuddy_cli: { label: "CodeBuddy CLI", color: "#0a6cff" },
  qoder_cli: { label: "Qoder CLI", color: "#7c4dff" },
  qoder_cn_cli: { label: "Qoder CN CLI", color: "#6a3fd6" },
  unknown: { label: "Unknown client", color: "#64748b" },
};

export function agentClientInfo(clientKey: string): AgentClientInfo {
  return Object.prototype.hasOwnProperty.call(CLIENTS, clientKey)
    ? CLIENTS[clientKey]
    : { label: clientKey, color: "#64748b" };
}
