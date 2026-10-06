"use client";

import { useEffect } from "react";

/**
 * Close a ribbon popover on the FIRST pointerdown outside it, in the capture
 * phase and without touching the event. Base UI dismisses a mouse outside press
 * only on `click` (after the button is released), so the popover would stay
 * open, and return focus to its trigger, around a drag that starts on the grid:
 * the drag would select only the release cell. Closing here lets the same
 * pointerdown reach the grid and start the selection (like Google Sheets).
 */
export function useCloseOnOutsidePointerDown(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-slot="popover-content"], [data-slot="popover-trigger"]')) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);
}
