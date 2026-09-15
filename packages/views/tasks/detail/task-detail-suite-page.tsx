"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useTask } from "@uniwork/core/tasks";
import { BreadcrumbHeader } from "../../layout/breadcrumb-header";
import {
  RightSidebarToggle,
  useAnimatedRightSidebar,
} from "../../layout/animated-right-sidebar";
import { useWorkspace } from "../../layout/workspace-context";
import { TaskDetailEditors } from "./components/task-detail-editors";
import { TaskDetailHeaderActions } from "./components/task-detail-header-actions";
import { TaskDetailResizableLayout } from "./components/task-detail-layout";
import { TaskDetailPropertiesSidebarSlot } from "./components/task-detail-properties-slot";
import { TaskFindScope } from "./find/task-find-scope";
import { useRecordTaskVisit } from "./hooks/use-record-task-visit";
import { useTaskDetailScrollRestore } from "./hooks/use-task-detail-scroll-restore";
import { useTaskFieldSave } from "./hooks/use-task-field-save";

/**
 * Suite task detail shell mounted from the web task detail route.
 * Properties sidebar, sub-tasks, timeline, and attachments are live.
 */
export function TaskDetailSuitePage(props: {
  workspaceId: string;
  taskId: string;
  /** Wired when the actions menu lands (Task 7+). */
  onDeleted?: () => void;
}) {
  const { workspaceId, taskId, onDeleted } = props;
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { data: task, isLoading, isError, error, refetch } = useTask(taskId);
  useRecordTaskVisit({ workspaceId, taskId, task, error });
  const sidebarController = useAnimatedRightSidebar(true);
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

  const identifier = task.identifier?.trim();
  const leaf = [identifier, task.title].filter(Boolean).join(" ") || t("tasks.detail.title_placeholder");

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="task-detail-suite"
    >
      <TaskDetailResizableLayout
        sidebarController={sidebarController}
        sidebarLabel={t("tasks.detail.sidebar_toggle")}
        main={
          <div
            className="flex h-full min-h-0 flex-col"
            data-testid="task-detail-main-pane"
          >
            <BreadcrumbHeader
              segments={segments}
              leaf={<span className="truncate font-medium text-foreground">{leaf}</span>}
              actions={
                <>
                  <TaskDetailHeaderActions
                    workspaceId={workspaceId}
                    task={task}
                    tasksHref={tasksHref}
                    onDeleted={onDeleted}
                  />
                  <RightSidebarToggle
                    controller={sidebarController}
                    label={t("tasks.detail.sidebar_toggle")}
                  />
                </>
              }
            />
            {/* The editors element is created here and handed to the find scope
                as children, so find state changing inside the scope (every
                keystroke) never re-renders them. */}
            <TaskFindScope
              taskId={taskId}
              container={scrollEl}
              description={task.description ?? ""}
            >
              <TaskDetailEditors
                task={task}
                workspaceId={workspaceId}
                scrollContainerRef={attachScroll}
                onSaveTitle={(title) => saveField({ title })}
                onSaveDescription={(description) => saveField({ description })}
              />
            </TaskFindScope>
          </div>
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
