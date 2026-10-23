"use client";

import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { ChatConversationSkeleton } from "./chat-conversation-skeleton";

/**
 * The session is still being restored: draw the chat page's own frame — the
 * list column and an opening room — so nothing moves when it arrives.
 */
export function ChatPageAuthLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 w-full flex-1 bg-surface lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
      {/* The page keeps its one h1 while the session is restored. */}
      <h1 className="sr-only">{t("chat.title")}</h1>
      <div aria-hidden className="hidden flex-col border-r border-border lg:flex">
        <div className="flex items-center gap-2 pt-4 pr-3 pb-3 pl-5">
          <Skeleton className="h-6 w-32 flex-1 rounded-full" />
          <Skeleton className="size-10 shrink-0 rounded-lg" />
        </div>
        <div className="px-4 pb-1">
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
        <div className="flex h-11 items-center justify-around border-b border-border px-2.5">
          {["w-10", "w-9", "w-9", "w-9"].map((w, i) => (
            <Skeleton key={i} className={cn("h-3 rounded-full", w)} />
          ))}
        </div>
        <div className="p-2">
          {[
            { w: "w-2/3", mark: "rounded-xl" },
            { w: "w-1/2", mark: "rounded-full" },
            { w: "w-3/4", mark: "rounded-full" },
          ].map((row) => (
            <div key={row.w} className="flex h-17 items-center gap-3 px-3">
              <Skeleton className={cn("size-12 shrink-0", row.mark)} />
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <Skeleton className={cn("h-3.5 rounded-full", row.w)} />
                <Skeleton className="h-3 w-5/6 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatConversationSkeleton />
      </div>
    </div>
  );
}
