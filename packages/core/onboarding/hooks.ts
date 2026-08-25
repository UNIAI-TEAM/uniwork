"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { TaskSchema } from "../types";

const TaskResponse = z.object({ task: TaskSchema });

export function useSeedWelcomeTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      api.request(`/api/v1/workspaces/${workspaceId}/welcome-task`, {
        method: "POST",
        schema: TaskResponse,
      }),
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ["tasks", d.task.workspace_id] }),
  });
}
