"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useTask } from "@uniwork/core/tasks";
import { BreadcrumbHeader } from "../../layout/breadcrumb-header";
import { useWorkspace } from "../../layout/workspace-context";
import { TaskDetailEditors } from "./components/task-detail-editors";
import { TaskDetailResizableLayout } from "./components/task-detail-layout";
import { TaskDetailPropertiesSidebarSlot } from "./components/task-detail-properties-slot";
import { useTaskDetailScrollRestore } from "./hooks/use-task-detail-scroll-restore";
import { useTaskFieldSave } from "./hooks/use-task-field-save";

/**
 * Suite task detail shell (flag-gated at the route in Task 10).
 * Properties sidebar + sub-tasks land in Task 7; timeline (8) and
 * attachments (9) remain labelled slots.
 */
export function TaskDetailSuitePage(props: {
  workspaceId: string;
  taskId: string;
  /** Wired when the actions menu lands (Task 7+). */
  onDeleted?: () => void;
}) {
  const { workspaceId, taskId } = props;
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { data: task, isLoading, isError, refetch } = useTask(taskId);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const attachScroll = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  useTaskDetailScrollRestore({
    restoreKey: taskId,
    scrollContainerEl: scrollEl,
    ready: !!task,
  });

  const saveField = useTaskFieldSave({
    workspaceId,
    taskId,
    revision: task?.revision ?? 0,
    refetch: () => {
      void refetch();
    },
  });

  const tasksHref = paths.workspace(workspace.organization_slug, workspace.slug).tasks();
  const segments = [{ href: tasksHref, label: t("tasks.title") }];

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <BreadcrumbHeader segments={segments} leaf={t("common.loading")} />
      </div>
    );
  }

  if (isError || !task) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <BreadcrumbHeader segments={segments} leaf={t("tasks.detail.not_found")} />
      </div>
    );
  }

  const leaf =
    task.identifier?.trim() ||
    task.title ||
    t("tasks.detail.title_placeholder");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <BreadcrumbHeader
        segments={segments}
        leaf={<span className="truncate font-medium text-foreground">{leaf}</span>}
      />
      <TaskDetailResizableLayout
        main={
          <TaskDetailEditors
            task={task}
            workspaceId={workspaceId}
            scrollContainerRef={attachScroll}
            onSaveTitle={(title) => saveField({ title })}
            onSaveDescription={(description) => saveField({ description })}
          />
        }
        sidebar={
          <TaskDetailPropertiesSidebarSlot
            workspaceId={workspaceId}
            task={task}
            onRefetch={() => {
              void refetch();
            }}
          />
        }
      />
    </div>
  );
}
