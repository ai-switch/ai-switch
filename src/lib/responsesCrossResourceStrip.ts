import hosts from "./responsesCrossResourceStripHosts.json";

export type ResponsesCrossResourceStripMode = "auto" | "on" | "off";
export const RESPONSES_CROSS_RESOURCE_STRIP_KEY = "responses_cross_resource_strip";

export function crossResourceStripModeFromConfig(
  config: Record<string, unknown>,
): ResponsesCrossResourceStripMode {
  const mode = config[RESPONSES_CROSS_RESOURCE_STRIP_KEY];
  // 未知非空配置不应被界面误展示为自动开启；保存时显式关闭。
  if (mode === "on" || mode === "off") return mode;
  return mode === undefined || mode === null || mode === "auto" ? "auto" : "off";
}

export function crossResourceStripMatchedHost(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return hosts.find((host) => host === url.hostname.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

export function writeCrossResourceStripMode(
  config: Record<string, unknown>,
  mode: ResponsesCrossResourceStripMode,
) {
  if (mode === "auto") delete config[RESPONSES_CROSS_RESOURCE_STRIP_KEY];
  else config[RESPONSES_CROSS_RESOURCE_STRIP_KEY] = mode;
}
