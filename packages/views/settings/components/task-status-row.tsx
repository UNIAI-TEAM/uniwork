"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, ArrowDown, ArrowUp, Ellipsis, GripVertical, Lock, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskCatalogStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { StatusIcon } from "../../tasks/icons/status-icon";

/** What a row shows: built-ins read from i18n, custom statuses from the catalog. */
export function statusRowText(status: TaskCatalogStatus, t: (key: string) => string) {
  return status.is_system
    ? { name: t(`tasks.status_${status.category}`), description: t(`settings.taskStatuses.system_${status.category}`) }
    : { name: status.name, description: status.description };
}

/**
 * One status in its group, laid out like UniAI's: drag handle (or a spacer in
 * a group of one), icon, name over a one-line description, and a "⋯" menu
 * that appears on hover or focus (always on touch). A built-in's menu keeps
 * edit and archive visible but disabled, with the reason under them.
 */
export function TaskStatusRow({
  status,
  canManage,
  draggable,
  isFirst,
  isLast,
  onMove,
  onEdit,
  onArchive,
}: {
  status: TaskCatalogStatus;
  canManage: boolean;
  /** The group has more than one status, so there is something to reorder. */
  draggable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (by: -1 | 1) => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const { name, description } = statusRowText(status, t);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
    disabled: !canManage || !draggable,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/row relative flex min-h-12 items-center gap-2 bg-surface py-2 pr-4 pl-2",
        isDragging && "z-10 shadow-md",
      )}
    >
      {canManage && draggable ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={t("settings.taskStatuses.drag", { name })}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground active:cursor-grabbing [@media(pointer:coarse)]:size-11"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
      ) : (
        <span aria-hidden className="size-6 shrink-0 [@media(pointer:coarse)]:size-11" />
      )}
      <StatusIcon
        status={status.key}
        category={status.is_system ? status.category : status.icon || status.category}
        color={status.is_system ? undefined : status.color}
      />
      <div className="min-w-0 flex-1">
        <span data-slot="status-name" className="block truncate text-body font-medium">
          {name}
        </span>
        {description ? <p className="truncate text-caption text-muted-foreground">{description}</p> : null}
      </div>
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("settings.taskStatuses.actions", { name })}
                className="group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-popup-open:opacity-100 [@media(hover:hover)]:opacity-0 [@media(pointer:coarse)]:opacity-100"
              />
            }
          >
            <Ellipsis aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem disabled={isFirst} onClick={() => onMove(-1)}>
              <ArrowUp aria-hidden />
              {t("settings.taskStatuses.move_up")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onClick={() => onMove(1)}>
              <ArrowDown aria-hidden />
              {t("settings.taskStatuses.move_down")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={status.is_system} onClick={onEdit}>
              <Pencil aria-hidden />
              {t("settings.taskStatuses.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={status.is_system} onClick={onArchive}>
              <Archive aria-hidden />
              {t("settings.taskStatuses.archive")}
            </DropdownMenuItem>
            {status.is_system ? (
              <p className="flex gap-1.5 px-2 py-1.5 text-caption text-pretty text-muted-foreground">
                <Lock aria-hidden className="mt-0.5 size-3 shrink-0" />
                {t("settings.taskStatuses.system_locked")}
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}
