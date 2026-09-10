"use client";

import { memo, useCallback, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { DraggableBoardCard, type BoardCardMeta } from "./board-card";
import { statusColumnBg } from "./status-config";
import type { LaneGroup } from "./swimlane-lanes";
import type { TaskGroupPageState } from "../surface/use-task-group-branches";

export const SwimLaneCell = memo(function SwimLaneCell({
  cellId: cId,
  taskIds,
  taskMap,
  cardMeta,
  status,
  lane,
  onCreateTask,
  onOpenTask,
  readOnly = false,
  page,
}: {
  cellId: string;
  taskIds: string[];
  taskMap: Map<string, Task>;
  cardMeta?: ReadonlyMap<string, BoardCardMeta>;
  status: TaskStatus;
  lane: LaneGroup;
  onCreateTask?: (defaults: Record<string, unknown>) => void;
  onOpenTask?: (id: string) => void;
  readOnly?: boolean;
  page?: TaskGroupPageState;
}) {
  const { setNodeRef, isOver: droppableIsOver } = useDroppable({ id: cId });
  const isOver = readOnly ? false : droppableIsOver;
  const { t } = useTranslation();

  const resolvedTasks = useMemo(
    () =>
      taskIds.flatMap((id) => {
        const task = taskMap.get(id);
        return task ? [task] : [];
      }),
    [taskIds, taskMap],
  );

  const handleAdd = useCallback(() => {
    onCreateTask?.({ status, ...lane.moveUpdates });
  }, [status, lane, onCreateTask]);

  return (
    <div
      className={`flex min-h-[120px] flex-col rounded-xl ${statusColumnBg(status)} p-2`}
      data-testid={`swimlane-cell-${lane.key}-${status}`}
    >
      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 rounded-lg p-1 transition-colors ${
          isOver ? "bg-accent/60" : ""
        }`}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {resolvedTasks.map((task) => (
            <DraggableBoardCard
              key={task.id}
              task={task}
              meta={cardMeta?.get(task.id)}
              onOpen={onOpenTask}
            />
          ))}
        </SortableContext>
        {taskIds.length === 0 ? (
          <p className="py-6 text-center text-caption text-muted-foreground">
            &mdash;
          </p>
        ) : null}
        {page?.hasMore ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-caption"
            disabled={page.isLoading || page.isFetching}
            onClick={page.isError ? page.retry : page.loadMore}
          >
            {page.isError
              ? t("tasks.table.load_more_retry")
              : t("tasks.table.load_more")}
          </Button>
        ) : null}
      </div>
      {!readOnly && onCreateTask ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("tasks.surface.add_task")}
          className="mt-1 w-full rounded-md text-muted-foreground hover:text-foreground"
          onClick={handleAdd}
        >
          <Plus className="size-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
});
