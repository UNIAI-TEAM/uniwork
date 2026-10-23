// The shared cache wiring on its own, bound the way a host binds it. The web's
// binding (realtime-cache.test.ts) and the phone's (apps/chat-mobile/data/
// chat-cache.test.ts) run every frame case; this file holds what the factory
// promises any host: its own keys, no optional hook required, and a viewer
// read only once a timeline fetch in flight has settled.
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat-schemas";
import { createChatMessageCache, type ChatMessageCacheHost, type ChatViewer } from "./chat-message-cache";
import { pendingChatMessageId } from "./pending-message-id";
import { flattenRoomTimeline, type RoomTimeline } from "./room-timeline-pages";

const keys: ChatMessageCacheHost["keys"] = {
  rooms: (wsId) => ["host", wsId, "rooms"],
  roomMessages: (wsId, roomId) => ["host", wsId, "timeline", roomId],
  threadMessages: (wsId, roomId, rootId) => ["host", wsId, "thread", roomId, rootId],
  roomThreads: (wsId, roomId) => ["host", wsId, "thread", roomId],
};

const message = (id: string, createdAt: string, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u2",
  sender_display_name: "Bob",
  kind: "text",
  body: `hello ${id}`,
  created_at: createdAt,
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...extra,
});

const defaultChannel = (extra: Partial<ChatRoomRecord> = {}): ChatRoomRecord => ({
  id: "room1",
  kind: "channel",
  is_default: true,
  name: "general",
  workspace_id: "ws1",
  member_user_ids: [],
  member_count: 0,
  unread_count: 0,
  mention_unread_count: 0,
  ...extra,
});

const shown = (qc: QueryClient, queryKey: QueryKey, data: unknown) => {
  qc.setQueryData(queryKey, data);
  new QueryObserver(qc, { queryKey, enabled: false }).subscribe(() => {});
};

const timelineIds = (qc: QueryClient, key: QueryKey) => {
  const data = qc.getQueryData<RoomTimeline>(key);
  return data ? flattenRoomTimeline(data).map((m) => m.id) : undefined;
};

describe("createChatMessageCache", () => {
  it("patches the host's own keys with no optional hook bound", async () => {
    const getMessage = vi.fn().mockResolvedValue(message("m2", "2026-01-01T10:01:00Z"));
    const cache = createChatMessageCache({ keys, getMessage });
    const qc = new QueryClient();
    const timeline = keys.roomMessages("ws1", "room1");
    shown(qc, timeline, { pages: [[message("m1", "2026-01-01T10:00:00Z")]], pageParams: [null] });

    await cache.fetchAndPatchChatMessage(qc, "ws1", { userId: "u1", activeRoomId: "room1" }, { roomId: "room1", messageId: "m2", created: true });
    expect(getMessage).toHaveBeenCalledWith("ws1", "room1", "m2");
    expect(timelineIds(qc, timeline)).toEqual(["m1", "m2"]);

    cache.patchChatMessageDeleted(qc, "ws1", "room1", "m1");
    expect(timelineIds(qc, timeline)).toEqual(["m2"]);

    cache.insertCreatedRoomMessage(qc, "ws1", "room1", message("m3", "2026-01-01T10:02:00Z"));
    expect(timelineIds(qc, timeline)).toEqual(["m2", "m3"]);
  });

  it("replaces a pending row when the WS echo arrives before onSuccess", async () => {
    const getMessage = vi.fn().mockResolvedValue(
      message("m2", "2026-01-01T10:01:00Z", { client_msg_id: "cmid-1" }),
    );
    const cache = createChatMessageCache({ keys, getMessage });
    const qc = new QueryClient();
    const timeline = keys.roomMessages("ws1", "room1");
    shown(qc, timeline, {
      pages: [[message("m1", "2026-01-01T10:00:00Z"), message(pendingChatMessageId("cmid-1"), "2026-01-01T10:00:30Z", { client_msg_id: "cmid-1" })]],
      pageParams: [null],
    });

    await cache.fetchAndPatchChatMessage(
      qc,
      "ws1",
      { userId: "u1", activeRoomId: "room1" },
      { roomId: "room1", messageId: "m2", created: true },
    );

    expect(timelineIds(qc, timeline)).toEqual(["m1", "m2"]);
  });

  it("calls each hook a host binds, with what happened", async () => {
    const reply = message("r1", "2026-01-01T10:01:00Z", { thread_root_id: "m1" });
    const host: ChatMessageCacheHost = {
      keys,
      getMessage: vi.fn().mockResolvedValue(reply),
      onMessagePlaced: vi.fn(),
      onUnshownFrame: vi.fn(),
      onMessageDeleted: vi.fn(),
      onMessageFetched: vi.fn(),
    };
    const cache = createChatMessageCache(host);
    const qc = new QueryClient();
    shown(qc, keys.roomMessages("ws1", "room1"), { pages: [[message("m1", "2026-01-01T10:00:00Z")]], pageParams: [null] });

    await cache.fetchAndPatchChatMessage(qc, "ws1", { userId: "u1", activeRoomId: null }, { roomId: "room1", messageId: "r1" });
    expect(host.onMessagePlaced).toHaveBeenCalledWith(qc, "ws1", "room1", reply, false);
    expect(host.onMessageFetched).toHaveBeenCalledWith(qc, "ws1", "room1", "r1", false);

    await cache.fetchAndPatchChatMessage(qc, "ws1", { userId: "u1", activeRoomId: null }, { roomId: "room2", messageId: "x" });
    expect(host.onUnshownFrame).toHaveBeenCalledWith(qc, "ws1", "room2", false);

    cache.patchChatMessageDeleted(qc, "ws1", "room1", "m1");
    expect(host.onMessageDeleted).toHaveBeenCalledWith(qc, "ws1", "room1");
  });

  it("reads the viewer once the room's first load settles, not when the frame arrived", async () => {
    const cache = createChatMessageCache({ keys, getMessage: vi.fn() });
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(keys.rooms("ws1"), [defaultChannel()]);
    let release!: () => void;
    const firstLoad = qc.fetchQuery({
      queryKey: keys.roomMessages("ws1", "room1"),
      queryFn: () => new Promise<undefined>((resolve) => (release = () => resolve(undefined))),
    });
    const viewer: { userId: string | null; activeRoomId: string | null } = { userId: "u1", activeRoomId: null };

    const applied = cache.fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m1", created: true, senderId: "u2" });
    // The person opens the room while it loads: the message is read, not unread.
    viewer.activeRoomId = "room1";
    release();
    await firstLoad.catch(() => undefined);
    await applied;

    expect(qc.getQueryData<ChatRoomRecord[]>(keys.rooms("ws1"))?.[0]?.unread_count).toBe(0);
  });

  it("counts a mention only on the default channel, from someone else, in a room not on screen", () => {
    const cache = createChatMessageCache({ keys, getMessage: vi.fn() });
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(keys.rooms("ws1"), [defaultChannel(), defaultChannel({ id: "room2", is_default: false })]);
    const away: ChatViewer = { userId: "u1", activeRoomId: null };
    const mentions = () => qc.getQueryData<ChatRoomRecord[]>(keys.rooms("ws1"))?.map((room) => room.mention_unread_count);

    cache.patchChatMentionCreated(qc, "ws1", away, "room1", "u2");
    cache.patchChatMentionCreated(qc, "ws1", away, "room2", "u2");
    cache.patchChatMentionCreated(qc, "ws1", away, "room1", "u1");
    cache.patchChatMentionCreated(qc, "ws1", { userId: "u1", activeRoomId: "room1" }, "room1", "u2");
    cache.patchChatMentionCreated(qc, "ws1", { userId: null, activeRoomId: null }, "room1", "u2");
    expect(mentions()).toEqual([1, 0]);
  });
});
