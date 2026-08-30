import type { Room } from "matrix-js-sdk";

function roomMemberIds(room: Room): Set<string> {
  const joined = room.getJoinedMembers();
  const invited = room.getMembersWithMembership("invite");
  return new Set([...joined, ...invited].map((member) => member.userId));
}

function roomIsDirectFlag(room: Room): boolean | undefined {
  const createEvent = room.currentState.getStateEvents("m.room.create", "");
  const isDirect = createEvent?.getContent()?.is_direct;
  if (isDirect === true) return true;
  if (isDirect === false) return false;
  return undefined;
}

/** True for a canonical 1:1 DM — never a multi-person or explicit group room. */
export function isPrivateDmRoom(
  room: Room,
  myMatrixUserId: string,
  targetMatrixUserId?: string,
): boolean {
  const membership = room.getMyMembership();
  if (membership !== "join" && membership !== "invite") return false;

  const ids = roomMemberIds(room);
  if (!ids.has(myMatrixUserId)) return false;

  const others = [...ids].filter((id) => id !== myMatrixUserId);
  if (others.length !== 1) return false;
  if (targetMatrixUserId && others[0] !== targetMatrixUserId) return false;

  const isDirect = roomIsDirectFlag(room);
  if (isDirect === false) return false;
  if (isDirect === true) return true;

  // Legacy rooms without is_direct: only exactly two participants.
  return ids.size === 2;
}

/** Ad-hoc multi-person room (not workspace, not 1:1 DM). */
export function isAdHocGroupRoom(
  room: Room,
  myMatrixUserId: string,
  workspaceRoomId: string | null,
): boolean {
  if (workspaceRoomId && room.roomId === workspaceRoomId) return false;
  if (isPrivateDmRoom(room, myMatrixUserId)) return false;

  const membership = room.getMyMembership();
  if (membership !== "join" && membership !== "invite") return false;

  const ids = roomMemberIds(room);
  if (!ids.has(myMatrixUserId)) return false;

  return ids.size - 1 >= 1;
}

export function isKnownGroupOrWorkspaceRoom(
  room: Room | null | undefined,
  myMatrixUserId: string,
  workspaceRoomId: string | null,
): boolean {
  if (!room) return false;
  if (workspaceRoomId && room.roomId === workspaceRoomId) return true;
  return isAdHocGroupRoom(room, myMatrixUserId, workspaceRoomId);
}
