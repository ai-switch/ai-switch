export type SubscriptionTypeDisplay = {
  raw: string;
  label: string;
  title: string;
  ariaLabel: string;
};

const SUBSCRIPTION_TYPE_LABELS: Readonly<Record<string, string>> = {
  self_serve_business_prolite: "Business 高级版",
};

function humanizeSubscriptionType(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[A-Za-z]+/g, (word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`);
}

export function formatSubscriptionType(raw: string | null | undefined): SubscriptionTypeDisplay | null {
  const normalized = typeof raw === "string" ? raw.trim() : "";
  if (!normalized) {
    return null;
  }

  const label =
    SUBSCRIPTION_TYPE_LABELS[normalized.toLowerCase()] ?? humanizeSubscriptionType(normalized);
  return {
    raw: normalized,
    label,
    title: `订阅类型：${label}\n原始订阅类型：${normalized}`,
    ariaLabel: `订阅类型：${label}；原始订阅类型：${normalized}`,
  };
}
