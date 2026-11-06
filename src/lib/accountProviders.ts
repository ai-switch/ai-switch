import type { PlatformId, RouteCredential } from "./api/types";

export const apiAccountProviders = [
  { value: "custom", label: "Custom" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "packycode", label: "PackyCode" },
  { value: "agentrouter", label: "AgentRouter" },
] as const;

export const officialAccountProviders = [
  { value: "openai", label: "OpenAI", platform: "codex" },
  { value: "claude", label: "Claude", platform: "claude" },
  { value: "gemini", label: "Gemini", platform: "gemini" },
  { value: "grok", label: "Grok", platform: "grok" },
] as const;

export type ApiAccountProvider = (typeof apiAccountProviders)[number]["value"];
export type OfficialAccountProvider = (typeof officialAccountProviders)[number]["value"];

export function officialProviderPlatform(provider: OfficialAccountProvider): PlatformId {
  return officialAccountProviders.find((item) => item.value === provider)!.platform;
}

export function accountProviderLabel(provider: string): string {
  return [...apiAccountProviders, ...officialAccountProviders].find((item) => item.value === provider)?.label ?? provider;
}

// 账号列表顶部的一行来源筛选 chip：官方厂商与内置中转/自定义 API 同排展示。
// `kind`/`provider` 直接对应服务端查询参数；all 表示不限。
export const accountSourceFilters = [
  { key: "all", label: "全部", kind: null, provider: null },
  { key: "openai", label: "OpenAI", kind: "official", provider: "openai" },
  { key: "claude", label: "Claude", kind: "official", provider: "claude" },
  { key: "gemini", label: "Gemini", kind: "official", provider: "gemini" },
  { key: "grok", label: "Grok", kind: "official", provider: "grok" },
  { key: "custom", label: "自定义API", kind: "api", provider: "custom" },
  { key: "openrouter", label: "OpenRouter", kind: "api", provider: "openrouter" },
  { key: "packycode", label: "PackyCode", kind: "api", provider: "packycode" },
  { key: "agentrouter", label: "AgentRouter", kind: "api", provider: "agentrouter" },
] as const;

// 旧服务响应未返回 provider 时的显示兼容，不把 API 的协议族当来源。
export function accountProvider(credential: Pick<RouteCredential, "provider" | "platform" | "kind">): string {
  if (credential.provider?.trim()) return credential.provider.trim().toLowerCase();
  if (credential.kind === "official") return credential.platform === "codex" ? "openai" : credential.platform;
  return "custom";
}
