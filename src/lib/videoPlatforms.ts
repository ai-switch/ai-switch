/**
 * 视频方言表。
 *
 * **视频不是平台。** 可灵 / 方舟(Seedance) / MiniMax / 智谱 / Sora 之间差的是
 * **线协议**（请求体形状、上游路径、状态解析），而线协议属于账号的
 * `config_json.interface_format`。视频账号本身住在某个**池身份**下（通常是
 * `codex`），靠 `model_mappings` 里声明的 `video.generate` 能力被识别为视频账号。
 *
 * 所以：
 *   - `platform` 列写**池身份**（`codex`），不是 `video`；
 *   - 供应商写在 `interface_format` 里（`VIDEO_DIALECTS[].dialect`）；
 *   - 客户端**不指定**供应商：请求里的 `model` 名决定落到哪家。
 *
 * 这与「供应商不是平台」是同一条原则：平台承担池身份，模态由端点路径决定。
 *
 * 只有 5 个**规范值**：后端还认一些别名（`seedance` / `hailuo` / `可灵` …），
 * 但界面只需要认规范值。
 */

export type VideoDialect = "kling" | "ark" | "minimax" | "zhipu" | "sora";

/// 视频账号必须声明的能力。少了它，视频端点在候选池里选不到这个账号
/// （`supports_requested_capability_with_mode` 要求**显式声明**，没有通配）。
export const VIDEO_CAPABILITY = "video.generate";

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

/** 该 `interface_format` 是不是视频方言。 */
export function isVideoDialect(value: string): boolean {
  return VIDEO_DIALECT_VALUES.includes(value.trim().toLowerCase());
}
