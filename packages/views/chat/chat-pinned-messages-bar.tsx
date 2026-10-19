"use client";

import {
  ChartColumn,
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
import { useEffect, useMemo, useState } from "react";
import { comparePinnedMessages } from "@uniwork/core/chat/pin-utils";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatRoomMessages, useToggleChatMessagePin } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { describeChatMediaBody, type ChatMediaLabels } from "./chat-expression-utils";
import { CHAT_MESSAGE_INITIAL } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import { stripInlineMarkdown } from "./chat-info-panel-utils";

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
  const text = stripInlineMarkdown(deserializeMessageBodyToComposerDraft(row.body)).replace(/\s+/g, " ").trim();
  if (text.length === 0) return "…";
  return [...text].length > 80 ? `${[...text].slice(0, 80).join("")}…` : text;
}

/** The same glyphs the composer's attach menu uses for each kind, on the card tints. */
const KIND: Record<string, { icon: LucideIcon; tile: string; ink: string; label: string }> = {
  note: { icon: StickyNote, tile: "bg-tint-yellow text-tint-yellow-foreground", ink: "text-tint-yellow-foreground", label: "chat.note_message_badge" },
  post: { icon: Megaphone, tile: "bg-tint-orange text-tint-orange-foreground", ink: "text-tint-orange-foreground", label: "chat.post_message_badge" },
  reminder: { icon: Clock, tile: "bg-tint-teal text-tint-teal-foreground", ink: "text-tint-teal-foreground", label: "chat.reminder_message_badge" },
  poll: { icon: ChartColumn, tile: "bg-tint-blue text-tint-blue-foreground", ink: "text-tint-blue-foreground", label: "chat.poll_message_badge" },
  voice_call_log: { icon: Phone, tile: "bg-tint-green text-tint-green-foreground", ink: "text-tint-green-foreground", label: "chat.voice_call_log_unknown" },
};
const PLAIN_PIN = { icon: Pin, tile: "bg-brand-subtle text-brand-subtle-foreground", ink: "text-brand", label: "chat.pinned_bar_kind_message" };

function kindOf(kind: string | undefined) {
  return (kind && KIND[kind]) || PLAIN_PIN;
}

/** 44px icon buttons at the end of a pin row. */
const ROW_ICON_BUTTON = "size-11 shrink-0 rounded-lg text-muted-foreground hover:text-foreground";

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
  // Which pin the collapsed bar shows; a tap jumps to it and moves on to the next older one.
  const [cursor, setCursor] = useState(0);

  const pinned = useMemo(
    () =>
      rows
        .filter((row) => row.pinned)
        .sort(comparePinnedMessages)
        .map((row) => ({
          id: row.id,
          ...kindOf(row.kind),
          preview: pinnedPreviewText(row, voiceCallLabel, mediaLabels),
        })),
    [rows, voiceCallLabel, mediaLabels],
  );

  const pinnedKey = pinned.map((row) => row.id).join(",");
  useEffect(() => {
    setCursor(0);
  }, [pinnedKey]);

  const position = pinned.length > 0 ? cursor % pinned.length : 0;
  const item = pinned[position];
  if (!item) return null;
  // Pins are read from the latest page only (no pinned-messages endpoint
  // yet); when that page is full, say how far back the bar looked.
  const windowFull = rows.length >= CHAT_MESSAGE_INITIAL;

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

  const unpinButton = (id: string) =>
    canPinMessages ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={ROW_ICON_BUTTON}
        aria-label={t("chat.action_unpin")}
        disabled={togglePin.isPending}
        onClick={() => void handleUnpin(id)}
      >
        <X className="size-4.5" aria-hidden />
      </Button>
    ) : null;
  const jumpTitle = windowFull ? t("chat.pinned_bar_window", { count: CHAT_MESSAGE_INITIAL }) : undefined;
  const jumpClass =
    "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 pr-2 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover";
  const kindTile = (item: (typeof pinned)[number]) => (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", item.tile)}>
      <item.icon className="size-4" aria-hidden />
    </span>
  );

  if (expanded) {
    return (
      <section
        className="shrink-0 border-b border-border bg-surface shadow-surface"
        aria-label={t("chat.pinned_bar_aria")}
      >
        {pinned.map((pin) => (
          <div key={pin.id} className="flex h-15 items-center gap-1 border-b border-border pr-2 pl-3 sm:pr-3 sm:pl-4">
            <button
              type="button"
              className={cn(jumpClass, "gap-3 pl-1")}
              aria-label={t("chat.pinned_bar_jump", { preview: pin.preview })}
              title={jumpTitle}
              onClick={() => onJumpToMessage(pin.id)}
            >
              {kindTile(pin)}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-caption font-semibold", pin.ink)}>{t(pin.label)}</span>
                <span className="truncate text-body text-foreground">{pin.preview}</span>
              </span>
            </button>
            {unpinButton(pin.id)}
          </div>
        ))}
        <div className="flex min-h-12 items-center justify-between gap-2 pr-2 pl-4 sm:pr-3 sm:pl-5">
          <p className="text-label text-muted-foreground tabular-nums">{jumpTitle}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8.5 shrink-0 gap-1.5 rounded-full pr-3.5 pl-2.5 text-muted-foreground"
            aria-expanded={true}
            aria-label={t("chat.pinned_bar_show_less")}
            onClick={() => setExpanded(false)}
          >
            <ChevronUp className="size-4" aria-hidden />
            {t("chat.pinned_bar_show_less")}
          </Button>
        </div>
      </section>
    );
  }

  // Collapsed (WebSearchPins, the pins board, over Main's plainer bar): one
  // segment per pin marking which one shows, its kind tile, "Tin ghim 1/3"
  // over its preview, unpin, and "+2" opening the rest.
  const more = pinned.length - 1;
  return (
    <section className="shrink-0 border-b border-border bg-surface" aria-label={t("chat.pinned_bar_aria")}>
      <div className="flex h-15 items-center gap-2.5 pr-1.5 pl-4">
        {more > 0 ? (
          <span aria-hidden className="flex h-10 w-0.75 shrink-0 flex-col gap-0.5">
            {pinned.map((pin) => (
              <span
                key={pin.id}
                className={cn("min-h-px flex-1 rounded-full", pin.id === item.id ? "bg-brand" : "bg-brand/20")}
              />
            ))}
          </span>
        ) : null}
        <button
          type="button"
          className={cn(jumpClass, "h-12")}
          aria-label={t("chat.pinned_bar_jump", { preview: item.preview })}
          title={jumpTitle}
          onClick={() => {
            onJumpToMessage(item.id);
            setCursor(position + 1);
          }}
        >
          {kindTile(item)}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-label font-semibold text-brand tabular-nums">
              {more > 0
                ? t("chat.pinned_bar_position", { current: position + 1, total: pinned.length })
                : t("chat.bulletin_tab_pinned")}
            </span>
            <span className="truncate text-body text-foreground">{item.preview}</span>
          </span>
        </button>
        {unpinButton(item.id)}
        {more > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8.5 shrink-0 gap-1 rounded-full pr-2 pl-3 font-semibold tabular-nums"
                  aria-expanded={false}
                  aria-label={t("chat.pinned_bar_more", { count: more })}
                  onClick={() => setExpanded(true)}
                />
              }
            >
              {`+${more}`}
              <ChevronDown className="size-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{t("chat.pinned_bar_more", { count: more })}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </section>
  );
}
