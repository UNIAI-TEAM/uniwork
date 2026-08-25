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
import { useTasks, useUpdateTask } from "@uniwork/core/tasks";
import { computeDropPosition } from "@uniwork/core/tasks/position";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { TaskCard } from "./task-card";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

function Column({
  status,
  tasks,
  onOpen,
}: {
  status: TaskStatus;
  tasks: Task[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-lg bg-muted p-2",
        isOver && "ring-2 ring-ring",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-label font-medium text-muted-foreground">{t(`tasks.status_${status}`)}</span>
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

export function BoardView({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const { data: tasks } = useTasks(workspaceId);
  const update = useUpdateTask(workspaceId);
  // distance > 0 để click thường vẫn mở detail, kéo mới kích hoạt drag
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byStatus = (s: TaskStatus) =>
    (tasks ?? []).filter((t) => t.status === s).sort((a, b) => a.position - b.position);

  const onDragEnd = (e: DragEndEvent) => {
    const task = e.active.data.current?.task as Task | undefined;
    const target = e.over?.id as TaskStatus | undefined;
    if (!task || !target || !COLUMNS.includes(target)) return;
    const dest = byStatus(target).filter((t) => t.id !== task.id);
    // Đợt 1: thả vào cuối cột (drop theo cột, chưa sort trong cột)
    const position = computeDropPosition(dest, dest.length);
    if (task.status === target && task.position === position) return;
    update.mutate({ taskId: task.id, patch: { status: target, position } });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {COLUMNS.map((s) => (
          <Column key={s} status={s} tasks={byStatus(s)} onOpen={onOpenTask} />
        ))}
      </div>
    </DndContext>
  );
}
