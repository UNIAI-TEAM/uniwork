"use client";

import { memo, type Ref } from "react";
import {
  defaultAnimateLayoutChanges,
  useSortable,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, FolderKanban, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task } from "@uniwork/core/types";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import type { BoardCardMeta } from "./board-card";
import { PriorityFlag, StatusIcon } from "./status-pill";
import { useTaskSurfaceSelectionOptional } from "../surface/selection-context";

function actorInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function formatDate(value: string, locale: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(date);
}

function TaskListRowContent({
  task,
  meta,
  onOpenTask,
  isDragging = false,
  containerRef,
  containerStyle,
  containerProps,
}: {
  task: Task;
  meta?: BoardCardMeta;
  onOpenTask?: (id: string) => void;
  isDragging?: boolean;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: React.CSSProperties;
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const { t, i18n } = useTranslation();
  const selection = useTaskSurfaceSelectionOptional();
  const selected = selection?.selectedIds.has(task.id) ?? false;
  const cardProperties = useViewStore((state) => state.cardProperties);
  const assignee = cardProperties.assignee ? task.assignee : undefined;
  const projectName = cardProperties.project ? meta?.projectName : undefined;
  const progress = cardProperties.childProgress
    ? meta?.childProgress
    : undefined;

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      {...containerProps}
      data-task-list-row=""
      className={cn(
        "group/row flex h-9 min-w-0 items-center gap-2 rounded-md px-3 text-body transition-colors",
        selected
          ? "bg-accent"
          : "hover:bg-muted focus-within:bg-muted",
        isDragging && "opacity-30",
      )}
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        {cardProperties.priority ? (
          <PriorityFlag
            priority={task.priority}
            className={cn("group-hover/row:hidden", selected && "hidden")}
          />
        ) : null}
        <input
          type="checkbox"
          checked={selected}
          aria-label={t("tasks.list.select_task", { title: task.title })}
          onChange={() => selection?.toggle(task.id)}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            "absolute inset-0 cursor-pointer accent-primary",
            selected ? "block" : "hidden group-hover/row:block",
          )}
        />
      </div>

      <button
        type="button"
        onClick={() => onOpenTask?.(task.id)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className="w-16 shrink-0 truncate text-caption tabular-nums text-muted-foreground"
          translate="no"
        >
          {task.identifier}
        </span>
        <StatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {task.title}
        </span>

        {projectName ? (
          <span className="hidden max-w-36 shrink-0 items-center gap-1 text-caption text-muted-foreground md:inline-flex">
            <FolderKanban className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{projectName}</span>
          </span>
        ) : null}
        {cardProperties.startDate && task.start_date ? (
          <span className="hidden shrink-0 items-center gap-1 text-caption tabular-nums text-muted-foreground lg:inline-flex">
            <CalendarDays className="size-3" aria-hidden />
            {formatDate(task.start_date, i18n.language)}
          </span>
        ) : null}
        {cardProperties.dueDate && task.due_date ? (
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {formatDate(task.due_date, i18n.language)}
          </span>
        ) : null}
        {progress ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-micro tabular-nums text-muted-foreground"
            aria-label={t("tasks.card.child_progress")}
          >
            <ListChecks className="size-3" aria-hidden />
            {progress.done}/{progress.total}
          </span>
        ) : null}
        {assignee ? (
          <span className="hidden max-w-32 shrink-0 items-center gap-1.5 text-caption text-muted-foreground sm:inline-flex">
            <ActorAvatar
              name={assignee.display_name}
              initials={actorInitial(assignee.display_name)}
              avatarUrl={assignee.avatar_url}
              isAgent={assignee.kind === "agent"}
              isSystem={assignee.kind === "system"}
              size="xs"
            />
            <span className="truncate">{assignee.display_name}</span>
          </span>
        ) : null}
      </button>
    </div>
  );
}

export const TaskListRow = memo(function TaskListRow({
  task,
  meta,
  onOpenTask,
}: {
  task: Task;
  meta?: BoardCardMeta;
  onOpenTask?: (id: string) => void;
}) {
  return <TaskListRowContent task={task} meta={meta} onOpenTask={onOpenTask} />;
});

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  if (args.isSorting || args.wasDragging) return false;
  return defaultAnimateLayoutChanges(args);
};

export const DraggableTaskListRow = memo(function DraggableTaskListRow({
  task,
  meta,
  onOpenTask,
  disableSorting,
}: {
  task: Task;
  meta?: BoardCardMeta;
  onOpenTask?: (id: string) => void;
  disableSorting?: boolean;
}) {
  const sortable = useSortable({
    id: task.id,
    data: { status: task.status, task },
    animateLayoutChanges,
    disabled: disableSorting ? { droppable: true } : undefined,
  });

  return (
    <TaskListRowContent
      task={task}
      meta={meta}
      onOpenTask={onOpenTask}
      isDragging={sortable.isDragging}
      containerRef={sortable.setNodeRef}
      containerStyle={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      containerProps={{ ...sortable.attributes, ...sortable.listeners }}
    />
  );
});
