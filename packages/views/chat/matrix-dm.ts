import { ClientEvent, Preset, type MatrixClient, type Room } from "matrix-js-sdk";
import { isPrivateDmRoom } from "./matrix-room-kind";
import { waitForRoomInClient } from "./matrix-room-sync";

const TYPING_TIMEOUT_MS = 30_000;
const SYNC_WAIT_MS = 6_000;
const POST_CREATE_SYNC_MS = 4_000;

/** Serialize DM room creation per user-pair within one browser tab. */
const pendingCreates = new Map<string, Promise<string>>();

/** Wait until the Matrix client has completed its initial sync (only when needed). */
export async function waitForMatrixSync(client: MatrixClient, timeoutMs = SYNC_WAIT_MS): Promise<void> {
  if (client.getSyncState() === "PREPARED") return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      client.removeListener(ClientEvent.Sync, onSync);
      reject(new Error("matrix_sync_timeout"));
    }, timeoutMs);
    const onSync = (state: string) => {
      if (state === "PREPARED") {
        window.clearTimeout(timer);
        client.removeListener(ClientEvent.Sync, onSync);
        resolve();
      }
    };
    client.on(ClientEvent.Sync, onSync);
  });
}

function dmPairKey(userA: string, userB: string): string {
  return [userA, userB].sort().join("\u0000");
}

function dmRoomCandidates(client: MatrixClient, targetMatrixUserId: string, myMatrixUserId: string): Room[] {
  const fromAccount = readDirectRoomFromAccountData(client, targetMatrixUserId);
  const scanned = client.getRooms().filter((room) =>
    isPrivateDmRoom(room, myMatrixUserId, targetMatrixUserId),
  );
  const byId = new Map<string, Room>();
  for (const room of scanned) byId.set(room.roomId, room);
  if (fromAccount) {
    const accountRoom = client.getRoom(fromAccount);
    if (accountRoom && isPrivateDmRoom(accountRoom, myMatrixUserId, targetMatrixUserId)) {
      byId.set(fromAccount, accountRoom);
    }
  }
  return [...byId.values()];
}

function readDirectRoomFromAccountData(client: MatrixClient, targetMatrixUserId: string): string | null {
  const clientWithDm = client as MatrixClient & { getDMRoomForUserId?: (userId: string) => string | null };
  const fromHelper = clientWithDm.getDMRoomForUserId?.(targetMatrixUserId);
  if (fromHelper) return fromHelper;

  const direct = client.getAccountData("m.direct" as never)?.getContent() as Record<string, string[]> | undefined;
  const roomIds = direct?.[targetMatrixUserId];
  return roomIds?.[0] ?? null;
}

function isDmWithUser(room: Room, targetMatrixUserId: string, myMatrixUserId: string): boolean {
  return isPrivateDmRoom(room, myMatrixUserId, targetMatrixUserId);
}

type DmRoomScore = {
  messageCount: number;
  bothJoined: boolean;
  membershipRank: number;
  roomId: string;
};

function membershipRank(membership: string): number {
  if (membership === "join") return 2;
  if (membership === "invite") return 1;
  return 0;
}

function scoreDmRoom(room: Room, myMatrixUserId: string, targetMatrixUserId: string): DmRoomScore {
  const messageCount = room
    .getLiveTimeline()
    .getEvents()
    .filter((ev) => ev.getType() === "m.room.message").length;
  const joinedIds = new Set(room.getJoinedMembers().map((member) => member.userId));
  return {
    messageCount,
    bothJoined: joinedIds.has(myMatrixUserId) && joinedIds.has(targetMatrixUserId),
    membershipRank: membershipRank(room.getMyMembership()),
    roomId: room.roomId,
  };
}

/** Same comparison on every client — prevents split rooms after duplicate creates. */
export function compareDmRoomScore(a: DmRoomScore, b: DmRoomScore): number {
  if (a.messageCount !== b.messageCount) return b.messageCount - a.messageCount;
  if (a.messageCount === 0) return a.roomId.localeCompare(b.roomId);
  if (a.bothJoined !== b.bothJoined) return a.bothJoined ? -1 : 1;
  if (a.membershipRank !== b.membershipRank) return b.membershipRank - a.membershipRank;
  return a.roomId.localeCompare(b.roomId);
}

export function pickBestDmRoom(
  rooms: Room[],
  myMatrixUserId: string,
  targetMatrixUserId: string,
): Room | null {
  if (rooms.length === 0) return null;
  return rooms.reduce((best, room) => {
    const bestScore = scoreDmRoom(best, myMatrixUserId, targetMatrixUserId);
    const roomScore = scoreDmRoom(room, myMatrixUserId, targetMatrixUserId);
    return compareDmRoomScore(bestScore, roomScore) <= 0 ? best : room;
  });
}

export function findBestDmRoomId(
  client: MatrixClient,
  targetMatrixUserId: string,
  myMatrixUserId: string,
): string | null {
  const rooms = dmRoomCandidates(client, targetMatrixUserId, myMatrixUserId);
  return pickBestDmRoom(rooms, myMatrixUserId, targetMatrixUserId)?.roomId ?? null;
}

async function ensureJoined(client: MatrixClient, roomId: string): Promise<void> {
  const room = client.getRoom(roomId);
  const membership = room?.getMyMembership();
  if (membership === "invite") {
    await client.joinRoom(roomId);
  }
}

async function updateDirectAccountData(
  client: MatrixClient,
  targetMatrixUserId: string,
  roomId: string,
): Promise<void> {
  try {
    const raw = client.getAccountData("m.direct" as never)?.getContent() as Record<string, string[]> | undefined;
    const direct = { ...(raw ?? {}) };
    const existing = direct[targetMatrixUserId] ?? [];
    if (existing[0] === roomId) return;
    direct[targetMatrixUserId] = [roomId, ...existing.filter((id) => id !== roomId)];
    type SetDirectAccountData = (
      type: string,
      content: Record<string, string[]>,
    ) => ReturnType<MatrixClient["setAccountData"]>;
    await (client.setAccountData as SetDirectAccountData)("m.direct", direct);
  } catch {
    // Account data is an optimization; room scan still finds the canonical room.
  }
}

async function resolveExistingDmRoom(
  client: MatrixClient,
  targetMatrixUserId: string,
  myMatrixUserId: string,
): Promise<string | null> {
  let best = pickBestDmRoom(
    dmRoomCandidates(client, targetMatrixUserId, myMatrixUserId),
    myMatrixUserId,
    targetMatrixUserId,
  );
  if (best) return best.roomId;

  await waitForMatrixSync(client).catch(() => undefined);

  best = pickBestDmRoom(
    dmRoomCandidates(client, targetMatrixUserId, myMatrixUserId),
    myMatrixUserId,
    targetMatrixUserId,
  );
  return best?.roomId ?? null;
}

async function createCanonicalDmRoom(
  client: MatrixClient,
  targetMatrixUserId: string,
  myMatrixUserId: string,
): Promise<string> {
  const lockKey = dmPairKey(myMatrixUserId, targetMatrixUserId);
  const inflight = pendingCreates.get(lockKey);
  if (inflight) return inflight;

  const work = (async () => {
    const beforeCreate = await resolveExistingDmRoom(client, targetMatrixUserId, myMatrixUserId);
    if (beforeCreate) return beforeCreate;

    const created = await client.createRoom({
      preset: Preset.TrustedPrivateChat,
      is_direct: true,
      invite: [targetMatrixUserId],
    });

    await waitForRoomInClient(client, created.room_id).catch(() => undefined);
    await waitForMatrixSync(client, POST_CREATE_SYNC_MS).catch(() => undefined);

    const canonical =
      pickBestDmRoom(
        dmRoomCandidates(client, targetMatrixUserId, myMatrixUserId),
        myMatrixUserId,
        targetMatrixUserId,
      ) ?? client.getRoom(created.room_id);

    return canonical?.roomId ?? created.room_id;
  })();

  pendingCreates.set(lockKey, work);
  try {
    return await work;
  } finally {
    pendingCreates.delete(lockKey);
  }
}

/** Resolve or create a single canonical 1:1 Matrix room for two users. */
export async function resolveDmRoomId(
  client: MatrixClient,
  targetMatrixUserId: string,
  myMatrixUserId: string,
  cachedRoomId?: string | null,
): Promise<string> {
  if (cachedRoomId) void ensureJoined(client, cachedRoomId);

  const existingId = await resolveExistingDmRoom(client, targetMatrixUserId, myMatrixUserId);
  if (existingId) {
    await ensureJoined(client, existingId);
    await updateDirectAccountData(client, targetMatrixUserId, existingId);
    return existingId;
  }

  const createdOrMergedId = await createCanonicalDmRoom(client, targetMatrixUserId, myMatrixUserId);
  await ensureJoined(client, createdOrMergedId);
  await updateDirectAccountData(client, targetMatrixUserId, createdOrMergedId);
  return createdOrMergedId;
}

export function canSendMatrixTyping(client: MatrixClient, roomId: string): boolean {
  const room = client.getRoom(roomId);
  if (!room) return false;
  return room.getMyMembership() === "join";
}

export async function sendMatrixTyping(
  client: MatrixClient,
  roomId: string,
  isTyping: boolean,
): Promise<void> {
  if (!canSendMatrixTyping(client, roomId)) return;
  try {
    await client.sendTyping(roomId, isTyping, isTyping ? TYPING_TIMEOUT_MS : 0);
  } catch {
    // Best-effort: Synapse returns M_FORBIDDEN when membership is not "join" yet.
  }
}

export function listTypingMatrixUserIds(client: MatrixClient, roomId: string, myMatrixUserId: string): string[] {
  const room = client.getRoom(roomId);
  if (!room) return [];
  return room
    .getMembersWithMembership("join")
    .filter((member) => member.userId !== myMatrixUserId && member.typing)
    .map((member) => member.userId);
}

/** Test seam */
export function resetDmCreateLocksForTests(): void {
  pendingCreates.clear();
}
