"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useChatRoomMembers,
  useRemoveChatRoomMember,
} from "@uniwork/core/chat";
import { useCurrentMember } from "@uniwork/core/permissions";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { ChatRoomMemberActions } from "./chat-room-member-actions";
import { ChatSettingsCollapsibleSection } from "./chat-settings-ui";
import { useResolvedRoomPermissions } from "./use-resolved-room-permissions";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function ChannelSettingsMembers({
  open,
  workspaceId,
  roomId,
  currentUserId,
  youLabel,
}: {
  open: boolean;
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  youLabel: string;
}) {
  const { t } = useTranslation();
  const { data: members = [] } = useChatRoomMembers(workspaceId, roomId, open);
  const removeMember = useRemoveChatRoomMember(workspaceId);
  const currentMember = useCurrentMember(workspaceId);
  const roomPermissions = useResolvedRoomPermissions({
    members,
    currentUserId,
    wsRole: currentMember.role,
  });
  const isModerator = roomPermissions.isModerator;
  const [membersOpen, setMembersOpen] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const runKick = (userId: string, label: string) => {
    const confirmed = window.confirm(t("chat.channel.kick_confirm", { name: label }));
    if (!confirmed) return;
    setBusyUserId(userId);
    void removeMember.mutateAsync({ roomId, userId }).finally(() => setBusyUserId(null));
  };

  return (
    <ChatSettingsCollapsibleSection
      title={t("chat.channel.members_section")}
      summary={t("chat.channel.member_count", { count: members.length })}
      open={membersOpen}
      onOpenChange={setMembersOpen}
    >
      <ul className="space-y-2">
        {members.map((member) => {
          const isSelf = member.user_id === currentUserId;
          const label = isSelf
            ? youLabel
            : member.display_name.trim() || member.email || member.user_id;
          return (
            <li
              key={member.user_id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <ActorAvatar name={label} initials={initialOf(label)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-foreground">{label}</p>
                <p className="truncate text-caption text-muted-foreground">
                  {member.role === "admin" ? t("chat.room_role_admin") : member.email}
                </p>
              </div>
              {!isSelf && isModerator && member.role === "member" ? (
                <ChatRoomMemberActions
                  label={label}
                  canPromote={false}
                  canDemote={false}
                  canMute={false}
                  canUnmute={false}
                  canKick
                  busy={busyUserId === member.user_id}
                  onPromote={() => undefined}
                  onDemote={() => undefined}
                  onMute={() => undefined}
                  onUnmute={() => undefined}
                  onKick={() => runKick(member.user_id, label)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </ChatSettingsCollapsibleSection>
  );
}
