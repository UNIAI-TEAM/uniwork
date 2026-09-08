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
    nicknamesByUserId: previewOptions.nicknamesByUserId,
  });
  const timeLabel = formatChatSidebarTime(preview?.createdAt, {
    yesterdayLabel: previewOptions.yesterdayLabel,
  });
  const subtitle = typingPreview ?? previewText ?? fallbackSubtitle;
  const hasUnread = unread > 0 || mentionUnread > 0;

  return (
    <button
      type="button"
      className={cn(
        "relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
        active ? "bg-brand/10 ring-1 ring-brand/20" : "hover:bg-muted/80",
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
              <span className="text-caption text-muted-foreground">{timeLabel}</span>
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
                    ? "inline-flex items-center gap-1.5 italic text-brand"
                    : hasUnread
                      ? "font-medium text-foreground/90"
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
      <UnreadBadge count={unread} mentionCount={mentionUnread} ready={unreadBadgesReady} />
    </button>
  );
}

function UnreadBadge({
  count,
  mentionCount = 0,
  ready,
}: {
  count: number;
  mentionCount?: number;
  ready: boolean;
}) {
  const { t } = useTranslation();
  if (!ready || (count <= 0 && mentionCount <= 0)) {
    return <span className="min-w-5 shrink-0" aria-hidden />;
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      {mentionCount > 0 ? (
        <Badge
          variant="default"
          className="min-w-5 shrink-0 rounded-full px-1.5 tabular-nums"
          aria-label={t("chat.mention_unread_badge_aria", { count: mentionCount })}
        >
          @
        </Badge>
      ) : null}
      {count > 0 ? (
        <Badge
          variant="default"
          className="min-w-5 shrink-0 rounded-full px-1.5 tabular-nums"
          aria-label={t("chat.unread_badge_aria", { count })}
        >
          {count > 99 ? "99+" : String(count)}
        </Badge>
      ) : null}
    </span>
  );
}
