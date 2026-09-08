"use client";

import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import { computeDropPosition } from "@uniwork/core/tasks/position";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { TaskCard } from "../task-card";
import { useTaskSurfaceActionsOptional } from "../surface/actions-context";

/**
 * Suite TaskSurface board mode. Separate from MVP `../board-view.tsx`, which
 * still uses the four hard-coded statuses for the flag-off path.
 */
export function BoardView({
  categories,
  tasks,
  onOpenTask,
  projectGroupingDisabled = true,
  projectGroupingReasonKey,
}: {
  categories: readonly string[];
  tasks: Task[];
  onOpenTask?: (id: string) => void;
  /** Projects board grouping is stubbed until Projects UI ships. */
  projectGroupingDisabled?: boolean;
  projectGroupingReasonKey?: string;
}) {
  const { t } = useTranslation();
  const actions = useTaskSurfaceActionsOptional();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const byStatus = (status: string) =>
    tasks
      .filter((task) => task.status === status)
      .sort((a, b) => a.position - b.position);

  const onDragEnd = (event: DragEndEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    const target = event.over?.id as string | undefined;
    if (!task || !target || !categories.includes(target)) return;
    const dest = byStatus(target).filter((row) => row.id !== task.id);
    const position = computeDropPosition(dest, dest.length);
    if (task.status === target && task.position === position) return;
    actions?.moveTask(task.id, { status: target as TaskStatus, position });
  };

  const noopOpen = onOpenTask ?? (() => {});

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <button
          type="button"
          disabled={projectGroupingDisabled}
          title={
            projectGroupingDisabled && projectGroupingReasonKey
              ? t(projectGroupingReasonKey)
              : undefined
          }
          className="rounded-md border border-border px-2.5 py-1.5 text-caption text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("tasks.surface.group_by_project")}
        </button>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {categories.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={byStatus(status)}
              onOpen={noopOpen}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function BoardColumn({
  status,
  tasks,
  onOpen,
}: {
  status: string;
  tasks: Task[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const labelKey = `tasks.status_${status}`;
  const label = t(labelKey);
  const title = label === labelKey ? status : label;

  return (
    <div
      ref={setNodeRef}
      data-testid={`board-column-${status}`}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-lg bg-muted p-2",
        isOver && "ring-2 ring-ring",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-label font-medium text-muted-foreground">
          {title}
        </span>
        <span className="text-caption text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-auto">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
