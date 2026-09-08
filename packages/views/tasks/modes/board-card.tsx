"use client";

import { memo, useCallback } from "react";
import {
  defaultAnimateLayoutChanges,
  useSortable,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import type { Task } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

const priorityClass: Record<Task["priority"], string> = {
  low: "text-muted-foreground",
  medium: "text-muted-foreground",
  high: "text-warning",
  urgent: "text-destructive",
};

export const BoardCardContent = memo(function BoardCardContent({
  task,
}: {
  task: Task;
}) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const agentCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.agent_runs",
  );
  const vcsCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.vcs",
  );
  const agentAvailable = agentCapability.status === "available";
  const vcsAvailable = vcsCapability.status === "available";

  return (
    <div className="rounded-lg border border-border bg-surface px-2.5 py-3 shadow-sm transition-colors group-hover/card:border-foreground/15 group-hover/card:bg-surface-hover">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            aria-label={t(`tasks.priority_${task.priority}`)}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center text-micro font-medium",
              priorityClass[task.priority],
            )}
          >
            {t(`tasks.priority_${task.priority}`).slice(0, 1)}
          </span>
          {task.identifier ? (
            <p className="truncate text-caption text-muted-foreground">
              {task.identifier}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "rounded-full bg-muted px-1.5 py-0.5 text-micro text-muted-foreground",
              !agentAvailable && "cursor-not-allowed opacity-60",
            )}
            title={
              agentAvailable
                ? undefined
                : t(agentCapability.explanation_key || "capabilities.unknown")
            }
            aria-disabled={!agentAvailable}
          >
            {t("tasks.surface.agent_chip_stub")}
          </span>
          <span
            className={cn(
              "rounded-full bg-muted px-1.5 py-0.5 text-micro text-muted-foreground",
              !vcsAvailable && "cursor-not-allowed opacity-60",
            )}
            title={
              vcsAvailable
                ? undefined
                : t(vcsCapability.explanation_key || "capabilities.unknown")
            }
            aria-disabled={!vcsAvailable}
          >
            {t("tasks.surface.vcs_chip_stub")}
          </span>
        </div>
      </div>

      <p className="mt-1 line-clamp-2 text-body font-medium leading-snug">
        {task.title}
      </p>

      {task.description ? (
        <p className="mt-1 line-clamp-1 text-caption text-muted-foreground">
          {task.description}
        </p>
      ) : null}

      {task.due_date ? (
        <div className="mt-2 flex items-center gap-1 text-caption text-muted-foreground">
          <CalendarDays className="size-3" aria-hidden />
          <span>{task.due_date}</span>
        </div>
      ) : null}
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
  onOpen,
  disableSorting,
}: {
  task: Task;
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
      className={cn("group/card", isDragging && "opacity-30")}
    >
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "block w-full text-left transition-colors",
          isDragging && "pointer-events-none",
        )}
      >
        <BoardCardContent task={task} />
      </button>
    </div>
  );
});
