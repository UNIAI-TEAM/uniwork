"use client";

import { useEffect } from "react";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import { paths } from "@uniwork/core/paths";
import { useSearchStore } from "@uniwork/core/search";
import {
  SHORTCUT_ACTION_BY_ID,
  getShortcut,
  isEditableShortcutTarget,
  isPortalLayerShortcutTarget,
  shortcutMatchesEvent,
  shouldIgnoreGlobalShortcutEvent,
  useShortcutStore,
  type ShortcutActionId,
} from "@uniwork/core/shortcuts";
import { useNavigation } from "../navigation";
import { useWorkspace } from "./workspace-context";

// Primary+B is deliberately absent: the sidebar primitive listens for it on
// window and does not respect defaultPrevented, so claiming it here would
// fire twice.
const GLOBAL_ACTIONS: readonly ShortcutActionId[] = [
  "openSearch",
  "ai.askUni",
  "createTask",
  "goBack",
  "goForward",
  "goInbox",
  "goTasks",
  "goMyTasks",
  "goProjects",
  "goMeetings",
  "goChat",
  "goPeople",
  "goSettings",
];

/**
 * The one keydown listener for product-level shortcuts inside the workspace
 * shell. Chords come from the shortcut store, so a rebinding in Settings
 * applies immediately; no other component listens for these chords.
 */
export function GlobalShortcuts({ onCreateTask }: { onCreateTask: () => void }) {
  const navigation = useNavigation();
  const { workspace } = useWorkspace();
  // Same query (and cache entry) the Ask UNI button and panel read: a
  // workspace without AI must not have ⌘J swallowed for a panel it cannot open.
  const aiEnabled = !!useAiCapabilities(workspace.id).data?.enabled;
  // Subscribe so a rebinding in Settings refreshes the listener closure.
  const overrides = useShortcutStore((state) => state.overrides);

  useEffect(() => {
    const ws = paths.workspace(workspace.organization_slug, workspace.slug);
    const destinations: Partial<Record<ShortcutActionId, string>> = {
      goInbox: ws.inbox(),
      goTasks: ws.tasks(),
      goMyTasks: ws.myTasks(),
      goProjects: ws.projects(),
      goMeetings: ws.meetings(),
      goChat: ws.chat(),
      goPeople: ws.people(),
      goSettings: ws.settings(),
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Component and editor handlers run before this document-level
      // listener; respect a control that already consumed the chord.
      if (shouldIgnoreGlobalShortcutEvent(event)) return;

      const actionId = GLOBAL_ACTIONS.find((id) => {
        const action = SHORTCUT_ACTION_BY_ID[id];
        if (!action) return false;
        if (id === "ai.askUni" && !aiEnabled) return false;
        if (!action.allowInEditable) {
          if (isEditableShortcutTarget(event.target)) return false;
          if (isPortalLayerShortcutTarget(event.target)) return false;
        }
        return shortcutMatchesEvent(getShortcut(id), event);
      });
      if (!actionId) return;

      event.preventDefault();
      switch (actionId) {
        case "openSearch":
          useSearchStore.getState().toggle();
          return;
        case "ai.askUni":
          useAiPanelStore.getState().toggle();
          return;
        case "createTask":
          onCreateTask();
          return;
        case "goBack":
          navigation.back();
          return;
        case "goForward":
          // Optional on the adapter: a host without a forward stack leaves it
          // undefined and the chord is a no-op.
          navigation.forward?.();
          return;
        default: {
          const destination = destinations[actionId];
          if (destination && destination !== navigation.pathname) navigation.push(destination);
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [aiEnabled, navigation, onCreateTask, overrides, workspace.organization_slug, workspace.slug]);

  return null;
}
