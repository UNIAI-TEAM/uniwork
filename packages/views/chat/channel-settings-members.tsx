"use client";

import { useState } from "react";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useTranslation } from "react-i18next";
import { useChatRoomMembers } from "@uniwork/core/chat";
import { useCurrentMember } from "@uniwork/core/permissions";
import type { ChatMemberMessageTarget } from "./chat-member-profile";
import { ChatRoomMemberActions } from "./chat-room-member-actions";
import {
  ChatMemberFace,
  ChatMemberListError,
  ChatMemberListSkeleton,
  ChatMemberRow,
  ChatSettingsCollapsibleSection,
} from "./chat-settings-ui";
import { useResolvedRoomPermissions } from "./use-resolved-room-permissions";
import { useRoomMemberModeration } from "./use-room-member-moderation";
import { lookupMemberAvatarUrl, type MemberAvatarUrlMap } from "./chat-member-avatar";

export function ChannelSettingsMembers({
  open,
  workspaceId,
  room,
  currentUserId,
  youLabel,
  memberAvatarByUserId = {},
  onMessage,
}: {
  open: boolean;
  workspaceId: string;
  room: ChatRoomRecord;
  currentUserId: string;
  youLabel: string;
  memberAvatarByUserId?: MemberAvatarUrlMap;
  onMessage?: (member: ChatMemberMessageTarget) => void;
}) {
  const { t } = useTranslation();
  const { data: members = [], isPending, isError, refetch } = useChatRoomMembers(workspaceId, room.id, open);
  const moderation = useRoomMemberModeration({ workspaceId, roomId: room.id });
  const currentMember = useCurrentMember(workspaceId);
  const roomPermissions = useResolvedRoomPermissions({
    room,
    members,
    currentUserId,
    wsRole: currentMember.role,
  });
  const isModerator = roomPermissions.isModerator;
  const [membersOpen, setMembersOpen] = useState(true);
  return (
    <ChatSettingsCollapsibleSection
      title={t("chat.channel.members_section")}
      summary={isPending || isError ? undefined : t("chat.channel.member_count", { count: members.length })}
      open={membersOpen}
      onOpenChange={setMembersOpen}
      flush
    >
      {isPending ? (
        <ChatMemberListSkeleton label={t("chat.members_loading")} />
      ) : isError ? (
        <ChatMemberListError onRetry={() => void refetch()} />
      ) : (
        <ul>
          {members.map((member) => {
            const isSelf = member.user_id === currentUserId;
            const label = isSelf ? youLabel : member.display_name.trim() || member.email || member.user_id;
            return (
              <ChatMemberRow
                key={member.user_id}
                avatar={
                  <ChatMemberFace
                    userId={member.user_id}
                    name={member.display_name.trim() || label}
                    avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, member.user_id)}
                  />
                }
                name={label}
                detail={member.role === "admin" ? t("chat.room_role_admin") : member.email}
                detailTone={member.role === "admin" ? "admin" : undefined}
                profile={{
                  userId: member.user_id,
                  email: member.email,
                  avatarUrl: lookupMemberAvatarUrl(memberAvatarByUserId, member.user_id),
                  onMessage:
                    !isSelf && onMessage
                      ? () =>
                          onMessage({
                            user_id: member.user_id,
                            email: member.email,
                            display_name: member.display_name.trim() || member.email,
                          })
                      : undefined,
                }}
                actions={
                  !isSelf && isModerator && member.role === "member" ? (
                    <ChatRoomMemberActions
                      label={label}
                      canPromote={false}
                      canDemote={false}
                      canMute={false}
                      canUnmute={false}
                      canKick
                      busy={moderation.busyUserId === member.user_id}
                      onPromote={() => undefined}
                      onDemote={() => undefined}
                      onMute={() => undefined}
                      onUnmute={() => undefined}
                      onKick={() =>
                        moderation.requestRemove(
                          member.user_id,
                          label,
                          t("chat.channel.kick_confirm", { name: label }),
                        )
                      }
                    />
                  ) : null
                }
              />
            );
          })}
        </ul>
      )}
      {moderation.confirmDialog}
    </ChatSettingsCollapsibleSection>
  );
}
