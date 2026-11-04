/**
 * 音频方言表（TTS）。
 *
 * **音频不是平台。** 供应商（OpenAI / MiniMax / 火山 / Azure / ElevenLabs …）
 * 之间差的是**线协议**——上游路径、鉴权头、回程是原始字节还是 JSON+base64——
 * 而线协议属于账号的 `config_json.interface_format`。音频账号本身住在某个
 * **池身份**下（通常是 `codex`），靠 `model_mappings` 里声明的 `audio.generate`
 * 能力被识别为音频账号。
 *
 * 目前有 2 个规范值：`openai`（OpenAI 兼容的 `/v1/audio/speech`）与
 * `minimax`（MiniMax 原生 `/v1/t2a_v2`）。后端还认别名，但界面只认规范值。
 *
 * 注意 `openai` 与**文本**线协议同名，`minimax` 与**视频**方言同名，所以「这个
 * 账号是不是音频账号」不能靠 `interface_format` 判断，只能靠它有没有声明
 * `audio.generate`。
 */

export type AudioDialect = "openai" | "minimax";

/// 音频账号必须声明的能力。少了它，音频端点在候选池里选不到这个账号。
export const AUDIO_CAPABILITY = "audio.generate";

export const AUDIO_DIALECTS: ReadonlyArray<{
  dialect: AudioDialect;
  label: string;
}> = [
  { dialect: "openai", label: "OpenAI" },
  { dialect: "minimax", label: "MiniMax" },
];

export const AUDIO_DIALECT_VALUES: readonly string[] = AUDIO_DIALECTS.map(
  (item) => item.dialect,
);

/** 账号的 `interface_format` → 展示用的供应商名（认不出就原样返回）。 */
export function audioDialectLabel(dialect: string): string {
  const trimmed = dialect.trim().toLowerCase();
  return AUDIO_DIALECTS.find((item) => item.dialect === trimmed)?.label ?? dialect;
}
