"use client";

import { StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";

type NotePayload = NonNullable<ChatMessage["note"]>;

export function ChatNoteMessageRow({
  note,
  senderLabel,
  showSenderName,
  compactTop,
}: {
  note: NotePayload;
  senderLabel: string;
  showSenderName?: boolean;
  compactTop?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <article className={cn("flex w-full max-w-full justify-center py-1", compactTop ? "pt-0.5" : "pt-3")}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
        {showSenderName ? (
          <p className="mb-1 text-caption font-medium text-brand">{senderLabel}</p>
        ) : null}

        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <StickyNote className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {t("chat.note_message_badge")}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-body font-semibold text-foreground">{note.body}</p>
          </div>
        </div>
      </div>
    </article>
  );
}
