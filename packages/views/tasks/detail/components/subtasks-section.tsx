"use client";

import { useId, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import {
  useChildTaskProgress,
  useCreateTask,
  useSetTaskParent,
  useTaskChildren,
} from "@uniwork/core/tasks";
import {
  useSubtasksCollapsed,
  useTaskDetailUiStore,
} from "@uniwork/core/tasks/stores/task-detail-ui-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";
import { StatusIcon } from "../../modes/status-pill";

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
  // Remembered per task: collapsing a long list sticks when you come back.
  const collapsed = useSubtasksCollapsed(taskId);
  const regionId = useId();
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  const progress = progressRows.find((row) => row.parent_task_id === taskId);
  const done = progress?.done ?? children.filter((c) => c.status === "done").length;
  const total = progress?.total ?? children.length;
  const groups = useMemo(() => {
    const byStage = new Map<number | null, typeof children>();
    for (const child of children) {
      const stage = child.stage ?? null;
      const current = byStage.get(stage) ?? [];
      current.push(child);
      byStage.set(stage, current);
    }
    return [...byStage.entries()].sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });
  }, [children]);
  const formatDueDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
      new Date(`${value}T00:00:00`),
    );

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
      className="mt-6"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-controls={regionId}
            aria-label={t("tasks.detail.subtasks_toggle")}
            onClick={() =>
              useTaskDetailUiStore.getState().setSubtasksCollapsed(taskId, !collapsed)
            }
          >
            <Chevron aria-hidden />
          </Button>
          <h2 className="text-body font-semibold text-foreground">
            {t("tasks.detail.section_subtasks")}
          </h2>
        </div>
        <span
          data-testid="subtasks-progress"
          className="text-caption text-muted-foreground"
        >
          {t("tasks.detail.subtasks_progress", { done, total })}
        </span>
      </div>

      {/* Hidden, not unmounted: a half-typed sub-task title survives a collapse. */}
      <div id={regionId} hidden={collapsed}>
        {isLoading ? (
          <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
        ) : children.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("tasks.detail.subtasks_empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map(([stage, stageChildren]) => (
              <li key={stage ?? "none"}>
                <h3 className="mb-1 px-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  {stage === null
                    ? t("tasks.detail.stage_none")
                    : t("tasks.detail.stage_group", { stage })}
                </h3>
                <ul className="overflow-hidden rounded-md border border-border/70 bg-muted/20">
                  {stageChildren.map((child) => {
                    const href = paths
                      .workspace(workspace.organization_slug, workspace.slug)
                      .task(child.id);
                    const assignee = child.assignee?.display_name;
                    return (
                      <li key={child.id}>
                        <AppLink
                          href={href}
                          className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border/60 px-2 py-2 text-caption last:border-b-0 hover:bg-accent/60 focus-visible:bg-accent/60"
                        >
                          <StatusIcon status={child.status} className="size-3.5" />
                          <span
                            translate="no"
                            className="shrink-0 font-medium text-muted-foreground"
                          >
                            {child.identifier || t("tasks.detail.identifier_missing")}
                          </span>
                          <span className="min-w-0 truncate text-foreground">
                            {child.title}
                          </span>
                          {child.due_date ? (
                            <time
                              dateTime={child.due_date}
                              className="inline-flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums"
                            >
                              <CalendarDays aria-hidden className="size-3.5" />
                              {formatDueDate(child.due_date)}
                            </time>
                          ) : null}
                          {assignee ? (
                            <span
                              aria-label={assignee}
                              title={assignee}
                              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-micro font-medium text-secondary-foreground"
                            >
                              {assignee.trim().charAt(0).toUpperCase()}
                            </span>
                          ) : null}
                        </AppLink>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
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
      </div>
    </section>
  );
}
