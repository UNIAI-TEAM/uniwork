"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CircleCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUnlinkChatMessage } from "@uniwork/core/chat";
import { deserializeMessageBodyToComposerDraft } from "@uniwork/core/chat/chat-mention-utils";
import { taskLinksOf } from "@uniwork/core/chat/message-links";
import type { CardProperties } from "@uniwork/core/tasks/stores/view-store-types";
import { useProjects, useTask } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { StatusIcon } from "../tasks/icons/status-icon";
import { TaskBoardCardContent } from "../tasks/modes/board-card-content";
import { STATUS_CONFIG } from "../tasks/modes/status-config";
import { MODULE_ICONS } from "../layout/module-icons";
import { ConfirmDialog } from "../common/form-dialog";
import { ChatTaskPeekDialog } from "./chat-task-peek-dialog";
import { toastChatError } from "./chat-error-message";
import { useChatMessageLinksFor } from "./chat-message-links-context";
import { CHAT_BUBBLE_OTHER, CHAT_ON_BUBBLE_LINE, chatBubbleShape } from "./chat-message-row";

/** Same fields the board card shows when a task is embedded in chat. */
const CHAT_TASK_CARD_PROPERTIES: CardProperties = {
  priority: true,
  description: false,
  assignee: true,
  startDate: false,
  dueDate: true,
  project: true,
  childProgress: false,
  labels: false,
};

function MessageTaskLinkRow({
  workspaceId,
  messageId,
  taskId,
  linkId,
  canUnlink,
  compact = false,
}: {
  workspaceId: string;
  messageId: string;
  taskId: string;
  linkId: string;
  canUnlink: boolean;
  /** A task linked to (not made from) the message: one line under it (canvas). */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { data: task } = useTask(taskId);
  const { data: projectList } = useProjects(workspaceId);
  const unlink = useUnlinkChatMessage(workspaceId);
  const [peekOpen, setPeekOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Mentions in a legacy title read as @Name on the card and in the open label.
  const title = deserializeMessageBodyToComposerDraft(task?.title ?? t("chat.link.task_loading"));
  const displayTask = useMemo(() => {
    if (!task) return null;
    return title === task.title ? task : { ...task, title };
  }, [task, title]);
  const identifier = task?.identifier || task?.id.slice(0, 8);
  const openLabel = t("chat.link.open_task", { identifier, title });
  const projectName = useMemo(() => {
    if (!task?.project_id) return undefined;
    return projectList?.projects.find((project) => project.id === task.project_id)?.title;
  }, [projectList?.projects, task?.project_id]);

  const unlinkButton = canUnlink ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "shrink-0 text-muted-foreground hover:text-foreground",
        compact ? "size-11 rounded-xl" : "absolute top-1.5 right-1.5 z-10 size-7 rounded-lg pointer-coarse:size-11",
      )}
      aria-label={t("chat.message_list.unlink_named", { identifier: identifier ?? "", title })}
      disabled={unlink.isPending}
      onClick={() => setConfirmOpen(true)}
    >
      <X className={compact ? "size-4" : "size-3.5"} aria-hidden />
    </Button>
  ) : null;

  const confirmAndPeek = (
    <>
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

  if (compact) {
    return (
      <>
        <div
          className={cn(
            "flex h-13 w-115 max-w-full items-center gap-2.5 rounded-xl border bg-chat-bubble-other pl-2.5 shadow-chat-bubble",
            CHAT_ON_BUBBLE_LINE,
            canUnlink ? "pr-1" : "pr-3",
          )}
        >
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground"
            aria-hidden
          >
            <MODULE_ICONS.tasks className="size-4" />
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-md text-left text-body"
            aria-label={openLabel}
            onClick={() => setPeekOpen(true)}
          >
            {identifier ? <span className="text-muted-foreground tabular-nums">{`${identifier} · `}</span> : null}
            <span className="font-medium">{title}</span>
          </button>
          {task?.status ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.25 text-caption font-semibold",
                STATUS_CONFIG[task.status]?.iconColor,
              )}
            >
              <StatusIcon status={task.status} inheritColor className="size-3.5" />
              {t(`tasks.status_${task.status}`, { defaultValue: task.status })}
            </span>
          ) : null}
          {unlinkButton}
        </div>
        {confirmAndPeek}
      </>
    );
  }

  return (
    <>
      {/* Same surface as the board card: priority + id, title, project, assignee. */}
      <div className="relative" data-testid="message-task-board-card">
        <button
          type="button"
          className="group/card block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={openLabel}
          onClick={() => setPeekOpen(true)}
        >
          {displayTask ? (
            <TaskBoardCardContent
              task={displayTask}
              cardProperties={CHAT_TASK_CARD_PROPERTIES}
              meta={projectName ? { projectName } : undefined}
              reserveActionSpace={canUnlink}
            />
          ) : (
            <span
              className="flex flex-col gap-2 rounded-lg border-[0.5px] border-border bg-surface px-2.5 py-3"
              aria-busy
            >
              <span className="sr-only">{title}</span>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </span>
          )}
        </button>
        {unlinkButton}
      </div>
      {confirmAndPeek}
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
  // Only linked, none made from it: each task is one line under the message, whose time stays in its bubble (canvas).
  if (!created) {
    return (
      <div className={cn("flex max-w-full flex-col gap-1.5", isOwn && "items-end")} data-testid="message-task-card">
        {taskLinks.map((link) => (
          <MessageTaskLinkRow
            key={link.id}
            workspaceId={workspaceId}
            messageId={messageId}
            taskId={link.target_id}
            linkId={link.id}
            canUnlink={canUnlink}
            compact
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("flex w-85 max-w-full flex-col gap-1.5 px-2.5 py-2", chatBubbleShape(isOwn, false), CHAT_BUBBLE_OTHER)}
      data-testid="message-task-card"
    >
      <p className="flex items-center gap-1.5 px-0.5 text-label text-muted-foreground">
        <CircleCheck className="size-3.5 shrink-0" aria-hidden />
        {isOwn ? t("chat.link.card_created_from_yours") : t("chat.link.card_created_from_this")}
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
