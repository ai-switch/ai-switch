import { Bot, Briefcase, Plug, Terminal, Waves, type LucideIcon } from "lucide-react";
import { AgentBrandMark, isAgentBrandKey } from "../components/brand/AgentBrandMark";
import { AgentIcon, type AgentIconPlatform } from "../components/brand/AgentIcon";

/**
 * 客户端接入页现在是**一张统一列表**，没有平台 tab。
 *
 * 账号池只有一个（后端池身份恒为 codex），左侧导航也早就没有平台入口。
 * 但客户端侧仍然客观存在不同协议族：Codex CLI 读 config.toml 并声明
 * `wire_api="responses"`，Claude Code 读 settings.json 并自己拼 `/v1/messages`，
 * 其余第三方 Agent 走 OpenAI 兼容的 Chat Completions。所以「接口格式」是
 * 每个智能体自己的属性，用来决定写入时走哪一组适配器、哪一把接入 Key，
 * 而不是一个需要用户先选的平台层级。
 */
export type AgentInterfaceFormat = "responses" | "chat" | "messages";

export const interfaceFormatLabels: Record<AgentInterfaceFormat, string> = {
  responses: "Responses",
  chat: "Chat",
  messages: "Messages",
};

export const interfaceFormatHints: Record<AgentInterfaceFormat, string> = {
  responses: "OpenAI Responses 协议，写入 Codex 系配置文件",
  chat: "OpenAI 兼容 Chat Completions，第三方 Agent 默认",
  messages: "Anthropic Messages 协议，Claude Code 专用",
};

/**
 * 默认写入格式：Codex CLI 用 Responses，Claude Code 用 Messages，其余一律 Chat。
 * 个别第三方客户端（如 ZCode）自己的配置文件里会声明 Responses；卡片上的
 * 徽标表示网关按哪个协议族为它写配置，具体线格式仍由各自的适配器决定。
 */
export function defaultAgentInterfaceFormat(clientKey: string): AgentInterfaceFormat {
  if (clientKey === "codex") return "responses";
  if (clientKey === "claude_code" || clientKey === "claude") return "messages";
  return "chat";
}

/** 写入时按接口格式落到后端的协议族；后端的 `platform` 只是协议族标识。 */
export const DEFAULT_AGENT_PLATFORM = "codex";
export const MESSAGES_AGENT_PLATFORM = "claude";

export function platformForInterfaceFormat(format: AgentInterfaceFormat): string {
  return format === "messages" ? MESSAGES_AGENT_PLATFORM : DEFAULT_AGENT_PLATFORM;
}

/**
 * 统一列表 = 原 Codex 组全部客户端 + Claude Code。
 * Claude 协议组下与第三方同名的客户端不重复出现：一个 Agent 只写一份配置。
 */
export const CLAUDE_CODE_CLIENT_KEY = "claude_code";

/** 兼容旧深链参数；现在页面只有一张列表，平台参数不再影响展示。 */
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
 * 卡片图标：有官方内联 SVG 的七个生态走 `AgentIcon`；其余第三方 Agent 用
 * 各自品牌色的矢量字标；都没匹配上才退回按客户端族给线性图标。
 */
export function ClientIcon({ clientKey, className = "h-5 w-5" }: ClientIconProps) {
  const brand = brandIconPlatform(clientKey);
  if (brand) {
    return <AgentIcon className={className} platform={brand} />;
  }
  if (isAgentBrandKey(clientKey)) {
    return <AgentBrandMark className={className} clientKey={clientKey} />;
  }
  const Icon = fallbackIcon(clientKey);
  return <Icon aria-hidden="true" className={className} />;
}

function brandIconPlatform(clientKey: string): AgentIconPlatform | null {
  switch (clientKey) {
    case "codex":
      return "codex";
    case "claude":
    case CLAUDE_CODE_CLIENT_KEY:
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
