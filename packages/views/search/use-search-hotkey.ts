"use client";

import { useEffect } from "react";
import { useSearchStore } from "@uniwork/core/search";

/** Toggle the command palette with ⌘K / Ctrl+K. */
export function useSearchHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) &&
        !useSearchStore.getState().open
      ) {
        return;
      }
      e.preventDefault();
      useSearchStore.getState().toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
