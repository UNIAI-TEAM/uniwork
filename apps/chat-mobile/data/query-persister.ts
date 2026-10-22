// The cache a cold start opens on: the workspaces, the rooms list,
// the unread counts, nicknames and members, the newest page of the rooms
// most recently active and the first page (root and newest replies) of the
// threads last opened in them, written to the encrypted device store
// (storage/device-store.ts) and read back before the first screen, so the
// inbox is there at once, offline included, and every query refetches behind
// it as usual. Nothing else is kept: search, older pages and tasks are asked
// again (the remote config keeps its own copy, outside any account:
// data/remote-config.ts). The copy belongs to one person and one
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
// (withEvicted). A frame cannot reach a carried copy (it patches memory only),
// so an edit, a reaction or a delete for such a room takes the copy off the
// disk (dropCarriedTimeline): wrong is worse than missing, and the next open
// or background refresh reads it afresh. A restored query lives in memory as
// long as the copy may (PERSISTED_CACHE_MAX_AGE_MS), not the 10 minutes of
// the rest: nothing re-reads the disk on a memory miss, so an offline open an
// hour after a cold start would find nothing.
//
// Cost. Every kept query is its own key (a timeline under
// `query-cache/timeline/`, the rest under `query-cache/query/`), written only
// when its data changed: a query whose data is the same object with the same
// update time as last written (TanStack's structural sharing keeps it so) is
// not even stringified, so a frame in one room serializes that room and the
// small envelope, not a 1,000-person member list. Saves follow only a change
// of kept data (a fetch's answer, a patch) and wait a second after the last
// one, so a burst of realtime frames is one write. A cold start reads in two
// steps: the first screen's queries (workspaces, rooms, unread counts,
// nicknames) before the splash lifts, the rest (members, room members,
// timelines) just after it, off the splash's clock. A save in between never
// drops a copy not read back yet.
import type { Query, QueryClient } from "@tanstack/react-query";
import { dehydrate, hydrate } from "@tanstack/react-query";
import { persistQueryClientRestore, persistQueryClientSave, type PersistedClient, type Persister } from "@tanstack/query-persist-client-core";
import { z } from "zod";
import { createLogger } from "./logger";
import { CACHE_SCHEMA_VERSION, persistedRooms, readPersistedClient, readPersistedQueries } from "./persisted-cache";
import type { DeviceStore } from "./storage/device-store";

/** The rooms whose newest page is kept: the most recently active ones. */
const PERSISTED_ROOM_TIMELINES = 24;
/** The threads whose first page is kept: the last read ones, in those rooms. */
const PERSISTED_THREAD_TIMELINES = 12;
/** A copy, or a carried query, older than this is not worth showing. */
export const PERSISTED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PERSIST_THROTTLE_MS = 1_000;
const STORE_KEY = "query-cache";
/** One key per kept timeline: `query-cache/timeline/<queryHash>`. */
const TIMELINE_PREFIX = `${STORE_KEY}/timeline/`;
/** One key per other kept query: `query-cache/query/<queryHash>`. */
const QUERY_PREFIX = `${STORE_KEY}/query/`;
/** After the first screen's queries are back, how long the rest waits: the inbox draws first. */
export const RESTORE_LATER_MS = 100;

const log = createLogger("query-cache");

/** The keys a cold start opens on (the allowlist), whatever their state. */
function isPersistedKey(queryKey: readonly unknown[]): boolean {
  const [root, second, third] = queryKey;
  if (root === "workspaces") return queryKey.length === 1;
  if (root !== "chat") return false;
  if (second === "unread-summary") return queryKey.length === 2;
  if (queryKey.length === 3) return third === "rooms" || third === "nicknames" || third === "members";
  if (queryKey.length === 5) return third === "thread-messages";
  return queryKey.length === 4 && (third === "room-members" || third === "room-messages");
}

/** The queries a cold start opens on; only answers the server gave. */
export function shouldPersistQuery(query: Pick<Query, "queryKey" | "state">): boolean {
  return query.state.status === "success" && isPersistedKey(query.queryKey);
}

type DehydratedQuery = PersistedClient["clientState"]["queries"][number];

const lastActivity = (room: { last_message_at?: string | null }) => Date.parse(room.last_message_at ?? "") || 0;
const isTimeline = (query: DehydratedQuery) =>
  query.queryKey[0] === "chat" && (query.queryKey[2] === "room-messages" || query.queryKey[2] === "thread-messages");

/** The rooms of each workspace whose timeline is kept, newest activity first. */
function recentRoomIds(queries: readonly DehydratedQuery[], limit: number): Set<string> {
  const keep = new Set<string>();
  for (const query of queries) {
    const [root, wsId, kind] = query.queryKey;
    if (root !== "chat" || kind !== "rooms") continue;
    const rooms = persistedRooms(query.state.data)
      .sort((a, b) => lastActivity(b) - lastActivity(a))
      .slice(0, limit);
    for (const room of rooms) keep.add(`${String(wsId)}/${room.id}`);
  }
  return keep;
}

// The newest page cut from each timeline's data, kept while that data is the same object: an unchanged
// timeline hands the writer the same data every save, and the writer skips it without serializing it.
const firstPages = new WeakMap<object, { pages: unknown[]; pageParams: unknown[] }>();

/** One room's timeline as kept: its newest page only (chat-timeline.ts › RoomTimeline). */
function firstPageOnly(query: DehydratedQuery): DehydratedQuery {
  const { data } = query.state;
  if (data === null || typeof data !== "object") return query;
  const pages: unknown = Reflect.get(data, "pages");
  if (!Array.isArray(pages) || pages.length <= 1) return query;
  let first = firstPages.get(data);
  if (!first) {
    const pageParams: unknown = Reflect.get(data, "pageParams");
    first = { pages: pages.slice(0, 1), pageParams: Array.isArray(pageParams) ? pageParams.slice(0, 1) : [] };
    firstPages.set(data, first);
  }
  return { ...query, state: { ...query.state, data: first } };
}

/** The threads kept: of the recent rooms, the `limit` read most lately. */
function recentThreadHashes(queries: readonly DehydratedQuery[], recent: ReadonlySet<string>, limit: number): Set<string> {
  return new Set(
    queries
      .filter((query) => query.queryKey[2] === "thread-messages" && recent.has(`${String(query.queryKey[1])}/${String(query.queryKey[3])}`))
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
      .slice(0, limit)
      .map((query) => query.queryHash),
  );
}

/** The copy written to disk: the timelines of the most recent rooms and of their last read threads, each one page. */
export function shapePersistedClient(
  client: PersistedClient,
  limit = PERSISTED_ROOM_TIMELINES,
  threadLimit = PERSISTED_THREAD_TIMELINES,
): PersistedClient {
  const { queries } = client.clientState;
  const recent = recentRoomIds(queries, limit);
  const threads = recentThreadHashes(queries, recent, threadLimit);
  const kept = queries.flatMap((query) => {
    const [root, wsId, kind, roomId] = query.queryKey;
    if (root !== "chat") return [query];
    if (kind === "thread-messages") return threads.has(query.queryHash) ? [firstPageOnly(query)] : [];
    if (kind !== "room-messages") return [query];
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

// The envelope names the keys it was written with: `first` read before the splash lifts, `later` after.
// One written before queries had their own keys holds them inside it, with `timelines` for the timelines.
const EnvelopeKeysSchema = z
  .object({ first: z.array(z.string()).catch([]), later: z.array(z.string()).catch([]), timelines: z.array(z.string()).catch([]) })
  .catch({ first: [], later: [], timelines: [] });
const EnvelopeQueriesSchema = z.looseObject({ clientState: z.looseObject({ queries: z.array(z.unknown()) }) });

/** The envelope with `queries` added among its own, for one read through the schemas. */
function withQueries(envelope: unknown, queries: readonly unknown[]): unknown {
  const parsed = EnvelopeQueriesSchema.safeParse(envelope);
  if (!parsed.success) return envelope;
  const { clientState } = parsed.data;
  return { ...parsed.data, clientState: { ...clientState, queries: [...clientState.queries, ...queries] } };
}

const isOwnKey = (key: string) => key.startsWith(TIMELINE_PREFIX) || key.startsWith(QUERY_PREFIX);
const ownKeysIn = (store: DeviceStore) => store.keys().filter(isOwnKey);

/** The queries a cold start's first screen draws: the inbox. Members, room members and timelines come after. */
function isFirstScreen(query: DehydratedQuery): boolean {
  const [root, , kind] = query.queryKey;
  return root === "workspaces" || query.queryKey[1] === "unread-summary" || kind === "rooms" || kind === "nicknames";
}

const keyOf = (query: DehydratedQuery) => `${isTimeline(query) ? TIMELINE_PREFIX : QUERY_PREFIX}${query.queryHash}`;

// What a key holds on disk, and the data and update time it was written from (none when read back from disk).
interface Written {
  json: string;
  data?: unknown;
  updatedAt?: number;
}

/** The device persister: the whole copy read back in one go, or in two (`restoreLater`). */
export interface DevicePersister extends Persister {
  /**
   * The kept queries a restore left for after the first screen, read through the schemas; each is
   * returned once. None when the last restore found no copy, or a removal came since.
   */
  restoreLater: () => Promise<DehydratedQuery[]>;
}

/**
 * The persister over the device store: a small envelope under one key, each
 * kept query under its own, rewritten only when its data changed; read back
 * through the schemas, the first screen's queries first, and a copy that does
 * not read is dropped.
 */
export function createDevicePersister(open: () => Promise<DeviceStore>): DevicePersister {
  const written = new Map<string, Written>();
  // Keys a restore left for later and nobody read since: a save keeps them listed and on disk.
  let later = new Set<string>();
  const readKeys = (store: DeviceStore, keys: readonly string[]) =>
    keys.flatMap((key) => {
      const json = isOwnKey(key) ? store.getString(key) : undefined;
      if (json === undefined) return [];
      written.set(key, { json });
      return [parseJson(json)];
    });
  return {
    persistClient: async (client) => {
      const store = await open();
      const shaped = shapePersistedClient(client);
      const first: string[] = [];
      const rest: string[] = [];
      for (const query of shaped.clientState.queries) {
        const key = keyOf(query);
        (isFirstScreen(query) ? first : rest).push(key);
        later.delete(key);
        const { data, dataUpdatedAt } = query.state;
        const last = written.get(key);
        if (last !== undefined && last.data === data && last.updatedAt === dataUpdatedAt && data !== undefined) continue;
        // The time of this dehydrate changes on every save and is never read back (persisted-cache.ts): not a change.
        const json = JSON.stringify(query, (field, value: unknown) => (field === "dehydratedAt" ? undefined : value));
        if (last?.json !== json) store.set(key, json);
        written.set(key, { json, data, updatedAt: dataUpdatedAt });
      }
      const keep = new Set([...first, ...rest, ...later]);
      for (const key of ownKeysIn(store)) {
        if (keep.has(key)) continue;
        store.remove(key);
        written.delete(key);
      }
      const envelope = {
        buster: shaped.buster,
        timestamp: shaped.timestamp,
        clientState: { mutations: [], queries: [] },
        first,
        later: [...rest, ...later],
      };
      store.set(STORE_KEY, JSON.stringify(envelope));
    },
    restoreClient: async () => {
      const store = await open();
      written.clear();
      later = new Set();
      const raw = store.getString(STORE_KEY);
      if (!raw) return undefined;
      const envelope = parseJson(raw);
      const keys = EnvelopeKeysSchema.parse(envelope);
      const read = readPersistedClient(withQueries(envelope, readKeys(store, keys.first)));
      if (!read) {
        log.warn("cached rooms unreadable");
        return undefined;
      }
      if (read.dropped > 0) log.warn("cached queries dropped", { count: read.dropped });
      later = new Set([...keys.later, ...keys.timelines]);
      return read.client;
    },
    restoreLater: async () => {
      const store = await open();
      const keys = [...later];
      later = new Set();
      if (keys.length === 0) return [];
      const { queries, dropped } = readPersistedQueries(readKeys(store, keys));
      if (dropped > 0) log.warn("cached queries dropped", { count: dropped });
      return queries;
    },
    removeClient: async () => {
      const store = await open();
      for (const key of ownKeysIn(store)) store.remove(key);
      written.clear();
      later = new Set();
      store.remove(STORE_KEY);
    },
  };
}

interface Installed {
  queryClient: QueryClient;
  /** The device persister; one without `restoreLater` reads its whole copy before the first screen. */
  persister: Persister & Partial<Pick<DevicePersister, "restoreLater">>;
}

let installed: Installed | null = null;
let stop: (() => void) | null = null;
// Every stop (a new restore, a reinstall, a sign-out) moves the generation on:
// a restore that started before it neither hydrates nor subscribes.
let generation = 0;
// A second restore for the same person while one runs (a sign-in's login() and
// the session's onChange both adopt the user) shares it instead of racing it.
let pending: { userId: string; run: Promise<void> } | null = null;
// The running subscription's drop of a carried timeline; none while nothing writes.
let forgetCarried: ((wsId: string, roomId: string) => void) | null = null;

/**
 * A frame changed or removed a message of this room (chat-cache.ts). When
 * memory no longer holds the room's timeline, the copy carried on disk can
 * never get that change: it goes, with a save. A timeline memory holds is
 * the frame's own to patch, and its save follows.
 */
export function dropCarriedTimeline(wsId: string, roomId: string): void {
  forgetCarried?.(wsId, roomId);
}

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
const HYDRATE_OPTIONS = { defaultOptions: { queries: { gcTime: PERSISTED_CACHE_MAX_AGE_MS } } };

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
    await persistQueryClientRestore({
      queryClient,
      persister: guarded,
      buster,
      maxAge: PERSISTED_CACHE_MAX_AGE_MS,
      // TanStack keeps the longest gcTime a query was given, so an observer's 10 minutes do not shorten it.
      hydrateOptions: HYDRATE_OPTIONS,
    });
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
    persistQueryClientSave({ queryClient, persister: carrying, buster, dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery } }).catch(
      (error: unknown) => log.warn("cached rooms not saved", { error: errorName(error) }),
    );
  };
  // Only new data in a kept query is worth a write: not a fetch starting, an observer, or memory letting a query go.
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || !isPersistedKey(event.query.queryKey)) return;
    timer ??= setTimeout(save, PERSIST_THROTTLE_MS);
  });
  forgetCarried = (wsId, roomId) => {
    // The room's timeline and its threads: a copy memory still holds is the frame's own to patch; one only the disk holds goes.
    const isRoom = (query: DehydratedQuery) =>
      isTimeline(query) && query.queryKey[1] === wsId && query.queryKey[3] === roomId && queryClient.getQueryData(query.queryKey) === undefined;
    if (!kept.some(isRoom)) return;
    kept = kept.filter((query) => !isRoom(query));
    timer ??= setTimeout(save, PERSIST_THROTTLE_MS);
  };
  // The rest of the copy, once the first screen had its turn. Hydrate keeps what memory fetched since
  // (it never overwrites newer data), and the rest joins what the disk holds for this person.
  const restoreLater = persister.restoreLater;
  const laterTimer = restoreLater
    ? setTimeout(() => {
        restoreLater()
          .then((queries) => {
            if (!current() || queries.length === 0) return;
            hydrate(queryClient, { mutations: [], queries }, HYDRATE_OPTIONS);
            const known = new Set(kept.map((query) => query.queryHash));
            kept = [...kept, ...queries.filter((query) => !known.has(query.queryHash))];
          })
          .catch((error: unknown) => log.warn("cached rooms not restored", { error: errorName(error) }));
      }, RESTORE_LATER_MS)
    : null;
  stop = () => {
    unsubscribe();
    forgetCarried = null;
    if (timer) clearTimeout(timer);
    if (laterTimer) clearTimeout(laterTimer);
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
