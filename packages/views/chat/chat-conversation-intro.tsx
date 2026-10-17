"use client";

import type { ReactNode } from "react";

/**
 * Where a conversation begins: the room's mark, what this room is, who sees
 * it, and the one thing worth doing next. A centred card on the chat wall at
 * the top of the history — an empty room reads as a starting point, and a
 * room whose whole history is loaded shows the same card above its first
 * message.
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
    <section
      aria-label={title}
      className="mx-auto my-4 flex w-full max-w-md flex-col items-center gap-1 rounded-2xl bg-chat-bubble-other p-5 text-center shadow-chat-bubble"
    >
      <div className="mb-2">{mark}</div>
      <h2 className="font-display text-title font-bold text-balance text-foreground">{title}</h2>
      <p className="text-body text-pretty text-muted-foreground">{description}</p>
      {actions ? <div className="mt-3.5 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </section>
  );
}
