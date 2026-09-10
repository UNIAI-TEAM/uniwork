"use client";

import { SquareCheckBig } from "lucide-react";
import { useTranslation } from "react-i18next";
import { taskScopeKey } from "@uniwork/core/tasks/surface/scope";
import { CollectionPageState } from "../layout/collection-page";
import { PageHeader } from "../layout/page-header";
import { TaskSurface } from "./surface/task-surface";
import type { TaskSurfaceMode } from "./surface/types";

const WORKSPACE_MODES: TaskSurfaceMode[] = [
  "board",
  "list",
  "table",
  "gantt",
  "swimlane",
];

const WORKSPACE_SCOPE = { type: "workspace" as const };

/** Workspace-scoped `/tasks` host: TaskSurface with the five suite modes. */
export function TaskSurfacePage({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <SquareCheckBig className="size-4 text-muted-foreground" aria-hidden />
        <h1 className="text-body font-medium">{t("tasks.title")}</h1>
      </PageHeader>

      <TaskSurface
        workspaceId={workspaceId}
        scope={WORKSPACE_SCOPE}
        modes={WORKSPACE_MODES}
        surfaceKey={taskScopeKey(WORKSPACE_SCOPE)}
        batchToolbar="list"
        onOpenTask={onOpenTask}
        renderEmpty={() => (
          <CollectionPageState
            icon={SquareCheckBig}
            title={t("tasks.empty_title")}
            description={t("tasks.empty_description")}
          />
        )}
      />
    </div>
  );
}
