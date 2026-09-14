"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

export type ThreadNavItem = {
  id: string;
  preview: string;
  replyCount: number;
  resolved: boolean;
};

/**
 * A row of chips for jumping between threads on a task. Below four threads,
 * scrolling the timeline by eye beats scanning a row of similar-looking
 * previews, and the row is pure cost — vertical space paid on every task
 * with a couple of threads, which is the common case, not the rare one. It
 * only starts earning its space once there are enough threads that they no
 * longer fit on one screen at a glance.
 */
export function ThreadNavPanel({
  threads,
  onJump,
}: {
  threads: ThreadNavItem[];
  onJump: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (threads.length < 4) return null;
  return (
    <nav
      aria-label={t("tasks.detail.thread_nav")}
      // The page's openThreadNav shortcut focuses the first chip through this
      // marker (hooks/use-task-detail-shortcuts.ts).
      data-thread-nav
      className="mb-3 flex flex-wrap gap-1.5"
    >
      {threads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          data-testid={`thread-nav-${thread.id}`}
          onClick={() => onJump(thread.id)}
          className={cn(
            "max-w-56 truncate rounded-full border border-border px-2.5 py-1 text-caption",
            thread.resolved ? "text-muted-foreground opacity-70" : "text-foreground",
          )}
        >
          {thread.preview}
          {thread.replyCount > 0 ? (
            <span className="ml-1 text-muted-foreground">
              {t("tasks.detail.thread_nav_replies", { count: thread.replyCount })}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
