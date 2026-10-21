// Audit R5: a cold start opens on the cached inbox, and only on the person's own.
import { QueryClient, QueryObserver, dehydrate } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/query-persist-client-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessagesListSchema, ChatRoomsListSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { CACHE_SCHEMA_VERSION } from "./persisted-cache";
import { chatKeys } from "./queries/chat-keys";
import {
  PERSISTED_CACHE_MAX_AGE_MS,
  PERSIST_THROTTLE_MS,
  createDevicePersister,
  dropAccountCache,
  dropCarriedTimeline,
  installAccountCache,
  restoreAccountCache,
  shapePersistedClient,
  shouldPersistQuery,
  withEvicted,
} from "./query-persister";
import { installReportSink } from "./report";
import { memoryDeviceStore, type DeviceStore } from "./storage/device-store";

// Records as the endpoints' schemas shape them: what the cache holds, and what a restore re-reads.
const room = (id: string, last: string | null) =>
  ChatRoomsListSchema.parse({ rooms: [{ id, kind: "dm", name: id, workspace_id: "w1", last_message_at: last ?? undefined }] }).rooms;
const page = (id: string) =>
  ChatMessagesListSchema.parse({ messages: [{ id, room_id: "r", workspace_id: "w1", sender_id: "u1", sender_display_name: "A", body: id, created_at: "2026-10-20T00:00:00Z" }] }).messages;
const unread = (direct: number) => ({ direct: { unread: direct, mentions: 0 }, workspaces: [] });
const buster = (rest: string) => `${CACHE_SCHEMA_VERSION}:${rest}`;

function seeded(qc = new QueryClient()): QueryClient {
  qc.setQueryData(["workspaces"], [{ id: "w1", slug: "w", name: "W", organization_id: "o1", organization_slug: "o", organization_name: "O" }]);
  qc.setQueryData(chatKeys.rooms("w1"), [...room("old", "2026-10-01T00:00:00Z"), ...room("new", "2026-10-20T00:00:00Z"), ...room("never", null)]);
  qc.setQueryData(chatKeys.unreadSummary(), unread(1));
  qc.setQueryData(chatKeys.nicknames("w1"), {});
  qc.setQueryData(chatKeys.members("w1"), []);
  qc.setQueryData(chatKeys.roomMembers("w1", "new"), []);
  qc.setQueryData(chatKeys.roomMessages("w1", "new"), { pages: [page("n2"), page("n1")], pageParams: [null, { cursor: "c" }] });
  qc.setQueryData(chatKeys.roomMessages("w1", "old"), { pages: [page("o1")], pageParams: [null] });
  // Never kept: search, threads, tasks, the remote config.
  qc.setQueryData(chatKeys.roomSearch("w1", "new", "hi"), []);
  qc.setQueryData(chatKeys.threadMessages("w1", "new", "root"), { pages: [], pageParams: [] });
  qc.setQueryData(chatKeys.task("w1", "t1"), {});
  qc.setQueryData(["remote-config"], {});
  return qc;
}

const keysOf = (client: PersistedClient) => client.clientState.queries.map((q) => JSON.stringify(q.queryKey)).sort();

afterEach(() => {
  installAccountCache(null);
  vi.useRealTimers();
});

describe("what is kept", () => {
  it("keeps only the inbox a cold start opens on, and only answers the server gave", () => {
    const qc = seeded();
    const kept = qc.getQueryCache().getAll().filter(shouldPersistQuery).map((q) => JSON.stringify(q.queryKey)).sort();
    expect(kept).toEqual(
      [
        ["workspaces"],
        chatKeys.rooms("w1"),
        chatKeys.unreadSummary(),
        chatKeys.nicknames("w1"),
        chatKeys.members("w1"),
        chatKeys.roomMembers("w1", "new"),
        chatKeys.roomMessages("w1", "new"),
        chatKeys.roomMessages("w1", "old"),
      ]
        .map((k) => JSON.stringify(k))
        .sort(),
    );
    const failed = { queryKey: chatKeys.rooms("w1"), state: { status: "error" } } as never;
    expect(shouldPersistQuery(failed)).toBe(false);
    for (const queryKey of [["workspaces", "x"], ["chat", "unread-summary", "x"], ["chat", "w1", "follow-ups"], ["chat", "w1", "room-members", "r", "x"]]) {
      expect(shouldPersistQuery({ queryKey, state: { status: "success" } } as never)).toBe(false);
    }
  });

  it("writes the newest page of the most recently active rooms only", () => {
    const qc = seeded();
    const client: PersistedClient = { buster: "b", timestamp: 1, clientState: dehydrate(qc, { shouldDehydrateQuery: shouldPersistQuery }) };
    const shaped = shapePersistedClient(client, 1);
    expect(keysOf(shaped)).not.toContain(JSON.stringify(chatKeys.roomMessages("w1", "old")));
    const timeline = shaped.clientState.queries.find((q) => JSON.stringify(q.queryKey) === JSON.stringify(chatKeys.roomMessages("w1", "new")));
    expect(timeline?.state.data).toEqual({ pages: [page("n2")], pageParams: [null] });
    expect(shapePersistedClient(client, 3).clientState.queries).toHaveLength(client.clientState.queries.length);

    // A timeline without its pageParams, and a workspace whose rooms list is not kept, read safely.
    const odd: PersistedClient = {
      ...client,
      clientState: {
        mutations: [],
        queries: [
          { ...client.clientState.queries[0]!, queryKey: chatKeys.rooms("w2"), state: { ...client.clientState.queries[0]!.state, data: "drift" } },
          { ...client.clientState.queries[0]!, queryKey: chatKeys.roomMessages("w2", "r"), state: { ...client.clientState.queries[0]!.state, data: { pages: [1, 2] } } },
        ],
      },
    };
    expect(shapePersistedClient(odd).clientState.queries).toHaveLength(1);
    const nullTimeline = { ...odd.clientState.queries[1]!, queryKey: chatKeys.roomMessages("w1", "new"), state: { ...odd.clientState.queries[1]!.state, data: null } };
    expect(shapePersistedClient({ ...client, clientState: { mutations: [], queries: [...client.clientState.queries, nullTimeline] } }).clientState.queries).toContainEqual(nullTimeline);
    const withRooms: PersistedClient = {
      ...odd,
      clientState: {
        mutations: [],
        queries: [
          { ...odd.clientState.queries[0]!, state: { ...odd.clientState.queries[0]!.state, data: room("r", null) } },
          odd.clientState.queries[1]!,
        ],
      },
    };
    expect(shapePersistedClient(withRooms).clientState.queries[1]?.state.data).toEqual({ pages: [1], pageParams: [] });
  });
});

describe("the device persister", () => {
  it("writes JSON under one key and drops a copy that does not read", async () => {
    const store = memoryDeviceStore();
    const persister = createDevicePersister(async () => store);
    expect(await persister.restoreClient()).toBeUndefined();
    const client: PersistedClient = { buster: "b", timestamp: 1, clientState: { mutations: [], queries: [] } };
    await persister.persistClient(client);
    expect(await persister.restoreClient()).toEqual(client);
    store.set("query-cache", "{broken");
    expect(await persister.restoreClient()).toBeUndefined();
    await persister.removeClient();
    expect(store.getString("query-cache")).toBeUndefined();
  });
});

describe("the account's cache", () => {
  let store: DeviceStore;
  let persister: Persister;
  const warnings: string[] = [];

  beforeEach(() => {
    store = memoryDeviceStore();
    persister = createDevicePersister(async () => store);
    warnings.length = 0;
    installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void warnings.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
  });
  afterEach(() => installReportSink(null));

  it("does nothing until the app installs it", async () => {
    await restoreAccountCache("u1");
    await dropAccountCache();
    expect(store.getString("query-cache")).toBeUndefined();
  });

  it("saves the person's inbox a second after the last change, and opens the next start on it", async () => {
    vi.useFakeTimers();
    const first = seeded();
    installAccountCache({ queryClient: first, persister });
    await restoreAccountCache("u1");
    first.setQueryData(chatKeys.rooms("w1"), room("new", "2026-10-21T00:00:00Z"));
    first.setQueryData(chatKeys.unreadSummary(), unread(2));
    expect(store.getString("query-cache")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    const saved = JSON.parse(store.getString("query-cache")!) as PersistedClient;
    expect(saved.buster).toBe(buster("u1"));
    expect(keysOf(saved)).toContain(JSON.stringify(chatKeys.rooms("w1")));
    expect(keysOf(saved)).not.toContain(JSON.stringify(["remote-config"]));

    // The next cold start, same person, same build.
    const next = new QueryClient();
    installAccountCache({ queryClient: next, persister });
    await restoreAccountCache("u1");
    expect(next.getQueryData(chatKeys.rooms("w1"))).toEqual(room("new", "2026-10-21T00:00:00Z"));
    expect(next.getQueryData(chatKeys.unreadSummary())).toEqual(unread(2));
    expect(next.getQueryData(chatKeys.roomMessages("w1", "new"))).toEqual({ pages: [page("n2")], pageParams: [null] });
  });

  it("another person or another cache schema reads nothing of it, and the copy goes", async () => {
    // The last one is a copy from before the store version left the buster: read as another schema.
    for (const [written, reader] of [[buster("u2"), "u1"], ["0:u1", "u1"], [`${CACHE_SCHEMA_VERSION}:0.3.0:u1`, "u1"]] as const) {
      store.set("query-cache", JSON.stringify({ buster: written, timestamp: Date.now(), clientState: dehydrate(seeded()) }));
      const qc = new QueryClient();
      installAccountCache({ queryClient: qc, persister });
      await restoreAccountCache(reader);
      expect(qc.getQueryData(chatKeys.rooms("w1"))).toBeUndefined();
      expect(store.getString("query-cache")).toBeUndefined();
    }
  });

  // An OTA keeps the buster: what an older bundle wrote is read through this one's schemas, never cast.
  it("a kept record that no longer reads is dropped alone, and the rest of the inbox opens", async () => {
    const clientState = dehydrate(seeded(), { shouldDehydrateQuery: shouldPersistQuery });
    const drifted = clientState.queries.map((q) => (JSON.stringify(q.queryKey) === JSON.stringify(chatKeys.unreadSummary()) ? { ...q, state: { ...q.state, data: "drift" } } : q));
    store.set("query-cache", JSON.stringify({ buster: buster("u1"), timestamp: Date.now(), clientState: { ...clientState, queries: drifted } }));
    const qc = new QueryClient();
    installAccountCache({ queryClient: qc, persister });
    await restoreAccountCache("u1");
    expect(qc.getQueryData(chatKeys.unreadSummary())).toBeUndefined();
    expect(qc.getQueryData(chatKeys.rooms("w1"))).toHaveLength(3);
    expect(warnings).toContain("cached queries dropped");

    store.set("query-cache", JSON.stringify({ buster: buster("u1"), timestamp: "yesterday" }));
    const fresh = new QueryClient();
    installAccountCache({ queryClient: fresh, persister });
    await restoreAccountCache("u1");
    expect(fresh.getQueryCache().getAll()).toHaveLength(0);
    expect(warnings).toContain("cached rooms unreadable");
  });

  it("sign-out stops the writes and removes the copy; a reinstall stops the last subscription", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    installAccountCache({ queryClient: qc, persister });
    await restoreAccountCache("u1");
    qc.setQueryData(chatKeys.rooms("w1"), []);
    await dropAccountCache();
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(store.getString("query-cache")).toBeUndefined();

    await restoreAccountCache("u1");
    // Observer churn alone is not a change worth a write.
    qc.getQueryCache().notify({ type: "observerAdded" } as never);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(store.getString("query-cache")).toBeUndefined();
    installAccountCache(null);
    qc.setQueryData(chatKeys.rooms("w1"), room("x", null));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(store.getString("query-cache")).toBeUndefined();
    await dropAccountCache();
  });

  // Review P1: a sign-in adopts the user twice at once (login() and the session's onChange);
  // the first subscription leaked past sign-out and saved the next account's rooms under this one's buster.
  it("two restores at once share one subscription, and a sign-out after them stops every write", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    installAccountCache({ queryClient: qc, persister });
    const [a, b] = [restoreAccountCache("A"), restoreAccountCache("A")];
    expect(a).toBe(b);
    await Promise.all([a, b]);
    await dropAccountCache();
    qc.setQueryData(chatKeys.rooms("w1"), room("b-room", null));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(store.getString("query-cache")).toBeUndefined();

    // Done, the next restore of the same person starts afresh and writes again.
    await restoreAccountCache("A");
    qc.setQueryData(chatKeys.rooms("w1"), room("a-room", null));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect((JSON.parse(store.getString("query-cache")!) as PersistedClient).buster).toBe(buster("A"));
  });

  it("a restore overtaken by another person's, or by a sign-out, neither hydrates nor subscribes", async () => {
    vi.useFakeTimers();
    store.set("query-cache", JSON.stringify({ buster: buster("A"), timestamp: Date.now(), clientState: dehydrate(seeded()) }));
    const qc = new QueryClient();
    installAccountCache({ queryClient: qc, persister });
    const first = restoreAccountCache("A");
    await dropAccountCache();
    await first;
    expect(qc.getQueryData(chatKeys.rooms("w1"))).toBeUndefined();

    const a = restoreAccountCache("A");
    const b = restoreAccountCache("B");
    await Promise.all([a, b]);
    qc.setQueryData(chatKeys.rooms("w1"), room("b-room", null));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect((JSON.parse(store.getString("query-cache")!) as PersistedClient).buster).toBe(buster("B"));
    await dropAccountCache();
  });

  it("a copy that will not read, or a write that fails, is logged and never stops the app", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const broken: Persister = {
      persistClient: () => Promise.reject(new Error("full")),
      restoreClient: () => Promise.reject("locked"),
      removeClient: async () => undefined,
    };
    installAccountCache({ queryClient: qc, persister: broken });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await restoreAccountCache("u1");
    qc.setQueryData(chatKeys.rooms("w1"), []);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(warnings).toEqual(["cached rooms not restored", "cached rooms not saved"]);

    const odd: Persister = { ...broken, restoreClient: () => Promise.reject(new Error("locked")), persistClient: () => Promise.reject("full") };
    installAccountCache({ queryClient: qc, persister: odd });
    await restoreAccountCache("u1");
    qc.setQueryData(chatKeys.rooms("w1"), room("y", null));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(warnings).toHaveLength(4);
  });
});

// Audit "gc-time-evicts-persisted-timelines": memory lets an unobserved query go after its gcTime; the disk does not.
describe("the disk outlives memory", () => {
  let store: DeviceStore;
  let persister: Persister;

  beforeEach(() => {
    store = memoryDeviceStore();
    persister = createDevicePersister(async () => store);
  });

  const savedTimelines = () => store.keys().filter((key) => key.startsWith("query-cache/timeline/")).sort();
  const timelineKey = (roomId: string) => `query-cache/timeline/${JSON.stringify(chatKeys.roomMessages("w1", roomId))}`;

  /** The app's QueryClient: a query nobody observes leaves memory after 10 minutes. */
  const appClient = () => new QueryClient({ defaultOptions: { queries: { gcTime: 10 * 60_000 } } });

  it("a timeline memory collects stays on disk, and a restored one stays in memory for the copy's whole life", async () => {
    vi.useFakeTimers();
    // A session that read both rooms and left them: gcTime passes.
    const first = seeded(appClient());
    installAccountCache({ queryClient: first, persister });
    await restoreAccountCache("u1");
    first.setQueryData(chatKeys.unreadSummary(), unread(3));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(savedTimelines()).toEqual([timelineKey("new"), timelineKey("old")]);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(first.getQueryData(chatKeys.roomMessages("w1", "new"))).toBeUndefined();

    // A rooms refetch saves: the collected timelines are still written.
    first.setQueryData(chatKeys.rooms("w1"), [...room("old", "2026-10-01T00:00:00Z"), ...room("new", "2026-10-21T00:00:00Z")]);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(savedTimelines()).toEqual([timelineKey("new"), timelineKey("old")]);

    // The next start restores both. Hours later, offline, a room opened and closed or never opened still opens on its page:
    // nothing re-reads the disk on a memory miss, so a restored query lives as long as the copy may.
    const next = appClient();
    installAccountCache({ queryClient: next, persister });
    await restoreAccountCache("u1");
    const opened = new QueryObserver(next, { queryKey: chatKeys.roomMessages("w1", "new"), gcTime: 10 * 60_000, enabled: false }).subscribe(() => undefined);
    opened();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(next.getQueryData(chatKeys.roomMessages("w1", "new"))).toEqual({ pages: [page("n2")], pageParams: [null] });
    expect(next.getQueryData(chatKeys.roomMessages("w1", "old"))).toEqual({ pages: [page("o1")], pageParams: [null] });
    expect(next.getQueryData(chatKeys.rooms("w1"))).toBeDefined();

    // A room left (the list without it) takes its timeline off the disk, carried or not.
    next.setQueryData(chatKeys.rooms("w1"), room("new", "2026-10-21T00:00:00Z"));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(savedTimelines()).toEqual([timelineKey("new")]);
    await dropAccountCache();
    expect(store.keys()).toEqual([]);
  });

  it("a frame for a room whose timeline only the disk still holds takes that copy off the disk: no frame can reach it", async () => {
    vi.useFakeTimers();
    const first = seeded();
    installAccountCache({ queryClient: first, persister });
    await restoreAccountCache("u1");
    first.setQueryData(chatKeys.unreadSummary(), unread(3));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);

    const next = new QueryClient();
    installAccountCache({ queryClient: next, persister });
    await restoreAccountCache("u1");
    // Memory let "new" go; a delete or an edit arrives for it.
    next.removeQueries({ queryKey: chatKeys.roomMessages("w1", "new"), exact: true });
    dropCarriedTimeline("w1", "new");
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(savedTimelines()).toEqual([timelineKey("old")]);

    // A timeline memory holds is the frame's own to patch, and one already gone is gone: nothing is written.
    const set = vi.spyOn(store, "set");
    dropCarriedTimeline("w1", "old");
    dropCarriedTimeline("w1", "new");
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(set).not.toHaveBeenCalled();

    // Signed out, nothing is carried and nothing is written.
    await dropAccountCache();
    dropCarriedTimeline("w1", "old");
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(store.keys()).toEqual([]);
  });

  it("a carried query older than the copy's limit is let go", () => {
    const qc = seeded();
    const client: PersistedClient = { buster: "b", timestamp: 1, clientState: dehydrate(qc, { shouldDehydrateQuery: shouldPersistQuery }) };
    const [rooms, ...rest] = client.clientState.queries;
    const fresh = { ...rest[0]!, queryHash: "fresh" };
    const stale = { ...rest[0]!, queryHash: "stale", state: { ...rest[0]!.state, dataUpdatedAt: 0 } };
    const now = rest[0]!.state.dataUpdatedAt + PERSISTED_CACHE_MAX_AGE_MS;
    const carried = withEvicted({ ...client, clientState: { mutations: [], queries: [rooms!] } }, [rooms!, fresh, stale], now);
    expect(carried.clientState.queries.map((q) => q.queryHash)).toEqual([rooms!.queryHash, "fresh"]);
    // Nothing memory let go: the save is memory's as it is.
    expect(withEvicted(client, client.clientState.queries, now)).toBe(client);
  });

  it("writes only the timelines that changed, and still reads a copy from before timelines had their own keys", async () => {
    vi.useFakeTimers();
    const qc = seeded();
    installAccountCache({ queryClient: qc, persister });
    await restoreAccountCache("u1");
    qc.setQueryData(chatKeys.unreadSummary(), unread(1));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    const set = vi.spyOn(store, "set");
    qc.setQueryData(chatKeys.roomMessages("w1", "new"), { pages: [page("n3")], pageParams: [null] });
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(set.mock.calls.map(([key]) => key)).toEqual([timelineKey("new"), "query-cache"]);
    await dropAccountCache();

    // The old layout: every query, timelines included, inside the envelope.
    store.set("query-cache", JSON.stringify({ buster: buster("u1"), timestamp: Date.now(), clientState: dehydrate(seeded(), { shouldDehydrateQuery: shouldPersistQuery }) }));
    // A listed key that is gone, or holds no JSON, or is not a timeline key, is skipped; the rest opens.
    const envelope = JSON.parse(store.getString("query-cache")!) as Record<string, unknown>;
    store.set("query-cache", JSON.stringify({ ...envelope, timelines: [timelineKey("gone"), timelineKey("broken"), "elsewhere"] }));
    store.set(timelineKey("broken"), "{");
    store.set("elsewhere", "{}");
    const next = new QueryClient();
    installAccountCache({ queryClient: next, persister });
    await restoreAccountCache("u1");
    expect(next.getQueryData(chatKeys.roomMessages("w1", "old"))).toEqual({ pages: [page("o1")], pageParams: [null] });
    // An envelope that is no client at all reads as none, its timeline keys or not.
    store.set("query-cache", JSON.stringify({ timelines: [] }));
    expect(await persister.restoreClient()).toBeUndefined();
  });

  it("only new data in a kept query is worth a write: a fetch starting, an invalidation or an eviction is not", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    installAccountCache({ queryClient: qc, persister });
    await restoreAccountCache("u1");
    qc.setQueryData(chatKeys.task("w1", "t1"), {});
    await qc.invalidateQueries({ queryKey: chatKeys.rooms("w1") });
    void qc.prefetchQuery({ queryKey: chatKeys.rooms("w1"), queryFn: () => new Promise<never>(() => undefined) });
    qc.removeQueries({ queryKey: chatKeys.task("w1", "t1") });
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(store.getString("query-cache")).toBeUndefined();
    await dropAccountCache();
  });
});
