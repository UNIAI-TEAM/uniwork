"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Close a ribbon popover on the FIRST pointerdown outside it, in the capture
 * phase and without touching the event. Base UI dismisses a mouse outside press
 * only on `click` (after the button is released), so the popover would stay
 * open, and return focus to its trigger, around a drag that starts on the grid:
 * the drag would select only the release cell. Closing here lets the same
 * pointerdown reach the grid and start the selection (like Google Sheets).
 *
 * Returns the popup's `finalFocus`: after such a close the focus stays where
 * the pointer put it (the grid), instead of jumping back to the ribbon
 * trigger; any other close (Escape, a picked item) returns it as before.
 */
export function useCloseOnOutsidePointerDown(open: boolean, close: () => void): () => boolean {
  const closedByPointer = useRef(false);
  useEffect(() => {
    if (!open) return;
    closedByPointer.current = false;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-slot="popover-content"], [data-slot="popover-trigger"]')) return;
      closedByPointer.current = true;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);
  return useCallback(() => !closedByPointer.current, []);
}
