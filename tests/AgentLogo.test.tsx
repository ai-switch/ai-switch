import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentLogo } from "../src/components/brand/AgentLogo";
import { agentClientInfo } from "../src/lib/agentClients";
import { ClientIcon } from "../src/lib/clientSetup";

describe("AgentLogo", () => {
  it.each(["codex", "claude_code", "gemini_cli", "grok", "opencode", "openclaw", "hermes", "zcode", "workbuddy", "workbuddy_ai", "codebuddy_cli", "qoder_cli", "qoder_cn_cli", "deepseek_harness", "deepseek_harness_desktop"])("renders %s locally with an accessible name", (clientKey) => {
    const { container } = render(<AgentLogo clientKey={clientKey} />);
    expect(screen.getByRole("img", { name: agentClientInfo(clientKey).label })).toBeInTheDocument();
    expect(container.querySelector("svg, img")).toBeInTheDocument();
    for (const image of container.querySelectorAll("img")) {
      expect(image.getAttribute("src")).not.toMatch(/^https?:/);
    }
  });

  it.each([
    ["zcode", "zcode.png"],
    ["codebuddy_cli", "codebuddy.svg"],
    ["qoder_cli", "qoder.svg"],
    ["qoder_cn_cli", "qoder.svg"],
  ])("uses the verified official client icon for %s instead of a generic monogram", (clientKey, asset) => {
    const { container } = render(<AgentLogo clientKey={clientKey} />);
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toContain(`brand/${asset}`);
    expect(container.querySelector("svg text")).not.toBeInTheDocument();
  });

  it.each(["workbuddy", "workbuddy_ai"])("uses official WorkBuddy artwork rather than a letter placeholder for %s", (clientKey) => {
    const { container } = render(<AgentLogo clientKey={clientKey} />);
    const logo = screen.getByRole("img", { name: agentClientInfo(clientKey).label });
    const image = logo.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toMatch(/brand\/workbuddy(?:-ai)?\.(?:svg|png)$/);
    expect(container.querySelector("svg text")).not.toBeInTheDocument();
  });

  it.each([
    ["workbuddy", "workbuddy.svg", "10ccbc099e7bc3d5ff12c315c4edd7b21386aa7166c1ec19997b3d55010d5c7d"],
    ["workbuddy_ai", "workbuddy.svg", "10ccbc099e7bc3d5ff12c315c4edd7b21386aa7166c1ec19997b3d55010d5c7d"],
    ["codebuddy_cli", "codebuddy.svg", "149baa45b9f9370c15f20d599afe381aa138e4fc13acf503f435c571ac93ecf5"],
    ["zcode", "zcode.png", "1ec553f7eaeae4492c673e9d636692a3898d11800d912628d8c1e667222d6d19"],
    ["qoder_cli", "qoder.svg", "5e1843cb50c4613855024453e76d5c06d2ca5562efebc12b4fcd80cf9ece1dd0"],
    ["qoder_cn_cli", "qoder.svg", "5e1843cb50c4613855024453e76d5c06d2ca5562efebc12b4fcd80cf9ece1dd0"],
  ])("renders the exact verified official asset in client setup for %s", (clientKey, asset, hash) => {
    const { container } = render(<ClientIcon clientKey={clientKey} />);
    const src = container.querySelector("img")?.getAttribute("src");
    expect(src).toBe(`${import.meta.env.BASE_URL}brand/${asset}`);
    const bytes = readFileSync(resolve(__dirname, "../public", src!.slice(import.meta.env.BASE_URL.length)));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  });

  it("uses the official local Harness artwork in client setup as well as the traffic view", () => {
    const { container } = render(<ClientIcon clientKey="deepseek_harness" />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("brand/deepseek-harness.svg");
  });

  it("uses a neutral mark for unknown clients, including object prototype names", () => {
    render(<AgentLogo clientKey="__proto__" />);
    expect(screen.getByRole("img", { name: "__proto__" })).toBeInTheDocument();
    expect(agentClientInfo("__proto__").color).toBe("#64748b");
  });
});
