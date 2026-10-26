"use client";

import { useTranslation } from "react-i18next";
import { taskScopeKey } from "@uniwork/core/tasks/surface/scope";
import { CollectionPageState } from "../layout/collection-page";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { PageHeader } from "../layout/page-header";
import { TrashLink } from "../trash/trash-link";
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
  trashHref,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
  /** Where the Thùng rác button goes; absent, the header has no button. */
  trashHref?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <MODULE_ICONS.tasks className="size-4 text-muted-foreground" aria-hidden />
        <h1 className="text-body font-medium">{t("tasks.title")}</h1>
        {trashHref ? (
          <div className="ml-auto flex shrink-0 items-center">
            <TrashLink href={trashHref} />
          </div>
        ) : null}
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
            icon={MODULE_ICONS.tasks}
            tone={moduleTone("tasks")}
            title={t("tasks.empty_title")}
            description={t("tasks.empty_description")}
          />
        )}
      />
    </div>
  );
}
