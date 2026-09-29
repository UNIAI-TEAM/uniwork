"use client";

import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDeleteTask, usePutTask, useUpdateTask } from "@uniwork/core/tasks";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { PinToggleButton } from "../../../common/pin-toggle-button";
import { useNavigation } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";
import {
  DROPDOWN_PARTS,
  RowActionItems,
  type TaskUpdates,
} from "../../row-actions-items";
import { RowAssigneePicker } from "../../row-assignee-picker";
import { TaskDetailThreadNav } from "./task-detail-thread-nav";

export function TaskDetailHeaderActions({
  workspaceId,
  task,
  tasksHref,
  onDeleted,
}: {
  workspaceId: string;
  task: Task;
  tasksHref: string;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const remove = useDeleteTask(workspaceId);
  const put = usePutTask(workspaceId);
  const update = useUpdateTask(workspaceId);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const copyLink = () => {
    const url = navigation.getShareableUrl(
      navigation.pathname || tasksHref.replace(/\/tasks$/, `/tasks/${task.id}`),
    );
    void copyText(url).then((ok) => {
      if (ok) toast.success(t("tasks.row_actions.link_copied"));
      else toast.error(t("tasks.row_actions.copy_link_failed"));
    });
  };

  const confirmDelete = async () => {
    try {
      await remove.mutateAsync(task.id);
      setDeleteOpen(false);
      toast.success(t("tasks.row_actions.delete_success"));
      if (onDeleted) onDeleted();
      else navigation.push(tasksHref);
    } catch (err) {
      toastApiError(err, t("tasks.row_actions.delete_failed"));
    }
  };

  const quickUpdate = (changes: TaskUpdates) => {
    if (typeof changes.status === "string") {
      put.mutate(
        {
          taskId: task.id,
          body: { status: changes.status, revision: task.revision },
          ifMatch: String(task.revision),
        },
        { onError: (err) => toastApiError(err, t("common.error")) },
      );
      return;
    }
    update.mutate(
      {
        taskId: task.id,
        patch: changes as Parameters<typeof update.mutate>[0]["patch"],
      },
      { onError: (err) => toastApiError(err, t("common.error")) },
    );
  };

  return (
    <>
      <TaskDetailThreadNav workspaceId={workspaceId} taskId={task.id} />
      <PinToggleButton
        workspaceId={workspaceId}
        itemType="task"
        itemId={task.id}
        pinLabel={t("tasks.detail.pin")}
        unpinLabel={t("tasks.detail.unpin")}
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              ref={actionsTriggerRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={t("tasks.detail.actions")}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <RowActionItems
            parts={DROPDOWN_PARTS}
            model={{
              task,
              copyLink,
              update: quickUpdate,
              requestDelete: () => setDeleteOpen(true),
              hasAny: true,
              deleteOpen,
              setDeleteOpen,
              deleting: remove.isPending,
              confirmDelete: () => void confirmDelete(),
              deleteDialogMounted: deleteOpen,
              deleteDialogClosed: () => {},
            }}
            onOpenAssignee={() => setAssigneeOpen(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {assigneeOpen ? (
        <RowAssigneePicker
          task={task}
          onUpdate={quickUpdate}
          anchor={actionsTriggerRef}
          onClose={() => setAssigneeOpen(false)}
        />
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tasks.row_actions.delete_dialog_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks.row_actions.delete_dialog_desc", { title: task.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("tasks.row_actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              aria-disabled={remove.isPending || undefined}
              onClick={() => void confirmDelete()}
            >
              {t("tasks.row_actions.delete_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
