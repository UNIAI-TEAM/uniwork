// The cache a cold start opens on (audit R5): the workspaces, the rooms list,
// the unread counts, nicknames and members, and the newest page of the rooms
// most recently active, written to the encrypted device store
// (storage/device-store.ts) and read back before the first screen, so the
// inbox is there at once, offline included, and every query refetches behind
// it as usual. Nothing else is kept: search, threads, older pages, tasks and
// the remote config are asked again. The copy belongs to one person on one
// build (the buster is the app version and the user id: another account or an
// update reads nothing of it) and is removed on sign-out. Saves wait a second
// after the last change, so a burst of realtime frames is one write.
import type { Query, QueryClient } from "@tanstack/react-query";
import { persistQueryClientRestore, persistQueryClientSave, type PersistedClient, type Persister } from "@tanstack/query-persist-client-core";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { createLogger } from "./logger";
import type { DeviceStore } from "./storage/device-store";

/** The rooms whose newest page is kept: the most recently active ones. */
const PERSISTED_ROOM_TIMELINES = 12;
/** A copy older than this is not worth showing. */
const PERSISTED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PERSIST_THROTTLE_MS = 1_000;
const STORE_KEY = "query-cache";

const log = createLogger("query-cache");

/** The queries a cold start opens on (the allowlist); only answers the server gave. */
export function shouldPersistQuery(query: Pick<Query, "queryKey" | "state">): boolean {
  if (query.state.status !== "success") return false;
  const [root, second, third] = query.queryKey;
  if (root === "workspaces") return query.queryKey.length === 1;
  if (root !== "chat") return false;
  if (second === "unread-summary") return query.queryKey.length === 2;
  if (query.queryKey.length === 3) return third === "rooms" || third === "nicknames" || third === "members";
  return query.queryKey.length === 4 && (third === "room-members" || third === "room-messages");
}

type DehydratedQuery = PersistedClient["clientState"]["queries"][number];

const lastActivity = (room: ChatRoomRecord) => Date.parse(room.last_message_at ?? "") || 0;

/** The rooms of each workspace whose timeline is kept, newest activity first. */
function recentRoomIds(queries: readonly DehydratedQuery[], limit: number): Set<string> {
  const keep = new Set<string>();
  for (const query of queries) {
    const [root, wsId, kind] = query.queryKey;
    if (root !== "chat" || kind !== "rooms" || !Array.isArray(query.state.data)) continue;
    const rooms = [...(query.state.data as ChatRoomRecord[])].sort((a, b) => lastActivity(b) - lastActivity(a)).slice(0, limit);
    for (const room of rooms) keep.add(`${String(wsId)}/${room.id}`);
  }
  return keep;
}

/** One room's timeline as kept: its newest page only (chat-timeline.ts › RoomTimeline). */
function firstPageOnly(query: DehydratedQuery): DehydratedQuery {
  const data = query.state.data as { pages?: unknown[]; pageParams?: unknown[] } | undefined;
  if (!data?.pages || data.pages.length <= 1) return query;
  return { ...query, state: { ...query.state, data: { pages: data.pages.slice(0, 1), pageParams: (data.pageParams ?? []).slice(0, 1) } } };
}

/** The copy written to disk: the timelines of the most recent rooms, each one page. */
export function shapePersistedClient(client: PersistedClient, limit = PERSISTED_ROOM_TIMELINES): PersistedClient {
  const { queries } = client.clientState;
  const recent = recentRoomIds(queries, limit);
  const kept = queries.flatMap((query) => {
    const [root, wsId, kind, roomId] = query.queryKey;
    if (root !== "chat" || kind !== "room-messages") return [query];
    return recent.has(`${String(wsId)}/${String(roomId)}`) ? [firstPageOnly(query)] : [];
  });
  return { ...client, clientState: { mutations: [], queries: kept } };
}

/** The persister over the device store: JSON under one key, unreadable copies dropped. */
export function createDevicePersister(open: () => Promise<DeviceStore>): Persister {
  return {
    persistClient: async (client) => (await open()).set(STORE_KEY, JSON.stringify(shapePersistedClient(client))),
    restoreClient: async () => {
      const raw = (await open()).getString(STORE_KEY);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as PersistedClient;
      } catch {
        return undefined;
      }
    },
    removeClient: async () => void (await open()).remove(STORE_KEY),
  };
}

interface Installed {
  queryClient: QueryClient;
  persister: Persister;
  version: string;
}

let installed: Installed | null = null;
let stop: (() => void) | null = null;

/** Boot (app/_layout.tsx): the app's client, the device store's persister and this build's version. */
export function installAccountCache(next: Installed | null): void {
  stop?.();
  stop = null;
  installed = next;
}

/**
 * The signed-in person's copy into the cache (before the first screen), then
 * every change back to disk. Another person's or another build's copy is
 * removed instead; a copy that does not read is dropped and logged.
 */
export async function restoreAccountCache(userId: string): Promise<void> {
  if (!installed) return;
  const { queryClient, persister, version } = installed;
  stop?.();
  const buster = `${version}:${userId}`;
  try {
    await persistQueryClientRestore({ queryClient, persister, buster, maxAge: PERSISTED_CACHE_MAX_AGE_MS });
  } catch (error) {
    log.warn("cached rooms not restored", { error: error instanceof Error ? error.name : typeof error });
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    persistQueryClientSave({ queryClient, persister, buster, dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery } }).catch((error: unknown) =>
      log.warn("cached rooms not saved", { error: error instanceof Error ? error.name : typeof error }),
    );
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "added" && event.type !== "removed" && event.type !== "updated") return;
    timer ??= setTimeout(save, PERSIST_THROTTLE_MS);
  });
  stop = () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** Sign-out: no more writes, and the copy goes. */
export async function dropAccountCache(): Promise<void> {
  stop?.();
  stop = null;
  await installed?.persister.removeClient();
}
