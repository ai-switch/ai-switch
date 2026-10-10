/**
 * 视频渠道的方言表。
 *
 * **视频只有一个平台 `video`。** 可灵 / 方舟(Seedance) / MiniMax / 智谱 / Sora
 * 之间差的是**线协议**（请求体形状、上游路径、状态解析），而线协议属于账号的
 * `config_json.interface_format`，不属于 `platform`——与文本平台同构：一个
 * `platform = codex` 的账号可以挂 `interface_format: anthropic`。
 *
 * 所以：
 *   - `platform` 列永远写 `video`（`VIDEO_PLATFORM`）；
 *   - 供应商写在 `interface_format` 里（`VIDEO_DIALECTS[].dialect`）；
 *   - 客户端**不指定**供应商：请求里的 `model` 名决定落到哪家。
 *
 * 只有 5 个**规范值**：后端还认一些别名（`seedance` / `hailuo` / `可灵` …），
 * 但界面只需要认规范值。
 */

/// 视频的平台值（`route_credentials.platform` 与 SaaS 分组都写它）。
export const VIDEO_PLATFORM = "video";

export type VideoDialect = "kling" | "ark" | "minimax" | "zhipu" | "sora";

export const VIDEO_DIALECTS: ReadonlyArray<{
  dialect: VideoDialect;
  label: string;
}> = [
  { dialect: "kling", label: "Kling" },
  // 方舟（Ark）上的视频模型是 Seedance，展示名用用户更认的那个
  { dialect: "ark", label: "Seedance" },
  { dialect: "minimax", label: "MiniMax" },
  { dialect: "zhipu", label: "Zhipu" },
  { dialect: "sora", label: "Sora" },
];

export const VIDEO_DIALECT_VALUES: readonly string[] = VIDEO_DIALECTS.map(
  (item) => item.dialect,
);

/** 账号的 `interface_format` → 展示用的供应商名（认不出就原样返回）。 */
export function videoDialectLabel(dialect: string): string {
  const trimmed = dialect.trim().toLowerCase();
  return VIDEO_DIALECTS.find((item) => item.dialect === trimmed)?.label ?? dialect;
}

/** 该账号是不是视频渠道。 */
export function isVideoPlatform(platform: string): boolean {
  return platform.trim().toLowerCase() === VIDEO_PLATFORM;
}
