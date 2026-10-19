"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/**
 * Desktop opens the actions bar on right-click (Telegram-style); touch opens
 * on a long press. The bar stays open until a click/tap outside the message
 * or Escape.
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

  const dismiss = useCallback(() => {
    setOpen(false);
    const root = rootRef.current;
    const active = document.activeElement;
    if (root && active instanceof HTMLElement && root.contains(active)) active.blur();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      // Dropdown / emoji picker content is portalled outside the message node.
      if (
        target instanceof Element &&
        (target.closest('[data-slot="dropdown-menu-content"]') ||
          target.closest('[data-slot="dropdown-menu-sub-content"]') ||
          target.closest('[data-slot="popover-content"]'))
      ) {
        return;
      }
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dismiss, open]);

  const focusFirstAction = useCallback(() => {
    rootRef.current?.querySelector<HTMLButtonElement>("[data-message-actions] button")?.focus();
  }, []);

  const bind = {
    onContextMenu: (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      setOpen(true);
      focusFirstAction();
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setOpen(true);
        focusFirstAction();
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
