"use client";

import { useEffect, type RefObject } from "react";
import { matchPptxShortcut } from "./shortcuts/pptx-shortcuts";

/**
 * R2-6: Ctrl+F opens the find bar (or refocuses it) from anywhere in the
 * editor, also with nothing focused yet; the browser's own page find would
 * search the chrome. A modal surface over the editor (`suspended`) owns the keys.
 */
export function usePptxFindShortcut(rootRef: RefObject<HTMLElement | null>, suspended: boolean, open: () => void): void {
  useEffect(() => {
    if (suspended) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const root = rootRef.current;
      const target = event.target;
      const inside = target instanceof Node && root?.contains(target) === true;
      const idle = target === document.body || target === document.documentElement;
      if (event.defaultPrevented || (!inside && !idle) || matchPptxShortcut(event)?.action !== "find") return;
      event.preventDefault();
      open();
      const field = root?.querySelector<HTMLInputElement>("[data-pptx-find-query]");
      field?.focus();
      field?.select();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, rootRef, suspended]);
}
