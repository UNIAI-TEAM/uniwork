"use client";

import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CHAT_WALL } from "./chat-wall";

/* Alternating sides and widths so the loading shape reads as a conversation,
   not a list — the same rhythm the real bubbles land in. */
const BUBBLES: Array<{ own: boolean; size: string }> = [
  { own: false, size: "h-14 w-56" },
  { own: false, size: "h-9 w-40" },
  { own: true, size: "h-14 w-64" },
  { own: false, size: "h-19 w-72" },
  { own: true, size: "h-9 w-32" },
];

/* Shapes on the chat wall are a veil of the surface, not the muted grey that
   would vanish into it. */
const ON_WALL = "bg-surface/75";

/** Messages only: what the timeline (on the chat wall) shows while its first page loads. */
export function ChatMessagesSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col justify-end gap-3.5 px-4 py-4", className)} aria-busy>
      {BUBBLES.map((b, i) => (
        <div key={i} className={cn("flex items-end gap-2", b.own && "flex-row-reverse")}>
          {b.own ? null : <Skeleton className={cn("size-8 shrink-0 rounded-full", ON_WALL)} />}
          <div className={cn("flex flex-col gap-1.5", b.own ? "items-end" : "items-start")}>
            {b.own ? null : <Skeleton className={cn("h-3 w-20 rounded-full", ON_WALL)} />}
            <Skeleton
              className={cn(
                "max-w-[70vw] rounded-2xl",
                b.own ? "rounded-br-sm" : "rounded-bl-sm",
                ON_WALL,
                b.size,
              )}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Header, messages and composer: a room that is still being opened. The
 * shapes are hidden from assistive tech; one status line says what is going on.
 */
export function ChatConversationSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" className={cn("flex min-h-0 flex-1 flex-col", CHAT_WALL)}>
      <span className="sr-only">{t("common.loading")}</span>
      <div aria-hidden className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-36 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
        <Skeleton className="size-8 shrink-0 rounded-lg" />
        <Skeleton className="size-8 shrink-0 rounded-lg" />
      </div>
      <ChatMessagesSkeleton className="min-h-0 flex-1" />
      <div aria-hidden className="flex shrink-0 items-center gap-2 px-3 pt-1 pb-3">
        <Skeleton className={cn("size-11 shrink-0 rounded-full", ON_WALL)} />
        <Skeleton className={cn("h-11 flex-1 rounded-full", ON_WALL)} />
        <Skeleton className={cn("size-11 shrink-0 rounded-full", ON_WALL)} />
      </div>
    </div>
  );
}
