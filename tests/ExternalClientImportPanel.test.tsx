import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExternalClientImportPanel } from "../src/components/accounts/ExternalClientImportPanel";
import type { ExternalClientImportPreview } from "../src/lib/api/types";

function preview(): ExternalClientImportPreview {
  return {
    client: "magpie",
    source_path: "C:/Users/example/.config/magpie",
    counts: {
      total: 2,
      importable: 1,
      create: 1,
      overwrite: 0,
      errors: 1,
      official: 1,
      other_platform: 0,
      other_platform_counts: {},
      unsupported: 2,
      unsupported_counts: { copilot: 1, aggregate: 1 },
    },
    items: [
      {
        source_id: "login:claude-1",
        display_name: "claude@example.com",
        platform: "claude",
        kind: "official",
        interface_format: null,
        base_url: null,
        api_key_masked: "sk-a***oken",
        model_mapping_count: 0,
        disposition: "create",
        existing_credential_id: null,
        existing_display_name: null,
        issue_codes: [],
      },
      {
        source_id: "login:broken",
        display_name: "Broken login",
        platform: "claude",
        kind: "official",
        interface_format: null,
        base_url: null,
        api_key_masked: null,
        model_mapping_count: 0,
        disposition: "error",
        existing_credential_id: null,
        existing_display_name: null,
        issue_codes: ["external_import.official_snapshot_invalid"],
      },
    ],
  };
}

function renderPanel(client: "cc-switch" | "codex-plus" | "magpie" = "magpie") {
  render(
    <ExternalClientImportPanel
      client={client}
      pathMode={client === "cc-switch" ? "file" : "directory"}
      desktop
      error={null}
      labelClass="label"
      loading={false}
      onChooseSourcePath={vi.fn()}
      onRefresh={vi.fn()}
      onResetSourcePath={vi.fn()}
      onToggleAll={vi.fn()}
      onToggleItem={vi.fn()}
      preview={preview()}
      selectedIds={new Set(["login:claude-1"])}
      sourcePath={preview().source_path}
    />,
  );
}

describe("ExternalClientImportPanel", () => {
  it("shows each external client label and official subscription rows", () => {
    renderPanel("magpie");
    expect(screen.getByText("Magpie")).toBeInTheDocument();
    expect(screen.getAllByText("订阅")).toHaveLength(2);
    expect(screen.getByText(/可导入 1 项 · 订阅 1 · 新增 1 · 覆盖 0 · 需修正 1/)).toBeInTheDocument();
  });

  it("shows unsupported buckets and new issue labels", () => {
    renderPanel("codex-plus");
    expect(screen.getByText("Codex++")).toBeInTheDocument();
    expect(screen.getByText(/暂不支持 2 项/)).toBeInTheDocument();
    expect(screen.getByText(/aggregate 1/)).toBeInTheDocument();
    expect(screen.getByText("官方登录凭据快照无法解析")).toBeInTheDocument();
  });
});
