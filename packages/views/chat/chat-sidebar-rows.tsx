"use client";

import { BellOff, Pin } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import {
  selectSidebarTypingUserIds,
  useSidebarTypingStore,
} from "@uniwork/core/chat/sidebar-typing-store";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import {
  formatChatSidebarPreviewText,
  formatChatSidebarTime,
} from "./chat-sidebar-preview";
import { formatSidebarTypingPreview } from "./chat-sidebar-typing";
import { SidebarTypingDots } from "./sidebar-typing-dots";

export function SidebarNavItem({
  active,
  onClick,
  avatar,
  title,
  fallbackSubtitle,
  preview,
  roomId = null,
  contacts = [],
  previewOptions,
  unread,
  mentionUnread = 0,
  unreadBadgesReady,
  pinned = false,
  notificationsMuted = false,
}: {
  active: boolean;
  onClick: () => void;
  avatar: ReactNode;
  title: string;
  fallbackSubtitle?: string;
  preview?: ChatRoomPreview;
  roomId?: string | null;
  contacts?: readonly ChatContact[];
  previewOptions: {
    currentUserId: string;
    isGroup: boolean;
    youLabel: string;
    voiceCallLabel: string;
    voiceMessageLabel: string;
    fileMessageLabel?: string;
    yesterdayLabel: string;
    nicknamesByUserId?: Record<string, string>;
  };
  unread: number;
  mentionUnread?: number;
  unreadBadgesReady: boolean;
  pinned?: boolean;
  notificationsMuted?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const typingUserIds = useSidebarTypingStore(
    useShallow((state) => selectSidebarTypingUserIds(state, roomId)),
  );
  const typingPreview = formatSidebarTypingPreview(typingUserIds, {
    isGroup: previewOptions.isGroup,
    t,
    locale: i18n.language,
    nicknamesByUserId: previewOptions.nicknamesByUserId,
    contacts,
  });
  const previewText = formatChatSidebarPreviewText(preview, {
    currentUserId: previewOptions.currentUserId,
    isGroup: previewOptions.isGroup,
    youLabel: previewOptions.youLabel,
    voiceCallLabel: previewOptions.voiceCallLabel,
    voiceMessageLabel: previewOptions.voiceMessageLabel,
    fileMessageLabel: previewOptions.fileMessageLabel,
    nicknamesByUserId: previewOptions.nicknamesByUserId,
    mediaLabels: {
      sticker: t("chat.media_sticker"),
      gif: t("chat.media_gif"),
      image: t("chat.media_image"),
    },
  });
  const timeLabel = formatChatSidebarTime(preview?.createdAt, {
    yesterdayLabel: previewOptions.yesterdayLabel,
    locale: i18n.language,
  });
  const subtitle = typingPreview ?? previewText ?? fallbackSubtitle;
  const hasUnread = unread > 0 || mentionUnread > 0;

  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      // The row publishes its fill as --row-fill so the presence dot's
      // cut-out ring matches whatever the row is painted with.
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-(--duration-fast)",
        active
          ? "bg-surface-selected text-surface-selected-foreground [--row-fill:var(--surface-selected)]"
          : "[--row-fill:var(--surface)] hover:bg-surface-hover hover:[--row-fill:var(--surface-hover)]",
      )}
      onClick={onClick}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-body font-medium text-foreground",
              hasUnread && "font-semibold",
            )}
          >
            {title}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {notificationsMuted ? (
              <BellOff
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t("chat.sidebar_conversation_muted_aria")}
              />
            ) : null}
            {timeLabel ? (
              <span
                className={cn(
                  "text-caption tabular-nums",
                  hasUnread && !notificationsMuted ? "font-medium text-brand-subtle-foreground" : "text-muted-foreground",
                )}
              >
                {timeLabel}
              </span>
            ) : null}
          </span>
        </span>
        {subtitle || pinned ? (
          <span className="mt-0.5 flex items-center gap-2">
            {subtitle ? (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-caption",
                  typingPreview
                    ? "inline-flex items-center gap-1.5 italic text-brand-subtle-foreground"
                    : hasUnread
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                )}
                aria-live={typingPreview ? "polite" : undefined}
              >
                {typingPreview ? (
                  <>
                    <span className="truncate">{typingPreview}</span>
                    <SidebarTypingDots />
                  </>
                ) : (
                  subtitle
                )}
              </span>
            ) : (
              <span className="min-w-0 flex-1" aria-hidden />
            )}
            {pinned ? (
              <Pin
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t("chat.sidebar_conversation_pinned_aria")}
              />
            ) : null}
          </span>
        ) : null}
      </span>
      <UnreadBadge
        count={unread}
        mentionCount={mentionUnread}
        ready={unreadBadgesReady}
        muted={notificationsMuted}
      />
    </button>
  );
}

const BADGE = "h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums";

/**
 * A mention is the one unread that asks for you, so it takes the warning
 * signal; a plain count is the brand. A muted room keeps its counts but drops
 * to neutral, so it no longer competes with rooms that notify.
 */
function UnreadBadge({
  count,
  mentionCount = 0,
  ready,
  muted = false,
}: {
  count: number;
  mentionCount?: number;
  ready: boolean;
  muted?: boolean;
}) {
  const { t } = useTranslation();
  if (!ready || (count <= 0 && mentionCount <= 0)) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-1 self-center">
      {mentionCount > 0 ? (
        <Badge
          className={cn(BADGE, "bg-warning-solid text-on-solid")}
          aria-label={t("chat.mention_unread_badge_aria", { count: mentionCount })}
        >
          @
        </Badge>
      ) : null}
      {count > 0 ? (
        <Badge
          className={cn(BADGE, muted ? "bg-muted text-muted-foreground" : "bg-brand text-brand-foreground")}
          aria-label={t("chat.unread_badge_aria", { count })}
        >
          {count > 99 ? "99+" : String(count)}
        </Badge>
      ) : null}
    </span>
  );
}
