"use client";

import { CheckCircle2, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useChildTaskProgress, useTask } from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";

export function TaskDetailContextLine({ workspaceId, task }: { workspaceId: string; task: Task }) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const parent = useTask(task.parent_task_id ?? "");
  const progress = useChildTaskProgress(workspaceId);
  const row = (progress.data ?? []).find((item) => item.parent_task_id === task.id);
  const total = row?.total ?? 0;
  const done = row?.done ?? 0;

  if (!task.parent_task_id && total === 0) return null;

  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
      {task.parent_task_id ? (
        parent.data ? (
          <AppLink
            href={paths.workspace(workspace.organization_slug, workspace.slug).task(parent.data.id)}
            className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground"
          >
            <CircleDot className="size-3.5 shrink-0 text-success" aria-hidden />
            <span className="shrink-0">{t("tasks.detail.child_of")}</span>
            <span className="max-w-80 truncate font-medium text-foreground">
              {parent.data.identifier} {parent.data.title}
            </span>
          </AppLink>
        ) : null
      ) : null}
      {total > 0 ? (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <CheckCircle2 className="size-3.5" aria-hidden />
          {t("tasks.detail.subtasks_progress", { done, total })}
        </span>
      ) : null}
    </div>
  );
}
