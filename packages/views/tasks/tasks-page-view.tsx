"use client";
import { SquareCheckBig } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { useTasks } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { BoardView } from "./board-view";
import { ListView } from "./list-view";
import { NewTaskDialog } from "./new-task-dialog";

export function TasksPageView({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"board" | "list">("board");
  useWorkspaceEvents(workspaceId);
  const { data: tasks, isFetched } = useTasks(workspaceId);
  const isEmpty = isFetched && (tasks?.length ?? 0) === 0;

  return (
    <div className="flex h-full flex-col">
      <CollectionPageHeader
        icon={SquareCheckBig}
        title={t("tasks.title")}
        count={tasks?.length}
        actions={
          <>
            <div role="group" aria-label={t("tasks.view_mode")} className="flex items-center gap-1">
              <Button
                variant={mode === "board" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={mode === "board"}
                onClick={() => setMode("board")}
              >
                {t("tasks.board")}
              </Button>
              <Button
                variant={mode === "list" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={mode === "list"}
                onClick={() => setMode("list")}
              >
                {t("tasks.list")}
              </Button>
            </div>
            <NewTaskDialog workspaceId={workspaceId} />
          </>
        }
      />
      <div className="min-h-0 flex-1">
        {isEmpty ? (
          <CollectionPageState
            icon={SquareCheckBig}
            title={t("tasks.empty_title")}
            description={t("tasks.empty_description")}
          />
        ) : mode === "board" ? (
          <BoardView workspaceId={workspaceId} onOpenTask={onOpenTask} />
        ) : (
          <ListView workspaceId={workspaceId} onOpenTask={onOpenTask} />
        )}
      </div>
    </div>
  );
}
