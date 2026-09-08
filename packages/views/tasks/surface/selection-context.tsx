"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface TaskSurfaceSelection {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  select: (ids: string[]) => void;
  deselect: (ids: string[]) => void;
  clear: () => void;
}

const TaskSurfaceSelectionContext =
  createContext<TaskSurfaceSelection | null>(null);

export function useCreateTaskSurfaceSelection(
  resetKey: string,
): TaskSurfaceSelection {
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
  const [committedResetKey, setCommittedResetKey] = useState(resetKey);

  // Render-phase reset when the data window changes — avoid one frame of
  // stale selection over a new membership.
  if (committedResetKey !== resetKey) {
    setCommittedResetKey(resetKey);
    if (selectedIds.size > 0) setSelectedIds(new Set());
  }

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const select = useCallback((ids: string[]) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const deselect = useCallback((ids: string[]) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return useMemo(
    () => ({ selectedIds, toggle, select, deselect, clear }),
    [clear, deselect, select, selectedIds, toggle],
  );
}

export function TaskSurfaceSelectionProvider({
  selection,
  children,
}: {
  selection: TaskSurfaceSelection;
  children: ReactNode;
}) {
  return (
    <TaskSurfaceSelectionContext.Provider value={selection}>
      {children}
    </TaskSurfaceSelectionContext.Provider>
  );
}

export function useTaskSurfaceSelectionOptional() {
  return useContext(TaskSurfaceSelectionContext);
}

export function useTaskSurfaceSelection(): TaskSurfaceSelection {
  const selection = useTaskSurfaceSelectionOptional();
  if (!selection) {
    throw new Error(
      "useTaskSurfaceSelection must be used within TaskSurfaceSelectionProvider",
    );
  }
  return selection;
}
