"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../../platform/storage";

/** How many tasks keep remembered UI state; the least recently touched goes. */
const MAX_TASKS = 200;

/**
 * Module-level empty list. Selectors fall back to THIS array, never to a
 * fresh `[]`: a new reference on every read makes zustand report a changed
 * snapshot each render, which re-runs every effect that depends on it (the
 * timeline's scroll effect among them) and can loop.
 */
const EMPTY_THREAD_IDS: readonly string[] = [];

interface TaskDetailUiEntry {
  /** Root comment ids of resolved threads the person expanded. */
  resolvedExpanded: string[];
  subtasksCollapsed: boolean;
  /** Monotonic touch stamp; the smallest one is evicted first. */
  touchedAt: number;
}

interface TaskDetailUiState {
  tasks: Record<string, TaskDetailUiEntry>;
  setResolvedExpanded: (taskId: string, threadRootId: string, expanded: boolean) => void;
  isResolvedExpanded: (taskId: string, threadRootId: string) => boolean;
  setSubtasksCollapsed: (taskId: string, collapsed: boolean) => void;
  isSubtasksCollapsed: (taskId: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDefault(entry: Pick<TaskDetailUiEntry, "resolvedExpanded" | "subtasksCollapsed">): boolean {
  return entry.resolvedExpanded.length === 0 && !entry.subtasksCollapsed;
}

/** Keep the `limit` most recently touched entries. */
function capTasks(
  tasks: Record<string, TaskDetailUiEntry>,
  limit: number,
): Record<string, TaskDetailUiEntry> {
  const entries = Object.entries(tasks);
  if (entries.length <= limit) return tasks;
  entries.sort(([, a], [, b]) => b.touchedAt - a.touchedAt);
  return Object.fromEntries(entries.slice(0, limit));
}

/**
 * Write one task's entry. Returning to the default state deletes the entry, so
 * only tasks that differ from "all resolved threads collapsed, sub-tasks open"
 * count against the cap. Only writes touch an entry: reads happen during
 * render and must not set state.
 */
function writeEntry(
  tasks: Record<string, TaskDetailUiEntry>,
  taskId: string,
  patch: Partial<Pick<TaskDetailUiEntry, "resolvedExpanded" | "subtasksCollapsed">>,
): Record<string, TaskDetailUiEntry> {
  const previous = tasks[taskId];
  const nextEntry = {
    resolvedExpanded: patch.resolvedExpanded ?? previous?.resolvedExpanded ?? [],
    subtasksCollapsed: patch.subtasksCollapsed ?? previous?.subtasksCollapsed ?? false,
  };
  const next = { ...tasks };
  delete next[taskId];
  if (isDefault(nextEntry)) return next;
  let latest = 0;
  for (const entry of Object.values(next)) latest = Math.max(latest, entry.touchedAt);
  next[taskId] = { ...nextEntry, touchedAt: Math.max(Date.now(), latest + 1) };
  return capTasks(next, MAX_TASKS);
}

/** Drop malformed persisted entries instead of letting storage crash the page. */
function sanitizeTasks(value: unknown): Record<string, TaskDetailUiEntry> {
  if (!isRecord(value)) return {};
  const tasks: Record<string, TaskDetailUiEntry> = {};
  for (const [taskId, raw] of Object.entries(value)) {
    if (!isRecord(raw) || !Array.isArray(raw.resolvedExpanded)) continue;
    if (typeof raw.subtasksCollapsed !== "boolean") continue;
    const entry: TaskDetailUiEntry = {
      resolvedExpanded: raw.resolvedExpanded.filter(
        (id): id is string => typeof id === "string",
      ),
      subtasksCollapsed: raw.subtasksCollapsed,
      touchedAt:
        typeof raw.touchedAt === "number" && Number.isFinite(raw.touchedAt)
          ? raw.touchedAt
          : 0,
    };
    if (!isDefault(entry)) tasks[taskId] = entry;
  }
  return capTasks(tasks, MAX_TASKS);
}

/**
 * Detail-page disclosure state that should survive leaving and returning to a
 * task: which resolved comment threads are open and whether the sub-task list
 * is collapsed. Task ids are globally unique ULIDs, so the storage is not
 * workspace-scoped. A link to a comment still wins over what is remembered:
 * the timeline expands the target's thread whatever this store says.
 */
export const useTaskDetailUiStore = create<TaskDetailUiState>()(
  persist(
    (set, get) => ({
      tasks: {},
      setResolvedExpanded: (taskId, threadRootId, expanded) =>
        set((state) => {
          const current = state.tasks[taskId]?.resolvedExpanded ?? EMPTY_THREAD_IDS;
          if (current.includes(threadRootId) === expanded) return state;
          const resolvedExpanded = expanded
            ? [...current, threadRootId]
            : current.filter((id) => id !== threadRootId);
          return { tasks: writeEntry(state.tasks, taskId, { resolvedExpanded }) };
        }),
      isResolvedExpanded: (taskId, threadRootId) =>
        get().tasks[taskId]?.resolvedExpanded.includes(threadRootId) ?? false,
      setSubtasksCollapsed: (taskId, collapsed) =>
        set((state) => {
          if ((state.tasks[taskId]?.subtasksCollapsed ?? false) === collapsed) return state;
          return {
            tasks: writeEntry(state.tasks, taskId, { subtasksCollapsed: collapsed }),
          };
        }),
      isSubtasksCollapsed: (taskId) => get().tasks[taskId]?.subtasksCollapsed ?? false,
    }),
    {
      name: "uniwork_task_detail_ui",
      storage: createJSONStorage(() => defaultStorage),
      partialize: (state) => ({ tasks: state.tasks }),
      version: 1,
      // Sanitize on every hydration, not only on version change.
      merge: (persisted, current) => ({
        ...current,
        tasks: sanitizeTasks(isRecord(persisted) ? persisted.tasks : undefined),
      }),
    },
  ),
);

/** Root ids of the task's expanded resolved threads; stable while unchanged. */
export function useResolvedExpandedThreads(taskId: string): readonly string[] {
  return useTaskDetailUiStore(
    (state) => state.tasks[taskId]?.resolvedExpanded ?? EMPTY_THREAD_IDS,
  );
}

export function useSubtasksCollapsed(taskId: string): boolean {
  return useTaskDetailUiStore((state) => state.tasks[taskId]?.subtasksCollapsed ?? false);
}
