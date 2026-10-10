/**
 * 视频渠道的方言表（G-P1）。
 *
 * 与后端 `models::platform::VideoProtocol` 一一对应：`platform` 是
 * `Provider.kind` 的「模态:协议」取值（`PlatformId::as_str()`），账号的
 * `platform` 列写的就是它。所以这里既是「可选协议」列表，也是
 * 「账号 platform → 展示名」的映射表。
 *
 * 注意只有 5 个**规范值**：后端还认一些别名（`klingai` / `seedance` / `可灵` …），
 * 但落库前都会被归一成规范值，所以前端只需要认规范值。
 */
export type VideoProtocol = "kling" | "ark" | "minimax" | "zhipu" | "sora";

/// 账号/分组 `platform` 列里的视频取值，形如 `video:kling`。
export type VideoPlatform = `video:${VideoProtocol}`;

export const VIDEO_PROTOCOLS: ReadonlyArray<{
  protocol: VideoProtocol;
  platform: string;
  label: string;
}> = [
  { protocol: "kling", platform: "video:kling", label: "Kling" },
  // 方舟（Ark）上的视频模型是 Seedance，展示名用用户更认的那个
  { protocol: "ark", platform: "video:ark", label: "Seedance" },
  { protocol: "minimax", platform: "video:minimax", label: "MiniMax" },
  { protocol: "zhipu", platform: "video:zhipu", label: "Zhipu" },
  { protocol: "sora", platform: "video:sora", label: "Sora" },
];

export const VIDEO_PLATFORMS: readonly string[] = VIDEO_PROTOCOLS.map(
  (item) => item.platform,
);

/** 账号的 `platform` 串 → 展示用的协议名（认不出就退回去掉前缀的原串）。 */
export function videoProtocolLabel(platform: string): string {
  return (
    VIDEO_PROTOCOLS.find((item) => item.platform === platform)?.label ??
    platform.replace(/^video:/i, "")
  );
}

/** 该账号是不是视频渠道。 */
export function isVideoPlatform(platform: string): boolean {
  return VIDEO_PROTOCOLS.some((item) => item.platform === platform);
}
