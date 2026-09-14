import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexOAuthDialog } from "../src/components/accounts/CodexOAuthDialog";
import { cancelCodexOAuth, getCodexOAuthStatus, startCodexOAuth } from "../src/lib/api/client";
import type { CodexOAuthStatus } from "../src/lib/api/types";
import { openExternal } from "../src/lib/openExternal";

vi.mock("../src/lib/api/client", () => ({ startCodexOAuth: vi.fn(), getCodexOAuthStatus: vi.fn(), cancelCodexOAuth: vi.fn() }));
vi.mock("../src/lib/openExternal", () => ({ openExternal: vi.fn() }));

const pending: CodexOAuthStatus = {
  session_id: "session-1", method: "browser", status: "waiting",
  authorization_url: "https://auth.openai.com/oauth/authorize?state=fixture",
  user_code: null, expires_at: "2026-09-14T23:59:59Z", account: null, error: null,
};
const success: CodexOAuthStatus = { ...pending, status: "succeeded", authorization_url: null, account: { id: "new-account", display_name: "oauth@example.test", email: "oauth@example.test" } };
const cancelled: CodexOAuthStatus = { ...pending, status: "cancelled", authorization_url: null };

function setup(batchName = "  OAuth Batch  ") {
  const onClose = vi.fn();
  const onImported = vi.fn();
  return { ...render(<CodexOAuthDialog batchName={batchName} onClose={onClose} onImported={onImported} />), onClose, onImported };
}

describe("CodexOAuthDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(startCodexOAuth).mockResolvedValue(pending);
    vi.mocked(getCodexOAuthStatus).mockResolvedValue(pending);
    vi.mocked(cancelCodexOAuth).mockResolvedValue(cancelled);
    vi.mocked(openExternal).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => { cleanup(); });

  it("validates the shared batch name before starting the official CLI", async () => {
    setup("  ");
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("批量名称不能为空");
    expect(startCodexOAuth).not.toHaveBeenCalled();
  });

  it("starts browser login and opens its URL once without exposing a token field", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(pending.authorization_url));
    expect(startCodexOAuth).toHaveBeenCalledWith({ method: "browser", batch_name: "OAuth Batch" });
    expect(screen.getByRole("status")).toHaveTextContent("等待浏览器授权");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "浏览器授权" })).toBeDisabled();
    await waitFor(() => expect(getCodexOAuthStatus).toHaveBeenCalled());
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("shows and copies a device code only after explicit device login", async () => {
    const device: CodexOAuthStatus = { ...pending, method: "device_code", user_code: "ABCD-1234", authorization_url: "https://auth.openai.com/codex/device" };
    vi.mocked(startCodexOAuth).mockResolvedValue(device);
    vi.mocked(getCodexOAuthStatus).mockResolvedValue(device);
    setup();
    await userEvent.click(screen.getByRole("button", { name: "设备码授权" }));
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "复制设备码" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(startCodexOAuth).toHaveBeenCalledWith({ method: "device_code", batch_name: "OAuth Batch" });
    expect(openExternal).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "打开授权页面" }));
    expect(openExternal).toHaveBeenCalledWith(device.authorization_url);
  });

  it("finishes one import without cancelling completed credentials", async () => {
    vi.mocked(getCodexOAuthStatus).mockResolvedValue(success);
    const { onImported, onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(onImported).toHaveBeenCalledWith(success.account);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cancelCodexOAuth).not.toHaveBeenCalled();
  });

  it("cancels on Escape and waits for cleanup before closing", async () => {
    let finish!: (value: CodexOAuthStatus) => void;
    vi.mocked(cancelCodexOAuth).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    await waitFor(() => expect(startCodexOAuth).toHaveBeenCalled());
    await userEvent.keyboard("{Escape}");
    expect(cancelCodexOAuth).toHaveBeenCalledWith("session-1");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish(cancelled); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels a late start response when the dialog was already unmounted", async () => {
    let finish!: (value: CodexOAuthStatus) => void;
    vi.mocked(startCodexOAuth).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { unmount, onImported } = setup();
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    unmount();
    await act(async () => { finish(pending); });
    expect(cancelCodexOAuth).toHaveBeenCalledWith("session-1");
    expect(openExternal).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("keeps login running when opening the browser fails and offers manual retry", async () => {
    vi.mocked(openExternal).mockRejectedValueOnce(new Error("browser unavailable"));
    setup();
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法打开浏览器");
    await userEvent.click(screen.getByRole("button", { name: "打开授权页面" }));
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(startCodexOAuth).toHaveBeenCalledTimes(1);
  });

  it("cleans up on polling failure and permits a fresh retry", async () => {
    vi.mocked(getCodexOAuthStatus).mockRejectedValueOnce(new Error("connection lost"));
    setup();
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    await waitFor(() => expect(cancelCodexOAuth).toHaveBeenCalledWith("session-1"), { timeout: 2500 });
    expect(await screen.findByRole("alert")).toHaveTextContent("登录状态获取失败");
    expect(screen.getByRole("button", { name: "浏览器授权" })).toBeEnabled();
  });

  it("accepts a completed import returned by cancellation instead of losing it", async () => {
    vi.mocked(cancelCodexOAuth).mockResolvedValue(success);
    const { onImported } = setup();
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    await userEvent.click(screen.getByRole("button", { name: "取消登录" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(success.account));
  });

  it("shows cleanup failures instead of silently closing a cancelled login", async () => {
    vi.mocked(cancelCodexOAuth).mockResolvedValue({ ...cancelled, status: "failed", error: {
      code: "codex_oauth.cleanup_failed", message: "cleanup failed", details: null, recoverable: true,
    } });
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "浏览器授权" }));
    await userEvent.click(screen.getByRole("button", { name: "取消登录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("临时登录目录未能完全清理");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps keyboard focus inside the login modal", async () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "OAuth 登录 Codex" });
    const buttons = dialog.querySelectorAll("button");
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(buttons[0]).toHaveFocus();
  });
});
