"use client";

import { useEffect, useRef } from "react";

/**
 * Moves focus to the new screen's heading when the page swaps one screen for
 * another (form → lobby, prejoin → lobby, waiting → declined), as AuthShell
 * does, so a screen reader and a keyboard user land on what changed. Not on
 * the first paint, and not out of the loading skeleton, where a form focuses
 * its own first field.
 */
export function useFocusHeadingOnViewChange(
  view: string,
  { selector = "main h1", fallback = "main" }: { selector?: string; fallback?: string | null } = {},
) {
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = view;
    if (before === undefined || before === view || before === "loading") return;
    const target =
      document.querySelector<HTMLElement>(selector) ??
      (fallback ? document.querySelector<HTMLElement>(fallback) : null);
    if (!target) return;
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus();
  }, [view, selector, fallback]);
}
