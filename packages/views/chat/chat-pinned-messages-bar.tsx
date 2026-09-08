"use client";

import { Pin, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useChatRoomMessages, useToggleChatMessagePin } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { CHAT_MESSAGE_INITIAL } from "./chat-messages";

function pinnedPreviewText(body: string, voiceCallLabel: string, kind?: string): string {
  if (kind === "voice_call_log") return voiceCallLabel;
  const text = deserializeMessageBodyToComposerDraft(body).replace(/\s+/g, " ").trim();
  const preview =
    text.length === 0
      ? "…"
      : [...text].length > 80
        ? `${[...text].slice(0, 80).join("")}…`
        : text;
  if (kind === "note") return `📝 ${preview}`;
  if (kind === "reminder") return `⏰ ${preview}`;
  if (kind === "poll") return `📊 ${preview}`;
  return preview;
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

  const pinned = useMemo(
    () =>
      rows
        .filter((row) => row.pinned)
        .map((row) => ({
          id: row.id,
          preview: pinnedPreviewText(row.body, voiceCallLabel, row.kind),
        }))
        .reverse(),
    [rows, voiceCallLabel],
  );

  if (pinned.length === 0) return null;

  const handleUnpin = (messageId: string) => {
    void togglePin.mutateAsync({ roomId, messageId });
  };

  return (
    <div
      className="shrink-0 border-b border-border bg-surface/95"
      aria-label={t("chat.pinned_bar_aria")}
    >
      {pinned.map((item) => (
        <div
          key={item.id}
          className={cn(
            "flex items-center gap-2 px-2 py-1",
            pinned.length > 1 && "border-b border-border/60 last:border-b-0",
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
        </div>
      ))}
    </div>
  );
}
