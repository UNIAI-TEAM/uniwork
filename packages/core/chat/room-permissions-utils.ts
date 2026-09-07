import type { ChatRoomMemberPermissions } from "../api/endpoints/chat";

export const DEFAULT_CHAT_ROOM_MEMBER_PERMISSIONS: ChatRoomMemberPermissions = {
  allow_change_profile: true,
  allow_pin_content: true,
  allow_create_notes: true,
  allow_create_polls: true,
  allow_send_messages: true,
};

export type ChatRoomPermissionKey = keyof ChatRoomMemberPermissions;

export function mergeRoomMemberPermissions(
  permissions?: Partial<ChatRoomMemberPermissions> | null,
): ChatRoomMemberPermissions {
  return { ...DEFAULT_CHAT_ROOM_MEMBER_PERMISSIONS, ...permissions };
}

/** Room admins and workspace moderators bypass member permission flags. */
export function canUseRoomPermission(
  permissions: ChatRoomMemberPermissions,
  isModerator: boolean,
  key: ChatRoomPermissionKey,
): boolean {
  if (isModerator) return true;
  return permissions[key];
}

export function isRoomSendBlocked(
  permissions: ChatRoomMemberPermissions,
  isModerator: boolean,
  sendRestricted: boolean,
): boolean {
  if (sendRestricted) return true;
  return !canUseRoomPermission(permissions, isModerator, "allow_send_messages");
}
