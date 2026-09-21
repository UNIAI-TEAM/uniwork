"use client";

import type { ReactNode } from "react";

/**
 * Where a conversation begins: the room's mark, what this room is, who sees
 * it, and the one thing worth doing next. Left-aligned at the top of the
 * history — an empty room reads as a starting point, and a room whose whole
 * history is loaded shows the same block above its first message.
 */
export function ChatConversationIntro({
  mark,
  title,
  description,
  actions,
}: {
  mark: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex max-w-xl flex-col items-start gap-3 pt-8 pb-6">
      {mark}
      <div className="space-y-1">
        <h2 className="text-title-lg font-semibold text-balance text-foreground">{title}</h2>
        <p className="text-body text-pretty text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
    </section>
  );
}
