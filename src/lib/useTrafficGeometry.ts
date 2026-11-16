import { useLayoutEffect, useRef, useState } from "react";

const emptyGeometry = { width: 660, height: 488, measured: false, clientPaths: new Map<string, string>(), accountPaths: new Map<string, string>() };

export function useTrafficGeometry(clientIds: string[], accountIds: string[]) {
  const boardRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const clientRefs = useRef(new Map<string, HTMLButtonElement>());
  const accountRefs = useRef(new Map<string, HTMLButtonElement>());
  const [geometry, setGeometry] = useState(emptyGeometry);
  const clientKey = JSON.stringify(clientIds);
  const accountKey = JSON.stringify(accountIds);

  useLayoutEffect(() => {
    const board = boardRef.current;
    const hub = hubRef.current;
    if (!board || !hub) return;
    let disposed = false;
    let frame: number | null = null;
    const measure = () => {
      if (disposed) return;
      const bounds = board.getBoundingClientRect();
      const measured = bounds.width > 0 && bounds.height > 0;
      const width = measured ? board.clientWidth || bounds.width : emptyGeometry.width;
      const height = measured ? board.clientHeight || bounds.height : emptyGeometry.height;
      const scaleX = measured ? width / bounds.width : 1;
      const scaleY = measured ? height / bounds.height : 1;
      const center = hub.getBoundingClientRect();
      const hubLeft = measured ? (center.left - bounds.left) * scaleX : width / 2 - 44;
      const hubRight = measured ? (center.right - bounds.left) * scaleX : width / 2 + 44;
      const hubY = measured ? (center.top + center.height / 2 - bounds.top) * scaleY : height / 2;
      const clientPaths = new Map<string, string>();
      const accountPaths = new Map<string, string>();
      clientIds.forEach((id, index) => {
        const node = clientRefs.current.get(id);
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const x = measured ? (rect.right - bounds.left) * scaleX : width * .32;
        const y = measured ? (rect.top + rect.height / 2 - bounds.top) * scaleY : 44 + (index + .5) * (height - 62) / clientIds.length;
        const bend = Math.max(12, (hubLeft - x) * .55);
        clientPaths.set(id, `M ${x} ${y} C ${x + bend} ${y}, ${hubLeft - bend} ${hubY}, ${hubLeft} ${hubY}`);
      });
      accountIds.forEach((id, index) => {
        const node = accountRefs.current.get(id);
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const x = measured ? (rect.left - bounds.left) * scaleX : width * .68;
        const y = measured ? (rect.top + rect.height / 2 - bounds.top) * scaleY : 44 + (index + .5) * (height - 62) / accountIds.length;
        const bend = Math.max(12, (x - hubRight) * .55);
        accountPaths.set(id, `M ${hubRight} ${hubY} C ${hubRight + bend} ${hubY}, ${x - bend} ${y}, ${x} ${y}`);
      });
      setGeometry({ width, height, measured, clientPaths, accountPaths });
    };
    const schedule = () => {
      if (typeof requestAnimationFrame === "undefined") { measure(); return; }
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; measure(); });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(board);
    observer?.observe(hub);
    clientIds.forEach((id) => { const node = clientRefs.current.get(id); if (node) { observer?.observe(node); if (node.parentElement) observer?.observe(node.parentElement); } });
    accountIds.forEach((id) => { const node = accountRefs.current.get(id); if (node) { observer?.observe(node); if (node.parentElement) observer?.observe(node.parentElement); } });
    measure();
    window.addEventListener("resize", schedule);
    return () => {
      disposed = true;
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
    };
  }, [clientKey, accountKey]);

  return { boardRef, hubRef, clientRefs, accountRefs, ...geometry };
}
