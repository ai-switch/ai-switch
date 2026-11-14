import type { RoutePoolGroup } from "./api/types";

/**
 * 统一账号池的分组展示投影。
 *
 * 迁移（202611040002）把旧平台组并进 codex 池后，旧 Claude 的三个系统视图组
 * （`claude-default` / `claude-out` / `claude-archived`）会与 codex 的同名组
 * 并列出现。它们可能仍被 SaaS 密钥、模型价格、同步与计费历史引用（v0.18.1
 * 的收敛因此保留它们），所以这里**只做展示折叠**：底栏把三个固定 ID 合成一个
 * 「Claude 备份分组」入口，点击后在真实子组之间切换。所有写操作继续使用真实
 * 子组 ID，容器本身没有可提交的后端 ID。
 */

/** 旧 Claude 系统视图组的固定 ID（migrations/202609080001）。 */
export const CLAUDE_BACKUP_GROUP_IDS = [
  "claude-default",
  "claude-out",
  "claude-archived",
] as const;

export type RoutePoolPresentationItem =
  | { kind: "group"; group: RoutePoolGroup }
  | { kind: "backup"; key: "claude-backup"; children: RoutePoolGroup[] };

export type ClaudeBackupContainer = {
  /** 按 default → out → archived 排序的真实子组。 */
  children: RoutePoolGroup[];
  /** 打开容器时默认浏览的子组：原默认组，缺失时取第一个存活的 child。 */
  initialChildId: string;
};

/** 底栏展示投影：真实组保持原顺序，旧 Claude 系统组折叠为一个容器项。 */
export function presentRoutePoolGroups(
  groups: RoutePoolGroup[],
): { items: RoutePoolPresentationItem[]; backup?: ClaudeBackupContainer } {
  const legacy = new Map<string, RoutePoolGroup>();
  for (const id of CLAUDE_BACKUP_GROUP_IDS) {
    const match = groups.find((group) => group.id === id);
    if (match) {
      legacy.set(id, match);
    }
  }
  if (legacy.size === 0) {
    return { items: groups.map((group) => ({ kind: "group", group })) };
  }

  const children = CLAUDE_BACKUP_GROUP_IDS.filter((id) => legacy.has(id)).map(
    (id) => legacy.get(id)!,
  );
  const items: RoutePoolPresentationItem[] = groups
    .filter((group) => !legacy.has(group.id))
    .map((group) => ({ kind: "group", group }) as RoutePoolPresentationItem);
  const backup: ClaudeBackupContainer = {
    children,
    initialChildId: children[0].id,
  };
  items.push({ kind: "backup", key: "claude-backup", children });
  return { items, backup };
}
