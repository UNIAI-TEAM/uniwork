// The cache a cold start opens on (audit R5): the workspaces, the rooms list,
// the unread counts, nicknames and members, and the newest page of the rooms
// most recently active, written to the encrypted device store
// (storage/device-store.ts) and read back before the first screen, so the
// inbox is there at once, offline included, and every query refetches behind
// it as usual. Nothing else is kept: search, threads, older pages, tasks and
// the remote config are asked again. The copy belongs to one person and one
// cache schema (the buster is CACHE_SCHEMA_VERSION and the user id: another
// account, or a change of what a kept record means, reads nothing of it) and
// is removed on sign-out. A store update or an OTA keeps it, so what it reads
// goes through the current code's schemas first (data/persisted-cache.ts):
// nothing is hydrated by a cast.
//
// The disk is not a mirror of memory. TanStack drops a query nobody observes
// after its gcTime (10 minutes, query-client.ts), and a save writes what
// memory holds: a room read an hour ago would leave the disk on the next save.
// A kept query memory let go is carried from the last copy instead, until it
// is older than the copy's own limit or its room leaves the most recent ones
// (withEvicted). Each kept timeline is its own key, written only when it
// changed, so a frame in one room rewrites that room and the small envelope,
// not every room. Saves follow only a change of kept data (a fetch's answer,
// a patch) and wait a second after the last one, so a burst of realtime
// frames is one write.
import type { Query, QueryClient } from "@tanstack/react-query";
import { dehydrate } from "@tanstack/react-query";
import { persistQueryClientRestore, persistQueryClientSave, type PersistedClient, type Persister } from "@tanstack/query-persist-client-core";
import { z } from "zod";
import { createLogger } from "./logger";
import { CACHE_SCHEMA_VERSION, persistedRooms, readPersistedClient } from "./persisted-cache";
import type { DeviceStore } from "./storage/device-store";

/** The rooms whose newest page is kept: the most recently active ones. */
const PERSISTED_ROOM_TIMELINES = 24;
/** A copy, or a carried query, older than this is not worth showing. */
export const PERSISTED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PERSIST_THROTTLE_MS = 1_000;
const STORE_KEY = "query-cache";
/** One key per kept timeline: `query-cache/timeline/<queryHash>`. */
const TIMELINE_PREFIX = `${STORE_KEY}/timeline/`;

const log = createLogger("query-cache");

/** The keys a cold start opens on (the allowlist), whatever their state. */
function isPersistedKey(queryKey: readonly unknown[]): boolean {
  const [root, second, third] = queryKey;
  if (root === "workspaces") return queryKey.length === 1;
  if (root !== "chat") return false;
  if (second === "unread-summary") return queryKey.length === 2;
  if (queryKey.length === 3) return third === "rooms" || third === "nicknames" || third === "members";
  return queryKey.length === 4 && (third === "room-members" || third === "room-messages");
}

/** The queries a cold start opens on; only answers the server gave. */
export function shouldPersistQuery(query: Pick<Query, "queryKey" | "state">): boolean {
  return query.state.status === "success" && isPersistedKey(query.queryKey);
}

type DehydratedQuery = PersistedClient["clientState"]["queries"][number];

const lastActivity = (room: { last_message_at?: string | null }) => Date.parse(room.last_message_at ?? "") || 0;
const isTimeline = (query: DehydratedQuery) => query.queryKey[0] === "chat" && query.queryKey[2] === "room-messages";

/** The rooms of each workspace whose timeline is kept, newest activity first. */
function recentRoomIds(queries: readonly DehydratedQuery[], limit: number): Set<string> {
  const keep = new Set<string>();
  for (const query of queries) {
    const [root, wsId, kind] = query.queryKey;
    if (root !== "chat" || kind !== "rooms") continue;
    const rooms = persistedRooms(query.state.data).sort((a, b) => lastActivity(b) - lastActivity(a)).slice(0, limit);
    for (const room of rooms) keep.add(`${String(wsId)}/${room.id}`);
  }
  return keep;
}

/** One room's timeline as kept: its newest page only (chat-timeline.ts › RoomTimeline). */
function firstPageOnly(query: DehydratedQuery): DehydratedQuery {
  const { data } = query.state;
  if (data === null || typeof data !== "object") return query;
  const pages: unknown = Reflect.get(data, "pages");
  if (!Array.isArray(pages) || pages.length <= 1) return query;
  const pageParams: unknown = Reflect.get(data, "pageParams");
  return { ...query, state: { ...query.state, data: { pages: pages.slice(0, 1), pageParams: Array.isArray(pageParams) ? pageParams.slice(0, 1) : [] } } };
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

/**
 * The save of `client` with the kept queries memory has let go of since the
 * last copy (`kept`): carried as they were, unless older than the copy's own
 * limit. A query memory still holds is always memory's. Whether a carried
 * timeline stays is shapePersistedClient's call, like any other: a room that
 * left the most recent ones, or the list (a room left), goes.
 */
export function withEvicted(client: PersistedClient, kept: readonly DehydratedQuery[], now: number): PersistedClient {
  const live = new Set(client.clientState.queries.map((query) => query.queryHash));
  const evicted = kept.filter((query) => !live.has(query.queryHash) && now - query.state.dataUpdatedAt <= PERSISTED_CACHE_MAX_AGE_MS);
  if (evicted.length === 0) return client;
  return { ...client, clientState: { ...client.clientState, queries: [...client.clientState.queries, ...evicted] } };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// The envelope names the timeline keys it was written with; one written before they were split has none.
const TimelineKeysSchema = z.object({ timelines: z.array(z.string()) }).catch({ timelines: [] });
const EnvelopeQueriesSchema = z.looseObject({ clientState: z.looseObject({ queries: z.array(z.unknown()) }) });

/** The envelope with its timelines back among its queries, for one read through the schemas. */
function withTimelines(envelope: unknown, timelines: readonly unknown[]): unknown {
  const parsed = EnvelopeQueriesSchema.safeParse(envelope);
  if (!parsed.success) return envelope;
  const { clientState } = parsed.data;
  return { ...parsed.data, clientState: { ...clientState, queries: [...clientState.queries, ...timelines] } };
}

const timelineKeysIn = (store: DeviceStore) => store.keys().filter((key) => key.startsWith(TIMELINE_PREFIX));

/**
 * The persister over the device store: the envelope under one key, each kept
 * timeline under its own, rewritten only when it changed; read back through
 * the schemas, and a copy that does not read is dropped.
 */
export function createDevicePersister(open: () => Promise<DeviceStore>): Persister {
  // What each timeline key holds on disk now, as last written or read.
  const written = new Map<string, string>();
  return {
    persistClient: async (client) => {
      const store = await open();
      const shaped = shapePersistedClient(client);
      const timelines = shaped.clientState.queries.filter(isTimeline);
      const keys = new Set<string>();
      for (const query of timelines) {
        const key = `${TIMELINE_PREFIX}${query.queryHash}`;
        // The time of this dehydrate changes on every save and is never read back (persisted-cache.ts): not a change.
        const json = JSON.stringify(query, (field, value: unknown) => (field === "dehydratedAt" ? undefined : value));
        keys.add(key);
        if (written.get(key) === json) continue;
        store.set(key, json);
        written.set(key, json);
      }
      for (const key of timelineKeysIn(store)) {
        if (keys.has(key)) continue;
        store.remove(key);
        written.delete(key);
      }
      const envelope = { ...shaped, clientState: { mutations: [], queries: shaped.clientState.queries.filter((query) => !isTimeline(query)) }, timelines: [...keys] };
      store.set(STORE_KEY, JSON.stringify(envelope));
    },
    restoreClient: async () => {
      const store = await open();
      written.clear();
      const raw = store.getString(STORE_KEY);
      if (!raw) return undefined;
      const envelope = parseJson(raw);
      const timelines = TimelineKeysSchema.parse(envelope).timelines.flatMap((key) => {
        const json = key.startsWith(TIMELINE_PREFIX) ? store.getString(key) : undefined;
        if (json === undefined) return [];
        written.set(key, json);
        return [parseJson(json)];
      });
      const read = readPersistedClient(withTimelines(envelope, timelines));
      if (!read) {
        log.warn("cached rooms unreadable");
        return undefined;
      }
      if (read.dropped > 0) log.warn("cached queries dropped", { count: read.dropped });
      return read.client;
    },
    removeClient: async () => {
      const store = await open();
      for (const key of timelineKeysIn(store)) store.remove(key);
      written.clear();
      store.remove(STORE_KEY);
    },
  };
}

interface Installed {
  queryClient: QueryClient;
  persister: Persister;
}

let installed: Installed | null = null;
let stop: (() => void) | null = null;
// Every stop (a new restore, a reinstall, a sign-out) moves the generation on:
// a restore that started before it neither hydrates nor subscribes.
let generation = 0;
// A second restore for the same person while one runs (a sign-in's login() and
// the session's onChange both adopt the user) shares it instead of racing it.
let pending: { userId: string; run: Promise<void> } | null = null;

function stopWrites(): void {
  generation += 1;
  pending = null;
  stop?.();
  stop = null;
}

/** Boot (app/_layout.tsx): the app's client and the device store's persister. */
export function installAccountCache(next: Installed | null): void {
  stopWrites();
  installed = next;
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

async function restoreAndSubscribe(userId: string, { queryClient, persister }: Installed): Promise<void> {
  stopWrites();
  const mine = generation;
  const current = () => generation === mine;
  const buster = `${CACHE_SCHEMA_VERSION}:${userId}`;
  // A copy read after a stop is not hydrated: the person it was for may have signed out meanwhile.
  const guarded: Persister = {
    ...persister,
    restoreClient: async () => {
      const client = await persister.restoreClient();
      return current() ? client : undefined;
    },
  };
  try {
    await persistQueryClientRestore({ queryClient, persister: guarded, buster, maxAge: PERSISTED_CACHE_MAX_AGE_MS });
  } catch (error) {
    log.warn("cached rooms not restored", { error: errorName(error) });
  }
  if (!current()) return;
  // What the disk holds for this person: what the restore hydrated, then each save's copy.
  let kept = dehydrate(queryClient, { shouldDehydrateQuery: shouldPersistQuery }).queries;
  const carrying: Persister = {
    ...persister,
    persistClient: (client) => {
      const next = shapePersistedClient(withEvicted(client, kept, Date.now()));
      kept = next.clientState.queries;
      return persister.persistClient(next);
    },
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    persistQueryClientSave({ queryClient, persister: carrying, buster, dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery } }).catch((error: unknown) =>
      log.warn("cached rooms not saved", { error: errorName(error) }),
    );
  };
  // Only new data in a kept query is worth a write: not a fetch starting, an observer, or memory letting a query go.
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || !isPersistedKey(event.query.queryKey)) return;
    timer ??= setTimeout(save, PERSIST_THROTTLE_MS);
  });
  stop = () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/**
 * The signed-in person's copy into the cache (before the first screen), then
 * every change back to disk. Another person's copy, or one of another cache
 * schema, is removed instead; a copy that does not read is dropped and logged. At most
 * one subscription writes at a time, always the last restore's.
 */
export function restoreAccountCache(userId: string): Promise<void> {
  if (!installed) return Promise.resolve();
  if (pending?.userId === userId) return pending.run;
  const run: Promise<void> = restoreAndSubscribe(userId, installed).finally(() => {
    if (pending?.run === run) pending = null;
  });
  pending = { userId, run };
  return run;
}

/** Sign-out: no more writes, and the copy goes. */
export async function dropAccountCache(): Promise<void> {
  stopWrites();
  await installed?.persister.removeClient();
}
