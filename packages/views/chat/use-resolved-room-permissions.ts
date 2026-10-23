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
import { bypassesRoomPermissions, isChatRoomModerator } from "./chat-room-moderation-utils";

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
    const isModerator = isChatRoomModerator(currentUserId, members, wsRole, room);
    // The server lets fewer people past the permission flags than it lets moderate.
    const bypasses = bypassesRoomPermissions(currentUserId, members, room);
    const sendRestricted =
      members.find((member) => member.user_id === currentUserId)?.send_restricted ?? false;

    return {
      permissions,
      isModerator,
      canSendMessages: !isRoomSendBlocked(permissions, bypasses, sendRestricted),
      sendRestricted,
      canPinContent: canUseRoomPermission(permissions, bypasses, "allow_pin_content"),
      canChangeProfile: canUseRoomPermission(permissions, bypasses, "allow_change_profile"),
      canCreateNotes: canUseRoomPermission(permissions, bypasses, "allow_create_notes"),
      canCreatePolls: canUseRoomPermission(permissions, bypasses, "allow_create_polls"),
    };
  }, [currentUserId, members, room, wsRole]);
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
