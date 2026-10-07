import hosts from "./responsesPlaintextReasoningHosts.json";

export type ResponsesPlaintextReasoningMode = "auto" | "on" | "off";
export const RESPONSES_PLAINTEXT_REASONING_KEY = "responses_plaintext_reasoning_compat";

export function plaintextReasoningModeFromConfig(config: Record<string, unknown>): ResponsesPlaintextReasoningMode {
  const mode = config[RESPONSES_PLAINTEXT_REASONING_KEY];
  // 未知非空配置不应被界面误展示为自动开启；保存时显式关闭。
  if (mode === "on" || mode === "off") return mode;
  return mode === undefined || mode === null || mode === "auto" ? "auto" : "off";
}

export function plaintextReasoningMatchedHost(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return hosts.find((host) => host === url.hostname.toLowerCase()) ?? null;
  } catch { return null; }
}

export function writePlaintextReasoningMode(config: Record<string, unknown>, mode: ResponsesPlaintextReasoningMode) {
  if (mode === "auto") delete config[RESPONSES_PLAINTEXT_REASONING_KEY];
  else config[RESPONSES_PLAINTEXT_REASONING_KEY] = mode;
}
