"use client";

import { BellOff, CheckCheck, Image as ImageIcon, Mic, Paperclip, Phone, Pin, type LucideIcon } from "lucide-react";
import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useChatComposerDraftStore } from "@uniwork/core/chat/composer-draft-store";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import {
  selectSidebarTypingUserIds,
  useSidebarTypingStore,
} from "@uniwork/core/chat/sidebar-typing-store";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import {
  chatSidebarPreviewIcon,
  formatChatSidebarPreviewText,
  formatChatSidebarTime,
  isMissedCallPreview,
} from "./chat-sidebar-preview";
import { formatSidebarTypingPreview } from "./chat-sidebar-typing";

export type SidebarPreviewOptions = {
  currentUserId: string;
  isGroup: boolean;
  youLabel: string;
  voiceCallLabel: string;
  voiceMessageLabel: string;
  missedCallLabel?: string;
  fileMessageLabel?: string;
  /** UNI-1966: the room's last message is a document card. */
  documentMessageLabel?: string;
  /** UNI-1966: "{{name}} đã tải lên phiên bản {{version}}" for the version line. */
  formatDocumentVersionLine?: (name: string, version: string) => string;
  yesterdayLabel: string;
  nicknamesByUserId?: Record<string, string>;
};

/**
 * One conversation row. Memoised: the sidebar re-renders on every unread
 * bump and presence change, and a row whose own props did not move should
 * not rebuild its preview line.
 */
export const SidebarNavItem = memo(function SidebarNavItem({
  active,
  onClick,
  rowIndex,
  tabIndex,
  onRowFocus,
  avatar,
  title,
  fallbackSubtitle,
  preview,
  roomId = null,
  contacts = [],
  typingNameByUserId,
  previewOptions,
  unread,
  mentionUnread = 0,
  unreadBadgesReady,
  pinned = false,
  notificationsMuted = false,
  peerReadAt,
  draftKey,
}: {
  active: boolean;
  onClick: () => void;
  /** Position in the list; the list's roving focus finds rows by it. */
  rowIndex?: number;
  /** Roving tabindex: only one row of the list is in the tab order. */
  tabIndex?: number;
  onRowFocus?: (rowIndex: number) => void;
  avatar: ReactNode;
  title: string;
  fallbackSubtitle?: string;
  preview?: ChatRoomPreview;
  roomId?: string | null;
  contacts?: readonly ChatContact[];
  typingNameByUserId?: Record<string, string>;
  previewOptions: SidebarPreviewOptions;
  unread: number;
  mentionUnread?: number;
  unreadBadgesReady: boolean;
  pinned?: boolean;
  notificationsMuted?: boolean;
  /** A DM's peer read pointer: the ✓✓ on my own last message once they saw it. */
  peerReadAt?: string;
  /** The conversation's composer draft key; an unsent draft shows as "Nháp:" while the row is not open. */
  draftKey?: string;
}) {
  const { t, i18n } = useTranslation();
  const typingUserIds = useSidebarTypingStore(
    useShallow((state) => selectSidebarTypingUserIds(state, roomId)),
  );
  // One string per row: a keystroke repaints the row whose draft it is, nothing else.
  const draft = useChatComposerDraftStore((state) => (draftKey && !active ? state.drafts[draftKey] : undefined));
  const draftLine = draft?.trim().split("\n")[0] ?? "";
  const typingPreview = formatSidebarTypingPreview(typingUserIds, {
    isGroup: previewOptions.isGroup,
    t,
    locale: i18n.language,
    nicknamesByUserId: previewOptions.nicknamesByUserId,
    contacts,
    fallbackNameByUserId: typingNameByUserId,
  });
  const formatOptions = {
    currentUserId: previewOptions.currentUserId,
    isGroup: previewOptions.isGroup,
    youLabel: previewOptions.youLabel,
    voiceCallLabel: previewOptions.voiceCallLabel,
    voiceMessageLabel: previewOptions.voiceMessageLabel,
    missedCallLabel: previewOptions.missedCallLabel,
    fileMessageLabel: previewOptions.fileMessageLabel,
    documentMessageLabel: previewOptions.documentMessageLabel,
    formatDocumentVersionLine: previewOptions.formatDocumentVersionLine,
    nicknamesByUserId: previewOptions.nicknamesByUserId,
    mediaLabels: {
      sticker: t("chat.media_sticker"),
      gif: t("chat.media_gif"),
      image: t("chat.sidebar_photo_preview"),
    },
  };
  const previewText = formatChatSidebarPreviewText(preview, formatOptions);
  // The sender ("Bạn: ", "Minh: ") is what the group line adds to the bare
  // body; split it off so it can carry the ink while the body stays quiet.
  const bodyText = previewOptions.isGroup
    ? formatChatSidebarPreviewText(preview, { ...formatOptions, isGroup: false })
    : previewText;
  const senderPrefix =
    previewText && bodyText && previewText !== bodyText && previewText.endsWith(bodyText)
      ? previewText.slice(0, previewText.length - bodyText.length)
      : "";
  const iconKind = previewText ? chatSidebarPreviewIcon(preview) : null;
  const missed = isMissedCallPreview(preview, previewOptions.currentUserId);
  const PreviewIcon = iconKind ? PREVIEW_ICONS[iconKind] : undefined;
  const timeLabel = formatChatSidebarTime(preview?.createdAt, {
    yesterdayLabel: previewOptions.yesterdayLabel,
    locale: i18n.language,
  });
  const subtitle = typingPreview ?? (draftLine || undefined) ?? previewText ?? fallbackSubtitle;
  const hasUnread = unread > 0 || mentionUnread > 0;
  const showBadges = unreadBadgesReady && hasUnread;
  const ownLast =
    !!preview && preview.senderId.trim().toUpperCase() === previewOptions.currentUserId.trim().toUpperCase();
  const seen = ownLast && !!peerReadAt && Date.parse(peerReadAt) >= Date.parse(preview.createdAt);
  // The open row is filled in the brand, as Telegram does: every line on it
  // takes the fill's foreground instead of its own colour.
  const quiet = active ? "text-primary-foreground/85" : "text-muted-foreground";
  const faint = active ? "text-primary-foreground/85" : "text-faint-foreground";

  return (
    <button
      type="button"
      data-chat-sidebar-row={rowIndex}
      tabIndex={tabIndex}
      onFocus={rowIndex === undefined || !onRowFocus ? undefined : () => onRowFocus(rowIndex)}
      aria-current={active ? "true" : undefined}
      // The row publishes its fill as --row-fill so the presence dot's
      // cut-out ring matches whatever the row is painted with.
      className={cn(
        "relative flex min-h-16 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-(--duration-fast)",
        // Folded to a column of faces: the face alone, its count on its corner.
        "@max-3xs/chatlist:justify-center @max-3xs/chatlist:px-0",
        active
          ? "bg-primary [--row-fill:var(--primary)]"
          : "[--row-fill:var(--surface)] hover:bg-surface-hover hover:[--row-fill:var(--surface-hover)]",
      )}
      // The folded column shows no names: the browser's tooltip gives it back on hover.
      title={title}
      onClick={onClick}
    >
      <span className="relative inline-flex shrink-0">
        {avatar}
        {showBadges ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-1.5 hidden h-4.5 min-w-4.5 items-center justify-center rounded-full border-2 border-(--row-fill) bg-primary px-1 text-micro font-bold text-primary-foreground tabular-nums @max-3xs/chatlist:flex"
          >
            {mentionUnread > 0 ? "@" : unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 @max-3xs/chatlist:hidden">
        <span className="flex items-center gap-1.25">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-body leading-5 font-semibold",
              active ? "text-primary-foreground" : "text-foreground",
            )}
          >
            {title}
          </span>
          {notificationsMuted ? (
            <BellOff className={cn("size-3.5 shrink-0", faint)} aria-label={t("chat.sidebar_conversation_muted_aria")} />
          ) : null}
          {seen ? (
            <CheckCheck
              className={cn("size-4 shrink-0", active ? "text-primary-foreground" : "text-brand")}
              strokeWidth={2.2}
              aria-label={t("chat.sidebar_seen_aria")}
            />
          ) : null}
          {timeLabel ? (
            <span
              className={cn(
                "shrink-0 text-caption tabular-nums",
                active ? quiet : hasUnread && !notificationsMuted ? "font-semibold text-brand" : "text-muted-foreground",
              )}
            >
              {timeLabel}
            </span>
          ) : null}
        </span>
        {subtitle || pinned || showBadges ? (
          <span className="flex items-center gap-1.5">
            {typingPreview ? (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-label font-medium",
                  active ? "text-primary-foreground" : "text-brand",
                )}
              >
                {typingPreview}
              </span>
            ) : draftLine ? (
              <span className={cn("min-w-0 flex-1 truncate text-label", quiet)}>
                <span className="font-medium text-destructive">{t("chat.sidebar_draft_label")}</span> {draftLine}
              </span>
            ) : previewText ? (
              <span
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1 text-label",
                  active ? quiet : missed ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {/* The trailing space stays in the text (names read "Minh: hi"); the flex gap draws it. */}
                {senderPrefix ? (
                  <span className={cn("shrink-0 font-medium", active ? "text-primary-foreground" : "text-foreground")}>
                    {senderPrefix}
                  </span>
                ) : null}
                {PreviewIcon ? (
                  <PreviewIcon
                    aria-hidden
                    // A missed call is red; any other call stays quiet.
                    className={cn(
                      "size-3.5 shrink-0",
                      active
                        ? "text-primary-foreground"
                        : iconKind !== "call"
                          ? "text-brand"
                          : missed
                            ? "text-destructive"
                            : "text-faint-foreground",
                    )}
                  />
                ) : null}
                <span className="min-w-0 truncate">{senderPrefix ? bodyText : previewText}</span>
              </span>
            ) : (
              <span className={cn("min-w-0 flex-1 truncate text-label", quiet)}>{subtitle}</span>
            )}
            <UnreadBadge
              count={unread}
              mentionCount={mentionUnread}
              ready={unreadBadgesReady}
              muted={notificationsMuted}
              onFill={active}
            />
            {pinned && !showBadges ? (
              <Pin className={cn("size-3.75 shrink-0 rotate-45", faint)} aria-label={t("chat.sidebar_conversation_pinned_aria")} />
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
});

/** Decorative: the preview text already names the kind ("Tin nhắn thoại", "Ảnh"). */
const PREVIEW_ICONS: Record<NonNullable<ReturnType<typeof chatSidebarPreviewIcon>>, LucideIcon> = {
  voice: Mic,
  call: Phone,
  image: ImageIcon,
  file: Paperclip,
};

const BADGE = "h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-caption font-semibold tabular-nums";
/* On the brand-filled open row the brand badge turns inside out. */
const BADGE_ON_FILL = "bg-primary-foreground text-primary";

/**
 * A mention is the one unread that asks for you: a brand "@" disc ahead of
 * the count, even in a muted room. A muted room's count drops to neutral
 * grey, so it no longer competes with rooms that notify.
 */
function UnreadBadge({
  count,
  mentionCount = 0,
  ready,
  muted = false,
  onFill = false,
}: {
  count: number;
  mentionCount?: number;
  ready: boolean;
  muted?: boolean;
  /** The row behind is the brand fill (the open conversation). */
  onFill?: boolean;
}) {
  const { t } = useTranslation();
  if (!ready || (count <= 0 && mentionCount <= 0)) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      {mentionCount > 0 ? (
        <Badge
          className={cn(BADGE, "px-0 text-label font-bold", onFill ? BADGE_ON_FILL : "bg-primary text-primary-foreground")}
          aria-label={t("chat.mention_unread_badge_aria", { count: mentionCount })}
        >
          @
        </Badge>
      ) : null}
      {count > 0 ? (
        <Badge
          className={cn(
            BADGE,
            onFill ? BADGE_ON_FILL : muted ? "bg-tint-gray-solid text-on-solid" : "bg-primary text-primary-foreground",
          )}
          aria-label={t("chat.unread_badge_aria", { count })}
        >
          {count > 99 ? "99+" : String(count)}
        </Badge>
      ) : null}
    </span>
  );
}
