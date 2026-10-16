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

/** `bypasses` is true for whoever chat_room_permissions.go memberCanPerformRoomAction lets past the flags. */
export function canUseRoomPermission(
  permissions: ChatRoomMemberPermissions,
  bypasses: boolean,
  key: ChatRoomPermissionKey,
): boolean {
  if (bypasses) return true;
  return permissions[key];
}

export function isRoomSendBlocked(
  permissions: ChatRoomMemberPermissions,
  bypasses: boolean,
  sendRestricted: boolean,
): boolean {
  if (sendRestricted) return true;
  return !canUseRoomPermission(permissions, bypasses, "allow_send_messages");
}
