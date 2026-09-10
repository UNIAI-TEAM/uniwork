"use client";

import { memo, useCallback } from "react";
import {
  defaultAnimateLayoutChanges,
  useSortable,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  Clock3,
  FolderKanban,
  ListChecks,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { ChildProgress, Task } from "@uniwork/core/types";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";

const priorityClass: Record<Task["priority"], string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-info/10 text-info",
  high: "bg-warning/10 text-warning",
  urgent: "bg-destructive/10 text-destructive",
};

export interface BoardCardMeta {
  projectName?: string;
  childProgress?: ChildProgress;
}

function actorInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export const BoardCardContent = memo(function BoardCardContent({
  task,
  meta,
}: {
  task: Task;
  meta?: BoardCardMeta;
}) {
  const { t } = useTranslation();
  const cardProperties = useViewStore((s) => s.cardProperties);
  const startDate = cardProperties.startDate ? task.start_date : undefined;
  const dueDate = cardProperties.dueDate ? task.due_date : undefined;
  const dateRange = [startDate, dueDate].filter(Boolean).join(" – ");
  const assignee = cardProperties.assignee ? task.assignee : undefined;
  const priorityLabel = t(`tasks.priority_${task.priority}`);

  return (
    <div className="rounded-lg border border-border bg-surface px-2.5 py-2.5 shadow-sm transition-[background-color,border-color,box-shadow] group-hover/card:border-foreground/15 group-hover/card:bg-surface-hover group-hover/card:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {task.identifier ? (
            <p className="truncate text-caption text-muted-foreground">
              {task.identifier}
            </p>
          ) : null}
        </div>
        {cardProperties.priority ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium",
              priorityClass[task.priority],
            )}
          >
            {priorityLabel}
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 line-clamp-2 text-pretty text-body font-medium leading-snug">
        {task.title}
      </p>

      {cardProperties.description && task.description ? (
        <p className="mt-1 line-clamp-2 text-pretty text-caption leading-relaxed text-muted-foreground">
          {task.description}
        </p>
      ) : null}

      {cardProperties.project && meta?.projectName ? (
        <div className="mt-2 flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
          <FolderKanban className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{meta.projectName}</span>
        </div>
      ) : null}

      {dateRange || (cardProperties.childProgress && meta?.childProgress) ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          {dateRange ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3 shrink-0" aria-hidden />
              <span className="tabular-nums">{dateRange}</span>
            </span>
          ) : null}
          {cardProperties.childProgress && meta?.childProgress ? (
            <span
              className="inline-flex items-center gap-1"
              aria-label={t("tasks.card.child_progress")}
            >
              <ListChecks className="size-3 shrink-0" aria-hidden />
              <span className="tabular-nums">
                {meta.childProgress.done}/{meta.childProgress.total}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
        {assignee ? (
          <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
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
        ) : (
          <span />
        )}
        <span className="inline-flex shrink-0 items-center gap-1 text-micro tabular-nums text-muted-foreground">
          <Clock3 className="size-3" aria-hidden />
          {task.updated_at.slice(0, 10)}
        </span>
      </div>
    </div>
  );
});

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  const { isSorting, wasDragging } = args;
  if (isSorting || wasDragging) return false;
  return defaultAnimateLayoutChanges(args);
};

export const DraggableBoardCard = memo(function DraggableBoardCard({
  task,
  meta,
  onOpen,
  disableSorting,
}: {
  task: Task;
  meta?: BoardCardMeta;
  onOpen?: (id: string) => void;
  disableSorting?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { status: task.status, task },
    animateLayoutChanges,
    disabled: disableSorting ? { droppable: true } : undefined,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleOpen = useCallback(() => {
    onOpen?.(task.id);
  }, [onOpen, task.id]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-board-card=""
      {...attributes}
      {...listeners}
      className={cn("group/card space-y-1", isDragging && "opacity-30")}
    >
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "block w-full text-left transition-colors",
          isDragging && "pointer-events-none",
        )}
      >
        <BoardCardContent task={task} meta={meta} />
      </button>
    </div>
  );
});
