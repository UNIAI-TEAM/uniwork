"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as tasks from "../api/endpoints/tasks";
import { taskKeys } from "../tasks/hooks";

export function useSeedWelcomeTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => tasks.seedWelcomeTask(workspaceId),
    onSuccess: (task) => {
      if (task) void qc.invalidateQueries({ queryKey: taskKeys.list(task.workspace_id) });
    },
  });
}
