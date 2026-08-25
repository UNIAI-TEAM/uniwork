"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
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
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h1 className="text-body font-semibold text-foreground">{t("tasks.title")}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={mode === "board" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("board")}
          >
            {t("tasks.board")}
          </Button>
          <Button
            variant={mode === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("list")}
          >
            {t("tasks.list")}
          </Button>
          <NewTaskDialog workspaceId={workspaceId} />
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {mode === "board" ? (
          <BoardView workspaceId={workspaceId} onOpenTask={onOpenTask} />
        ) : (
          <ListView workspaceId={workspaceId} onOpenTask={onOpenTask} />
        )}
      </div>
    </div>
  );
}
