import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodexBaselineModelsDialog } from "../src/components/accounts/CodexBaselineModelsDialog";

function renderDialog(overrides: Partial<Parameters<typeof CodexBaselineModelsDialog>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <CodexBaselineModelsDialog
      models={["gpt-a", "gpt-b"]}
      defaultModels={["default-a", "default-b"]}
      onClose={onClose}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave, onClose };
}

describe("CodexBaselineModelsDialog", () => {
  it("renders the current ordered models", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Codex 基线模型" })).toBeInTheDocument();
    expect(screen.getByLabelText("基线模型 1")).toHaveValue("gpt-a");
    expect(screen.getByLabelText("基线模型 2")).toHaveValue("gpt-b");
  });

  it("adds, moves, and removes rows while preserving order", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    const added = screen.getByLabelText("基线模型 3");
    await user.type(added, "gpt-c");
    await user.click(screen.getByRole("button", { name: "上移 3" }));

    expect(screen.getByLabelText("基线模型 1")).toHaveValue("gpt-a");
    expect(screen.getByLabelText("基线模型 2")).toHaveValue("gpt-c");
    expect(screen.getByLabelText("基线模型 3")).toHaveValue("gpt-b");

    await user.click(screen.getByRole("button", { name: "删除 1" }));
    expect(screen.getByLabelText("基线模型 1")).toHaveValue("gpt-c");
    expect(screen.getByLabelText("基线模型 2")).toHaveValue("gpt-b");
  });

  it("restores defaults and saves them", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();

    await user.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(screen.getByLabelText("基线模型 1")).toHaveValue("default-a");
    expect(screen.getByLabelText("基线模型 2")).toHaveValue("default-b");

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(["default-a", "default-b"]);
  });

  it("trims blank rows and rejects duplicate ids case-insensitively", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({ models: [" gpt-a ", "", "gpt-b"] });

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(["gpt-a", "gpt-b"]);

    const third = screen.getByLabelText("基线模型 3");
    await user.clear(third);
    await user.type(third, "GPT-A");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("模型 ID 不能重复");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("resyncs the editor when models arrive after mount", () => {
    const { rerender } = render(
      <CodexBaselineModelsDialog
        models={[]}
        defaultModels={["default-a"]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    rerender(
      <CodexBaselineModelsDialog
        models={["loaded-a", "loaded-b"]}
        defaultModels={["default-a"]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("基线模型 1")).toHaveValue("loaded-a");
    expect(screen.getByLabelText("基线模型 2")).toHaveValue("loaded-b");
  });

  it("disables saving while a request is pending", () => {
    renderDialog({ loading: true });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
