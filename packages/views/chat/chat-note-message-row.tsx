"use client";

import { StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./chat-messages";
import { ChatCard } from "./chat-card";

type NotePayload = NonNullable<ChatMessage["note"]>;

export function ChatNoteMessageRow({
  note,
  senderLabel,
  senderId,
  isOwn,
  ts,
  showSenderName,
  compactTop,
}: {
  note: NotePayload;
  senderLabel: string;
  senderId?: string;
  isOwn?: boolean;
  ts?: number;
  showSenderName?: boolean;
  compactTop?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ChatCard
      icon={StickyNote}
      tone="yellow"
      label={t("chat.note_message_badge")}
      senderLabel={senderLabel}
      senderId={senderId}
      isOwn={isOwn}
      ts={ts}
      showSenderName={showSenderName}
      compactTop={compactTop}
    >
      <p className="whitespace-pre-wrap text-body leading-relaxed text-foreground text-pretty [overflow-wrap:anywhere]">
        {note.body}
      </p>
    </ChatCard>
  );
}
