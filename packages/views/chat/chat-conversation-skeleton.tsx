"use client";

import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";

/* Alternating sides and widths so the loading shape reads as a conversation,
   not a list — the same rhythm the real bubbles land in. */
const BUBBLES: Array<{ own: boolean; size: string }> = [
  { own: false, size: "h-14 w-56" },
  { own: false, size: "h-9 w-40" },
  { own: true, size: "h-14 w-64" },
  { own: false, size: "h-19 w-72" },
  { own: true, size: "h-9 w-32" },
];

/** Messages only: what the timeline shows while its first page loads. */
export function ChatMessagesSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col justify-end gap-4 px-4 py-4", className)} aria-busy>
      {BUBBLES.map((b, i) => (
        <div key={i} className={cn("flex items-end gap-2", b.own && "flex-row-reverse")}>
          {b.own ? null : <Skeleton className="size-8 shrink-0 rounded-full" />}
          <div className={cn("flex flex-col gap-1.5", b.own ? "items-end" : "items-start")}>
            {b.own ? null : <Skeleton className="h-3 w-20" />}
            <Skeleton className={cn("max-w-[70vw] rounded-2xl", b.size)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Header, messages and composer: a room that is still being opened. */
export function ChatConversationSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy>
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <ChatMessagesSkeleton className="min-h-0 flex-1" />
      <div className="border-t border-border bg-surface px-4 py-3">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}
