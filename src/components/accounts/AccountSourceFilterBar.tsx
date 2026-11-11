import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { computeVisibleSourceFilterCount } from "../../lib/sourceFilterOverflow";
import { MotionMenu } from "../motion/MotionPrimitives";

export type AccountSourceFilterItem = { key: string; label: string };

type AccountSourceFilterBarProps = {
  items: readonly AccountSourceFilterItem[];
  icons: Record<string, ReactNode>;
  activeKey: string;
  onSelect: (key: string) => void;
};

const chipClass = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-semibold motion-control";

export function AccountSourceFilterBar({ items, icons, activeKey, onSelect }: AccountSourceFilterBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [naturalWidth, setNaturalWidth] = useState<number>();
  const [open, setOpen] = useState(false);
  const visibleItems = items.slice(0, visibleCount);
  const overflowItems = items.slice(visibleCount);
  const overflowActive = overflowItems.some((item) => item.key === activeKey);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measurement = measureRef.current;
    if (!row || !measurement) return;
    let disposed = false;
    const update = () => {
      if (disposed) return;
      const widths = Array.from(measurement.querySelectorAll<HTMLElement>("[data-source-filter-measure]"))
        .map((chip) => chip.getBoundingClientRect().width);
      if (widths.some((width) => width <= 0)) return;
      const moreWidth = measurement.querySelector<HTMLElement>("[data-source-filter-more-measure]")
        ?.getBoundingClientRect().width ?? 64;
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 2;
      const contentWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap;
      setNaturalWidth(contentWidth + 6);
      setVisibleCount(computeVisibleSourceFilterCount(row.getBoundingClientRect().width, widths, moreWidth, gap));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(row);
    observer?.observe(measurement);
    window.addEventListener("resize", update);
    void document.fonts?.ready.then(update);
    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [items]);

  useEffect(() => {
    if (!overflowItems.length) setOpen(false);
  }, [overflowItems.length]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?? menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    first?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const select = (key: string) => {
    onSelect(key);
    setOpen(false);
    moreRef.current?.focus();
  };

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      moreRef.current?.focus();
      return;
    }
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (!buttons.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.findIndex((button) => button === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div aria-label="账号来源筛选" role="group" className="relative min-w-16 flex-1" ref={rootRef} style={{ maxWidth: naturalWidth }}>
      <div className="rounded-lg border border-stone-300 bg-white p-0.5 shadow-sm">
        <div className="flex h-7 min-w-0 items-center gap-0.5" data-testid="account-source-filter-row" ref={rowRef}>
          {visibleItems.map((item) => (
            <button
              aria-label={`账号来源筛选 ${item.label}`}
              aria-pressed={activeKey === item.key}
              className={`${chipClass} ${activeKey === item.key ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}
              key={item.key}
              onClick={() => onSelect(item.key)}
              title={item.label}
              type="button"
            >
              {icons[item.key]}{item.label}
            </button>
          ))}
          {overflowItems.length > 0 && (
            <div className="relative min-w-0 shrink-0" onKeyDown={handleMenuKey}>
              <button
                aria-label="更多账号来源"
                aria-expanded={open}
                aria-haspopup="menu"
                aria-pressed={overflowActive}
                className={`${chipClass} max-w-full ${overflowActive ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}
                onClick={() => setOpen((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setOpen(true);
                  }
                }}
                ref={moreRef}
                title={overflowActive ? `当前来源：${items.find((item) => item.key === activeKey)?.label}` : "更多账号来源"}
                type="button"
              >
                更多<ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              </button>
              <div ref={menuRef}>
                <MotionMenu
                  ariaLabel="更多账号来源"
                  className="absolute right-0 top-full z-30 mt-1 max-h-64 w-40 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-stone-300 bg-white p-1 shadow-lg"
                  open={open}
                  origin="top-right"
                  role="menu"
                >
                  {overflowItems.map((item) => (
                    <button
                      aria-label={`账号来源筛选 ${item.label}`}
                      aria-checked={activeKey === item.key}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-semibold motion-control ${activeKey === item.key ? "bg-stone-100 text-stone-950" : "text-stone-600 hover:bg-stone-100"}`}
                      key={item.key}
                      onClick={() => select(item.key)}
                      role="menuitemradio"
                      type="button"
                    >
                      {icons[item.key]}<span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {activeKey === item.key && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  ))}
                </MotionMenu>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Measure every option even while it is folded, so growing the panel restores it. */}
      <div aria-hidden="true" className="pointer-events-none invisible fixed left-[-10000px] top-0 flex w-max gap-0.5" ref={measureRef}>
        {items.map((item) => (
          <button className={chipClass} data-source-filter-measure key={item.key} tabIndex={-1} type="button">
            {icons[item.key]}{item.label}
          </button>
        ))}
        <button className={chipClass} data-source-filter-more-measure tabIndex={-1} type="button">
          更多<ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </button>
      </div>
    </div>
  );
}
