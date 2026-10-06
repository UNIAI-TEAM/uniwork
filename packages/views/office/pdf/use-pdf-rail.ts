"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Tailwind's `sm` breakpoint: from here up the rail is static and its toggle is hidden. */
const WIDE_QUERY = "(min-width: 40rem)";

/**
 * Below sm the thumbnail rail floats over the canvas (UIQ-3). While it is open
 * it behaves like a light popover (review-fe-r6 F3): focus moves into it,
 * Escape and a press outside it close it, and the canvas behind is inert so Tab
 * cannot reach content hidden under the overlay. Growing to sm closes it too,
 * since the static rail needs no overlay state.
 *
 * Closing from the keyboard or a page pick returns focus to the toggle; when
 * the toggle is not rendered (display:none from sm up, r6 F4) focus falls back
 * to the editor root instead of being dropped on the body.
 */
export function usePdfRail({ rootRef, canvasRef }: { rootRef: RefObject<HTMLElement | null>; canvasRef: RefObject<HTMLElement | null> }) {
  const [railOpen, setRailOpen] = useState(false);
  const railToggleRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const restoreFocus = useCallback(() => {
    const toggle = railToggleRef.current;
    toggle?.focus();
    // focus() on a display:none button is a no-op: fall back to the landmark.
    if (!toggle || document.activeElement !== toggle) rootRef.current?.focus({ preventScroll: true });
  }, [rootRef]);

  const closeRail = useCallback((returnFocus: boolean) => {
    setRailOpen(false);
    if (returnFocus) restoreFocus();
  }, [restoreFocus]);

  const toggleRail = useCallback(() => setRailOpen((open) => !open), []);

  useEffect(() => {
    if (!railOpen) return undefined;
    const rail = railRef.current;
    const canvas = canvasRef.current;
    const target = rail?.querySelector<HTMLElement>('[aria-current="page"]') ?? rail?.querySelector<HTMLElement>("button");
    target?.focus({ preventScroll: true });
    canvas?.setAttribute("inert", "");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeRail(true);
    };
    // A press outside moves focus where the user pressed, so focus stays put.
    const onPointerDown = (event: PointerEvent) => {
      const pressed = event.target instanceof Node ? event.target : null;
      if (!pressed || rail?.contains(pressed) || railToggleRef.current?.contains(pressed)) return;
      closeRail(false);
    };
    const wide = typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY) : null;
    const onWide = () => { if (wide?.matches) closeRail(false); };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    wide?.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      wide?.removeEventListener("change", onWide);
      canvas?.removeAttribute("inert");
    };
  }, [canvasRef, closeRail, railOpen]);

  return { railOpen, railRef, railToggleRef, toggleRail, closeRail };
}
