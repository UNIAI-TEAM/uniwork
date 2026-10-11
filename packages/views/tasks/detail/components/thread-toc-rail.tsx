"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useComments } from "@uniwork/core/tasks";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import {
  formatCommentDateTime,
  formatCommentTimeAgo,
} from "../../../comments/comment-time";
import { useTaskThreadNav } from "../thread-nav-context";
import { TaskActorAvatar } from "./task-actor-avatar";
import {
  buildThreadNavThreads,
  commentThreadPreview,
  type ThreadNavThread,
} from "./thread-nav-helpers";

const READING_LINE_OFFSET = 48;

/**
 * Compact comment table of contents pinned to the task's reading edge.
 * The header navigator remains the detailed/searchable surface; this rail is
 * the low-noise path for scanning and jumping while reading.
 */
export function ThreadTocRail({
  threads,
  scrollContainerEl,
  onJump,
  onHoverThread,
}: {
  threads: ThreadNavThread[];
  scrollContainerEl: HTMLElement | null;
  onJump: (threadId: string) => void;
  onHoverThread?: (threadId: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    threads[0]?.id ?? null,
  );
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!scrollContainerEl || threads.length === 0) return;

    const measure = () => {
      const readingLine = scrollContainerEl.getBoundingClientRect().top + READING_LINE_OFFSET;
      const anchors = new Map(
        [...scrollContainerEl.querySelectorAll<HTMLElement>("[data-thread-root-id]")].map(
          (element) => [element.dataset.threadRootId, element] as const,
        ),
      );
      let active = threads[0]?.id ?? null;
      for (const thread of threads) {
        const anchor = anchors.get(thread.id);
        if (!anchor) continue;
        if (anchor.getBoundingClientRect().top <= readingLine) active = thread.id;
        else break;
      }
      setActiveThreadId(active);
    };
    const scheduleMeasure = () => {
      if (frameRef.current !== undefined) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined;
        measure();
      });
    };

    measure();
    scrollContainerEl.addEventListener("scroll", scheduleMeasure, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(scrollContainerEl);
    if (scrollContainerEl.firstElementChild instanceof HTMLElement) {
      resizeObserver?.observe(scrollContainerEl.firstElementChild);
    }

    return () => {
      scrollContainerEl.removeEventListener("scroll", scheduleMeasure);
      resizeObserver?.disconnect();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, [scrollContainerEl, threads]);

  if (threads.length === 0) return null;

  return (
    <div
      data-testid="task-thread-toc-rail"
      className="pointer-events-none absolute top-12 right-3 bottom-0 z-10 flex flex-col justify-center py-6 pointer-coarse:hidden"
    >
      <nav
        aria-label={t("tasks.detail.thread_toc.label")}
        className="pointer-events-auto flex max-h-full flex-col overflow-hidden"
      >
        {threads.map((thread, index) => {
          const preview = commentThreadPreview(thread.entry.body ?? "");
          const label = [preview.title, preview.body].filter(Boolean).join(" — ") ||
            t("tasks.detail.thread_toc.comment_label", { index: index + 1 });
          const active = thread.id === activeThreadId;
          const authorName = thread.entry.author?.display_name ??
            thread.entry.display_name ??
            thread.entry.author_id;
          const locale = i18n.resolvedLanguage ?? i18n.language ?? "vi";
          const timeAgo = now === null
            ? null
            : formatCommentTimeAgo(thread.entry.created_at, locale, now);
          const exactTime = formatCommentDateTime(thread.entry.created_at, locale);
          return (
            <Tooltip
              key={thread.id}
              open={previewThreadId === thread.id}
              onOpenChange={(open) => {
                if (!open && previewThreadId === thread.id) setPreviewThreadId(null);
              }}
            >
              <TooltipTrigger
                render={(
                  <button
                    type="button"
                    aria-label={label}
                    aria-current={active ? "location" : undefined}
                    onClick={() => {
                      setActiveThreadId(thread.id);
                      onJump(thread.id);
                    }}
                    onPointerEnter={() => {
                      setPreviewThreadId(thread.id);
                      onHoverThread?.(thread.id);
                    }}
                    onPointerLeave={() => {
                      setPreviewThreadId(null);
                      onHoverThread?.(null);
                    }}
                    onFocus={() => {
                      setPreviewThreadId(thread.id);
                      onHoverThread?.(thread.id);
                    }}
                    onBlur={() => {
                      setPreviewThreadId(null);
                      onHoverThread?.(null);
                    }}
                    className="group/tick flex min-h-[5px] w-5 flex-[0_1_0.875rem] cursor-pointer items-center justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 w-3 origin-right rounded-full transition-[scale,background-color] duration-(--duration-fast) ease-out group-hover/tick:scale-x-[1.7] group-hover/tick:bg-foreground group-focus-visible/tick:scale-x-[1.7] group-focus-visible/tick:bg-foreground motion-reduce:transition-none",
                    active ? "bg-foreground/70" : "bg-muted-foreground/30",
                  )}
                />
              </TooltipTrigger>
              <TooltipContent
                data-testid={`thread-toc-preview-${thread.id}`}
                side="left"
                sideOffset={8}
                className="w-72 max-w-[min(18rem,calc(100vw-2rem))] flex-col items-stretch gap-2.5 p-3 text-left shadow-lg"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <TaskActorAvatar
                    name={authorName}
                    avatarUrl={thread.entry.author?.avatar_url ?? thread.entry.avatar_url}
                    kind={thread.entry.author_kind}
                    size="sm"
                    className="shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-foreground">{authorName}</span>
                    {timeAgo ? (
                      <time
                        dateTime={thread.entry.created_at}
                        title={exactTime ?? undefined}
                        className="text-micro text-muted-foreground"
                      >
                        {timeAgo}
                      </time>
                    ) : null}
                  </span>
                </span>
                <span className="line-clamp-3 whitespace-pre-wrap text-body text-foreground">
                  {label}
                </span>
                {thread.replyCount > 0 || thread.resolved ? (
                  <span className="flex items-center gap-3 text-caption text-muted-foreground">
                    {thread.replyCount > 0 ? (
                      <span className="flex items-center gap-1 tabular-nums">
                        <MessageSquare className="size-3.5" aria-hidden />
                        {t("tasks.detail.comment_reply_count", { count: thread.replyCount })}
                      </span>
                    ) : null}
                    {thread.resolved ? (
                      <span className="flex items-center gap-1 text-success">
                        <CircleCheck className="size-3.5" aria-hidden />
                        {t("tasks.detail.comment_resolved")}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </div>
  );
}

export function TaskDetailThreadTocRail({ taskId }: { taskId: string }) {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const comments = useComments(taskId);
  const { scrollContainerEl, jumpToThread, onHoverThread } = useTaskThreadNav();
  const threads = useMemo(
    () => buildThreadNavThreads(comments.data ?? [], currentUserId),
    [comments.data, currentUserId],
  );

  return (
    <ThreadTocRail
      threads={threads}
      scrollContainerEl={scrollContainerEl}
      onJump={jumpToThread}
      onHoverThread={onHoverThread}
    />
  );
}
