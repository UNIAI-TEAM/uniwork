"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/**
 * Touch has no hover, so a message's actions open on a long press instead.
 * The bar stays open until a tap lands outside the message or Escape is
 * pressed. Mouse and pen keep the hover behaviour and are ignored here.
 */
export function useMessageActionsReveal() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const bind = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setOpen(true);
        // Put focus on the first action so a screen reader lands in the bar.
        rootRef.current?.querySelector<HTMLButtonElement>("[data-message-actions] button")?.focus();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      if (Math.abs(event.clientX - start.x) > MOVE_TOLERANCE_PX || Math.abs(event.clientY - start.y) > MOVE_TOLERANCE_PX) {
        clear(); // a scroll, not a press
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  };

  return { open, rootRef, bind };
}
