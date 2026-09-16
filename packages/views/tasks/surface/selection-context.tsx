"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/** The live selection, readable without re-rendering whoever holds it. */
export interface TaskSurfaceSelectionStore {
  subscribe(listener: () => void): () => void;
  isSelected(id: string): boolean;
  getSnapshot(): Set<string>;
}

interface TaskSurfaceSelectionActions {
  toggle: (id: string) => void;
  select: (ids: string[]) => void;
  deselect: (ids: string[]) => void;
  clear: () => void;
}

/**
 * What `useCreateTaskSurfaceSelection` returns: identity-stable for the life
 * of its owner, so changing the selection never re-renders the owner.
 */
export interface TaskSurfaceSelectionHandle extends TaskSurfaceSelectionActions {
  store: TaskSurfaceSelectionStore;
}

/** The context value for consumers that render from the whole selection. */
export interface TaskSurfaceSelection extends TaskSurfaceSelectionActions {
  selectedIds: Set<string>;
}

const TaskSurfaceSelectionContext =
  createContext<TaskSurfaceSelection | null>(null);
const TaskSurfaceSelectionHandleContext =
  createContext<TaskSurfaceSelectionHandle | null>(null);

function createSelectionHandle(): TaskSurfaceSelectionHandle & {
  /** Replaces the selection without notifying; the caller notifies later. */
  resetSilently: () => void;
  notify: () => void;
} {
  let selected = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const commit = (next: Set<string>) => {
    selected = next;
    notify();
  };
  return {
    store: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isSelected: (id) => selected.has(id),
      getSnapshot: () => selected,
    },
    toggle(id) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      commit(next);
    },
    select(ids) {
      const next = new Set(selected);
      for (const id of ids) next.add(id);
      commit(next);
    },
    deselect(ids) {
      const next = new Set(selected);
      for (const id of ids) next.delete(id);
      commit(next);
    },
    clear() {
      commit(new Set());
    },
    resetSilently() {
      if (selected.size > 0) selected = new Set();
    },
    notify,
  };
}

export function useCreateTaskSurfaceSelection(
  resetKey: string,
): TaskSurfaceSelectionHandle {
  const [handle] = useState(createSelectionHandle);
  const [committedResetKey, setCommittedResetKey] = useState(resetKey);

  // Render-phase reset when the data window changes — avoid one frame of
  // stale selection over a new membership. Listeners hear about it after
  // commit: notifying during render would update other components mid-render.
  if (committedResetKey !== resetKey) {
    setCommittedResetKey(resetKey);
    handle.resetSilently();
  }
  useEffect(() => {
    handle.notify();
  }, [handle, committedResetKey]);

  return handle;
}

/** The whole selection, for the component that owns the handle. */
export function useTaskSurfaceSelectedIds(
  store: TaskSurfaceSelectionStore,
): Set<string> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * Only this provider and the consumers of `useTaskSurfaceSelection` re-render
 * when the selection changes; `children` keep their identity and bail out.
 */
export function TaskSurfaceSelectionProvider({
  selection,
  children,
}: {
  selection: TaskSurfaceSelectionHandle;
  children: ReactNode;
}) {
  const selectedIds = useTaskSurfaceSelectedIds(selection.store);
  const value = useMemo<TaskSurfaceSelection>(
    () => ({
      selectedIds,
      toggle: selection.toggle,
      select: selection.select,
      deselect: selection.deselect,
      clear: selection.clear,
    }),
    [selectedIds, selection],
  );
  return (
    <TaskSurfaceSelectionHandleContext.Provider value={selection}>
      <TaskSurfaceSelectionContext.Provider value={value}>
        {children}
      </TaskSurfaceSelectionContext.Provider>
    </TaskSurfaceSelectionHandleContext.Provider>
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

/** The stable handle: actions and the store, without subscribing to changes. */
export function useTaskSurfaceSelectionHandle(): TaskSurfaceSelectionHandle {
  const handle = useContext(TaskSurfaceSelectionHandleContext);
  if (!handle) {
    throw new Error(
      "useTaskSurfaceSelectionHandle must be used within TaskSurfaceSelectionProvider",
    );
  }
  return handle;
}

/** Re-renders only when this task's own selected state flips. */
export function useIsTaskSelected(id: string): boolean {
  const { store } = useTaskSurfaceSelectionHandle();
  const isSelected = () => store.isSelected(id);
  return useSyncExternalStore(store.subscribe, isSelected, isSelected);
}

/** Re-renders only when the summary over `ids` changes. */
export function useSelectionSummary(
  ids: readonly string[],
): "none" | "some" | "all" {
  const { store } = useTaskSurfaceSelectionHandle();
  const summarize = () => {
    let count = 0;
    for (const id of ids) if (store.isSelected(id)) count += 1;
    if (count === 0) return "none";
    return count === ids.length ? "all" : "some";
  };
  return useSyncExternalStore(store.subscribe, summarize, summarize);
}
