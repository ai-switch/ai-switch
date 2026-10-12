import { useState } from "react";
import { AgentIcon, type AgentIconPlatform } from "../components/brand/AgentIcon";
import { ImageCapabilitySegment } from "../components/accounts/ImageCapabilitySegment";
import type { PlatformId } from "../lib/api/types";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { AUDIO_CAPABILITY } from "../lib/audioPlatforms";
import { VIDEO_CAPABILITY } from "../lib/videoPlatforms";
import { AccountsScreen } from "./AccountsScreen";

/// codex 页的模态分段器。
///
/// **为什么在这里分。** 视频 / 音频 / 生图是三种模态，不是三种平台。它们曾经各占一个
/// 侧边栏入口，于是导航第一层里混了两种东西——「池身份」（Codex / Claude / …）和
/// 「模态」（Video / Audio）——每加一个模态就多一个入口、多一张 key。这一屏把模态收进
/// 分段器，侧边栏只留池身份。
///
/// **四段共用同一套账号管理**：都是 `AccountsScreen(platform="codex")`，区别只在
/// `capabilityFilter`。这不是巧合——视频 / 音频账号本来就住在 codex 池里，靠
/// `model_mappings` 里声明的 `video.generate` / `audio.generate` / `image.generate`
/// 被识别。账号列表的差别只是筛出来的那一部分。
///
/// 分段选择的持久化键。导出是为了让测试能直接播种/断言，而不必去猜字面量。
export const CODEX_SEGMENT_STORAGE_KEY = "ai-switch.codex-channel-segment";

const SEGMENTS = ["general", "image", "video", "audio"] as const;
type CodexSegment = (typeof SEGMENTS)[number];

const SEGMENT_LABEL_KEYS: Record<CodexSegment, TranslationKey> = {
  general: "codex.segment.general",
  image: "codex.segment.image",
  video: "codex.segment.video",
  audio: "codex.segment.audio",
};

/// 段图标。「通用」用的是 codex 的图标——那一段**就是** codex 池。
const SEGMENT_ICONS: Record<CodexSegment, AgentIconPlatform> = {
  general: "codex",
  image: "image",
  video: "video",
  audio: "audio",
};

/// 记住上次选的段：常切的人不用每次重新点，也不至于每次进 codex 都被弹到别的段。
function readStoredSegment(): CodexSegment {
  try {
    const stored = window.localStorage.getItem(CODEX_SEGMENT_STORAGE_KEY);
    if (SEGMENTS.includes(stored as CodexSegment)) {
      return stored as CodexSegment;
    }
  } catch {
    // 受限 webview 里 localStorage 可能不可用。
  }
  return "general";
}

function storeSegment(segment: CodexSegment) {
  try {
    window.localStorage.setItem(CODEX_SEGMENT_STORAGE_KEY, segment);
  } catch {
    // 同上：存不下就只影响「记住上次选择」，不该影响使用。
  }
}

export function CodexChannelsScreen({
  onOpenSessions,
  sidebarCollapsed,
  onPoolScopeFocusConsumed,
  poolScopeFocus,
  imageGenerationEnabled,
  onOpenImageStudio,
}: {
  onOpenSessions?: (platform: PlatformId) => void;
  sidebarCollapsed?: boolean;
  onPoolScopeFocusConsumed?: (nonce: number) => void;
  poolScopeFocus?: {
    platform: string;
    scope: "in_pool" | "out_of_pool";
    nonce: number;
  } | null;
  imageGenerationEnabled: boolean;
  onOpenImageStudio?: () => void;
}) {
  const { t } = useI18n();
  const [segment, setSegment] = useState<CodexSegment>(readStoredSegment);

  const select = (next: CodexSegment) => {
    setSegment(next);
    storeSegment(next);
  };

  return (
    <div className="space-y-3">
      <div
        aria-label={t("codex.segments")}
        className="flex flex-wrap items-center gap-1 border-b border-stone-200 px-1 pb-2"
        role="tablist"
      >
        {SEGMENTS.map((item) => (
          <button
            aria-selected={segment === item}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold motion-control ${
              segment === item
                ? "bg-stone-900 text-white"
                : "text-stone-600 hover:bg-stone-100"
            }`}
            key={item}
            onClick={() => select(item)}
            role="tab"
            type="button"
          >
            <AgentIcon className="h-3.5 w-3.5" platform={SEGMENT_ICONS[item]} />
            {t(SEGMENT_LABEL_KEYS[item])}
          </button>
        ))}
      </div>

      {segment === "general" ? (
        <AccountsScreen
          onOpenSessions={onOpenSessions}
          onPoolScopeFocusConsumed={onPoolScopeFocusConsumed}
          platform="codex"
          poolScopeFocus={poolScopeFocus}
          sidebarCollapsed={sidebarCollapsed}
        />
      ) : null}

      {segment === "image" ? (
        <div className="space-y-3">
          <ImageCapabilitySegment
            imageGenerationEnabled={imageGenerationEnabled}
            onOpenImageStudio={onOpenImageStudio}
          />
          {/* 生图账号就是 codex 池里**声明了 `image.generate` 的账号**，所以这里
              直接复用账号管理屏、只把列表按能力筛过 —— 与「通用」段是同一套增删改查，
              区别只在 `capabilityFilter`。 */}
          <AccountsScreen capabilityFilter="image.generate" platform="codex" />
        </div>
      ) : null}

      {segment === "video" ? (
        <div className="space-y-3">
          {/* 视频账号住在 codex 池里，靠 `video.generate` 被识别 —— 所以这一段和
              「通用」段是同一套账号管理，只是列表按能力筛过。 */}
          <AccountsScreen capabilityFilter={VIDEO_CAPABILITY} platform="codex" />
        </div>
      ) : null}

      {segment === "audio" ? (
        <div className="space-y-3">
          {/* 同视频：音频账号的 `interface_format` 是 `openai`（与文本同名），所以
              识别它的唯一依据就是 `audio.generate` 这个能力声明。 */}
          <AccountsScreen capabilityFilter={AUDIO_CAPABILITY} platform="codex" />
        </div>
      ) : null}
    </div>
  );
}
