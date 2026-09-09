"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api";
import { usePutTask } from "@uniwork/core/tasks";
import { toastApiError } from "../../../toast-api-error";

type TaskFieldPatch = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  position?: number;
};

/**
 * PUT title/description (and later sidebar fields) with revision / If-Match.
 * On `revision_conflict`, toast and refetch so the shell picks up the server
 * revision — UniWork prefers that over an inline compare UI for this slice.
 */
export function useTaskFieldSave(args: {
  workspaceId: string;
  taskId: string;
  revision: number;
  refetch: () => void;
}) {
  const { workspaceId, taskId, revision, refetch } = args;
  const { t } = useTranslation();
  const put = usePutTask(workspaceId);

  return useCallback(
    (patch: TaskFieldPatch) => {
      put.mutate(
        {
          taskId,
          body: { ...patch, revision },
          ifMatch: String(revision),
        },
        {
          onSuccess: (data) => {
            if (data == null) {
              toast.error(t("tasks.detail.revision_conflict"));
              refetch();
            }
          },
          onError: (err) => {
            if (errorCode(err) === "revision_conflict") {
              toast.error(t("tasks.detail.revision_conflict"));
              refetch();
              return;
            }
            toastApiError(err, t("common.error"));
          },
        },
      );
    },
    [put, refetch, revision, t, taskId],
  );
}
