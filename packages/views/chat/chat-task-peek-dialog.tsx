"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useTask, useUpdateTask } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toastApiError } from "../toast-api-error";
import { FormDialogBody, FormDialogContent, FormDialogHeader } from "../common/form-dialog";
import { ChatTaskPeekFields, chatTaskTitleInput } from "./chat-task-peek-fields";

/** Placeholder in the shape of the peek: a row of chips, the title, the description. */
function PeekSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div className="flex flex-wrap gap-2" aria-hidden>
        {["w-24", "w-20", "w-20", "w-28", "w-24"].map((w, i) => (
          <Skeleton key={i} className={`h-8 rounded-full ${w}`} />
        ))}
      </div>
      <Skeleton className="h-8 w-2/3" aria-hidden />
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/** Task peek inside chat: editable chips, title and description, saved on blur. */
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
  const { data: task, isLoading, isError, error, refetch, isFetching } = useTask(taskId);
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

  // A 404 (or a 403, which the API answers as not found to non-members) means
  // the task is gone; anything else is a failed load the user can retry.
  const notFound =
    (isError && error instanceof ApiError && (error.status === 404 || error.status === 403)) ||
    (!isLoading && !isError && !task);
  const loadFailed = isError && !notFound;

  const identifier = task?.identifier?.trim() || task?.id.slice(0, 8) || t("chat.link.task_loading");

  const savePatch = (patch: { title?: string; description?: string }) => {
    if (!task) return;
    update.mutate(
      { taskId: task.id, patch },
      { onError: (err) => toastApiError(err, t("chat.link.save_error")) },
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
      <FormDialogContent size="lg" className="sm:max-w-2xl">
        <div data-testid="chat-task-peek-dialog" className="contents">
          <FormDialogHeader title={identifier} description={t("chat.link.peek_description")} />

          <FormDialogBody className="max-h-[min(80vh,44rem)] pb-6">
            {isLoading ? <PeekSkeleton label={t("chat.link.task_loading")} /> : null}

            {notFound ? (
              <p className="py-6 text-body text-muted-foreground">{t("tasks.detail.not_found")}</p>
            ) : null}

            {loadFailed ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-6">
                <p className="text-body text-foreground">{t("chat.link.task_load_error")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : null}

            {task ? (
              <>
                <ChatTaskPeekFields workspaceId={workspaceId} task={task} />

                <Input
                  id={`chat-task-title-${task.id}`}
                  aria-label={t("chat.link.title_label")}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  maxLength={200}
                  placeholder={t("tasks.detail.title_placeholder")}
                  className={chatTaskTitleInput}
                />

                <Textarea
                  id={`chat-task-desc-${task.id}`}
                  aria-label={t("tasks.description")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={commitDescription}
                  rows={8}
                  placeholder={t("tasks.detail.description_placeholder")}
                  className="min-h-40 resize-none border-transparent bg-transparent px-1 leading-relaxed hover:border-border dark:bg-transparent"
                />
              </>
            ) : null}
          </FormDialogBody>
        </div>
      </FormDialogContent>
    </Dialog>
  );
}
