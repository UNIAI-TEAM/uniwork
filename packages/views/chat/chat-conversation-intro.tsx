"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * True once the history above which the intro sits has messages: the card
 * then folds to a one-line chip, as Telegram's "chat started" line, so the
 * start of a conversation does not take the top of every screen.
 */
export const ChatIntroCompactContext = createContext(false);

/**
 * Where a conversation begins: the room's mark, what this room is, who sees
 * it, and the one thing worth doing next. A centred card on the chat wall at
 * the top of the history while the room is empty; above a loaded history it
 * is one quiet line (ChatIntroCompactContext).
 */
export function ChatConversationIntro({
  mark,
  title,
  description,
  people,
  actions,
}: {
  mark: ReactNode;
  title: string;
  description: string;
  /** Who is here: faces and names, between the words and the actions (canvas). */
  people?: ReactNode;
  actions?: ReactNode;
}) {
  const compact = useContext(ChatIntroCompactContext);
  if (compact) {
    return (
      <section aria-label={title} className="my-3 flex justify-center">
        <h2 className="max-w-full truncate rounded-full bg-chat-chip px-3 py-1 text-caption font-semibold text-chat-chip-foreground shadow-chat-bubble">
          {title}
        </h2>
      </section>
    );
  }
  return (
    <section
      aria-label={title}
      className="mx-auto my-4 flex w-full max-w-md flex-col items-center gap-1 rounded-2xl bg-chat-bubble-other p-5 text-center shadow-chat-bubble"
    >
      <div className="mb-2">{mark}</div>
      <h2 className="font-display text-title font-bold text-balance text-foreground">{title}</h2>
      <p className="text-body text-pretty text-muted-foreground">{description}</p>
      {people ? <div className="mt-2.5 flex items-center justify-center gap-2">{people}</div> : null}
      {actions ? <div className="mt-3.5 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </section>
  );
}
