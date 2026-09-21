"use client";

import { useState } from "react";
import { ListTodo, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatMessageLinks, useUnlinkChatMessage } from "@uniwork/core/chat";
import { taskLinksOf } from "@uniwork/core/chat/message-links";
import { useTask } from "@uniwork/core/tasks";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";
import { StatusIcon } from "../tasks/icons/status-icon";
import { ChatTaskPeekDialog } from "./chat-task-peek-dialog";

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
  const title = task?.title ?? t("chat.link.task_loading");
  const identifier = task?.identifier || task?.id.slice(0, 8);
  const openLabel = t("chat.link.open_task", { identifier, title });

  return (
    <>
      {/* A linked task reads as a task everywhere: the tasks tint on its glyph,
          its identifier, and its status in the status's own words and icon. */}
      <div className="flex w-full max-w-full items-center gap-2 rounded-lg border border-border bg-surface py-1 pr-1 pl-2.5">
        <ListTodo className={cn("size-3.5 shrink-0", tintForegroundClass[moduleTone("tasks")])} aria-hidden />
        {task ? (
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-sm py-1 text-left text-caption font-medium text-foreground hover:underline"
            aria-label={openLabel}
            onClick={() => setPeekOpen(true)}
          >
            <span className="text-muted-foreground tabular-nums">{identifier}</span>
            <span className="mx-1 text-muted-foreground">·</span>
            <span>{title}</span>
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 py-1" aria-busy>
            <span className="sr-only">{title}</span>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 flex-1" />
          </span>
        )}
        {task?.status ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
            <StatusIcon status={task.status} className="size-3.5" />
            {t(`tasks.status_${task.status}`, { defaultValue: task.status })}
          </span>
        ) : null}
        {canUnlink ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t("chat.link.unlink")}
            disabled={unlink.isPending}
            onClick={() => {
              void unlink.mutateAsync({ messageId, linkId });
            }}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
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
  enabled = true,
  canUnlink = true,
  className,
}: {
  workspaceId: string;
  messageId: string;
  enabled?: boolean;
  canUnlink?: boolean;
  className?: string;
}) {
  const { data: links = [] } = useChatMessageLinks(workspaceId, messageId, enabled && !!messageId);
  const taskLinks = taskLinksOf(links);
  if (!enabled || taskLinks.length === 0) return null;

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
