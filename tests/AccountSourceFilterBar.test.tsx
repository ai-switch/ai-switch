import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSourceFilterBar } from "../src/components/accounts/AccountSourceFilterBar";

const items = [
  { key: "all", label: "全部" },
  { key: "openai", label: "OpenAI" },
  { key: "custom", label: "自定义API" },
  { key: "packycode", label: "PackyCode" },
];
let availableWidth = 400;
const resizeCallbacks = new Set<ResizeObserverCallback>();

function Filters() {
  const [activeKey, setActiveKey] = useState("all");
  return (
    <>
      <AccountSourceFilterBar items={items} icons={{}} activeKey={activeKey} onSelect={setActiveKey} />
      <output aria-label="当前账号来源">{activeKey}</output>
      <button type="button">其他操作</button>
    </>
  );
}

function resize(width: number) {
  availableWidth = width;
  act(() => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
  });
}

beforeEach(() => {
  availableWidth = 400;
  resizeCallbacks.clear();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { resizeCallbacks.add(this.callback); }
    unobserve() {}
    disconnect() { resizeCallbacks.delete(this.callback); }
  });
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    let width: number | undefined;
    if (this.dataset.testid === "account-source-filter-row") width = availableWidth;
    else if (this.hasAttribute("data-source-filter-measure")) width = 80;
    else if (this.hasAttribute("data-source-filter-more-measure")) width = 56;
    if (width === undefined) return original.call(this);
    return { x: 0, y: 0, width, height: 28, top: 0, right: width, bottom: 28, left: 0, toJSON: () => ({}) };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AccountSourceFilterBar", () => {
  it("keeps the complete row visible at its exact fitted width", () => {
    availableWidth = 326;
    render(<Filters />);
    expect(screen.getAllByRole("button", { name: /^账号来源筛选 / })).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "更多账号来源" })).not.toBeInTheDocument();
  });

  it("moves only trailing providers into more and retains their selection", async () => {
    availableWidth = 240;
    render(<Filters />);
    expect(screen.getAllByRole("button", { name: /^账号来源筛选 / })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "账号来源筛选 PackyCode" })).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "更多账号来源" });
    await userEvent.click(more);
    const menu = screen.getByRole("menu", { name: "更多账号来源" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2);
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: "账号来源筛选 PackyCode" }));
    expect(screen.getByLabelText("当前账号来源")).toHaveTextContent("packycode");
    expect(more).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "账号来源筛选 全部" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("remeasures hidden chips and restores them when the window grows", async () => {
    availableWidth = 240;
    render(<Filters />);
    await userEvent.click(screen.getByRole("button", { name: "更多账号来源" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "账号来源筛选 PackyCode" }));
    resize(400);
    expect(screen.getAllByRole("button", { name: /^账号来源筛选 / })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "账号来源筛选 PackyCode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "更多账号来源" })).not.toBeInTheDocument();
    resize(240);
    expect(screen.getByRole("button", { name: "更多账号来源" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps every provider reachable when only the more button fits", async () => {
    availableWidth = 60;
    render(<Filters />);
    expect(screen.queryAllByRole("button", { name: /^账号来源筛选 / })).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "更多账号来源" }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
  });

  it("closes more with Escape and returns focus to its trigger", async () => {
    availableWidth = 240;
    render(<Filters />);
    const more = screen.getByRole("button", { name: "更多账号来源" });
    await userEvent.click(more);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it("closes more after a click outside the filter bar", async () => {
    availableWidth = 240;
    render(<Filters />);
    await userEvent.click(screen.getByRole("button", { name: "更多账号来源" }));
    await userEvent.click(screen.getByRole("button", { name: "其他操作" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("unsubscribes its size observation on unmount", () => {
    const { unmount } = render(<Filters />);
    expect(resizeCallbacks.size).toBeGreaterThan(0);
    unmount();
    expect(resizeCallbacks.size).toBe(0);
  });
});
