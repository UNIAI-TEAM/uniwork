import { ClientEvent, type MatrixClient, type Room } from "matrix-js-sdk";
import { isKnownGroupOrWorkspaceRoom, isPrivateDmRoom } from "./matrix-room-kind";

/** Wait until the room object exists on the client (avoids RTC/state race after createRoom). */
export async function waitForRoomInClient(
  client: MatrixClient,
  roomId: string,
  timeoutMs = 8_000,
): Promise<void> {
  if (client.getRoom(roomId)) return;

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      client.removeListener(ClientEvent.Room, onRoom);
      reject(new Error("room_sync_timeout"));
    }, timeoutMs);

    const onRoom = (room: Room) => {
      if (room.roomId !== roomId) return;
      window.clearTimeout(timer);
      client.removeListener(ClientEvent.Room, onRoom);
      resolve();
    };

    client.on(ClientEvent.Room, onRoom);
  });
}

export function isValidDmRoomId(
  client: MatrixClient,
  roomId: string | null | undefined,
  myMatrixUserId: string,
  targetMatrixUserId: string,
  workspaceRoomId: string | null,
): boolean {
  if (!roomId) return false;
  const room = client.getRoom(roomId);
  if (!room) return false;
  if (isKnownGroupOrWorkspaceRoom(room, myMatrixUserId, workspaceRoomId)) return false;
  return isPrivateDmRoom(room, myMatrixUserId, targetMatrixUserId);
}
