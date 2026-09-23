"use client";

import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
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
      <div aria-hidden className="hidden flex-col gap-3 border-r border-border p-3 lg:flex">
        <Skeleton className="h-8 w-full" />
        <div className="flex gap-1">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-12" />
        </div>
        {["w-2/3", "w-1/2", "w-3/4"].map((w) => (
          <div key={w} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="size-8 shrink-0 rounded-lg" />
            <Skeleton className={`h-3.5 ${w}`} />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <ChatConversationSkeleton />
      </div>
    </div>
  );
}
