import type { MatrixClient } from "matrix-js-sdk";

/** Leave then forget a Matrix room — matches Element's hide-from-list flow. */
export async function leaveAndForgetRoom(client: MatrixClient, roomId: string): Promise<void> {
  const membership = client.getRoom(roomId)?.getMyMembership();
  if (membership === "join" || membership === "invite") {
    await client.leave(roomId);
  }
  await client.forget(roomId);
}
