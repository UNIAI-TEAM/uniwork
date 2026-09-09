"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commonTaskFields } from "@uniwork/core/tasks/batch";
import {
  useBatchDeleteTasks,
  useBatchUpdateTasks,
} from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
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
import { useTaskSurfaceActionsOptional } from "../surface/actions-context";
import { useTaskSurfaceSelection } from "../surface/selection-context";
import {
  BatchAssigneePicker,
  BatchPriorityPicker,
  BatchStatusPicker,
  type BatchUpdates,
} from "./batch-pickers";

export function BatchActionToolbar({
  workspaceId,
  tasks,
  placement = "fixed-bottom",
  members = [],
}: {
  workspaceId: string;
  tasks: Task[];
  placement?: "fixed-bottom" | "inline";
  members?: Array<{ id: string; name: string }>;
}) {
  const { t } = useTranslation();
  const selection = useTaskSurfaceSelection();
  const selectedIds = selection.selectedIds;
  const clear = selection.clear;

  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedIds.has(task.id)),
    [tasks, selectedIds],
  );
  const count = selectedTasks.length;
  const common = useMemo(() => commonTaskFields(selectedTasks), [selectedTasks]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const surfaceActions = useTaskSurfaceActionsOptional();
  const batchUpdate = useBatchUpdateTasks(workspaceId);
  const batchDelete = useBatchDeleteTasks(workspaceId);
  const loading =
    surfaceActions?.isPending ??
    (batchUpdate.isPending || batchDelete.isPending);
  const ids = selectedTasks.map((task) => task.id);

  useEffect(() => {
    if (count > 0) return;
    setDeleteOpen(false);
  }, [count]);

  const handleBatchUpdate = async (updates: BatchUpdates) => {
    try {
      if (surfaceActions) {
        await surfaceActions.batchUpdate(ids, updates);
      } else {
        await batchUpdate.mutateAsync({ task_ids: ids, updates });
      }
      toast.success(t("tasks.batch.update_success", { count }));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t("tasks.batch.update_failed"),
      );
    }
  };

  const handleBatchDelete = async () => {
    try {
      if (surfaceActions) {
        await surfaceActions.batchDelete(ids);
      } else {
        await batchDelete.mutateAsync(ids);
      }
      clear();
      toast.success(t("tasks.batch.delete_success", { count }));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t("tasks.batch.delete_failed"),
      );
    } finally {
      setDeleteOpen(false);
    }
  };

  if (count === 0) return null;

  return (
    <>
      <div
        className={cn(
          "z-50",
          placement === "fixed-bottom"
            ? "fixed bottom-6 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2"
            : "mb-2 w-fit",
        )}
      >
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 shadow-lg">
          <div className="mr-1 flex items-center gap-1.5 border-r border-border pr-2 pl-1">
            <span className="text-body font-medium">
              {t("tasks.batch.selected", { count })}
            </span>
            <button
              type="button"
              onClick={clear}
              className="rounded p-0.5 transition-colors hover:bg-accent"
              aria-label={t("tasks.batch.clear_selection")}
            >
              <X className="size-3.5 text-muted-foreground" aria-hidden />
            </button>
          </div>

          <BatchStatusPicker
            status={common.status}
            disabled={loading}
            onUpdate={(updates) => {
              if (!updates.status) return;
              void handleBatchUpdate(updates);
            }}
          />
          <BatchPriorityPicker
            priority={common.priority}
            disabled={loading}
            onUpdate={(updates) => void handleBatchUpdate(updates)}
          />
          <BatchAssigneePicker
            assigneeId={common.assignee?.id ?? null}
            mixed={common.assignee === null}
            disabled={loading}
            members={members}
            onUpdate={(updates) => void handleBatchUpdate(updates)}
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => setDeleteOpen(true)}
            className="text-destructive hover:text-destructive"
            data-testid="batch-delete"
          >
            <Trash2 className="mr-1 size-3.5" aria-hidden />
            {t("tasks.batch.delete")}
          </Button>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tasks.batch.delete_dialog_title", { count })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks.batch.delete_dialog_desc", { count })}
              <span className="mt-2 block text-caption text-muted-foreground">
                {t("tasks.batch.delete_dialog_warning")}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("tasks.batch.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleBatchDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="batch-delete-confirm"
            >
              {t("tasks.batch.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
