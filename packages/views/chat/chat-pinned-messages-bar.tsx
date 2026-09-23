"use client";

import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock,
  Megaphone,
  Phone,
  Pin,
  StickyNote,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatRoomMessages, useToggleChatMessagePin } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { describeChatMediaBody, type ChatMediaLabels } from "./chat-expression-utils";
import { CHAT_MESSAGE_INITIAL } from "./chat-messages";
import { toastChatError } from "./chat-error-message";

function pinnedPreviewText(
  row: ChatMessageRecord,
  voiceCallLabel: string,
  mediaLabels: ChatMediaLabels,
): string {
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
  const media = describeChatMediaBody(row.body, mediaLabels);
  if (media) return media;
  const text = deserializeMessageBodyToComposerDraft(row.body).replace(/\s+/g, " ").trim();
  if (text.length === 0) return "…";
  return [...text].length > 80 ? `${[...text].slice(0, 80).join("")}…` : text;
}

/** The same glyphs the composer's attach menu uses for each kind. */
function kindIcon(kind: string | undefined): LucideIcon {
  if (kind === "note") return StickyNote;
  if (kind === "post") return Megaphone;
  if (kind === "reminder") return Clock;
  if (kind === "poll") return BarChart3;
  if (kind === "voice_call_log") return Phone;
  return Pin;
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
  const mediaLabels = useMemo(
    () => ({ sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") }),
    [t],
  );
  const [expanded, setExpanded] = useState(false);

  const pinned = useMemo(
    () =>
      rows
        .filter((row) => row.pinned)
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          icon: kindIcon(row.kind),
          preview: pinnedPreviewText(row, voiceCallLabel, mediaLabels),
        }))
        .reverse(),
    [rows, voiceCallLabel, mediaLabels],
  );

  if (pinned.length === 0) return null;
  // Pins are read from the latest page only (no pinned-messages endpoint
  // yet); when that page is full, say how far back the bar looked.
  const windowFull = rows.length >= CHAT_MESSAGE_INITIAL;

  const visible = expanded || pinned.length === 1 ? pinned : pinned.slice(0, 1);
  const hiddenCount = pinned.length - 1;

  // Unpinning is one tap away from a mistake, so it says it happened and
  // offers the way back; a failure says so instead of leaving the pin as is.
  const handleUnpin = async (messageId: string) => {
    try {
      await togglePin.mutateAsync({ roomId, messageId });
    } catch (err) {
      toastChatError(err, t, t("chat.message_list.unpin_failed"));
      return;
    }
    toast.success(t("chat.message_list.unpinned"), {
      action: {
        label: t("chat.message_list.undo"),
        onClick: () => {
          togglePin.mutateAsync({ roomId, messageId }).catch((err: unknown) => {
            toastChatError(err, t, t("chat.message_list.pin_failed"));
          });
        },
      },
    });
  };

  return (
    <section className="shrink-0 border-b border-border bg-surface" aria-label={t("chat.pinned_bar_aria")}>
      {visible.map((item) => (
        <div
          key={item.id}
          className={cn(
            "flex items-center gap-2 px-2 py-1",
            visible.length > 1 && "border-b border-border last:border-b-0",
          )}
        >
          <button
            type="button"
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover pointer-coarse:min-h-11"
            aria-label={t("chat.pinned_bar_jump", { preview: item.preview })}
            title={windowFull ? t("chat.pinned_bar_window", { count: CHAT_MESSAGE_INITIAL }) : undefined}
            onClick={() => onJumpToMessage(item.id)}
          >
            <item.icon className="size-4 shrink-0 text-brand-subtle-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-caption text-foreground">{item.preview}</span>
          </button>
          {canPinMessages ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("chat.action_unpin")}
              disabled={togglePin.isPending}
              onClick={() => void handleUnpin(item.id)}
            >
              <X className="size-4" aria-hidden />
            </Button>
          ) : null}
          {!expanded && pinned.length > 1 && item.id === visible[0]?.id ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-foreground"
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
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <p className="px-2 text-caption text-muted-foreground">
            {windowFull ? t("chat.pinned_bar_window", { count: CHAT_MESSAGE_INITIAL }) : null}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground"
            aria-expanded={true}
            aria-label={t("chat.pinned_bar_show_less")}
            onClick={() => setExpanded(false)}
          >
            <ChevronUp className="size-4" aria-hidden />
            {t("chat.pinned_bar_show_less")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
