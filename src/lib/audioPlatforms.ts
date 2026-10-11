/**
 * 音频渠道的方言表。
 *
 * **音频只有一个平台 `audio`。** 供应商（OpenAI / MiniMax / 火山 / Azure /
 * ElevenLabs …）之间差的是**线协议**——上游路径、鉴权头、回程是原始字节还是
 * JSON+base64——而线协议属于账号的 `config_json.interface_format`，不属于
 * `platform`。与视频同构：一个平台、一张 key，落到哪家由请求里的 `model` 名决定。
 *
 * 目前只有 1 个规范值：`openai`（OpenAI 兼容的 `/v1/audio/speech`）。后端还认
 * `tts` / `speech` 这类别名，但界面只认规范值。
 *
 * **刻意与视频不同的一点**：视频那边故意**不认** `openai`（收了它
 * `interface_format: "openai"` 会静默变成「Sora」），而音频这里 `openai` 是正当
 * 取值。两处结论相反是因为语义不同，不是笔误。
 */

/// 音频的平台值（`route_credentials.platform` 与 SaaS 分组都写它）。
export const AUDIO_PLATFORM = "audio";

export type AudioDialect = "openai";

export const AUDIO_DIALECTS: ReadonlyArray<{
  dialect: AudioDialect;
  label: string;
}> = [{ dialect: "openai", label: "OpenAI" }];

export const AUDIO_DIALECT_VALUES: readonly string[] = AUDIO_DIALECTS.map(
  (item) => item.dialect,
);

/** 账号的 `interface_format` → 展示用的供应商名（认不出就原样返回）。 */
export function audioDialectLabel(dialect: string): string {
  const trimmed = dialect.trim().toLowerCase();
  return AUDIO_DIALECTS.find((item) => item.dialect === trimmed)?.label ?? dialect;
}

/** 该账号是不是音频渠道。 */
export function isAudioPlatform(platform: string): boolean {
  return platform.trim().toLowerCase() === AUDIO_PLATFORM;
}
