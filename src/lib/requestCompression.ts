import hosts from "./requestCompressionHosts.json";

export type RequestCompressionMode = "auto" | "on" | "off";
export const REQUEST_BROTLI_COMPRESSION_KEY = "request_brotli_compression";

export function requestCompressionModeFromConfig(config: Record<string, unknown>): RequestCompressionMode {
  const mode = config[REQUEST_BROTLI_COMPRESSION_KEY];
  if (mode === "on" || mode === "off") return mode;
  return mode === undefined || mode === null || mode === "auto" ? "auto" : "off";
}

export function requestCompressionMatchedHost(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "https:" || (url.port !== "" && url.port !== "443")) return null;
    const host = url.hostname.toLowerCase();
    return hosts.some((allowed) => allowed.toLowerCase() === host) ? host : null;
  } catch {
    return null;
  }
}

export function writeRequestCompressionMode(config: Record<string, unknown>, mode: RequestCompressionMode) {
  if (mode === "auto") delete config[REQUEST_BROTLI_COMPRESSION_KEY];
  else config[REQUEST_BROTLI_COMPRESSION_KEY] = mode;
}
