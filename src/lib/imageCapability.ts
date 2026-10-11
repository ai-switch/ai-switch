/**
 * 从一个账号的 `config_json` 里读出**声明了 `image.generate` 的公开模型名**。
 *
 * 生图没有自己的平台：它是文本池里账号的一个能力，端点是 `/v1/images/generations`，
 * 与文本共用同一个 Base URL 和同一张 key。所以「这个池能不能出图」只能从账号的
 * `model_mappings` 里读出来 —— 接入信息与「生图」段都靠它。
 *
 * 认不出的条目直接跳过、不抛：这个函数跑在渲染路径上，一个手写的脏 config 不该让
 * 整屏炸掉。
 */
export function imageCapableModels(configJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    return [];
  }
  const mappings = (parsed as { model_mappings?: unknown } | null)?.model_mappings;
  if (!Array.isArray(mappings)) {
    return [];
  }
  const models: string[] = [];
  for (const item of mappings) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { from?: unknown; capabilities?: unknown };
    const from = typeof row.from === "string" ? row.from.trim() : "";
    if (!from) {
      continue;
    }
    const capabilities = Array.isArray(row.capabilities) ? row.capabilities : [];
    if (capabilities.includes("image.generate")) {
      models.push(from);
    }
  }
  return models;
}

/** 一个池里所有账号声明过的生图模型名（去重，保持首次出现的顺序）。 */
export function poolImageModels(
  credentials: ReadonlyArray<{ config_json: string }>,
): string[] {
  const models = new Set<string>();
  for (const credential of credentials) {
    for (const model of imageCapableModels(credential.config_json)) {
      models.add(model);
    }
  }
  return [...models];
}
