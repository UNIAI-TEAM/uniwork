import type { ChatRoomMemberRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { MemberRole } from "@uniwork/core/types/workspace";

/** What the moderation rules read from a room; undefined while it loads. */
type ModeratedRoom = Pick<ChatRoomRecord, "kind" | "is_default"> | null | undefined;

function selfOf(currentUserId: string, members: ChatRoomMemberRecord[]): ChatRoomMemberRecord | undefined {
  return members.find((member) => member.user_id === currentUserId);
}

function isWorkspaceAdmin(wsRole: MemberRole | null): boolean {
  return wsRole === "owner" || wsRole === "admin";
}

/** Mirrors chat_moderation.go canModerateChatRoom: promote, mute, kick, invite to a channel, edit room permissions. */
export function isChatRoomModerator(
  currentUserId: string,
  members: ChatRoomMemberRecord[],
  wsRole: MemberRole | null,
  room: ModeratedRoom,
): boolean {
  const self = selfOf(currentUserId, members);
  if (self?.role === "admin") return true;
  if (room?.kind === "workspace" || (room?.kind === "channel" && room.is_default)) return isWorkspaceAdmin(wsRole);
  return (room?.kind === "group" || room?.kind === "channel") && self?.is_creator === true;
}

/** Mirrors chat_room_permissions.go memberCanPerformRoomAction: who ignores the room's member permission flags. */
export function bypassesRoomPermissions(
  currentUserId: string,
  members: ChatRoomMemberRecord[],
  room: ModeratedRoom,
): boolean {
  const self = selfOf(currentUserId, members);
  if (self?.role === "admin") return true;
  return room?.kind === "group" && self?.is_creator === true;
}

/** Mirrors chat_channels.go authorizeChannelAdmin: edit and archive a channel. */
export function canAdminChannel(
  currentUserId: string,
  members: ChatRoomMemberRecord[],
  wsRole: MemberRole | null,
): boolean {
  const self = selfOf(currentUserId, members);
  return self?.is_creator === true || self?.role === "admin" || isWorkspaceAdmin(wsRole);
}

export function canPromoteChatMember(target: ChatRoomMemberRecord, isModerator: boolean): boolean {
  return isModerator && target.role === "member";
}

/** Mirrors chat_moderation.go canDemoteChatAdmin, which the server checks after canModerateChatRoom. */
export function canDemoteChatMember(
  target: ChatRoomMemberRecord,
  currentUserId: string,
  members: ChatRoomMemberRecord[],
  wsRole: MemberRole | null,
  room: ModeratedRoom,
): boolean {
  if (target.role !== "admin" || target.user_id === currentUserId) return false;
  if (!isChatRoomModerator(currentUserId, members, wsRole, room)) return false;
  if (room?.kind === "group") return selfOf(currentUserId, members)?.is_creator === true && !target.is_creator;
  return isWorkspaceAdmin(wsRole);
}

export function canMuteChatMember(target: ChatRoomMemberRecord, isModerator: boolean): boolean {
  return isModerator && target.role === "member" && !target.send_restricted;
}

export function canUnmuteChatMember(target: ChatRoomMemberRecord, isModerator: boolean): boolean {
  return isModerator && target.send_restricted;
}
