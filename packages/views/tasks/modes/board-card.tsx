"use client";
import { memo, useCallback } from "react";
import { defaultAnimateLayoutChanges, useSortable, type AnimateLayoutChanges } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { RowActionsContextMenu, RowActionsDropdown, RowDeleteDialog, useRowActionModel } from "../row-actions-menu";
import { TaskBoardCardContent, type BoardCardMeta } from "./board-card-content";
export type { BoardCardMeta } from "./board-card-content";

/** The workspace supplies display preferences; marketing uses the same card without workspace state. */
export const BoardCardContent = memo(function BoardCardContent(props: { task: Task; meta?: BoardCardMeta; reserveActionSpace?: boolean }) {
  const cardProperties = useViewStore(state => state.cardProperties);
  return <TaskBoardCardContent {...props} cardProperties={cardProperties} />;
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
