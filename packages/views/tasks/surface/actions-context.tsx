"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Task } from "@uniwork/core/types";

export type TaskSurfaceMutationOptions = {
  errorMessage?: string;
  onSuccess?: (task: Task) => void;
  onError?: (err: unknown) => void;
  onSettled?: () => void;
};

export type TaskCreateDefaults = {
  title?: string;
  status?: string;
  priority?: string;
  assignee_id?: string | null;
};

export interface TaskSurfaceActions {
  isPending: boolean;
  createTask: (defaults?: TaskCreateDefaults) => void;
  updateTask: (
    taskId: string,
    updates: Record<string, unknown>,
    options?: TaskSurfaceMutationOptions,
  ) => void;
  moveTask: (
    taskId: string,
    updates: Record<string, unknown>,
    options?: TaskSurfaceMutationOptions,
  ) => void;
  batchUpdate: (
    taskIds: string[],
    updates: Record<string, unknown>,
  ) => Promise<void>;
  batchDelete: (taskIds: string[]) => Promise<void>;
}

const TaskSurfaceActionsContext = createContext<TaskSurfaceActions | null>(
  null,
);

export function TaskSurfaceActionsProvider({
  actions,
  children,
}: {
  actions: TaskSurfaceActions;
  children: ReactNode;
}) {
  return (
    <TaskSurfaceActionsContext.Provider value={actions}>
      {children}
    </TaskSurfaceActionsContext.Provider>
  );
}

export function useTaskSurfaceActionsOptional() {
  return useContext(TaskSurfaceActionsContext);
}
