import type { ChatRoomMemberRecord } from "@uniwork/core/api/endpoints/chat";
import type { MemberRole } from "@uniwork/core/types/workspace";

export function isChatRoomModerator(
  currentUserId: string,
  members: ChatRoomMemberRecord[],
  wsRole: MemberRole | null,
): boolean {
  const self = members.find((member) => member.user_id === currentUserId);
  if (self?.role === "admin") return true;
  return wsRole === "owner" || wsRole === "admin";
}

export function canPromoteChatMember(target: ChatRoomMemberRecord, isModerator: boolean): boolean {
  return isModerator && target.role === "member";
}

export function canDemoteChatMember(
  target: ChatRoomMemberRecord,
  currentUserId: string,
  isModerator: boolean,
): boolean {
  return isModerator && target.role === "admin" && target.user_id !== currentUserId;
}

export function canMuteChatMember(target: ChatRoomMemberRecord, isModerator: boolean): boolean {
  return isModerator && target.role === "member" && !target.send_restricted;
}

export function canUnmuteChatMember(target: ChatRoomMemberRecord, isModerator: boolean): boolean {
  return isModerator && target.send_restricted;
}
