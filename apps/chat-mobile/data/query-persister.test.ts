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
  RESTORE_LATER_MS,
  accountCacheInstalled,
  accountCacheUser,
  createDevicePersister,
  dropAccountCache,
  dropCarriedTimeline,
  installAccountCache,
  restoreAccountCache,
  saveAccountCacheNow,
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
  // A thread last read in a recent room: its first page is kept too.
  qc.setQueryData(chatKeys.threadMessages("w1", "new", "root"), { pages: [page("t2"), page("t1")], pageParams: [null, { cursor: "t" }] });
  // Never kept: search, tasks, the remote config.
  qc.setQueryData(chatKeys.roomSearch("w1", "new", "hi"), []);
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
        chatKeys.threadMessages("w1", "new", "root"),
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
    const saved = JSON.parse(store.getString("query-cache")!) as PersistedClient & { first: string[]; later: string[] };
    expect(saved.buster).toBe(buster("u1"));
    // The first screen's queries, then the rest, each under its own key.
    expect(saved.first).toContain(`query-cache/query/${JSON.stringify(chatKeys.rooms("w1"))}`);
    expect(saved.later).toContain(`query-cache/query/${JSON.stringify(chatKeys.members("w1"))}`);
    expect(saved.later).toContain(`query-cache/timeline/${JSON.stringify(chatKeys.roomMessages("w1", "new"))}`);
    expect(store.keys().some((key) => key.includes("remote-config"))).toBe(false);

    // The next cold start, same person, same build: the inbox before the first screen, the rest just after.
    const next = new QueryClient();
    installAccountCache({ queryClient: next, persister });
    await restoreAccountCache("u1");
    expect(next.getQueryData(chatKeys.rooms("w1"))).toEqual(room("new", "2026-10-21T00:00:00Z"));
    expect(next.getQueryData(chatKeys.unreadSummary())).toEqual(unread(2));
    expect(next.getQueryData(chatKeys.nicknames("w1"))).toEqual({});
    expect(next.getQueryData(chatKeys.roomMessages("w1", "new"))).toBeUndefined();
    expect(next.getQueryData(chatKeys.members("w1"))).toBeUndefined();
    await vi.advanceTimersByTimeAsync(RESTORE_LATER_MS);
    expect(next.getQueryData(chatKeys.roomMessages("w1", "new"))).toEqual({ pages: [page("n2")], pageParams: [null] });
    expect(next.getQueryData(chatKeys.members("w1"))).toEqual([]);
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

  // A push's background task (chat-sync/push-prefetch.ts) may be the runtime's last moment: it saves what it read at
  // once rather than a second later, and boots the cache only where no screen did.
  it("saves at once on demand, and says whether it is installed and whose copy is live", async () => {
    vi.useFakeTimers();
    expect(accountCacheInstalled()).toBe(false);
    await saveAccountCacheNow();
    const qc = new QueryClient();
    installAccountCache({ queryClient: qc, persister });
    expect(accountCacheInstalled()).toBe(true);
    expect(accountCacheUser()).toBeNull();
    // Nothing restored: nobody's copy to write.
    await saveAccountCacheNow();
    expect(store.getString("query-cache")).toBeUndefined();
    await restoreAccountCache("u1");
    expect(accountCacheUser()).toBe("u1");
    // With no change waiting it writes the copy as it is.
    await saveAccountCacheNow();
    expect(store.getString("query-cache")).toBeDefined();
    qc.setQueryData(chatKeys.rooms("w1"), room("new", null));
    await saveAccountCacheNow();
    expect((JSON.parse(store.getString("query-cache")!) as PersistedClient).buster).toBe(buster("u1"));
    // The save it ran took the throttled one's place: no second write a second later.
    store.remove("query-cache");
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(store.getString("query-cache")).toBeUndefined();
    await dropAccountCache();
    expect(accountCacheUser()).toBeNull();
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

  // The rooms' timelines (a thread's are under the same prefix: its own test below).
  const savedTimelines = () => store.keys().filter((key) => key.startsWith("query-cache/timeline/") && key.includes("room-messages")).sort();
  const savedThreads = () => store.keys().filter((key) => key.includes("thread-messages")).sort();
  const threadKey = (roomId: string, rootId: string) => `query-cache/timeline/${JSON.stringify(chatKeys.threadMessages("w1", roomId, rootId))}`;
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
    await vi.advanceTimersByTimeAsync(RESTORE_LATER_MS);
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

  it("keeps the first page of the threads last read in the recent rooms, and a frame takes a copy only the disk holds", async () => {
    vi.useFakeTimers();
    const first = seeded();
    first.setQueryData(chatKeys.threadMessages("w1", "old", "r-old"), { pages: [page("x")], pageParams: [null] });
    // A room not among the recent ones: its thread is not kept either.
    first.setQueryData(chatKeys.rooms("w1"), [...room("new", "2026-10-20T00:00:00Z"), ...room("old", "2026-10-01T00:00:00Z"), ...room("gone", "2026-09-01T00:00:00Z")]);
    first.setQueryData(chatKeys.threadMessages("w1", "elsewhere", "r9"), { pages: [page("y")], pageParams: [null] });
    installAccountCache({ queryClient: first, persister });
    await restoreAccountCache("u1");
    first.setQueryData(chatKeys.unreadSummary(), unread(3));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(savedThreads()).toEqual([threadKey("new", "root"), threadKey("old", "r-old")]);
    // Its first page only: the root and the newest replies.
    expect(JSON.parse(store.getString(threadKey("new", "root"))!).state.data).toEqual({ pages: [page("t2")], pageParams: [null] });

    const next = new QueryClient();
    installAccountCache({ queryClient: next, persister });
    await restoreAccountCache("u1");
    await vi.advanceTimersByTimeAsync(RESTORE_LATER_MS);
    expect(next.getQueryData(chatKeys.threadMessages("w1", "new", "root"))).toEqual({ pages: [page("t2")], pageParams: [null] });
    // Memory let the thread go while it still holds the room: an edit in the room takes the thread's copy off the disk too.
    next.removeQueries({ queryKey: chatKeys.threadMessages("w1", "new", "root"), exact: true });
    dropCarriedTimeline("w1", "new");
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(savedThreads()).toEqual([threadKey("old", "r-old")]);
    expect(savedTimelines()).toContain(timelineKey("new"));

    // The threads kept are the ones read last (the seeded one, just now; then t3), a few per account.
    const many = seeded();
    const client: PersistedClient = { buster: "b", timestamp: 1, clientState: dehydrate(many, { shouldDehydrateQuery: shouldPersistQuery }) };
    const base = client.clientState.queries.find((q) => q.queryKey[2] === "thread-messages")!;
    const threads = [1, 2, 3].map((n) => ({ ...base, queryHash: `t${n}`, queryKey: chatKeys.threadMessages("w1", "new", `t${n}`), state: { ...base.state, dataUpdatedAt: n } }));
    const shaped = shapePersistedClient({ ...client, clientState: { mutations: [], queries: [...client.clientState.queries, ...threads] } }, 24, 2);
    expect(shaped.clientState.queries.filter((q) => q.queryKey[2] === "thread-messages").map((q) => q.queryHash)).toEqual([base.queryHash, "t3"]);
    await dropAccountCache();
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
    await vi.advanceTimersByTimeAsync(RESTORE_LATER_MS);
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
    await vi.advanceTimersByTimeAsync(RESTORE_LATER_MS);
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

// Audit P2 Perf: a save serializes what changed, and a cold start reads the inbox before the rest.
describe("the cost of a save and of a cold start", () => {
  let store: DeviceStore;
  let persister: ReturnType<typeof createDevicePersister>;
  const queryKey = (key: readonly unknown[]) => `query-cache/query/${JSON.stringify(key)}`;
  const timelineKey = (roomId: string) => `query-cache/timeline/${JSON.stringify(chatKeys.roomMessages("w1", roomId))}`;
  const people = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ user_id: `u${n}`, email: `u${n}@uni.vn`, display_name: `Người ${n}`, role: "member", joined_at: "2026-10-01T00:00:00Z" }));

  beforeEach(() => {
    store = memoryDeviceStore();
    persister = createDevicePersister(async () => store);
  });

  it("serializes only the queries whose data changed: a frame never re-serializes a 1,000-person member list", async () => {
    vi.useFakeTimers();
    const qc = seeded();
    qc.setQueryData(chatKeys.members("w1"), people(1000));
    installAccountCache({ queryClient: qc, persister });
    await restoreAccountCache("u1");
    qc.setQueryData(chatKeys.unreadSummary(), unread(2));
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(store.getString(queryKey(chatKeys.members("w1")))).toContain("Người 999");

    qc.setQueryData(chatKeys.roomMessages("w1", "new"), { pages: [page("n3"), page("n2")], pageParams: [null, { cursor: "c" }] });
    const stringify = vi.spyOn(JSON, "stringify");
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    // The timeline that changed, and the envelope: no other kept query is even turned into JSON.
    const written = stringify.mock.calls.map(([value]) => (value && typeof value === "object" && "queryHash" in value ? String(value.queryHash) : "envelope"));
    expect(written).toEqual([JSON.stringify(chatKeys.roomMessages("w1", "new")), "envelope"]);
    stringify.mockRestore();
    await dropAccountCache();
  });

  it("a save before the rest is read back keeps it on disk and listed; read once, it is memory's", async () => {
    const qc = seeded();
    const client: PersistedClient = { buster: buster("u1"), timestamp: Date.now(), clientState: dehydrate(qc, { shouldDehydrateQuery: shouldPersistQuery }) };
    await persister.persistClient(client);

    const restarted = createDevicePersister(async () => store);
    const first = await restarted.restoreClient();
    expect(first ? keysOf(first) : []).toEqual(
      [["workspaces"], chatKeys.rooms("w1"), chatKeys.unreadSummary(), chatKeys.nicknames("w1")].map((key) => JSON.stringify(key)).sort(),
    );
    // A save of the first screen alone, before the rest is back: nothing of the rest goes.
    await restarted.persistClient(first!);
    expect(store.keys()).toContain(timelineKey("new"));
    const envelope = JSON.parse(store.getString("query-cache")!) as { later: string[] };
    expect(envelope.later).toContain(timelineKey("new"));
    expect(envelope.later).toContain(queryKey(chatKeys.members("w1")));

    const rest = await restarted.restoreLater();
    expect(rest.map((query) => JSON.stringify(query.queryKey)).sort()).toEqual(
      [
        chatKeys.members("w1"),
        chatKeys.roomMembers("w1", "new"),
        chatKeys.roomMessages("w1", "new"),
        chatKeys.roomMessages("w1", "old"),
        chatKeys.threadMessages("w1", "new", "root"),
      ]
        .map((key) => JSON.stringify(key))
        .sort(),
    );
    // Each is returned once, and a save without them now takes them off the disk.
    expect(await restarted.restoreLater()).toEqual([]);
    await restarted.persistClient(first!);
    expect(store.keys()).not.toContain(timelineKey("new"));
  });

  it("drops a later query that does not read, alone", async () => {
    const warnings: string[] = [];
    installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void warnings.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
    await persister.persistClient({ buster: buster("u1"), timestamp: Date.now(), clientState: dehydrate(seeded(), { shouldDehydrateQuery: shouldPersistQuery }) });
    store.set(timelineKey("old"), JSON.stringify({ queryKey: chatKeys.roomMessages("w1", "old"), queryHash: "x", state: { data: "drift" } }));
    const restarted = createDevicePersister(async () => store);
    await restarted.restoreClient();
    expect(await restarted.restoreLater()).toHaveLength(4);
    expect(warnings).toContain("cached queries dropped");
    installReportSink(null);
  });

  it("a sign-out while the rest is being read hydrates none of it; a read that fails is logged", async () => {
    vi.useFakeTimers();
    const warnings: string[] = [];
    installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void warnings.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
    await persister.persistClient({ buster: buster("u1"), timestamp: Date.now(), clientState: dehydrate(seeded(), { shouldDehydrateQuery: shouldPersistQuery }) });
    let release: (queries: Awaited<ReturnType<typeof persister.restoreLater>>) => void = () => undefined;
    const slow = { ...persister, restoreLater: () => new Promise<Awaited<ReturnType<typeof persister.restoreLater>>>((resolve) => (release = resolve)) };
    const qc = new QueryClient();
    installAccountCache({ queryClient: qc, persister: slow });
    await restoreAccountCache("u1");
    await vi.advanceTimersByTimeAsync(RESTORE_LATER_MS);
    await dropAccountCache();
    release(await persister.restoreLater());
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(chatKeys.roomMessages("w1", "new"))).toBeUndefined();

    // Signed out before the rest was due: it is never read.
    await persister.persistClient({ buster: buster("u1"), timestamp: Date.now(), clientState: dehydrate(seeded(), { shouldDehydrateQuery: shouldPersistQuery }) });
    const later = vi.spyOn(persister, "restoreLater");
    installAccountCache({ queryClient: qc, persister });
    await restoreAccountCache("u1");
    await dropAccountCache();
    await vi.advanceTimersByTimeAsync(RESTORE_LATER_MS);
    expect(later).not.toHaveBeenCalled();

    const failing = { ...persister, restoreLater: () => Promise.reject(new Error("locked")) };
    await persister.persistClient({ buster: buster("u1"), timestamp: Date.now(), clientState: dehydrate(seeded(), { shouldDehydrateQuery: shouldPersistQuery }) });
    installAccountCache({ queryClient: new QueryClient(), persister: failing });
    await restoreAccountCache("u1");
    await vi.advanceTimersByTimeAsync(RESTORE_LATER_MS);
    expect(warnings).toContain("cached rooms not restored");
    installReportSink(null);
    await dropAccountCache();
  });
});
