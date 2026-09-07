"use client";

import { useMemo } from "react";
import type { ChatRoomMemberPermissions, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatRoomMemberRecord } from "@uniwork/core/api/endpoints/chat";
import {
  canUseRoomPermission,
  isRoomSendBlocked,
  mergeRoomMemberPermissions,
} from "@uniwork/core/chat/room-permissions-utils";
import type { MemberRole } from "@uniwork/core/types/workspace";
import { isChatRoomModerator } from "./chat-room-moderation-utils";

export function useResolvedRoomPermissions({
  room,
  members,
  currentUserId,
  wsRole,
}: {
  room?: ChatRoomRecord | null;
  members: ChatRoomMemberRecord[];
  currentUserId: string;
  wsRole: MemberRole | null;
}): ResolvedRoomPermissions {
  return useMemo(() => {
    const permissions = mergeRoomMemberPermissions(room?.member_permissions);
    const isModerator = isChatRoomModerator(currentUserId, members, wsRole);
    const sendRestricted =
      members.find((member) => member.user_id === currentUserId)?.send_restricted ?? false;

    return {
      permissions,
      isModerator,
      canSendMessages: !isRoomSendBlocked(permissions, isModerator, sendRestricted),
      sendRestricted,
      canPinContent: canUseRoomPermission(permissions, isModerator, "allow_pin_content"),
      canChangeProfile: canUseRoomPermission(permissions, isModerator, "allow_change_profile"),
      canCreateNotes: canUseRoomPermission(permissions, isModerator, "allow_create_notes"),
      canCreatePolls: canUseRoomPermission(permissions, isModerator, "allow_create_polls"),
    };
  }, [currentUserId, members, room?.member_permissions, wsRole]);
}

type ResolvedRoomPermissions = {
  permissions: ChatRoomMemberPermissions;
  isModerator: boolean;
  canSendMessages: boolean;
  sendRestricted: boolean;
  canPinContent: boolean;
  canChangeProfile: boolean;
  canCreateNotes: boolean;
  canCreatePolls: boolean;
};
