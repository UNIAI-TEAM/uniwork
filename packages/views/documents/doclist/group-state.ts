import { useCallback, useState } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import { defaultStorage } from "@uniwork/core/platform";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { DOC_LIST_GROUP_ORDER } from "./date-groups";
import type { DocListGroupScreen } from "./groups";

// Which date groups a person keeps collapsed, per screen (UNI-2045 W11):
// `uniwork_documents_groups:{userId}` → `{ "<screen>": ["<groupId>", ...] }`
// through the StorageAdapter. Anything unreadable reads as "every group open";
// a failed write keeps the choice for this session only.

const GROUPS_STORAGE_KEY = "uniwork_documents_groups";
const SCREENS: readonly DocListGroupScreen[] = ["recent", "shared", "trash"];

export type CollapsedGroups = Partial<Record<DocListGroupScreen, string[]>>;

export function groupsStorageKey(userId: string): string {
  return `${GROUPS_STORAGE_KEY}:${userId}`;
}

/** The viewer's collapsed groups; a value it does not know is dropped, a broken one reads as none. */
export function readCollapsedGroups(
  userId: string | null | undefined,
  storage: Pick<StorageAdapter, "getItem"> | null | undefined = defaultStorage,
): CollapsedGroups {
  if (!userId || !storage) return {};
  try {
    const raw = storage.getItem(groupsStorageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: CollapsedGroups = {};
    for (const screen of SCREENS) {
      const ids: unknown = (parsed as Record<string, unknown>)[screen];
      if (!Array.isArray(ids)) continue;
      const known = ids.filter((id): id is string => typeof id === "string" && (DOC_LIST_GROUP_ORDER[screen] as readonly string[]).includes(id));
      if (known.length > 0) out[screen] = known;
    }
    return out;
  } catch {
    // Malformed JSON or blocked storage: every group open.
    return {};
  }
}

/** Persists the viewer's collapsed groups; ignores storage failures. */
export function writeCollapsedGroups(
  userId: string | null | undefined,
  value: CollapsedGroups,
  storage: Pick<StorageAdapter, "setItem"> | null | undefined = defaultStorage,
): void {
  if (!userId || !storage) return;
  try {
    storage.setItem(groupsStorageKey(userId), JSON.stringify(value));
  } catch {
    // Storage unavailable or blocked: keep the in-memory choice for this session.
  }
}

/** Flips one group of one screen, leaving the other screens as they are. */
export function toggleCollapsedGroup(value: CollapsedGroups, screen: DocListGroupScreen, id: string): CollapsedGroups {
  const current = value[screen] ?? [];
  return { ...value, [screen]: current.includes(id) ? current.filter((key) => key !== id) : [...current, id] };
}

export interface GroupCollapse {
  isCollapsed: (id: string) => boolean;
  onToggle: (id: string) => void;
}

/** The collapse state of one screen's groups for the signed-in viewer. */
export function useCollapsedGroups(screen: DocListGroupScreen | null): GroupCollapse {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [state, setState] = useState(() => ({ userId, value: readCollapsedGroups(userId) }));
  if (state.userId !== userId) setState({ userId, value: readCollapsedGroups(userId) });
  const collapsed = screen ? (state.value[screen] ?? []) : [];
  const onToggle = useCallback(
    (id: string) => {
      if (!screen) return;
      setState((prev) => {
        const value = toggleCollapsedGroup(prev.value, screen, id);
        writeCollapsedGroups(prev.userId, value);
        return { ...prev, value };
      });
    },
    [screen],
  );
  return { isCollapsed: (id) => collapsed.includes(id), onToggle };
}
