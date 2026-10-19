"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRoomMemberRecord } from "@uniwork/core/api/endpoints/chat";
import { resolveChatNicknameForUser } from "@uniwork/core/chat/contacts-store";
import { usePresenceStore } from "@uniwork/core/chat/presence-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { cn } from "@uniwork/ui/lib/utils";
import { lookupMemberAvatarUrl, type MemberAvatarUrlMap } from "./chat-member-avatar";
import { initialsOf } from "./chat-initials";
import { ChatInfoLink, ChatInfoSection } from "./chat-info-panel-parts";
import { chatPersonFaceClass } from "./chat-person-card";
import { ChatPresenceAvatar } from "./chat-presence-avatar";

/** Members shown before "Xem tất cả". */
const MEMBER_PREVIEW = 4;

/** Online first (the caller counts as online), then the room's own order. */
export function previewMembers(
  members: readonly ChatRoomMemberRecord[],
  online: Record<string, true>,
  currentUserId: string,
  limit = MEMBER_PREVIEW,
): ChatRoomMemberRecord[] {
  const isOnline = (member: ChatRoomMemberRecord) =>
    member.user_id === currentUserId || Boolean(online[normalizeTypingUserId(member.user_id)]);
  return [...members.filter(isOnline), ...members.filter((member) => !isOnline(member))].slice(0, limit);
}

/**
 * "12 thành viên" and the first few of them — who is online now, then the
 * rest — with the full list (and its moderation) one tap away in settings.
 */
export function ChatInfoMembers({
  members,
  total,
  currentUserId,
  memberAvatarByUserId,
  nicknamesByUserId,
  onViewAll,
}: {
  members: readonly ChatRoomMemberRecord[];
  total: number;
  currentUserId: string;
  memberAvatarByUserId: MemberAvatarUrlMap;
  nicknamesByUserId: Record<string, string>;
  onViewAll: () => void;
}) {
  const { t } = useTranslation();
  const online = usePresenceStore((state) => state.onlineUserIds);
  const rows = useMemo(() => previewMembers(members, online, currentUserId), [members, online, currentUserId]);

  return (
    <ChatInfoSection
      className="pb-6"
      title={t("chat.group_member_count", { count: total })}
      action={<ChatInfoLink onClick={onViewAll}>{t("chat.info_panel.view_all")}</ChatInfoLink>}
    >
      <ul className="-mt-1">
        {rows.map((member) => {
          const self = member.user_id === currentUserId;
          const name = self
            ? t("chat.you")
            : resolveChatNicknameForUser(nicknamesByUserId, member.user_id) ||
              member.display_name.trim() ||
              member.email ||
              member.user_id;
          const isOnline = self || Boolean(online[normalizeTypingUserId(member.user_id)]);
          return (
            <li key={member.user_id} className="flex items-center gap-2.5 py-1.75">
              <ChatPresenceAvatar
                name={name}
                initials={initialsOf(self ? member.display_name.trim() || name : name)}
                avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, member.user_id)}
                size="fluid"
                avatarClassName={cn("size-9 text-caption", chatPersonFaceClass(member.user_id))}
                online={isOnline}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-medium text-foreground">{name}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {isOnline ? t("chat.presence_online") : member.email}
                </span>
              </span>
              {member.role === "admin" ? (
                <span className="shrink-0 text-caption font-semibold text-muted-foreground">
                  {t("chat.info_panel.role_admin")}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </ChatInfoSection>
  );
}
