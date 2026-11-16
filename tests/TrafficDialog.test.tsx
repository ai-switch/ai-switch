import { useRef, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TrafficDialog } from "../src/components/traffic/TrafficDialog";
import { I18nProvider } from "../src/lib/i18n";

function Fixture({ removeOpener = false }: { removeOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const fallback = useRef<HTMLButtonElement>(null);
  return <I18nProvider initialLanguage="en"><div data-testid="board">
    <button ref={fallback}>Routing help</button>
    {(!open || !removeOpener) && <button onClick={() => setOpen(true)}>More accounts</button>}
    {open && <TrafficDialog title="Account pool" onClose={() => setOpen(false)} returnFocusRef={fallback}>
      <button>First account</button><button>Last account</button>
    </TrafficDialog>}
  </div></I18nProvider>;
}

describe("TrafficDialog", () => {
  it("portals outside the clipped board and focuses Close, traps Tab, and restores the opener", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const opener = screen.getByRole("button", { name: "More accounts" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Account pool" });
    expect(screen.getByTestId("board")).not.toContainElement(dialog);
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Last account" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("restores a stable fallback when live updates remove the overflow trigger", async () => {
    const user = userEvent.setup();
    render(<Fixture removeOpener />);
    await user.click(screen.getByRole("button", { name: "More accounts" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Routing help" })).toHaveFocus();
  });

  it("closes on the backdrop but not on an inner click", () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "More accounts" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
