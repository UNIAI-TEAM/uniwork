"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUnlinkChatMessage } from "@uniwork/core/chat";
import { taskLinksOf } from "@uniwork/core/chat/message-links";
import { useTask } from "@uniwork/core/tasks";
import { IconTile, tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { StatusIcon } from "../tasks/icons/status-icon";
import { STATUS_CONFIG } from "../tasks/modes/status-config";
import { ConfirmDialog } from "../common/form-dialog";
import { ChatTaskPeekDialog } from "./chat-task-peek-dialog";
import { toastChatError } from "./chat-error-message";
import { useChatMessageLinksFor } from "./chat-message-links-context";

function MessageTaskLinkRow({
  workspaceId,
  messageId,
  taskId,
  linkId,
  canUnlink,
}: {
  workspaceId: string;
  messageId: string;
  taskId: string;
  linkId: string;
  canUnlink: boolean;
}) {
  const { t } = useTranslation();
  const { data: task } = useTask(taskId);
  const unlink = useUnlinkChatMessage(workspaceId);
  const [peekOpen, setPeekOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const title = task?.title ?? t("chat.link.task_loading");
  const identifier = task?.identifier || task?.id.slice(0, 8);
  const openLabel = t("chat.link.open_task", { identifier, title });
  const statusTone = task?.status ? STATUS_CONFIG[task.status]?.tone : undefined;

  return (
    <>
      {/* A linked task reads as a task everywhere: the tasks tint on its glyph,
          its identifier, and its status in the status's own words and icon. */}
      <div className="flex min-h-12 w-full max-w-full items-center gap-2.5 rounded-lg border border-border bg-surface py-1 pr-1 pl-2.5 shadow-chat-bubble">
        <IconTile icon={MODULE_ICONS.tasks} tone={moduleTone("tasks")} size="sm" />
        {task ? (
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-sm py-1 text-left text-body text-foreground hover:underline"
            aria-label={openLabel}
            onClick={() => setPeekOpen(true)}
          >
            <span className="text-muted-foreground tabular-nums">{identifier}</span>
            <span className="mx-1 text-muted-foreground">·</span>
            <span className="font-medium">{title}</span>
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 py-1" aria-busy>
            <span className="sr-only">{title}</span>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 flex-1" />
          </span>
        )}
        {task?.status ? (
          <span
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-caption font-semibold",
              statusTone ? tintClass[statusTone] : "bg-muted text-muted-foreground",
            )}
          >
            <StatusIcon status={task.status} className="size-3.5" inheritColor />
            {t(`tasks.status_${task.status}`, { defaultValue: task.status })}
          </span>
        ) : null}
        {canUnlink ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label={t("chat.message_list.unlink_named", { identifier: identifier ?? "", title })}
            disabled={unlink.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("chat.message_list.unlink_confirm_title")}
        description={t("chat.message_list.unlink_confirm_description", { title })}
        confirmLabel={t("chat.link.unlink")}
        pending={unlink.isPending}
        onConfirm={() => {
          void unlink
            .mutateAsync({ messageId, linkId })
            .then(() => setConfirmOpen(false))
            .catch((err: unknown) => {
              setConfirmOpen(false);
              toastChatError(err, t, t("chat.message_list.unlink_failed"));
            });
        }}
      />
      <ChatTaskPeekDialog
        open={peekOpen}
        onOpenChange={setPeekOpen}
        workspaceId={workspaceId}
        taskId={taskId}
      />
    </>
  );
}

/** Compact task cards under a chat message when message↔task links exist. */
export function MessageTaskCard({
  workspaceId,
  messageId,
  className,
}: {
  workspaceId: string;
  messageId: string;
  className?: string;
}) {
  const { links, canUnlink } = useChatMessageLinksFor(messageId);
  const taskLinks = taskLinksOf(links);
  if (taskLinks.length === 0) return null;

  return (
    <div className={cn("mt-2 flex w-full flex-col gap-1.5", className)} data-testid="message-task-card">
      {taskLinks.map((link) => (
        <MessageTaskLinkRow
          key={link.id}
          workspaceId={workspaceId}
          messageId={messageId}
          taskId={link.target_id}
          linkId={link.id}
          canUnlink={canUnlink}
        />
      ))}
    </div>
  );
}
