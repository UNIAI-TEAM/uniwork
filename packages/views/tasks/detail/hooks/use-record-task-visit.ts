"use client";

import { useEffect } from "react";
import { ApiError } from "@uniwork/core/api";
import { useRecentTasksStore } from "@uniwork/core/tasks/stores/recent-tasks-store";

/**
 * Keeps the search palette's recent tasks in step with what the detail page
 * loaded. It writes through `getState()` and never subscribes, so recording a
 * visit re-renders nothing on the page, the editors included.
 */
export function useRecordTaskVisit({
  workspaceId,
  taskId,
  task,
  error,
}: {
  workspaceId: string;
  taskId: string;
  task: { id: string; identifier?: string | null; title?: string | null } | null | undefined;
  error: unknown;
}) {
  const id = task?.id;
  const identifier = task?.identifier ?? "";
  const title = task?.title ?? "";
  const failed = error != null;

  useEffect(() => {
    if (id === undefined || failed) return;
    useRecentTasksStore.getState().recordVisit(workspaceId, { id, identifier, title });
  }, [workspaceId, id, identifier, title, failed]);

  useEffect(() => {
    // The page shows "not found" for every failure, but only a real 404 means
    // the task is gone. A dropped connection or a 5xx keeps the entry.
    if (error instanceof ApiError && error.status === 404) {
      useRecentTasksStore.getState().forget(workspaceId, taskId);
    }
  }, [workspaceId, taskId, error]);
}
