/**
 * The pool address a client of `platform` has to be pointed at.
 *
 * Two shapes, decided by whether the client appends a bare endpoint or a
 * versioned path of its own:
 *
 * - **`{base}/v1`** — Codex calls `{baseUrl}/responses`, and OpenCode / OpenClaw
 *   / Hermes all reach the pool through Chat Completions, i.e.
 *   `{baseUrl}/chat/completions`. Each platform's config writer renders exactly
 *   this, and an address the user copies by hand has to match what gets written.
 * - **bare** — Claude / Gemini / Grok clients append their own versioned paths
 *   (`/v1/messages`, `/v1beta/models/...`), so a `/v1` here would double it.
 */
const PLATFORMS_NEEDING_V1 = new Set(["codex", "opencode", "openclaw", "hermes"]);

export function routeProxyEndpointForPlatform(baseUrl: string, platform: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed || !PLATFORMS_NEEDING_V1.has(platform)) {
    return trimmed;
  }
  // Idempotent: a base URL that already ends in /v1 must not grow a second one.
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/**
 * 生图端点（`/v1/images/generations`）的完整地址。
 *
 * 生图**没有自己的平台**：它是 codex / gemini 账号的一个能力，与文本共用同一个池、
 * 同一个 Base URL，只是路径不同。所以这个地址必须从 `routeProxyEndpointForPlatform`
 * 的结果推出来，而不能像视频/音频那样自己拼 `{base}/v1/...` —— codex 的 Base URL
 * 已经带 `/v1`（客户端自己接 `/responses`），gemini 的是裸的（客户端自己接
 * `/v1beta/...`），同一个绝对路径因此要接在两段不同的位置上。
 */
export function imageGenerationEndpoint(poolBaseUrl: string, platform: string): string {
  const endpoint = routeProxyEndpointForPlatform(poolBaseUrl, platform);
  if (!endpoint) {
    return "";
  }
  return /\/v1$/i.test(endpoint)
    ? `${endpoint}/images/generations`
    : `${endpoint}/v1/images/generations`;
}
