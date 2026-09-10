"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTask, useUpdateTask } from "@uniwork/core/tasks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";
import { ChatTaskPeekFields } from "./chat-task-peek-fields";

/** Task peek shaped like a ClickUp task modal — editable title, chips, description. */
export function ChatTaskPeekDialog({
  open,
  onOpenChange,
  workspaceId,
  taskId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const { data: task, isLoading, isError } = useTask(taskId);
  const update = useUpdateTask(workspaceId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Load local draft when the dialog opens or the task id changes — not on every
  // cache tick, so typing is not wiped mid-edit.
  useEffect(() => {
    if (!open || !task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional

  const identifier =
    task?.identifier?.trim() || task?.id.slice(0, 8) || t("chat.link.task_loading");

  const savePatch = (patch: { title?: string; description?: string }) => {
    if (!task) return;
    update.mutate(
      { taskId: task.id, patch },
      { onError: (err) => toastApiError(err, t("common.error")) },
    );
  };

  const commitTitle = () => {
    const next = title.trim();
    if (!task || !next || next === task.title) {
      if (task && !next) setTitle(task.title);
      return;
    }
    savePatch({ title: next });
  };

  const commitDescription = () => {
    if (!task) return;
    const next = description.trimEnd();
    if (next === (task.description ?? "")) return;
    savePatch({ description: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(90vh,44rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        data-testid="chat-task-peek-dialog"
      >
        <DialogTitle className="sr-only">{identifier}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("chat.link.peek_description")}
        </DialogDescription>

        {isLoading ? (
          <p className="px-6 py-10 text-body text-muted-foreground">{t("chat.link.loading")}</p>
        ) : null}

        {isError || (!isLoading && !task) ? (
          <p className="px-6 py-10 text-body text-muted-foreground">
            {t("tasks.detail.not_found")}
          </p>
        ) : null}

        {task ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-5 pr-14">
            <p className="mb-3 text-caption font-medium tracking-wide text-muted-foreground">
              {identifier}
            </p>

            <ChatTaskPeekFields workspaceId={workspaceId} task={task} />

            <input
              id={`chat-task-title-${task.id}`}
              aria-label={t("chat.link.title_label")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className={cn(
                "mt-4 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-display-sm font-bold leading-snug tracking-tight text-foreground outline-none",
                "placeholder:text-muted-foreground/60 hover:border-border/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
              )}
              placeholder={t("tasks.detail.title_placeholder")}
            />

            <textarea
              id={`chat-task-desc-${task.id}`}
              aria-label={t("tasks.description")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitDescription}
              rows={8}
              placeholder={t("tasks.detail.description_placeholder")}
              className={cn(
                "mt-3 min-h-40 w-full flex-1 resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-body leading-relaxed text-foreground outline-none",
                "placeholder:text-muted-foreground/70 hover:border-border/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
              )}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
