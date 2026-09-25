"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatRoomMembers } from "@uniwork/core/chat";
import { useCurrentMember } from "@uniwork/core/permissions";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { ChatRoomMemberActions } from "./chat-room-member-actions";
import {
  ChatMemberListError,
  ChatMemberListSkeleton,
  ChatMemberRow,
  ChatSettingsCollapsibleSection,
} from "./chat-settings-ui";
import { useResolvedRoomPermissions } from "./use-resolved-room-permissions";
import { useRoomMemberModeration } from "./use-room-member-moderation";
import { lookupMemberAvatarUrl, type MemberAvatarUrlMap } from "./chat-member-avatar";
import { initialOf } from "./chat-initials";

export function ChannelSettingsMembers({
  open,
  workspaceId,
  roomId,
  currentUserId,
  youLabel,
  memberAvatarByUserId = {},
}: {
  open: boolean;
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  youLabel: string;
  memberAvatarByUserId?: MemberAvatarUrlMap;
}) {
  const { t } = useTranslation();
  const { data: members = [], isPending, isError, refetch } = useChatRoomMembers(workspaceId, roomId, open);
  const moderation = useRoomMemberModeration({ workspaceId, roomId });
  const currentMember = useCurrentMember(workspaceId);
  const roomPermissions = useResolvedRoomPermissions({
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
                  <ActorAvatar
                    name={label}
                    initials={initialOf(label)}
                    avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, member.user_id)}
                    size="lg"
                  />
                }
                name={label}
                detail={member.role === "admin" ? t("chat.room_role_admin") : member.email}
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
