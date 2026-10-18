"use client";

import { useState, type ReactNode } from "react";
import { Calendar, CircleCheck, Link2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUnlinkChatMessage } from "@uniwork/core/chat";
import { taskLinksOf } from "@uniwork/core/chat/message-links";
import { useTask } from "@uniwork/core/tasks";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { STATUS_CONFIG } from "../tasks/modes/status-config";
import { ConfirmDialog } from "../common/form-dialog";
import { ChatTaskPeekDialog } from "./chat-task-peek-dialog";
import { toastChatError } from "./chat-error-message";
import { useChatMessageLinksFor } from "./chat-message-links-context";
import { CHAT_BUBBLE_OTHER, CHAT_ON_BUBBLE_HOVER, CHAT_ON_BUBBLE_LINE, chatBubbleShape } from "./chat-message-row";
import { formatTaskDue } from "./chat-info-panel-utils";
import { chatPersonFaceClass } from "./chat-person-card";
import { initialsOf } from "./chat-initials";

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
  const { t, i18n } = useTranslation();
  const { data: task } = useTask(taskId);
  const unlink = useUnlinkChatMessage(workspaceId);
  const [peekOpen, setPeekOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const title = task?.title ?? t("chat.link.task_loading");
  const identifier = task?.identifier || task?.id.slice(0, 8);
  const openLabel = t("chat.link.open_task", { identifier, title });
  const statusTone = task?.status ? STATUS_CONFIG[task.status]?.tone : undefined;

  const assignee = task?.assignee;
  return (
    <>
      {/* The task as a card inside the bubble: its title, who has it, when it
          is due and its status in the status's own words and tint (canvas). */}
      <div className={cn("relative rounded-xl border bg-muted/60 text-foreground dark:bg-foreground/8", CHAT_ON_BUBBLE_LINE)}>
        {task ? (
          <button
            type="button"
            className={cn("block w-full rounded-xl px-3 py-2.5 text-left", CHAT_ON_BUBBLE_HOVER, canUnlink && "pr-10")}
            aria-label={openLabel}
            onClick={() => setPeekOpen(true)}
          >
            <span className="block font-display text-body font-bold">{title}</span>
            <span className="mt-2 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              {assignee ? (
                <span className="inline-flex items-center gap-1.25">
                  <ActorAvatar
                    name={assignee.display_name}
                    initials={initialsOf(assignee.display_name)}
                    avatarUrl={assignee.avatar_url}
                    size="xs"
                    className={chatPersonFaceClass(assignee.id)}
                  />
                  {assignee.display_name}
                </span>
              ) : null}
              {task.due_date ? (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Calendar className="size-3.25" aria-hidden />
                  {formatTaskDue(task.due_date, i18n.language)}
                </span>
              ) : null}
              {task.status ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-semibold",
                    statusTone ? tintClass[statusTone] : "bg-muted text-muted-foreground",
                  )}
                >
                  {t(`tasks.status_${task.status}`, { defaultValue: task.status })}
                </span>
              ) : null}
            </span>
          </button>
        ) : (
          <span className="flex flex-col gap-2 px-3 py-2.5" aria-busy>
            <span className="sr-only">{title}</span>
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        )}
        {canUnlink ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1.5 right-1.5 size-7 rounded-lg text-muted-foreground hover:text-foreground pointer-coarse:size-11"
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

/**
 * The tasks made from (or linked to) a message, as one more bubble in the
 * sender's run under it: a line saying so, a card per task, and the run's
 * time at its foot (canvas).
 */
export function MessageTaskCard({
  workspaceId,
  messageId,
  isOwn = false,
  meta,
}: {
  workspaceId: string;
  messageId: string;
  /** The message is mine: "của bạn", and the bubble on my side. */
  isOwn?: boolean;
  /** The message's time and delivery state, moved here from the bubble above. */
  meta?: ReactNode;
}) {
  const { t } = useTranslation();
  const { links, canUnlink } = useChatMessageLinksFor(messageId);
  const taskLinks = taskLinksOf(links);
  if (taskLinks.length === 0) return null;
  const created = taskLinks.some((link) => link.relation === "created_from");
  const Icon = created ? CircleCheck : Link2;

  return (
    <div
      className={cn("flex w-85 max-w-full flex-col gap-1.5 px-2.5 py-2", chatBubbleShape(isOwn, false), CHAT_BUBBLE_OTHER)}
      data-testid="message-task-card"
    >
      <p className="flex items-center gap-1.5 px-0.5 text-label text-muted-foreground">
        <Icon className="size-3.75 shrink-0" aria-hidden />
        {created
          ? isOwn
            ? t("chat.link.card_created_from_yours")
            : t("chat.link.card_created_from_this")
          : t("chat.link.card_linked")}
      </p>
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
      {meta ? <div className="flex justify-end px-0.5">{meta}</div> : null}
    </div>
  );
}
