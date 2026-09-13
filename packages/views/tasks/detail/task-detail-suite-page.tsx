"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useComments, useTask } from "@uniwork/core/tasks";
import { BreadcrumbHeader } from "../../layout/breadcrumb-header";
import {
  RightSidebarToggle,
  useAnimatedRightSidebar,
} from "../../layout/animated-right-sidebar";
import { useWorkspace } from "../../layout/workspace-context";
import { TaskDetailEditors } from "./components/task-detail-editors";
import { TaskDetailResizableLayout } from "./components/task-detail-layout";
import { TaskDetailPropertiesSidebarSlot } from "./components/task-detail-properties-slot";
import { TaskFindBar } from "./find/task-find-bar";
import { useTaskFind } from "./find/use-task-find";
import { useTaskDetailScrollRestore } from "./hooks/use-task-detail-scroll-restore";
import { useTaskDetailShortcuts } from "./hooks/use-task-detail-shortcuts";
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
  const { workspaceId, taskId } = props;
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { data: task, isLoading, isError, refetch } = useTask(taskId);
  const sidebarController = useAnimatedRightSidebar(true);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const attachScroll = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);
  // Same query key as the timeline, so no second request.
  const { data: comments } = useComments(taskId);

  const find = useTaskFind({
    container: scrollEl,
    contentKey: `${comments?.length ?? 0}:${task?.description ?? ""}`,
  });
  const { closeFind, openFind, barRef: findBarRef } = find;
  useTaskDetailShortcuts({
    container: scrollEl,
    enabled: !!task,
    findBarRef,
    onFind: openFind,
  });
  // The route reuses this component for another task: drop the old search.
  useEffect(() => {
    closeFind();
  }, [taskId, closeFind]);

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
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="task-detail-suite"
    >
      <BreadcrumbHeader
        segments={segments}
        leaf={<span className="truncate font-medium text-foreground">{leaf}</span>}
        actions={
          <RightSidebarToggle
            controller={sidebarController}
            label={t("tasks.detail.sidebar_toggle")}
          />
        }
      />
      <TaskDetailResizableLayout
        sidebarController={sidebarController}
        sidebarLabel={t("tasks.detail.sidebar_toggle")}
        main={
          <div className="relative flex h-full min-h-0 flex-col">
            {find.open ? (
              // Outside the scroll container, so it stays put while the page
              // scrolls; z-30 clears the sticky comment composer (z-10).
              <TaskFindBar find={find} className="absolute right-4 top-3 z-30" />
            ) : null}
            <TaskDetailEditors
              task={task}
              workspaceId={workspaceId}
              scrollContainerRef={attachScroll}
              onSaveTitle={(title) => saveField({ title })}
              onSaveDescription={(description) => saveField({ description })}
              findQuery={find.open ? find.query : ""}
            />
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
