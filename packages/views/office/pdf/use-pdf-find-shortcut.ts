"use client";

import { useEffect, type RefObject } from "react";

/**
 * review-fe-r3 F2: the editor's own key handler sees Ctrl+F only while focus is
 * inside it, so a press with focus on the body (nothing focused, e.g. after the
 * button that opened the file unmounted) reached the browser instead. This
 * listener takes exactly that case and nothing else: focus is on the body, the
 * editor is ready, and the editor is shown - a background desktop tab sits in a
 * `hidden`/`inert` panel and is skipped, so only the visible editor opens Find.
 * Focus held by any other control (another editor, an input, a tab button)
 * keeps its own Ctrl+F.
 */
export function usePdfFindFromBody(rootRef: RefObject<HTMLElement | null>, enabled: boolean, openFind: () => void): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      const root = rootRef.current;
      if (!root?.isConnected || root.closest("[hidden],[inert]")) return;
      event.preventDefault();
      openFind();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, openFind, rootRef]);
}
