"use client";

import { ListTodo } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { myTasksViewStore } from "@uniwork/core/tasks/stores/my-tasks-view-store";
import { taskScopeKey } from "@uniwork/core/tasks/surface/scope";
import { CollectionPageState } from "../layout/collection-page";
import { PageHeader } from "../layout/page-header";
import { TaskSurface } from "../tasks/surface/task-surface";
import type { TaskSurfaceMode } from "../tasks/surface/types";
import { MyTasksHeader } from "./my-tasks-header";

const MY_TASKS_MODES: TaskSurfaceMode[] = [
  "board",
  "list",
  "table",
  "swimlane",
];

/**
 * Flag-on `/my-tasks` host body: my-scoped TaskSurface with four relation tabs.
 * Flag-off hosts render {@link MyTasksUnavailable} instead.
 */
export function MyTasksPageView({
  workspaceId,
  userId,
  onOpenTask,
}: {
  workspaceId: string;
  userId: string;
  onOpenTask: (id: string) => void;
}) {
  const { t } = useTranslation();
  const scope = useStore(myTasksViewStore, (s) => s.scope);
  const setScope = useStore(myTasksViewStore, (s) => s.setScope);
  const taskScope = {
    type: "my" as const,
    userId,
    relation: scope,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <ListTodo className="size-4 text-muted-foreground" aria-hidden />
        <h1 className="text-body font-medium">{t("myTasks.page.title")}</h1>
      </PageHeader>

      <TaskSurface
        workspaceId={workspaceId}
        scope={taskScope}
        modes={MY_TASKS_MODES}
        surfaceKey={taskScopeKey(taskScope)}
        batchToolbar="list"
        onOpenTask={onOpenTask}
        renderHeader={({ controller }) => (
          <MyTasksHeader
            workspaceId={workspaceId}
            modes={MY_TASKS_MODES}
            scopedTasks={controller.surfaceTasks}
            isRefreshing={controller.isRefreshing}
            scope={scope}
            onScopeChange={setScope}
          />
        )}
        renderEmpty={() => (
          <CollectionPageState
            icon={ListTodo}
            title={t("myTasks.page.empty_title")}
            description={t("myTasks.page.empty_description")}
          />
        )}
      />
    </div>
  );
}

/** Deep-link / flag-off shell — visible empty state, no crash. */
export function MyTasksUnavailable() {
  const { t } = useTranslation();
  return (
    <CollectionPageState
      icon={ListTodo}
      title={t("myTasks.unavailable_title")}
      description={t("myTasks.unavailable_description")}
      role="status"
    />
  );
}
