"use client";

import { useCallback } from "react";
import type { TaskView } from "../../types/task-view";
import { useTaskViews } from "../hooks-views";
import {
  taskViewContainerKey,
  useActiveTaskViewStore,
  type TaskViewScope,
} from "./active-view-store";

const EMPTY_VIEWS: TaskView[] = [];

export function useActiveTaskView(wsId: string, scope: TaskViewScope | null) {
  const containerKey = scope ? taskViewContainerKey(wsId, scope) : "";
  const activeViewId = useActiveTaskViewStore((s) =>
    containerKey ? (s.active[containerKey] ?? null) : null,
  );
  const setActiveInStore = useActiveTaskViewStore((s) => s.setActive);

  const listQuery = useTaskViews(wsId, {
    scope_type: (scope ?? { scope_type: "workspace" }).scope_type,
    scope_id: scope?.scope_id ?? undefined,
  });
  const views = listQuery.data?.views ?? EMPTY_VIEWS;
  const activeView = activeViewId
    ? (views.find((v) => v.id === activeViewId) ?? null)
    : null;
  const missing =
    !!activeViewId &&
    listQuery.isSuccess &&
    !listQuery.isFetching &&
    !activeView;

  const setActive = useCallback(
    (viewId: string | null) => {
      if (containerKey) setActiveInStore(containerKey, viewId);
    },
    [containerKey, setActiveInStore],
  );

  return {
    containerKey,
    activeViewId,
    activeView,
    views,
    viewsReady: listQuery.isSuccess,
    setActive,
    missing,
  };
}

export function canManageTaskView(
  view: { owner_id: string; visibility: string },
  userId: string | null,
  role: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (view.owner_id === userId) return true;
  return (
    view.visibility === "workspace" && (role === "owner" || role === "admin")
  );
}

export interface ViewBarPrefs {
  hidden: string[];
  order: string[];
}

export const EMPTY_VIEW_BAR_PREFS: ViewBarPrefs = { hidden: [], order: [] };

export function applyViewBarPrefs<T extends { barItemId: string }>(
  items: T[],
  prefs: ViewBarPrefs | undefined,
  anchorId: string,
): { visible: T[]; hiddenSet: Set<string>; ordered: T[] } {
  const order = prefs?.order ?? [];
  const hiddenSet = new Set(prefs?.hidden ?? []);
  hiddenSet.delete(anchorId);

  const byId = new Map(items.map((item) => [item.barItemId, item]));
  const ordered: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  for (const item of items) {
    if (byId.has(item.barItemId)) ordered.push(item);
  }

  return {
    ordered,
    hiddenSet,
    visible: ordered.filter((item) => !hiddenSet.has(item.barItemId)),
  };
}
