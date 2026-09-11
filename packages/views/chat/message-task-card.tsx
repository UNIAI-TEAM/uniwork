"use client";

import { useState } from "react";
import { ListTodo, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatMessageLinks, useUnlinkChatMessage } from "@uniwork/core/chat";
import { taskLinksOf } from "@uniwork/core/chat/message-links";
import { useTask } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
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
      <div
        className={cn(
          "flex w-full max-w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 shadow-sm",
        )}
      >
        <ListTodo className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-caption font-medium text-foreground hover:underline"
          aria-label={openLabel}
          onClick={() => setPeekOpen(true)}
        >
          <span className="text-muted-foreground">{identifier}</span>
          <span className="mx-1 text-muted-foreground">·</span>
          <span>{title}</span>
        </button>
        {task?.status ? (
          <span className="shrink-0 text-caption text-muted-foreground">{task.status}</span>
        ) : null}
        {canUnlink ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
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
    <div className={cn("mt-1 flex w-full flex-col gap-1", className)} data-testid="message-task-card">
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
