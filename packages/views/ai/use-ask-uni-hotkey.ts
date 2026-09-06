"use client";

import { useEffect } from "react";
import { useAiPanelStore } from "@uniwork/core/ai";
import { shortcutMatchesEvent, useShortcut } from "@uniwork/core/shortcuts";

/**
 * ⌘J / Ctrl+J toggles the Ask UNI panel. The chord comes from the shortcut
 * store (action `ai.askUni`), so a user override applies here without this
 * hook knowing about it. Allowed inside editors: asking about the thing you
 * are typing is the point.
 */
export function useAskUniHotkey(enabled: boolean) {
  const chord = useShortcut("ai.askUni");
  useEffect(() => {
    if (!enabled || !chord) return;
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutMatchesEvent(chord, e)) return;
      e.preventDefault();
      useAiPanelStore.getState().toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, chord]);
}
