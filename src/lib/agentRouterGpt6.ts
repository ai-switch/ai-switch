import type { InterfaceFormat, ModelMapping } from "./api/types";

/**
 * Hosts whose gpt-6 line answers only on the Responses API.
 *
 * AgentRouter fronts both `agentrouter.org` and the backup line on
 * `ps.air-outer.com`. On either one, a gpt-6 request that reaches
 * `/v1/chat/completions` is rejected as soon as the client sends function
 * tools: "Function tools with reasoning_effort are not supported ... use
 * /v1/responses or set reasoning_effort to 'none'".
 */
const AGENTROUTER_HOSTS = ["agentrouter.org", "ps.air-outer.com"];

/** The gpt-6 model ids the guard found in an account's model mappings. */
export type AgentRouterGpt6Warning = {
  models: string[];
};

/** Host of `baseUrl`, lowercased and without the port; `null` when unreadable. */
function baseUrlHost(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function isGpt6Model(model: string): boolean {
  return /^gpt-6/i.test(model.trim());
}

/**
 * Whether saving this account would produce the AgentRouter + gpt-6 + Chat
 * Completions combination the upstream rejects.
 *
 * Only `openai` (Chat Completions) is flagged: `openai-responses` is the fix,
 * and the Anthropic/Gemini dialects never put `reasoning_effort` on this path.
 * A null result means there is nothing to warn about.
 */
export function agentRouterGpt6NeedsResponses(input: {
  baseUrl: string;
  interfaceFormat: InterfaceFormat | string | null | undefined;
  modelMappings: readonly ModelMapping[];
}): AgentRouterGpt6Warning | null {
  if (input.interfaceFormat !== "openai") {
    return null;
  }
  const host = baseUrlHost(input.baseUrl);
  if (!host || !AGENTROUTER_HOSTS.includes(host)) {
    return null;
  }
  const models: string[] = [];
  // Case-insensitive: `gpt-6-astra` and `GPT-6-astra` are one id written two
  // ways, and listing both would only make the prompt read like two accounts.
  const seen = new Set<string>();
  for (const mapping of input.modelMappings) {
    for (const candidate of [mapping.from, mapping.to]) {
      const model = candidate?.trim();
      const key = model?.toLowerCase();
      if (!model || !key || !isGpt6Model(model) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      models.push(model);
    }
  }
  return models.length > 0 ? { models } : null;
}

/** Save-time prompt shown when {@link agentRouterGpt6NeedsResponses} fires. */
export function agentRouterGpt6ResponsesMessage(warning: AgentRouterGpt6Warning): string {
  return [
    `AgentRouter 的 gpt-6（${warning.models.join("、")}）现在配的是 OpenAI Chat Completions。`,
    "该站 gpt-6 只接受 /v1/responses：走 /v1/chat/completions 时，带 function tools 的请求会被上游以 400 拒绝" +
      "（Function tools with reasoning_effort are not supported）。",
    "",
    "点「确定」改用 OpenAI Responses 并保存；点「取消」保持 Chat Completions 保存。",
  ].join("\n");
}
