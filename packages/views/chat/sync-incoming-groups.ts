import type { MatrixClient } from "matrix-js-sdk";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { defaultGroupName, isAdHocGroupRoom, readGroupMemberUserIds } from "./matrix-group";

export type ResolveChatProfile = (userId: string) => Promise<{
  user_id: string;
  email: string;
  display_name: string;
  matrix_user_id?: string;
} | null>;

/** Pull ad-hoc group rooms from Matrix sync into the local groups list. */
export async function syncIncomingGroupChats(
  client: MatrixClient,
  myMatrixUserId: string,
  workspaceRoomId: string | null,
  resolveProfile: ResolveChatProfile,
  upsert: (group: GroupChat) => void,
  newGroupFallback: string,
): Promise<void> {
  const groupRooms = client.getRooms().filter((room) =>
    isAdHocGroupRoom(room, myMatrixUserId, workspaceRoomId),
  );

  for (const room of groupRooms) {
    if (room.getMyMembership() === "invite") {
      try {
        await client.joinRoom(room.roomId);
      } catch {
        // Another tab may have joined already.
      }
    }
  }

  const seenRoomIds = new Set<string>();
  for (const room of groupRooms) {
    if (seenRoomIds.has(room.roomId)) continue;
    seenRoomIds.add(room.roomId);

    const memberUserIds = readGroupMemberUserIds(client, room.roomId, myMatrixUserId);
    if (memberUserIds.length === 0) continue;

    const matrixName = room.name?.trim();
    let groupName = matrixName && matrixName.length > 0 ? matrixName : "";

    if (!groupName) {
      const profiles = await Promise.all(memberUserIds.map((userId) => resolveProfile(userId)));
      const labels = profiles.map((profile, index) => {
        if (profile?.display_name?.trim()) return profile.display_name;
        if (profile?.email?.trim()) return profile.email;
        return memberUserIds[index] ?? "";
      });
      groupName = defaultGroupName(labels, newGroupFallback);
    }

    upsert({
      id: room.roomId,
      name: groupName,
      room_id: room.roomId,
      member_user_ids: memberUserIds,
    });
  }
}
