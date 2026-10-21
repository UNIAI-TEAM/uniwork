"use client";

import { useEffect, type RefObject } from "react";
import {
  getShortcut,
  shortcutMatchesEvent,
  shouldIgnoreGlobalShortcutEvent,
} from "@uniwork/core/shortcuts";

/**
 * The chat page's find: the registry's `findInTask` chord opens message search
 * for the room, but only while focus is inside the conversation; anywhere else
 * the browser keeps its own find. The chord is read from the shortcut store at
 * key time, so a rebinding in Settings applies immediately, and the registry
 * keeps every other action off it (`isFindShortcut`).
 */
export function useChatFindShortcut(
  conversationRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onFind: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcutEvent(event)) return;
      if (!shortcutMatchesEvent(getShortcut("findInTask"), event)) return;
      const root = conversationRef.current;
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;
      event.preventDefault();
      onFind();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, conversationRef, onFind]);
}
