"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { TaskView } from "@uniwork/core/types/task-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export interface ViewBarItem {
  barItemId: string;
  label: string;
  kind: "builtin" | "view";
  view?: TaskView;
  canManage?: boolean;
}

export function DeleteViewConfirm({
  view,
  onOpenChange,
  onConfirm,
}: {
  view: TaskView | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (view: TaskView) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={!!view} onOpenChange={(v) => !v && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("tasks.view_bar.delete_title")}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {t("tasks.view_bar.delete_description", { name: view?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("tasks.save_view.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const target = view;
              onOpenChange(false);
              if (!target) return;
              void onConfirm(target).then(
                () => toast.success(t("tasks.view_bar.toast_deleted")),
                () => toast.error(t("tasks.save_view.toast_failed")),
              );
            }}
          >
            {t("tasks.view_bar.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ViewListPanel({
  items,
  activeViewId,
  onSelect,
  onEdit,
  onDelete,
}: {
  items: ViewBarItem[];
  activeViewId: string | null;
  onSelect: (item: ViewBarItem) => void;
  onEdit?: (view: TaskView) => void;
  onDelete?: (view: TaskView) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-1">
      {items.map((item) => {
        const active =
          item.kind === "view"
            ? item.view?.id === activeViewId
            : activeViewId === null && item.kind === "builtin";
        return (
          <div
            key={item.barItemId}
            className={cn(
              "group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted/60",
              active && "bg-accent",
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate px-1 text-left text-body"
              onClick={() => onSelect(item)}
            >
              {item.label}
              {item.kind === "builtin" ? (
                <span className="ml-1.5 text-caption text-muted-foreground">
                  {t("tasks.view_bar.builtin_tag")}
                </span>
              ) : null}
            </button>
            {item.kind === "view" && item.canManage && item.view ? (
              <span className="flex opacity-0 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("tasks.view_bar.edit")}
                  onClick={() => onEdit?.(item.view!)}
                >
                  <Pencil className="size-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("tasks.view_bar.delete")}
                  onClick={() => onDelete?.(item.view!)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function useDeleteViewState() {
  const [deleting, setDeleting] = useState<TaskView | null>(null);
  return { deleting, setDeleting };
}
