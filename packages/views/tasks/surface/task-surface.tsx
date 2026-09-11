"use client";

import { useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ListTodo, Plus } from "lucide-react";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { taskScopeKey } from "@uniwork/core/tasks/surface/scope";
import { useChildTaskProgress, useProjects } from "@uniwork/core/tasks";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import {
  UI_EASE_OUT,
  UI_MOTION_DISTANCE,
  UI_MOTION_DURATION,
} from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { NewTaskDialog } from "../new-task-dialog";
import { BoardView } from "../modes/board-view";
import type { BoardCardMeta } from "../modes/board-card";
import { GanttView } from "../modes/gantt-view";
import { ListView } from "../modes/list-view";
import { SwimLaneView } from "../modes/swimlane-view";
import { TableView } from "../modes/table-view";
import { BatchActionToolbar } from "../views/batch-action-toolbar";
import { TasksHeader } from "../views/tasks-header";
import { TaskSurfaceActionsProvider } from "./actions-context";
import { TaskSurfaceSelectionProvider } from "./selection-context";
import type { TaskSurfaceMode, TaskSurfaceProps } from "./types";
import { useTaskSurfaceController } from "./use-task-surface-controller";

export type { TaskSurfaceProps } from "./types";
export type { TaskSurfaceController } from "./use-task-surface-controller";

export function TaskSurface({
  workspaceId,
  scope,
  modes,
  surfaceKey,
  batchToolbar = "never",
  onOpenTask,
  renderHeader,
  renderEmpty,
}: TaskSurfaceProps) {
  const resolvedSurfaceKey = surfaceKey || taskScopeKey(scope);
  const store = useMemo(
    () => getTaskSurfaceViewStore(resolvedSurfaceKey),
    [resolvedSurfaceKey],
  );
  const contentKey = `${workspaceId}:${taskScopeKey(scope)}`;

  return (
    <ViewStoreProvider store={store}>
      <TaskSurfaceContent
        key={contentKey}
        workspaceId={workspaceId}
        scope={scope}
        modes={modes}
        batchToolbar={batchToolbar}
        onOpenTask={onOpenTask}
        renderHeader={renderHeader}
        renderEmpty={renderEmpty}
      />
    </ViewStoreProvider>
  );
}

function TaskSurfaceContent({
  workspaceId,
  scope,
  modes,
  batchToolbar = "never",
  onOpenTask,
  renderHeader,
  renderEmpty,
}: Omit<TaskSurfaceProps, "surfaceKey">) {
  // Workspace table endpoints have no my-relation filter — omit table on my-scope.
  const availableModes = useMemo(
    () =>
      scope.type === "my" ? modes.filter((mode) => mode !== "table") : modes,
    [modes, scope.type],
  );
  const controller = useTaskSurfaceController({
    workspaceId,
    scope,
    modes: availableModes,
  });
  const reduceMotion = useReducedMotion() ?? false;
  const { data: membersData } = useMembers(workspaceId);
  const { data: projectsData } = useProjects(workspaceId);
  const { data: childProgressData } = useChildTaskProgress(workspaceId);
  const batchMembers = useMemo(
    () =>
      (membersData ?? []).map((m) => ({
        id: m.user_id,
        name: m.display_name || m.email,
      })),
    [membersData],
  );
  const tableMembers = useMemo(
    () =>
      (membersData ?? []).map((member) => ({
        id: member.user_id,
        name: member.display_name || member.email,
        ...(typeof member.avatar_url === "string"
          ? { avatarUrl: member.avatar_url }
          : {}),
      })),
    [membersData],
  );
  const boardCardMeta = useMemo(() => {
    const projectNames = new Map(
      (projectsData?.projects ?? []).map((project) => [project.id, project.title]),
    );
    const progressByTask = new Map(
      (childProgressData ?? []).map((progress) => [
        progress.parent_task_id,
        progress,
      ]),
    );
    return new Map<string, BoardCardMeta>(
      controller.surfaceTasks.map((task) => [
        task.id,
        {
          projectName: task.project_id
            ? projectNames.get(task.project_id)
            : undefined,
          childProgress: progressByTask.get(task.id),
        },
      ]),
    );
  }, [childProgressData, controller.surfaceTasks, projectsData?.projects]);

  const renderContext = useMemo(
    () => ({ controller }),
    [controller],
  );

  const showBatchToolbar =
    batchToolbar === "always" ||
    (batchToolbar === "list" && controller.viewMode === "list");
  const surfaceStageKey = controller.isLoading
    ? `loading:${controller.viewMode}`
    : controller.isEmpty
      ? "empty"
      : `mode:${controller.viewMode}`;

  const header =
    renderHeader?.(renderContext) ??
    (
      <TasksHeader
        workspaceId={workspaceId}
        modes={availableModes}
        scopedTasks={controller.surfaceTasks}
        isRefreshing={controller.isRefreshing}
        lockProjectFilter={scope.type === "project"}
        showProjectGrouping={scope.type !== "project"}
        projectGroupingDisabled={controller.projectGroupingDisabled}
        projectGroupingReasonKey={controller.projectGroupingReasonKey}
        saveViewScope={
          scope.type === "workspace"
            ? { kind: "workspace" }
            : scope.type === "my"
              ? {
                  kind: "my",
                  variant:
                    scope.relation === "all" ? "any" : scope.relation,
                }
              : scope.type === "project"
                ? { kind: "project", projectId: scope.projectId }
                : null
        }
      />
    );

  return (
    <TaskSurfaceActionsProvider actions={controller.actions}>
      <TaskSurfaceSelectionProvider selection={controller.selection}>
        <div className="flex min-h-0 flex-1 flex-col">
          {header}
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={surfaceStageKey}
              initial={{
                opacity: 0,
                x: reduceMotion ? 0 : UI_MOTION_DISTANCE.subtle,
              }}
              animate={{ opacity: 1, x: 0 }}
              exit={{
                opacity: 0,
                x: reduceMotion ? 0 : -UI_MOTION_DISTANCE.subtle,
              }}
              transition={{
                duration: reduceMotion
                  ? UI_MOTION_DURATION.micro
                  : UI_MOTION_DURATION.fast,
                ease: UI_EASE_OUT,
              }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {controller.isLoading ? (
                <TaskSurfaceSkeleton mode={controller.viewMode} />
              ) : controller.isEmpty ? (
                renderEmpty ? (
                  renderEmpty()
                ) : (
                  <DefaultEmpty onCreate={() => controller.openCreateTask()} />
                )
              ) : (
                <div className={cn("flex min-h-0 flex-1 flex-col")}>
                  {controller.viewMode === "list" ? (
                    <ListView
                      categories={controller.boardCategories}
                      tasks={controller.surfaceTasks}
                      cardMeta={boardCardMeta}
                      onOpenTask={onOpenTask}
                    />
                  ) : controller.viewMode === "board" ? (
                    <BoardView
                      categories={controller.boardCategories}
                      tasks={controller.surfaceTasks}
                      cardMeta={boardCardMeta}
                      projects={projectsData?.projects}
                      onOpenTask={onOpenTask}
                    />
                  ) : controller.viewMode === "table" ? (
                    <TableView
                      workspaceId={workspaceId}
                      filter={controller.tableFilter}
                      members={tableMembers}
                      projects={projectsData?.projects}
                      childProgress={childProgressData}
                      projectGroupingDisabled={controller.projectGroupingDisabled}
                      projectGroupingReasonKey={controller.projectGroupingReasonKey}
                      onOpenTask={onOpenTask}
                    />
                  ) : controller.viewMode === "gantt" ? (
                    <GanttView tasks={controller.ganttTasks} />
                  ) : controller.viewMode === "swimlane" ? (
                    <SwimLaneView
                      tasks={controller.surfaceTasks}
                      categories={controller.boardCategories}
                      projects={projectsData?.projects}
                      cardMeta={boardCardMeta}
                      groupBranches={controller.groupBranches}
                      projectGroupingDisabled={controller.projectGroupingDisabled}
                      projectGroupingReasonKey={controller.projectGroupingReasonKey}
                      parentGroupingDisabled={controller.parentGroupingDisabled}
                      parentGroupingReasonKey={controller.parentGroupingReasonKey}
                      onOpenTask={onOpenTask}
                    />
                  ) : (
                    <ModePlaceholder />
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          {showBatchToolbar ? (
            <BatchActionToolbar
              workspaceId={workspaceId}
              tasks={controller.surfaceTasks}
              members={batchMembers}
            />
          ) : null}
          <NewTaskDialog
            workspaceId={workspaceId}
            open={controller.createOpen}
            onOpenChange={controller.setCreateOpen}
            showTrigger={false}
          />
        </div>
      </TaskSurfaceSelectionProvider>
    </TaskSurfaceActionsProvider>
  );
}

function ModePlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-body text-muted-foreground">
      {t("tasks.surface.mode_placeholder")}
    </div>
  );
}

function DefaultEmpty({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <ListTodo className="h-10 w-10 text-muted-foreground" aria-hidden />
      <p className="text-body">{t("tasks.empty_title")}</p>
      <p className="text-caption">{t("tasks.empty_description")}</p>
      <Button variant="outline" size="sm" className="mt-1" onClick={onCreate}>
        <Plus className="mr-1.5 size-3.5" aria-hidden />
        {t("tasks.new")}
      </Button>
    </div>
  );
}

function TaskSurfaceSkeleton({ mode }: { mode: TaskSurfaceMode }) {
  if (mode === "list") {
    return (
      <div
        aria-hidden
        data-testid="task-surface-skeleton"
        data-layout="rows"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden
      data-testid="task-surface-skeleton"
      data-layout="columns"
      className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex min-w-52 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
