import { describe, expect, it } from "vitest";
import type { RoutePoolGroup } from "../../src/lib/api/types";
import {
  CLAUDE_BACKUP_GROUP_IDS,
  presentRoutePoolGroups,
  type RoutePoolPresentationItem,
} from "../../src/lib/routePoolGroupPresentation";

const timestamp = "2026-11-14T00:00:00Z";

function group(
  id: string,
  overrides: Partial<Omit<RoutePoolGroup, "id">> = {},
): RoutePoolGroup {
  return {
    id,
    platform: "codex",
    name: id,
    sort_order: 0,
    is_internal: false,
    is_active: false,
    account_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function ids(items: RoutePoolPresentationItem[]) {
  return items.map((item) => ("children" in item ? item.key : item.group.id));
}

describe("routePoolGroupPresentation", () => {
  it("keeps real groups and appends one backup container for the legacy claude trio", () => {
    const groups = [
      group("codex-default", { name: "默认组", is_active: true }),
      group("codex-out", { name: "未入池" }),
      group("codex-archived", { name: "已归档" }),
      group("claude-default", { name: "默认组", sort_order: 3 }),
      group("claude-out", { name: "未入池", sort_order: 4 }),
      group("claude-archived", { name: "已归档", sort_order: 5 }),
    ];
    const { items, backup } = presentRoutePoolGroups(groups);
    expect(ids(items)).toEqual([
      "codex-default",
      "codex-out",
      "codex-archived",
      "claude-backup",
    ]);
    expect(backup).toBeDefined();
    expect(backup!.children.map((child) => child.id)).toEqual([
      "claude-default",
      "claude-out",
      "claude-archived",
    ]);
    // The default child is the natural entry point.
    expect(backup!.initialChildId).toBe("claude-default");
    // The container carries no backend-usable id.
    expect("id" in items[3]).toBe(false);
  });

  it("only folds the exact legacy ids, keeping renamed, custom and claude-saas groups visible", () => {
    const groups = [
      group("codex-default", { name: "默认组", is_active: true }),
      group("claude-default", { name: "Claude 主力", sort_order: 1 }),
      group("claude-out", { name: "未入池", sort_order: 2 }),
      group("claude-saas", { name: "默认组", sort_order: 3 }),
      group("custom-uuid", { name: "默认组", sort_order: 4 }),
    ];
    const { items, backup } = presentRoutePoolGroups(groups);
    expect(ids(items)).toEqual([
      "codex-default",
      "claude-saas",
      "custom-uuid",
      "claude-backup",
    ]);
    expect(backup!.children.map((child) => child.id)).toEqual([
      "claude-default",
      "claude-out",
    ]);
  });

  it("sorts surviving children in the canonical default → out → archived order", () => {
    const groups = [
      group("claude-archived", { name: "已归档" }),
      group("claude-out", { name: "未入池" }),
    ];
    const { backup } = presentRoutePoolGroups(groups);
    expect(backup!.children.map((child) => child.id)).toEqual([
      "claude-out",
      "claude-archived",
    ]);
    expect(backup!.initialChildId).toBe("claude-out");
  });

  it("returns no backup entry when none of the legacy ids survive", () => {
    const groups = [
      group("codex-default", { name: "默认组", is_active: true }),
      group("custom-uuid", { name: "自建" }),
    ];
    const { items, backup } = presentRoutePoolGroups(groups);
    expect(ids(items)).toEqual(["codex-default", "custom-uuid"]);
    expect(backup).toBeUndefined();
    expect(items.every((item) => "group" in item)).toBe(true);
  });

  it("exposes every legacy id it knows about, even when the backend dropped some", () => {
    expect(CLAUDE_BACKUP_GROUP_IDS).toEqual([
      "claude-default",
      "claude-out",
      "claude-archived",
    ]);
  });
});
