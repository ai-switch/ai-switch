import { Bot, Briefcase, Plug, Terminal, Waves, type LucideIcon } from "lucide-react";
import { AgentIcon, type AgentIconPlatform } from "../components/brand/AgentIcon";

/**
 * 配置写入按平台分栏：每个平台有自己的一组客户端适配器与一把池 key。
 * 统一账号池之后账号不再分平台，但客户端配置文件仍然是按平台写入的
 * （codex 写 config.toml、claude 写 settings.json……），所以这里保留平台维度。
 */
export const clientSetupPlatforms = ["codex", "claude", "gemini", "grok"] as const;
export type ClientSetupPlatform = (typeof clientSetupPlatforms)[number];

export const clientSetupPlatformLabels: Record<ClientSetupPlatform, string> = {
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
};

export function clientSetupPlatformOf(value: string | null | undefined): ClientSetupPlatform {
  return clientSetupPlatforms.includes((value ?? "") as ClientSetupPlatform)
    ? (value as ClientSetupPlatform)
    : "codex";
}

type ClientIconProps = {
  clientKey: string;
  className?: string;
};

/**
 * 客户端卡片图标：七个有品牌 SVG 的走 `AgentIcon`，其余按客户端族给线性图标，
 * 未知 key 兜底插头 —— 卡片永远不该没有图形。
 */
export function ClientIcon({ clientKey, className = "h-5 w-5" }: ClientIconProps) {
  const brand = brandIconPlatform(clientKey);
  if (brand) {
    return <AgentIcon className={className} platform={brand} />;
  }
  const Icon = fallbackIcon(clientKey);
  return <Icon aria-hidden="true" className={className} />;
}

function brandIconPlatform(clientKey: string): AgentIconPlatform | null {
  switch (clientKey) {
    case "codex":
      return "codex";
    case "claude":
      return "claude";
    case "gemini":
      return "gemini";
    case "grok":
      return "grok";
    case "opencode":
      return "opencode";
    case "openclaw":
      return "openclaw";
    case "hermes":
      return "hermes";
    default:
      return null;
  }
}

function fallbackIcon(clientKey: string): LucideIcon {
  if (clientKey.startsWith("deepseek_harness")) return Waves;
  if (clientKey.startsWith("workbuddy")) return Briefcase;
  if (clientKey.startsWith("qoder")) return Terminal;
  if (clientKey === "zcode" || clientKey.startsWith("codebuddy")) return Bot;
  return Plug;
}
