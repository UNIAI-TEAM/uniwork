"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Layers, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskView } from "@uniwork/core/types/task-view";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import { DeleteViewConfirm, type ViewBarItem } from "./view-bar-popover";

function setDndCursor(on: boolean) {
  if (on) document.documentElement.dataset.dndDragging = "true";
  else delete document.documentElement.dataset.dndDragging;
}

function SortableRow({
  item,
  hidden,
  anchor,
  onToggleHidden,
  onEdit,
  onDelete,
}: {
  item: ViewBarItem;
  hidden: boolean;
  anchor: boolean;
  onToggleHidden: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.barItemId });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5",
        isDragging && "z-10 bg-accent opacity-80",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("tasks.view_bar.drag_handle")}
        className={cn(
          "cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing",
          isDragging && "cursor-grabbing",
        )}
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-body">
        {item.label}
        {item.kind === "builtin" ? (
          <span className="ml-1.5 text-caption text-muted-foreground">
            {t("tasks.view_bar.builtin_tag")}
          </span>
        ) : null}
      </span>
      {item.kind === "view" && item.canManage ? (
        <span className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("tasks.view_bar.edit")}
            onClick={onEdit}
          >
            <Pencil className="size-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("tasks.view_bar.delete")}
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </span>
      ) : null}
      <Switch
        size="sm"
        checked={!hidden}
        disabled={anchor}
        aria-label={t("tasks.view_bar.visible_toggle")}
        onCheckedChange={onToggleHidden}
      />
    </div>
  );
}

export function ManageViewsDialog({
  open,
  onOpenChange,
  items,
  hiddenSet,
  anchorId,
  onReorder,
  onToggleHidden,
  onEditView,
  onDeleteView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ViewBarItem[];
  hiddenSet: Set<string>;
  anchorId: string;
  onReorder: (orderedIds: string[]) => void;
  onToggleHidden: (barItemId: string, hidden: boolean) => void;
  onEditView: (view: TaskView) => void;
  onDeleteView: (view: TaskView) => Promise<void>;
}) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  useEffect(() => () => setDndCursor(false), []);
  useEffect(() => {
    if (!open) setLocalOrder(null);
  }, [open]);

  const orderedItems = useMemo(() => {
    if (!localOrder) return items;
    const byId = new Map(items.map((item) => [item.barItemId, item]));
    const next: ViewBarItem[] = [];
    for (const id of localOrder) {
      const item = byId.get(id);
      if (item) {
        next.push(item);
        byId.delete(id);
      }
    }
    return [...next, ...byId.values()];
  }, [items, localOrder]);

  const [deleting, setDeleting] = useState<TaskView | null>(null);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = orderedItems.map((item) => item.barItemId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setLocalOrder(next);
    onReorder(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Layers className="size-4" aria-hidden />
              {t("tasks.view_bar.manage_title")}
            </DialogTitle>
            <DialogDescription>
              {t("tasks.view_bar.manage_hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-2 min-w-0 overflow-hidden">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={() => setDndCursor(true)}
              onDragCancel={() => setDndCursor(false)}
              onDragEnd={(event) => {
                setDndCursor(false);
                handleDragEnd(event);
              }}
            >
              <SortableContext
                items={orderedItems.map((item) => item.barItemId)}
                strategy={verticalListSortingStrategy}
              >
                {orderedItems.map((item) => (
                  <SortableRow
                    key={item.barItemId}
                    item={item}
                    hidden={hiddenSet.has(item.barItemId)}
                    anchor={item.barItemId === anchorId}
                    onToggleHidden={() =>
                      onToggleHidden(
                        item.barItemId,
                        !hiddenSet.has(item.barItemId),
                      )
                    }
                    onEdit={
                      item.view ? () => onEditView(item.view!) : undefined
                    }
                    onDelete={
                      item.view ? () => setDeleting(item.view!) : undefined
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteViewConfirm
        view={deleting}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        onConfirm={onDeleteView}
      />
    </>
  );
}
