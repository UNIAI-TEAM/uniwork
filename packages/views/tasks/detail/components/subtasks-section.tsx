"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import {
  useChildTaskProgress,
  useCreateTask,
  useSetTaskParent,
  useTaskChildren,
} from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";

/**
 * Sub-task list under a parent: children + progress, create awaits server
 * (create task → set parent). Batch chrome is omitted — surface already has
 * batch APIs, but no child-selection UX ships in this slice.
 */
export function TaskDetailSubtasksSection({
  workspaceId,
  taskId,
}: {
  workspaceId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { data: children = [], isLoading } = useTaskChildren(taskId);
  const { data: progressRows = [] } = useChildTaskProgress(workspaceId);
  const create = useCreateTask(workspaceId);
  const setParent = useSetTaskParent(workspaceId);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);

  const progress = progressRows.find((row) => row.parent_task_id === taskId);
  const done = progress?.done ?? children.filter((c) => c.status === "done").length;
  const total = progress?.total ?? children.length;

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      const created = await create.mutateAsync({ title: trimmed });
      if (!created) {
        toastApiError(new Error("create failed"), t("common.error"));
        return;
      }
      await setParent.mutateAsync({
        taskId: created.id,
        body: { parent_task_id: taskId },
      });
      setTitle("");
    } catch (err) {
      toastApiError(err, t("common.error"));
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-label={t("tasks.detail.section_subtasks")}
      className="mt-8 border-t border-border pt-6"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-foreground">
          {t("tasks.detail.section_subtasks")}
        </h2>
        <span
          data-testid="subtasks-progress"
          className="text-caption text-muted-foreground"
        >
          {t("tasks.detail.subtasks_progress", { done, total })}
        </span>
      </div>

      {isLoading ? (
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : children.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t("tasks.detail.subtasks_empty")}
        </p>
      ) : (
        <ul className="space-y-1">
          {children.map((child) => {
            const href = paths
              .workspace(workspace.organization_slug, workspace.slug)
              .task(child.id);
            return (
              <li key={child.id}>
                <AppLink
                  href={href}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-accent/60"
                >
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {child.identifier || child.id.slice(0, 8)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {t(`tasks.status_${child.status}`, {
                      defaultValue: child.status,
                    })}
                  </span>
                </AppLink>
              </li>
            );
          })}
        </ul>
      )}

      <form className="mt-3 flex gap-2" onSubmit={(e) => void onCreate(e)}>
        <Input
          aria-label={t("tasks.detail.add_subtask")}
          placeholder={t("tasks.detail.add_subtask_placeholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !title.trim()}>
          {t("tasks.detail.add_subtask_action")}
        </Button>
      </form>
    </section>
  );
}
