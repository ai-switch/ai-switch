import type { AccountPreset } from "./accountPresets";

export const IMAGE_CAPABILITY = "image.generate";

// The wire dialect stays compatible with the native image bridge; the UI names
// the actual image endpoint rather than its unrelated text protocol.
export const IMAGE_DIALECTS = [
  { dialect: "openai" as const, label: "OpenAI 图片 / GPT Image（兼容 Seedream）" },
  { dialect: "gemini" as const, label: "Google Gemini 图片（Nano Banana / Pro）" },
];

export const IMAGE_ACCOUNT_PRESETS: AccountPreset[] = [
  {
    id: "openai-image",
    platform: "codex",
    label: "OpenAI / GPT Image",
    provider: "OpenAI",
    defaultName: "GPT Image",
    baseUrl: "https://api.openai.com/v1",
    interfaceFormat: "openai",
    modelMappings: [{ from: "gpt-image-1", to: "gpt-image-1", capabilities: [IMAGE_CAPABILITY] }],
  },
  {
    id: "google-gemini-image",
    platform: "codex",
    label: "Google / Nano Banana（Gemini 图片）",
    provider: "Google Nano Banana",
    defaultName: "Nano Banana",
    baseUrl: "https://generativelanguage.googleapis.com",
    interfaceFormat: "gemini",
    modelMappings: [{ from: "gemini-2.5-flash-image", to: "gemini-2.5-flash-image", capabilities: [IMAGE_CAPABILITY] }],
  },
  {
    id: "google-nano-banana-pro",
    platform: "codex",
    label: "Google / Nano Banana Pro（Gemini 图片）",
    provider: "Google Nano Banana Pro",
    defaultName: "Nano Banana Pro",
    baseUrl: "https://generativelanguage.googleapis.com",
    interfaceFormat: "gemini",
    modelMappings: [{ from: "gemini-3-pro-image-preview", to: "gemini-3-pro-image-preview", capabilities: [IMAGE_CAPABILITY] }],
  },
  {
    id: "volcengine-seedream",
    platform: "codex",
    label: "豆包 / Seedream（火山方舟）",
    provider: "火山方舟",
    defaultName: "豆包 Seedream",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    interfaceFormat: "openai",
    modelMappings: [{ from: "doubao-seedream-4-0-250828", to: "doubao-seedream-4-0-250828", capabilities: [IMAGE_CAPABILITY] }],
  },
];

export function imageUpstreamEndpoint(baseUrl: string, dialect: string, model: string): string | null {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (dialect === "gemini") {
    const modelId = model.trim().replace(/^\/?models\//, "");
    if (!modelId) return null;
    const root = base.replace(/\/(v1|v1beta)\/?$/i, "");
    return `${root}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  }
  if (dialect === "openai-responses") return `${base}/responses`;
  if (dialect !== "openai") return null;
  return /\/v\d+$/i.test(base) ? `${base}/images/generations` : `${base}/v1/images/generations`;
}

export function imageDialectLabel(dialect: string): string {
  if (dialect === "openai-responses") return "OpenAI 图片工具（旧 Responses 图片账号）";
  return IMAGE_DIALECTS.find((item) => item.dialect === dialect)?.label ?? dialect;
}
