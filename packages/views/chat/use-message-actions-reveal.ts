"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

function wheelOrScrollShouldKeepMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Emoji picker / submenu: allow scrolling inside the overlay.
  return Boolean(
    target.closest('[data-slot="popover-content"]') ||
      target.closest('[data-slot="dropdown-menu-content"]') ||
      target.closest('[data-slot="dropdown-menu-sub-content"]'),
  );
}

/**
 * Desktop opens the actions bar on right-click (Telegram-style); touch opens
 * on a long press. The bar closes on outside tap, Escape, or scrolling the
 * timeline (including wheel over the message), like Telegram.
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
      // The menu is portalled to `body`; emoji pickers and submenus use their own portals.
      if (
        target instanceof Element &&
        (target.closest("[data-message-actions]") ||
          target.closest('[data-slot="dropdown-menu-content"]') ||
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
    const onWheel = (event: WheelEvent) => {
      if (wheelOrScrollShouldKeepMenu(event.target)) return;
      dismiss();
    };
    const onScroll = (event: Event) => {
      if (wheelOrScrollShouldKeepMenu(event.target)) return;
      dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    document.addEventListener("scroll", onScroll, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("wheel", onWheel, { capture: true });
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [dismiss, open]);

  const focusFirstAction = useCallback(() => {
    const messageId = rootRef.current?.dataset.chatMessageId;
    requestAnimationFrame(() => {
      const menu = messageId
        ? document.querySelector(`[data-message-actions][data-for="${messageId}"]`)
        : rootRef.current?.querySelector("[data-message-actions]");
      menu?.querySelector<HTMLButtonElement>("button")?.focus();
    });
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
