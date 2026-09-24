"use client";

import { memo, useCallback } from "react";
import {
  defaultAnimateLayoutChanges,
  useSortable,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarClock,
  CalendarDays,
  FolderKanban,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { ChildProgress, Task } from "@uniwork/core/types";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { PriorityFlag } from "./status-pill";
import {
  RowActionsContextMenu,
  RowActionsDropdown,
  RowDeleteDialog,
  useRowActionModel,
} from "../row-actions-menu";

export interface BoardCardMeta {
  projectName?: string;
  childProgress?: ChildProgress;
}

function actorInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function descriptionPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!file\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, "")
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .replace(/^[\s>#]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value: string, locale: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(date);
}

function isPastDate(value: string): boolean {
  const today = new Date();
  const localToday = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return value.slice(0, 10) < localToday;
}

function formatTimeAgo(value: string, locale: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const elapsed = timestamp - Date.now();
  const absolute = Math.abs(elapsed);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absolute < 60_000) return formatter.format(0, "second");
  if (absolute < 3_600_000) return formatter.format(Math.round(elapsed / 60_000), "minute");
  if (absolute < 86_400_000) return formatter.format(Math.round(elapsed / 3_600_000), "hour");
  return formatter.format(Math.round(elapsed / 86_400_000), "day");
}

function TaskProgressRing({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <span className="relative size-3.5" data-slot="task-progress-ring" aria-hidden>
      <svg className="size-3.5 -rotate-90" viewBox="0 0 16 16">
        <circle className="text-muted" strokeWidth="2" stroke="currentColor" fill="none" r="6" cx="8" cy="8" />
        <circle
          className="text-success"
          strokeWidth="2"
          stroke="currentColor"
          fill="none"
          r="6"
          cx="8"
          cy="8"
          strokeDasharray={`${ratio * 37.7} 37.7`}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export const BoardCardContent = memo(function BoardCardContent({
  task,
  meta,
  reserveActionSpace = false,
}: {
  task: Task;
  meta?: BoardCardMeta;
  /**
   * Set where the card carries the three-dot button. On coarse pointers the
   * button is always visible in the top-right corner, so the header row moves
   * the priority label left instead of letting the button cover it. The drag
   * overlay has no button and leaves this off.
   */
  reserveActionSpace?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const cardProperties = useViewStore((s) => s.cardProperties);
  const startDate = cardProperties.startDate ? task.start_date : undefined;
  const dueDate = cardProperties.dueDate ? task.due_date : undefined;
  const assignee = cardProperties.assignee ? task.assignee : undefined;
  const progress = cardProperties.childProgress ? meta?.childProgress : undefined;
  const showAssigneeName = !!assignee && !startDate && !dueDate;
  const updatedAgo = showAssigneeName && !progress
    ? formatTimeAgo(task.updated_at, i18n.language)
    : null;
  const preview = cardProperties.description && task.description
    ? descriptionPreview(task.description)
    : "";
  const showMeta = cardProperties.assignee || startDate || dueDate || progress;

  return (
    <div
      data-slot="task-card"
      className="rounded-lg border-[0.5px] border-border bg-surface px-2.5 py-3 shadow-[var(--surface-shadow)] transition-colors group-hover/card:border-foreground/15 group-hover/card:bg-surface-hover"
    >
      <div
        data-card-header=""
        className={cn(
          "flex items-center justify-between gap-2",
          // 44px button at right-1.5 covers 50px from the card edge; border
          // and px-2.5 already give 11px, so the header reserves 40px.
          reserveActionSpace && "pointer-coarse:pr-10",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {cardProperties.priority ? <PriorityFlag priority={task.priority} /> : null}
          {task.identifier ? (
            <p className="truncate text-caption text-muted-foreground">
              {task.identifier}
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-1 line-clamp-2 text-pretty text-body font-medium leading-snug">
        {task.title}
      </p>

      {preview ? (
        <p className="mt-1 line-clamp-1 text-caption text-muted-foreground">
          {preview}
        </p>
      ) : null}

      {cardProperties.project && meta?.projectName ? (
        <div className="mt-1.5 inline-flex max-w-40 items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro text-muted-foreground">
          <FolderKanban className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{meta.projectName}</span>
        </div>
      ) : null}

      {showMeta ? (
        <div data-slot="task-card-meta" className="mt-2 flex items-center justify-between gap-2">
          {cardProperties.assignee ? (
            assignee ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-foreground">
                <ActorAvatar
                  name={assignee.display_name}
                  initials={actorInitial(assignee.display_name)}
                  avatarUrl={assignee.avatar_url}
                  isAgent={assignee.kind === "agent"}
                  isSystem={assignee.kind === "system"}
                  size="sm"
                />
                {showAssigneeName ? <span className="truncate">{assignee.display_name}</span> : null}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                {t("tasks.unassigned")}
              </span>
            )
          ) : (
            <span />
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2 text-caption text-muted-foreground">
            {startDate ? (
              <span data-slot="task-start-date" className="inline-flex items-center gap-1 tabular-nums">
                <CalendarClock className="size-3" aria-hidden />
                {formatDate(startDate, i18n.language)}
              </span>
            ) : null}
            {dueDate ? (
              <span
                data-slot="task-due-date"
                className={cn(
                  "inline-flex items-center gap-1 tabular-nums",
                  isPastDate(dueDate) && "text-destructive",
                )}
              >
                <CalendarDays className="size-3" aria-hidden />
                {formatDate(dueDate, i18n.language)}
              </span>
            ) : null}
            {progress ? (
              <span className="inline-flex items-center gap-1" aria-label={t("tasks.card.child_progress")}>
                <TaskProgressRing done={progress.done} total={progress.total} />
                <span className="text-micro font-medium tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              </span>
            ) : null}
            {updatedAgo ? (
              <span className="text-caption text-muted-foreground">
                {t("tasks.card.updated_ago", { time: updatedAgo })}
              </span>
            ) : null}
          </div>
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
  meta,
  onOpen,
  disableSorting,
  disableDragging,
}: {
  task: Task;
  meta?: BoardCardMeta;
  onOpen?: (id: string) => void;
  disableSorting?: boolean;
  disableDragging?: boolean;
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
    disabled: disableDragging
      ? true
      : disableSorting
        ? { droppable: true }
        : undefined,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleOpen = useCallback(() => {
    onOpen?.(task.id);
  }, [onOpen, task.id]);
  const rowActions = useRowActionModel(task, onOpen);

  return (
    <RowActionsContextMenu
      model={rowActions}
      ref={setNodeRef}
      style={style}
      data-board-card=""
      className={cn("group/card relative", isDragging && "opacity-30")}
    >
      {/* Drag listeners sit on this child so the portalled menus and dialog,
          which render as children of the outer card, never reach them. */}
      <div {...attributes} {...listeners}>
        <button
          type="button"
          onClick={handleOpen}
          className={cn(
            "block w-full text-left transition-colors",
            isDragging && "pointer-events-none",
          )}
        >
          <BoardCardContent task={task} meta={meta} reserveActionSpace />
        </button>
      </div>
      {isDragging ? null : (
        <RowActionsDropdown
          model={rowActions}
          className="absolute top-1.5 right-1.5"
          triggerClassName="bg-surface group-hover/card:opacity-100 group-focus-within/card:opacity-100"
        />
      )}
      <RowDeleteDialog model={rowActions} />
    </RowActionsContextMenu>
  );
});
