import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResponsesPlaintextReasoningOption } from "../src/components/accounts/ResponsesPlaintextReasoningOption";
import { plaintextReasoningMatchedHost, plaintextReasoningModeFromConfig, writePlaintextReasoningMode } from "../src/lib/responsesPlaintextReasoning";

describe("Responses 明文推理兼容", () => {
  it.each([
    ["https://anyrouter.top/v1", "anyrouter.top"],
    ["HTTPS://ANYROUTER.TOP:443/v1", "anyrouter.top"],
    ["https://sub.anyrouter.top/v1", null],
    ["https://anyrouter.top.evil.example/v1", null],
    ["https://evil.example/anyrouter.top", null],
    ["https://anyrouter.top@evil.example/v1", null],
    ["https://anyrouter.top./v1", null],
    ["file://anyrouter.top/v1", null],
    ["not a URL", null],
  ])("精确匹配 %s", (url, host) => expect(plaintextReasoningMatchedHost(url)).toBe(host));

  it("从旧配置读取自动模式，显式关闭保持关闭", () => {
    expect(plaintextReasoningModeFromConfig({})).toBe("auto");
    expect(plaintextReasoningModeFromConfig({ responses_plaintext_reasoning_compat: null })).toBe("auto");
    expect(plaintextReasoningModeFromConfig({ responses_plaintext_reasoning_compat: "off" })).toBe("off");
    expect(plaintextReasoningModeFromConfig({ responses_plaintext_reasoning_compat: "unexpected" })).toBe("off");
    const config: Record<string, unknown> = { unrelated: "keep", responses_encrypted_content_cleanup: true };
    writePlaintextReasoningMode(config, "off");
    expect(config.responses_plaintext_reasoning_compat).toBe("off");
    writePlaintextReasoningMode(config, "auto");
    expect(config).toEqual({ unrelated: "keep", responses_encrypted_content_cleanup: true });
  });

  it("Base URL 变化时实时更新自动状态，手动关闭不被名单反转", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ResponsesPlaintextReasoningOption mode="auto" baseUrl="https://other.example/v1" onChange={onChange} />);
    expect(screen.getByText("自动：未开启，网站未在兼容名单中")).toBeInTheDocument();
    rerender(<ResponsesPlaintextReasoningOption mode="auto" baseUrl="https://anyrouter.top/v1" onChange={onChange} />);
    expect(screen.getByText("自动：已开启，命中 anyrouter.top")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Responses 明文推理兼容"), "off");
    expect(onChange).toHaveBeenCalledWith("off");
    rerender(<ResponsesPlaintextReasoningOption mode="off" baseUrl="https://anyrouter.top/v1" onChange={onChange} />);
    expect(screen.getByText("已手动关闭（优先于自动名单）")).toBeInTheDocument();
  });
});
