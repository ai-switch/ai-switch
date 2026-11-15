import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageGenerationScreen } from "../src/imagegen/ImageGenerationScreen";
import { imagegenApi } from "../src/imagegen/api";
import type { ImageSession } from "../src/imagegen/types";
import { I18nProvider } from "../src/lib/i18n";

vi.mock("../src/imagegen/api", () => ({
  imagegenApi: { listSessions: vi.fn(), createSession: vi.fn(), conversation: vi.fn(), models: vi.fn() },
}));

const session: ImageSession = {
  id: "session-1", title: "Mountain sunrise", platform: "gemini", archived: false,
  created_at: "2026-11-10T12:00:00Z", updated_at: "2026-11-10T12:00:00Z",
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(imagegenApi.listSessions).mockReset().mockResolvedValue([]);
  vi.mocked(imagegenApi.models).mockReset().mockResolvedValue([]);
  vi.mocked(imagegenApi.createSession).mockReset().mockResolvedValue(session);
  vi.mocked(imagegenApi.conversation).mockReset().mockResolvedValue({ session, messages: [], assets: [] });
});

function renderScreen() {
  return render(<I18nProvider initialLanguage="en"><ImageGenerationScreen /></I18nProvider>);
}

describe("image session creation", () => {
  it("creates the named session from an inline form and opens its conversation", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.selectOptions(screen.getByRole("combobox", { name: "Compute group platform" }), "gemini");
    await user.click(screen.getByRole("button", { name: "New session" }));
    const form = screen.getByRole("form", { name: "New session" });
    const name = within(form).getByRole("textbox", { name: "Session name" });
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, "  Mountain sunrise  ");
    vi.mocked(imagegenApi.listSessions).mockResolvedValue([session]);
    await user.click(within(form).getByRole("button", { name: "New session" }));
    expect(await screen.findByRole("heading", { name: "Mountain sunrise" })).toBeInTheDocument();
    expect(imagegenApi.createSession).toHaveBeenCalledWith({ title: "Mountain sunrise", platform: "gemini" });
    expect(screen.queryByRole("form", { name: "New session" })).not.toBeInTheDocument();
  });

  it("cancels without creating or changing a session", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "New session" }));
    const form = screen.getByRole("form", { name: "New session" });
    await user.type(within(form).getByRole("textbox", { name: "Session name" }), " draft");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "New session" })).not.toBeInTheDocument();
    expect(imagegenApi.createSession).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Create a session to start generating" })).toBeInTheDocument();
  });

  it("rejects an empty name and retains input when creation fails", async () => {
    const user = userEvent.setup();
    vi.mocked(imagegenApi.createSession).mockRejectedValue(new Error("Storage unavailable"));
    renderScreen();
    await user.click(screen.getByRole("button", { name: "New session" }));
    const form = screen.getByRole("form", { name: "New session" });
    const name = within(form).getByRole("textbox", { name: "Session name" });
    await user.clear(name);
    await user.type(name, "   ");
    expect(within(form).getByRole("button", { name: "New session" })).toBeDisabled();
    expect(imagegenApi.createSession).not.toHaveBeenCalled();
    await user.clear(name);
    await user.type(name, "Retry me{Enter}");
    expect(await screen.findByText(/Storage unavailable/)).toBeInTheDocument();
    expect(name).toHaveValue("Retry me");
    await waitFor(() => expect(within(form).getByRole("button", { name: "New session" })).toBeEnabled());
  });
});
