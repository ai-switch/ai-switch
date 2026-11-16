import { useLayoutEffect, useRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTrafficGeometry } from "../../src/lib/useTrafficGeometry";

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
  toJSON: () => ({}),
});
function Fixture({ ids = ["one", "two"] }: { ids?: string[] }) {
  const geometry = useTrafficGeometry(ids, ["account"]);
  useLayoutEffect(() => {
    const board = geometry.boardRef.current!;
    Object.defineProperty(board, "clientWidth", { configurable: true, value: 660 });
    Object.defineProperty(board, "clientHeight", { configurable: true, value: 488 });
    board.getBoundingClientRect = () => rect(100, 50, 330, 244);
    geometry.hubRef.current!.getBoundingClientRect = () => rect(237.5, 145, 44, 60);
    ids.forEach((id, index) => {
      geometry.clientRefs.current.get(id)!.getBoundingClientRect = () => rect(105, 75 + index * 20, 100, 15);
    });
    geometry.accountRefs.current.get("account")!.getBoundingClientRect = () => rect(325, 100, 100, 20);
    window.dispatchEvent(new Event("resize"));
  }, [ids.join(",")]);
  return <div ref={geometry.boardRef}>
    <div ref={geometry.hubRef} />
    {ids.map((id) => <button key={id} ref={(node) => { if (node) geometry.clientRefs.current.set(id, node); else geometry.clientRefs.current.delete(id); }} />)}
    <button ref={(node) => { if (node) geometry.accountRefs.current.set("account", node); else geometry.accountRefs.current.delete("account"); }} />
    <output data-testid="client-one-path">{geometry.clientPaths.get("one") ?? ""}</output>
    <output data-testid="account-path">{geometry.accountPaths.get("account") ?? ""}</output>
  </div>;
}

afterEach(() => vi.unstubAllGlobals());

describe("traffic geometry", () => {
  it("normalizes scaled page coordinates and remeasures a same-size node reorder", () => {
    let scheduled: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => { scheduled = callback; return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { rerender } = render(<Fixture />);
    act(() => scheduled?.(0));
    expect(screen.getByTestId("client-one-path")).toHaveTextContent(/^M 210 65 /);
    expect(screen.getByTestId("account-path")).toHaveTextContent(/^M 363 250 /);
    rerender(<Fixture ids={["two", "one"]} />);
    act(() => scheduled?.(0));
    expect(screen.getByTestId("client-one-path")).toHaveTextContent(/^M 210 105 /);
  });

  it("updates anchors when a hidden-busy footer changes row positions without resizing the board", () => {
    const callbacks: Array<{ callback: ResizeObserverCallback; nodes: Element[] }> = [];
    vi.stubGlobal("ResizeObserver", class {
      entry: { callback: ResizeObserverCallback; nodes: Element[] };
      constructor(callback: ResizeObserverCallback) { this.entry = { callback, nodes: [] }; callbacks.push(this.entry); }
      observe(node: Element) { this.entry.nodes.push(node); }
      disconnect() {}
    });
    let scheduled: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => { scheduled = callback; return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    function FooterFixture({ busy }: { busy: boolean }) {
      const geometry = useTrafficGeometry(["client"], ["account"]);
      const shift = useRef(busy);
      shift.current = busy;
      const nodeRef = useRef<HTMLButtonElement | null>(null);
      useLayoutEffect(() => {
        const board = geometry.boardRef.current!;
        Object.defineProperty(board, "clientWidth", { configurable: true, value: 660 });
        Object.defineProperty(board, "clientHeight", { configurable: true, value: 488 });
        board.getBoundingClientRect = () => rect(0, 0, 660, 488);
        geometry.hubRef.current!.getBoundingClientRect = () => rect(286, 184, 88, 120);
        nodeRef.current!.getBoundingClientRect = () => rect(10, shift.current ? 30 : 50, 200, 20);
        window.dispatchEvent(new Event("resize"));
      }, []);
      return <div ref={geometry.boardRef}><div ref={geometry.hubRef} />
        <div data-testid="node-list"><button ref={(node) => { nodeRef.current = node; if (node) geometry.clientRefs.current.set("client", node); }} /></div>
        {busy && <small>1 active off-screen</small>}
        <output>{geometry.clientPaths.get("client")}</output>
      </div>;
    }
    const { rerender } = render(<FooterFixture busy={false} />);
    act(() => { const callback = scheduled; scheduled = undefined; callback?.(0); });
    expect(screen.getByRole("status")).toHaveTextContent(/^M 210 60 /);
    rerender(<FooterFixture busy />);
    act(() => {
      const observation = callbacks.find((entry) => entry.nodes.includes(screen.getByTestId("node-list")));
      observation?.callback([], {} as ResizeObserver);
      const callback = scheduled;
      scheduled = undefined;
      callback?.(0);
    });
    expect(screen.getByRole("status")).toHaveTextContent(/^M 210 40 /);
  });

  it("disconnects observers and cancels queued work on unmount", () => {
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7));
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const view = render(<Fixture />);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
