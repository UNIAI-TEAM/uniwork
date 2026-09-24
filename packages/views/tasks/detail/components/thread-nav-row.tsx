"use client";

import { CheckCircle2, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { TaskActorAvatar } from "./task-actor-avatar";
import {
  formatStamp,
  highlightMatches,
  type ThreadDayGroup,
  type ThreadNavThread,
} from "./thread-nav-helpers";

type PreparedThread = {
  thread: ThreadNavThread;
  title: string;
  excerpt: string;
  authorName: string;
  group: ThreadDayGroup;
};

export function ThreadNavRow({
  prepared,
  isActive,
  optionId,
  query,
  onJump,
  onHover,
}: {
  prepared: PreparedThread;
  isActive: boolean;
  optionId: string;
  query: string;
  onJump: () => void;
  onHover: (threadId: string | null) => void;
}) {
  const { t } = useTranslation();
  const { thread, title, excerpt, authorName } = prepared;
  return (
    <button
      type="button"
      tabIndex={-1}
      role="option"
      id={optionId}
      aria-selected={isActive}
      data-thread-id={thread.id}
      data-testid={`thread-nav-${thread.id}`}
      data-active={isActive || undefined}
      onClick={onJump}
      onPointerEnter={() => onHover(thread.id)}
      onPointerLeave={() => onHover(null)}
      className={cn(
        "relative flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors",
        "hover:bg-surface-hover data-active:bg-surface-hover",
      )}
    >
      <TaskActorAvatar
        name={authorName}
        avatarUrl={thread.entry.author?.avatar_url ?? thread.entry.avatar_url}
        kind={thread.entry.author_kind}
        size="sm"
        className="mt-0.5 shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-body",
              thread.resolved ? "text-muted-foreground" : "font-medium text-foreground",
            )}
          >
            {highlightMatches(title, query)}
          </span>
          <span className="shrink-0 text-micro tabular-nums text-faint-foreground">
            {formatStamp(thread.entry.created_at, prepared.group)}
          </span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <span className="shrink-0">{authorName}</span>
          {thread.replyCount > 0 ? (
            <span className="flex shrink-0 items-center gap-0.5 tabular-nums text-faint-foreground">
              <MessageSquare className="size-3" aria-hidden />
              {thread.replyCount}
            </span>
          ) : null}
          {thread.resolved ? (
            <span className="flex shrink-0 items-center gap-0.5 text-success">
              <CheckCircle2 className="size-3" aria-hidden />
              {t("tasks.detail.comment_resolved")}
            </span>
          ) : null}
          {excerpt ? (
            <span className="min-w-0 truncate text-faint-foreground">
              {highlightMatches(excerpt, query)}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
