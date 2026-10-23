// Where this phone is in each workspace's chat change log: the `head` of the
// last sync answer it applied, per signed-in person and workspace, on the
// device store so a cold start asks only for what changed while the app was
// closed. Sign-out forgets them all (auth/store.ts › forgetAccountLocally).
import { openDeviceStore } from "../storage/device-store";

const PREFIX = "chat-sync/";
const keyOf = (userId: string, wsId: string) => `${PREFIX}${userId}/${wsId}`;

export interface ChatSyncHeads {
  get(userId: string, wsId: string): Promise<number | null>;
  set(userId: string, wsId: string, head: number): Promise<void>;
}

export const chatSyncHeads: ChatSyncHeads = {
  async get(userId, wsId) {
    const raw = (await openDeviceStore()).getString(keyOf(userId, wsId));
    // What the store hands back is untrusted: anything but a whole number is no head.
    const head = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    return Number.isSafeInteger(head) ? head : null;
  },
  async set(userId, wsId, head) {
    (await openDeviceStore()).set(keyOf(userId, wsId), String(head));
  },
};

/** Sign-out: every head of every account this phone kept. */
export async function forgetChatSyncHeads(): Promise<void> {
  const store = await openDeviceStore();
  for (const key of store.keys()) if (key.startsWith(PREFIX)) store.remove(key);
}
