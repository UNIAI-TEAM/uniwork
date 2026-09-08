"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ListTodo, Plus } from "lucide-react";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { taskScopeKey } from "@uniwork/core/tasks/surface/scope";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { NewTaskDialog } from "../new-task-dialog";
import { BoardView } from "../modes/board-view";
import { GanttView } from "../modes/gantt-view";
import { ListView } from "../modes/list-view";
import { SwimLaneView } from "../modes/swimlane-view";
import { TableView } from "../modes/table-view";
import { BatchActionToolbar } from "../views/batch-action-toolbar";
import { TasksHeader } from "../views/tasks-header";
import { TaskSurfaceActionsProvider } from "./actions-context";
import { TaskSurfaceSelectionProvider } from "./selection-context";
import type { TaskSurfaceProps } from "./types";
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
  const controller = useTaskSurfaceController({
    workspaceId,
    scope,
    modes,
  });
  const { data: membersData } = useMembers(workspaceId);
  const batchMembers = useMemo(
    () =>
      (membersData ?? []).map((m) => ({
        id: m.user_id,
        name: m.display_name || m.email,
      })),
    [membersData],
  );

  const renderContext = useMemo(
    () => ({ controller }),
    [controller],
  );

  const showBatchToolbar =
    batchToolbar === "always" ||
    (batchToolbar === "list" && controller.viewMode === "list");

  const header =
    renderHeader?.(renderContext) ??
    (
      <TasksHeader
        workspaceId={workspaceId}
        modes={modes}
        scopedTasks={controller.surfaceTasks}
        isRefreshing={controller.isRefreshing}
        saveViewScope={
          scope.type === "workspace"
            ? { kind: "workspace" }
            : scope.type === "my"
              ? {
                  kind: "my",
                  variant:
                    scope.relation === "all" ? "any" : scope.relation,
                }
              : null
        }
      />
    );

  return (
    <TaskSurfaceActionsProvider actions={controller.actions}>
      <TaskSurfaceSelectionProvider selection={controller.selection}>
        <div className="flex min-h-0 flex-1 flex-col">
          {header}
          {controller.isLoading ? (
            <TaskSurfaceSkeleton />
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
                  tasks={controller.surfaceTasks}
                  onOpenTask={onOpenTask}
                />
              ) : controller.viewMode === "board" ? (
                <BoardView
                  categories={controller.boardCategories}
                  tasks={controller.surfaceTasks}
                  projectGroupingDisabled={controller.projectGroupingDisabled}
                  projectGroupingReasonKey={controller.projectGroupingReasonKey}
                  onOpenTask={onOpenTask}
                />
              ) : controller.viewMode === "table" ? (
                <TableView
                  workspaceId={workspaceId}
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

function TaskSurfaceSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}