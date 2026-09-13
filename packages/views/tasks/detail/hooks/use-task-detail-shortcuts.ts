"use client";

import { useEffect, type RefObject } from "react";
import {
  SHORTCUT_ACTION_BY_ID,
  getShortcut,
  isEditableShortcutTarget,
  isPortalLayerShortcutTarget,
  shortcutMatchesEvent,
  shouldIgnoreGlobalShortcutEvent,
  type ShortcutActionId,
} from "@uniwork/core/shortcuts";

const PAGE_ACTIONS: readonly ShortcutActionId[] = ["findInTask", "openThreadNav"];

/**
 * The task detail page's one keydown listener, for the two actions that only
 * mean something here: find in the task and move into thread navigation.
 *
 * Not in GlobalShortcuts on purpose. The chat page owns Ctrl/Cmd+F for its own
 * message search (chat-page-content.tsx), and a shell-level claim would take
 * the browser's find away from every other page too. Chords are read from the
 * shortcut store at key time, so a rebinding applies immediately.
 */
export function useTaskDetailShortcuts({
  container,
  enabled,
  findBarRef,
  onFind,
}: {
  /** The page's scroll container: the searched region and the visibility probe. */
  container: HTMLElement | null;
  enabled: boolean;
  /** The find bar sits outside the container; ⌘F from its input re-selects the query. */
  findBarRef: RefObject<HTMLElement | null>;
  onFind: () => void;
}): void {
  useEffect(() => {
    if (!enabled || !container) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcutEvent(event)) return;
      const actionId = PAGE_ACTIONS.find((id) => shortcutMatchesEvent(getShortcut(id), event));
      if (!actionId) return;
      // A detail page kept mounted while hidden (display: none has no boxes)
      // must not swallow the key from whatever is on screen.
      if (container.getClientRects().length === 0) return;
      if (isPortalLayerShortcutTarget(event.target)) return;
      if (isEditableShortcutTarget(event.target)) {
        if (!SHORTCUT_ACTION_BY_ID[actionId]?.allowInEditable) return;
        // An editor on another surface (the palette's input) is not this page.
        const target = event.target as Node;
        if (!container.contains(target) && !findBarRef.current?.contains(target)) return;
      }

      if (actionId === "findInTask") {
        event.preventDefault();
        onFind();
        return;
      }
      // Marked in thread-nav-panel.tsx. Below four threads the panel does not
      // render; then the key is left alone.
      const firstChip = container.querySelector<HTMLElement>("[data-thread-nav] button");
      if (!firstChip) return;
      event.preventDefault();
      firstChip.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [container, enabled, findBarRef, onFind]);
}
