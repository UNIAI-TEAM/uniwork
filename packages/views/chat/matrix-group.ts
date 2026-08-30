import { Preset, type MatrixClient, type Room } from "matrix-js-sdk";
import { memberSetKey } from "@uniwork/core/chat/groups-store";
import { matrixLocalpart } from "@uniwork/core/chat/matrix-users";
import { waitForMatrixSync } from "./matrix-dm";
import { isAdHocGroupRoom } from "./matrix-room-kind";
import { waitForRoomInClient } from "./matrix-room-sync";

export { isAdHocGroupRoom } from "./matrix-room-kind";

const POST_CREATE_SYNC_MS = 4_000;
const pendingCreates = new Map<string, Promise<string>>();

function roomMemberMatrixIds(room: Room): string[] {
  const joined = room.getJoinedMembers();
  const invited = room.getMembersWithMembership("invite");
  return [...new Set([...joined, ...invited].map((member) => member.userId))];
}

export function uniworkIdsFromMatrixMembers(
  matrixUserIds: string[],
  myMatrixUserId: string,
): string[] {
  return matrixUserIds
    .filter((id) => id !== myMatrixUserId)
    .map((id) => matrixLocalpart(id).toUpperCase())
    .sort();
}

export function groupMemberKeyFromMatrix(matrixUserIds: string[], myMatrixUserId: string): string {
  return memberSetKey(uniworkIdsFromMatrixMembers(matrixUserIds, myMatrixUserId));
}

function scoreGroupRoom(room: Room): { messageCount: number; membershipRank: number; roomId: string } {
  const messageCount = room
    .getLiveTimeline()
    .getEvents()
    .filter((ev) => ev.getType() === "m.room.message").length;
  const membership = room.getMyMembership();
  const membershipRank = membership === "join" ? 2 : membership === "invite" ? 1 : 0;
  return { messageCount, membershipRank, roomId: room.roomId };
}

function compareGroupScore(
  a: ReturnType<typeof scoreGroupRoom>,
  b: ReturnType<typeof scoreGroupRoom>,
): number {
  if (a.messageCount !== b.messageCount) return b.messageCount - a.messageCount;
  if (a.membershipRank !== b.membershipRank) return b.membershipRank - a.membershipRank;
  return a.roomId.localeCompare(b.roomId);
}

export function findGroupRoomId(
  client: MatrixClient,
  memberMatrixUserIds: string[],
  myMatrixUserId: string,
  workspaceRoomId: string | null,
): string | null {
  const targetKey = groupMemberKeyFromMatrix(memberMatrixUserIds, myMatrixUserId);
  let best: Room | null = null;

  for (const room of client.getRooms()) {
    if (!isAdHocGroupRoom(room, myMatrixUserId, workspaceRoomId)) continue;
    const roomKey = groupMemberKeyFromMatrix(roomMemberMatrixIds(room), myMatrixUserId);
    if (roomKey !== targetKey) continue;
    if (!best || compareGroupScore(scoreGroupRoom(room), scoreGroupRoom(best)) < 0) {
      best = room;
    }
  }

  return best?.roomId ?? null;
}

async function ensureJoined(client: MatrixClient, roomId: string): Promise<void> {
  const room = client.getRoom(roomId);
  if (room?.getMyMembership() === "invite") {
    await client.joinRoom(roomId);
  }
}

async function createGroupRoom(
  client: MatrixClient,
  name: string,
  inviteMatrixUserIds: string[],
  myMatrixUserId: string,
  workspaceRoomId: string | null,
): Promise<string> {
  const lockKey = groupMemberKeyFromMatrix(inviteMatrixUserIds, myMatrixUserId);
  const inflight = pendingCreates.get(lockKey);
  if (inflight) return inflight;

  const work = (async () => {
    const existing = findGroupRoomId(client, inviteMatrixUserIds, myMatrixUserId, workspaceRoomId);
    if (existing) return existing;

    const created = await client.createRoom({
      name: name.trim() || undefined,
      preset: Preset.PrivateChat,
      is_direct: false,
      invite: inviteMatrixUserIds,
    });

    await waitForRoomInClient(client, created.room_id).catch(() => undefined);
    await waitForMatrixSync(client, POST_CREATE_SYNC_MS).catch(() => undefined);

    return (
      findGroupRoomId(client, inviteMatrixUserIds, myMatrixUserId, workspaceRoomId) ?? created.room_id
    );
  })();

  pendingCreates.set(lockKey, work);
  try {
    return await work;
  } finally {
    pendingCreates.delete(lockKey);
  }
}

export async function resolveGroupRoomId(
  client: MatrixClient,
  options: {
    name: string;
    inviteMatrixUserIds: string[];
    myMatrixUserId: string;
    workspaceRoomId: string | null;
    cachedRoomId?: string | null;
  },
): Promise<string> {
  const { name, inviteMatrixUserIds, myMatrixUserId, workspaceRoomId, cachedRoomId } = options;

  if (cachedRoomId) {
    await ensureJoined(client, cachedRoomId);
    const cached = client.getRoom(cachedRoomId);
    if (cached && isAdHocGroupRoom(cached, myMatrixUserId, workspaceRoomId)) {
      return cachedRoomId;
    }
  }

  const existing = findGroupRoomId(client, inviteMatrixUserIds, myMatrixUserId, workspaceRoomId);
  if (existing) {
    await ensureJoined(client, existing);
    return existing;
  }

  if (cachedRoomId) {
    throw new Error("group_room_unavailable");
  }

  const created = await createGroupRoom(
    client,
    name,
    inviteMatrixUserIds,
    myMatrixUserId,
    workspaceRoomId,
  );
  await ensureJoined(client, created);
  return created;
}

export function readGroupMemberUserIds(
  client: MatrixClient,
  roomId: string,
  myMatrixUserId: string,
): string[] {
  const room = client.getRoom(roomId);
  if (!room) return [];
  return uniworkIdsFromMatrixMembers(roomMemberMatrixIds(room), myMatrixUserId);
}

export type GroupRoomMember = {
  matrixUserId: string;
  membership: "join" | "invite";
};

export function readGroupRoomMembers(client: MatrixClient, roomId: string): GroupRoomMember[] {
  const room = client.getRoom(roomId);
  if (!room) return [];
  const joined = room.getJoinedMembers().map((member) => ({
    matrixUserId: member.userId,
    membership: "join" as const,
  }));
  const invited = room.getMembersWithMembership("invite").map((member) => ({
    matrixUserId: member.userId,
    membership: "invite" as const,
  }));
  const byId = new Map<string, GroupRoomMember>();
  for (const member of [...joined, ...invited]) {
    byId.set(member.matrixUserId, member);
  }
  return [...byId.values()];
}

/** Invite more users into an existing group room — Matrix uses one room, not new DMs. */
export async function inviteMembersToGroupRoom(
  client: MatrixClient,
  roomId: string,
  inviteMatrixUserIds: string[],
): Promise<void> {
  await ensureJoined(client, roomId);
  const room = client.getRoom(roomId);
  if (!room) throw new Error("group_room_missing");

  const existing = new Set(roomMemberMatrixIds(room));
  for (const matrixUserId of inviteMatrixUserIds) {
    if (existing.has(matrixUserId)) continue;
    try {
      await client.invite(roomId, matrixUserId);
    } catch {
      // Already invited, lacks permission, or homeserver rejected — best effort.
    }
  }

  await waitForRoomInClient(client, roomId).catch(() => undefined);
  await waitForMatrixSync(client, POST_CREATE_SYNC_MS).catch(() => undefined);
}

export function defaultGroupName(
  labels: string[],
  fallback: string,
): string {
  const names = labels.map((label) => label.trim()).filter(Boolean);
  if (names.length === 0) return fallback;
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/** Test seam */
export function resetGroupCreateLocksForTests(): void {
  pendingCreates.clear();
}
