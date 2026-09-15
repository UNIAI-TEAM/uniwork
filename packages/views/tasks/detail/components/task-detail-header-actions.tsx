"use client";

import { useState } from "react";
import { MessageSquare, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useComments,
  useCreatePin,
  useDeletePin,
  useDeleteTask,
  usePins,
  usePutTask,
  useUpdateTask,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { useNavigation } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";
import {
  DROPDOWN_PARTS,
  RowActionItems,
  type TaskUpdates,
} from "../../row-actions-items";

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
  const comments = useComments(task.id);
  const pins = usePins(workspaceId);
  const createPin = useCreatePin(workspaceId);
  const deletePin = useDeletePin(workspaceId);
  const remove = useDeleteTask(workspaceId);
  const put = usePutTask(workspaceId);
  const update = useUpdateTask(workspaceId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pinned = (pins.data?.pins ?? []).some(
    (pin) => pin.item_type === "task" && pin.item_id === task.id,
  );
  const pinPending = createPin.isPending || deletePin.isPending;

  const togglePin = () => {
    if (pinPending) return;
    const mutation = pinned
      ? deletePin.mutateAsync({ itemType: "task", itemId: task.id })
      : createPin.mutateAsync({ item_type: "task", item_id: task.id });
    void mutation.catch((err: unknown) => toastApiError(err, t("common.error")));
  };

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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        aria-label={t("tasks.detail.comments_count", { count: comments.data?.length ?? 0 })}
        onClick={() =>
          document
            .querySelector<HTMLElement>("[data-testid='task-detail-timeline']")
            ?.scrollIntoView({ block: "start" })
        }
      >
        <MessageSquare aria-hidden />
        <span className="tabular-nums">{comments.data?.length ?? 0}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("tasks.detail.actions")}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            disabled={pinPending}
            onClick={togglePin}
          >
            {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
            {pinned ? t("tasks.detail.unpin") : t("tasks.detail.pin")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
          />
        </DropdownMenuContent>
      </DropdownMenu>

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
