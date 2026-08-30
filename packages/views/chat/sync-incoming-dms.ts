import type { MatrixClient } from "matrix-js-sdk";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { isPlaceholderChatDisplayName } from "@uniwork/core/chat/contacts-store";
import { matrixLocalpart } from "@uniwork/core/chat/matrix-users";
import { findBestDmRoomId } from "./matrix-dm";
import { isAdHocGroupRoom, isPrivateDmRoom } from "./matrix-room-kind";
import { isValidDmRoomId } from "./matrix-room-sync";

export type ResolveChatProfile = (userId: string) => Promise<{
  user_id: string;
  email: string;
  display_name: string;
  matrix_user_id?: string;
} | null>;

function otherMatrixUserId(
  room: ReturnType<MatrixClient["getRooms"]>[number],
  myMatrixUserId: string,
): string | null {
  const joined = room.getJoinedMembers();
  const invited = room.getMembersWithMembership("invite");
  return (
    [...joined, ...invited].map((m) => m.userId).find((id) => id !== myMatrixUserId) ?? null
  );
}

function matrixMemberDisplayName(
  room: ReturnType<MatrixClient["getRooms"]>[number],
  matrixUserId: string,
  uniworkUserId: string,
): string | null {
  const member = room.getMember(matrixUserId);
  const name = member?.name?.trim();
  if (!name || name === matrixUserId) return null;
  if (isPlaceholderChatDisplayName(name, uniworkUserId)) return null;
  return name;
}

/** Clear dm_room_id when it incorrectly points at a group or workspace room. */
export function sanitizeContactDmRooms(
  client: MatrixClient,
  myMatrixUserId: string,
  workspaceRoomId: string | null,
  contacts: ChatContact[],
  upsert: (contact: ChatContact) => void,
): void {
  for (const contact of contacts) {
    if (!contact.dm_room_id || !contact.matrix_user_id) continue;
    if (
      isValidDmRoomId(
        client,
        contact.dm_room_id,
        myMatrixUserId,
        contact.matrix_user_id,
        workspaceRoomId,
      )
    ) {
      continue;
    }
    upsert({ ...contact, dm_room_id: undefined });
  }
}

/** Pull DM rooms from Matrix sync into the local contacts list (incoming messages). */
export async function syncIncomingDmContacts(
  client: MatrixClient,
  myMatrixUserId: string,
  workspaceRoomId: string | null,
  resolveProfile: ResolveChatProfile,
  upsert: (contact: ChatContact) => void,
  existingContacts: ChatContact[] = [],
): Promise<void> {
  const existingByUserId = new Map(
    existingContacts.map((contact) => [contact.user_id.toUpperCase(), contact]),
  );
  const dmRooms = client.getRooms().filter((room) => {
    if (workspaceRoomId && room.roomId === workspaceRoomId) return false;
    if (isAdHocGroupRoom(room, myMatrixUserId, workspaceRoomId)) return false;
    return isPrivateDmRoom(room, myMatrixUserId);
  });

  for (const room of dmRooms) {
    if (room.getMyMembership() === "invite") {
      try {
        await client.joinRoom(room.roomId);
      } catch {
        // Another tab may have joined already.
      }
    }
  }

  const seen = new Set<string>();
  for (const room of dmRooms) {
    const otherMatrixId = otherMatrixUserId(room, myMatrixUserId);
    if (!otherMatrixId || seen.has(otherMatrixId)) continue;
    seen.add(otherMatrixId);

    const roomId = findBestDmRoomId(client, otherMatrixId, myMatrixUserId);
    if (!roomId) continue;

    const resolvedRoom = client.getRoom(roomId);
    if (!resolvedRoom || !isPrivateDmRoom(resolvedRoom, myMatrixUserId, otherMatrixId)) continue;
    if (isAdHocGroupRoom(resolvedRoom, myMatrixUserId, workspaceRoomId)) continue;

    const uniworkUserId = matrixLocalpart(otherMatrixId).toUpperCase();
    const existing = existingByUserId.get(uniworkUserId);
    const matrixName = matrixMemberDisplayName(room, otherMatrixId, uniworkUserId);

    if (
      existing?.dm_room_id === roomId &&
      existing.email &&
      !isPlaceholderChatDisplayName(existing.display_name, uniworkUserId)
    ) {
      continue;
    }

    const profile =
      existing?.email && !isPlaceholderChatDisplayName(existing.display_name, uniworkUserId)
        ? {
            user_id: existing.user_id,
            email: existing.email,
            display_name: existing.display_name,
            matrix_user_id: existing.matrix_user_id ?? undefined,
          }
        : await resolveProfile(uniworkUserId);
    const resolvedName =
      profile?.display_name ??
      profile?.email ??
      matrixName ??
      uniworkUserId;

    upsert({
      user_id: profile?.user_id ?? uniworkUserId,
      email: profile?.email ?? "",
      display_name: resolvedName,
      matrix_user_id: profile?.matrix_user_id ?? otherMatrixId,
      dm_room_id: roomId,
    });
  }
}
