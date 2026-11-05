export const accountModalities = ["general", "image", "video", "audio", "vector"] as const;
export type AccountModality = (typeof accountModalities)[number];
export type ModalityVisibility = Record<AccountModality, boolean>;

export const modalityScreenById: Record<AccountModality, string> = {
  general: "PoolGeneral",
  image: "PoolImage",
  video: "PoolVideo",
  audio: "PoolAudio",
  vector: "PoolVector",
};

export const modalityLabelKeys = {
  general: "codex.segment.general",
  image: "codex.segment.image",
  video: "codex.segment.video",
  audio: "codex.segment.audio",
  vector: "codex.segment.vector",
} as const;

export const MODALITY_VISIBILITY_STORAGE_KEY = "ai-switch.modality-visibility";
type VisibilityStorage = Pick<Storage, "getItem" | "setItem">;

export function modalityForScreen(screen: string): AccountModality | undefined {
  return accountModalities.find((modality) => modalityScreenById[modality] === screen);
}

export function createDefaultModalityVisibility(): ModalityVisibility {
  return { general: true, image: true, video: true, audio: true, vector: true };
}

export function readModalityVisibility(storage?: VisibilityStorage): ModalityVisibility {
  const visibility = createDefaultModalityVisibility();
  if (!storage && typeof window === "undefined") return visibility;
  try {
    const stored: unknown = JSON.parse(
      (storage ?? window.localStorage).getItem(MODALITY_VISIBILITY_STORAGE_KEY) ?? "{}",
    );
    if (!stored || typeof stored !== "object") return visibility;
    for (const modality of accountModalities) {
      const value = (stored as Record<string, unknown>)[modality];
      if (typeof value === "boolean") visibility[modality] = value;
    }
  } catch {
    // 受限 webview 的 localStorage 不可用时仍显示全部账号池入口。
  }
  return visibility;
}

export function writeModalityVisibility(visibility: ModalityVisibility, storage?: VisibilityStorage) {
  if (!storage && typeof window === "undefined") return;
  try {
    (storage ?? window.localStorage).setItem(MODALITY_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // 存不下偏好不应影响当前导航。
  }
}

export function resolveVisibleModalityScreen(screen: string, visibility: ModalityVisibility): string {
  const modality = modalityForScreen(screen);
  if (!modality || visibility[modality]) return screen;
  const next = accountModalities.find((item) => visibility[item]);
  return next ? modalityScreenById[next] : "Settings";
}
