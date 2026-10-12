import { useState } from "react";
import { AgentIcon, type AgentIconPlatform } from "../components/brand/AgentIcon";
import { ImageCapabilitySegment } from "../components/accounts/ImageCapabilitySegment";
import type { PlatformId } from "../lib/api/types";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { AccountsScreen } from "./AccountsScreen";
import { AudioChannelsScreen } from "./AudioChannelsScreen";
import { VideoChannelsScreen } from "./VideoChannelsScreen";

/// codex 页的模态分段器。
///
/// **为什么在这里分。** 视频 / 音频是独立平台（上游是另一家公司），生图是文本池里
/// 账号的一个能力。它们曾经各占一个侧边栏入口，于是导航第一层里混了两种东西
/// ——「池身份」（Codex / Claude / …）和「模态」（Video / Audio）——每加一个模态就
/// 多一个入口。这一屏把模态收进分段器，侧边栏只留池身份。
///
/// **这是过渡形态。** 目标架构是「网关统一账号池 → provider 分组 → 多模态 → 账号」：
/// 那时 codex 页会成为账号池的唯一载体、其余平台降级成 provider 来源。在那之前，
/// 「视频」「TTS」两段里显示的仍然是它们自己平台（`video` / `audio`）的账号，段内
/// 会写明这一点，免得用户以为它们属于 codex 池。
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
        <VideoChannelsScreen embedded hint={t("codex.segment.videoHint")} />
      ) : null}

      {segment === "audio" ? (
        <AudioChannelsScreen embedded hint={t("codex.segment.audioHint")} />
      ) : null}
    </div>
  );
}
