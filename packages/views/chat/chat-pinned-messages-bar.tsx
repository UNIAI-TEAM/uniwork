"use client";

import { ChevronDown, ChevronUp, Pin, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatRoomMessages, useToggleChatMessagePin } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { CHAT_MESSAGE_INITIAL } from "./chat-messages";

function pinnedPreviewText(row: ChatMessageRecord, voiceCallLabel: string): string {
  if (row.kind === "voice_call_log") return voiceCallLabel;
  if (row.kind === "post") {
    const title = row.post?.title?.trim();
    if (title) return title;
  }
  if (row.kind === "note" && row.note?.body) {
    return row.note.body.replace(/\s+/g, " ").trim() || "…";
  }
  if (row.kind === "poll" && row.poll?.question) {
    return row.poll.question.trim();
  }
  if (row.kind === "reminder" && row.reminder?.body) {
    return row.reminder.body.replace(/\s+/g, " ").trim() || "…";
  }
  const text = deserializeMessageBodyToComposerDraft(row.body).replace(/\s+/g, " ").trim();
  if (text.length === 0) return "…";
  return [...text].length > 80 ? `${[...text].slice(0, 80).join("")}…` : text;
}

function kindPrefix(kind: string | undefined): string {
  if (kind === "note") return "📝 ";
  if (kind === "post") return "📢 ";
  if (kind === "reminder") return "⏰ ";
  if (kind === "poll") return "📊 ";
  return "";
}

export function ChatPinnedMessagesBar({
  workspaceId,
  roomId,
  canPinMessages = false,
  onJumpToMessage,
}: {
  workspaceId: string;
  roomId: string;
  canPinMessages?: boolean;
  onJumpToMessage: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: rows = [] } = useChatRoomMessages(workspaceId, roomId, CHAT_MESSAGE_INITIAL);
  const togglePin = useToggleChatMessagePin(workspaceId);
  const voiceCallLabel = t("chat.sidebar_voice_call_preview");
  const [expanded, setExpanded] = useState(false);

  const pinned = useMemo(
    () =>
      rows
        .filter((row) => row.pinned)
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          preview: `${kindPrefix(row.kind)}${pinnedPreviewText(row, voiceCallLabel)}`,
        }))
        .reverse(),
    [rows, voiceCallLabel],
  );

  if (pinned.length === 0) return null;

  const visible = expanded || pinned.length === 1 ? pinned : pinned.slice(0, 1);
  const hiddenCount = pinned.length - 1;

  const handleUnpin = (messageId: string) => {
    void togglePin.mutateAsync({ roomId, messageId });
  };

  return (
    <div
      className="shrink-0 border-b border-border bg-surface/95"
      aria-label={t("chat.pinned_bar_aria")}
    >
      {visible.map((item) => (
        <div
          key={item.id}
          className={cn(
            "flex items-center gap-2 px-2 py-1",
            visible.length > 1 && "border-b border-border/60 last:border-b-0",
          )}
        >
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
              "hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none",
            )}
            aria-label={t("chat.pinned_bar_jump", { preview: item.preview })}
            onClick={() => onJumpToMessage(item.id)}
          >
            <Pin className="size-4 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-caption text-foreground">{item.preview}</span>
          </button>
          {canPinMessages ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("chat.action_unpin")}
              disabled={togglePin.isPending}
              onClick={() => handleUnpin(item.id)}
            >
              <X className="size-4" aria-hidden />
            </Button>
          ) : null}
          {!expanded && pinned.length > 1 && item.id === visible[0]?.id ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              aria-expanded={false}
              aria-label={t("chat.pinned_bar_show_more", { count: hiddenCount })}
              onClick={() => setExpanded(true)}
            >
              <ChevronDown className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
      {expanded && pinned.length > 1 ? (
        <div className="flex justify-end px-2 py-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-caption text-muted-foreground"
            aria-expanded={true}
            aria-label={t("chat.pinned_bar_show_less")}
            onClick={() => setExpanded(false)}
          >
            <ChevronUp className="size-4" aria-hidden />
            {t("chat.pinned_bar_show_less")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
