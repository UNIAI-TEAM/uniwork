// Parity: packages/core/chat/realtime-cache.test.ts, with the viewer passed
// in (the web reads its auth store) and without the legacy workspace list and
// task-link caches the phone does not keep.
import { InfiniteQueryObserver, QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "./chat-api";
import {
  applyChatMessageResponse,
  bumpThreadRootReplyCount,
  fetchAndPatchChatMessage,
  isChatThreadReply,
  patchChatMessageDeleted,
  patchRoomSidebarFromMessage,
  removeMessageFromList,
  type ChatViewer,
} from "./chat-cache";
import { compareMessages, flattenRoomTimeline, type RoomMessagesPageParam, type RoomTimeline } from "./chat-timeline";
import { chatKeys } from "./queries/chat-keys";

const viewer: ChatViewer = { userId: "u1", activeRoomId: null };

const sampleMessage = (id: string, createdAt: string): ChatMessageRecord => ({
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
});

const timelineOf = (rows: ChatMessageRecord[]): RoomTimeline => ({ pages: [rows], pageParams: [null] });
/** A timeline a screen shows: realtime only asks the server for those (UNI-1078). */
const seed = (qc: QueryClient, queryKey: QueryKey, data: unknown) => {
  qc.setQueryData(queryKey, data);
  new QueryObserver(qc, { queryKey, enabled: false }).subscribe(() => {});
};
const timelineIds = (qc: QueryClient, roomId: string) => {
  const data = qc.getQueryData<RoomTimeline>(chatKeys.roomMessages("ws1", roomId));
  return data ? flattenRoomTimeline(data).map((m) => m.id) : undefined;
};

const threadReply = (id: string, createdAt: string): ChatMessageRecord => ({
  ...sampleMessage(id, createdAt),
  thread_root_id: "root1",
});
const threadIds = (qc: QueryClient) => {
  const data = qc.getQueryData<RoomTimeline>(chatKeys.threadMessages("ws1", "room1", "root1"));
  return data ? flattenRoomTimeline(data).sort(compareMessages).map((m) => m.id) : undefined;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("removeMessageFromList", () => {
  it("removes a message by id", () => {
    const existing = [sampleMessage("m1", "2026-01-01T10:00:00Z"), sampleMessage("m2", "2026-01-01T10:01:00Z")];
    expect(removeMessageFromList(existing, "m1").map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("patchRoomSidebarFromMessage", () => {
  it("updates preview and moves room to top", () => {
    const rooms: ChatRoomRecord[] = [
      {
        id: "room-a",
        kind: "dm",
        name: "A",
        workspace_id: "ws1",
        member_user_ids: [],
        member_count: 0,
        unread_count: 0,
        mention_unread_count: 0,
        last_message_at: "2026-01-01T09:00:00Z",
      },
      {
        id: "room-b",
        kind: "dm",
        name: "B",
        workspace_id: "ws1",
        member_user_ids: [],
        member_count: 0,
        unread_count: 0,
        mention_unread_count: 0,
        last_message_at: "2026-01-01T10:00:00Z",
      },
    ];
    const message = sampleMessage("m1", "2026-01-01T11:00:00Z");
    const next = patchRoomSidebarFromMessage(rooms, "room-a", message, { incrementUnread: true });
    expect(next[0]?.id).toBe("room-a");
    expect(next[0]?.last_message_body).toBe(message.body);
    expect(next[0]?.unread_count).toBe(1);
  });
});

describe("fetchAndPatchChatMessage unread", () => {
  it("does not locally increment unread for DM rooms (activity refetch owns the count)", async () => {
    const message = sampleMessage("m1", "2026-01-01T11:00:00Z");
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(message);
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), [
      {
        id: "room1",
        kind: "dm",
        name: "Bob",
        workspace_id: "ws1",
        member_user_ids: [],
        member_count: 0,
        unread_count: 0,
        mention_unread_count: 0,
      },
    ]);
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m1", created: true });

    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.unread_count).toBe(0);
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.last_message_body).toBe(
      message.body,
    );
  });

  // Migration 165 turned the workspace room into the default channel; it is
  // the one room without `chat.room.activity`, so it counts locally.
  it("increments unread locally for the default channel", async () => {
    const message = { ...sampleMessage("m1", "2026-01-01T11:00:00Z"), room_id: "ws-room" };
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(message);
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), [
      {
        id: "ws-room",
        kind: "channel",
        is_default: true,
        name: "General",
        workspace_id: "ws1",
        member_user_ids: [],
        member_count: 0,
        unread_count: 0,
        mention_unread_count: 0,
      },
    ]);
    seed(qc, chatKeys.roomMessages("ws1", "ws-room"), timelineOf([]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "ws-room", messageId: "m1", created: true });

    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.unread_count).toBe(1);
  });

  it("does not locally increment unread for a non-default channel", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(sampleMessage("m1", "2026-01-01T11:00:00Z"));
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), [
      {
        id: "room1",
        kind: "channel",
        is_default: false,
        name: "Dev",
        workspace_id: "ws1",
        member_user_ids: [],
        member_count: 0,
        unread_count: 0,
        mention_unread_count: 0,
      },
    ]);
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m1", created: true });

    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.unread_count).toBe(0);
  });

  // C2: every member online fetched every message of every room. Only a
  // timeline someone has loaded is worth the GET; `chat.room.activity` owns
  // the sidebar of the rest.
  it("does not GET a message whose room timeline is not loaded", async () => {
    const get = vi.spyOn(chatApi, "getMessage");
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), [
      {
        id: "room1",
        kind: "dm",
        name: "Bob",
        workspace_id: "ws1",
        member_user_ids: [],
        member_count: 0,
        unread_count: 0,
        mention_unread_count: 0,
      },
    ]);

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m1", created: true });

    expect(get).not.toHaveBeenCalled();
    expect(qc.getQueryData(chatKeys.roomMessages("ws1", "room1"))).toBeUndefined();
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.unread_count).toBe(0);
  });

  it("shows the new default-channel message in the sidebar while another room is open", async () => {
    const message = {
      ...sampleMessage("m-new", "2026-01-01T11:00:00Z"),
      room_id: "ws-room",
      body: "tin mới từ Chung",
    };
    const get = vi.spyOn(chatApi, "getMessage").mockResolvedValue(message);
    const qc = new QueryClient();
    seed(qc, chatKeys.rooms("ws1"), [
      {
        id: "ws-room",
        kind: "channel",
        is_default: true,
        name: "Chung",
        workspace_id: "ws1",
        member_user_ids: [],
        unread_count: 0,
        mention_unread_count: 0,
        last_message_body: "tin cũ của mình",
        last_message_sender_id: "u1",
        last_message_at: "2026-01-01T09:00:00Z",
      },
    ]);

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "ws-room", messageId: "m-new", created: true, senderId: "u2" });

    const room = qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0];
    expect(get).toHaveBeenCalledWith("ws1", "ws-room", "m-new");
    expect(room?.last_message_body).toBe("tin mới từ Chung");
    expect(room?.last_message_sender_id).toBe("u2");
    expect(room?.unread_count).toBe(1);
    expect(qc.getQueryData(chatKeys.roomMessages("ws1", "ws-room"))).toBeUndefined();
  });

  it("counts a new default-channel message without a GET when its timeline is not loaded", async () => {
    const get = vi.spyOn(chatApi, "getMessage");
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), [
      {
        id: "ws-room",
        kind: "channel",
        is_default: true,
        name: "General",
        workspace_id: "ws1",
        member_user_ids: [],
        member_count: 0,
        unread_count: 2,
        mention_unread_count: 0,
      },
    ]);

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "ws-room", messageId: "m1", created: true });
    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "ws-room", messageId: "m0", created: false });

    expect(get).not.toHaveBeenCalled();
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.unread_count).toBe(3);
  });

  // UNI-1079: a message this user sent from another tab or device counted as unread.
  it("does not count the user's own default-channel message", async () => {
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), [
      {
        id: "ws-room", kind: "channel", is_default: true, name: "General", workspace_id: "ws1",
        member_user_ids: [], member_count: 0, unread_count: 2, mention_unread_count: 0,
      },
    ]);

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "ws-room", messageId: "m1", created: true, senderId: "u1" });
    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "ws-room", messageId: "m2", created: true, senderId: "u2" });

    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.unread_count).toBe(3);
  });

  it("does not count an edit or a reaction as unread", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(sampleMessage("m1", "2026-01-01T11:00:00Z"));
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), [
      {
        id: "room1",
        kind: "channel",
        is_default: true,
        name: "General",
        workspace_id: "ws1",
        member_user_ids: [],
        member_count: 0,
        unread_count: 0,
        mention_unread_count: 0,
      },
    ]);
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([sampleMessage("m1", "2026-01-01T11:00:00Z")]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m1", created: false });

    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.unread_count).toBe(0);
  });

});

// UNI-1692: an edit, reaction or vote on an older message became the room's preview and sank it.
describe("fetchAndPatchChatMessage sidebar", () => {
  const sidebar = (): ChatRoomRecord[] => [
    {
      id: "room1", kind: "channel", is_default: false, name: "Dev", workspace_id: "ws1",
      member_user_ids: [], member_count: 0, unread_count: 0, mention_unread_count: 0,
      last_message_body: "mới", last_message_at: "2026-01-01T12:00:00Z",
    },
    {
      id: "room2", kind: "channel", is_default: false, name: "Ops", workspace_id: "ws1",
      member_user_ids: [], member_count: 0, unread_count: 0, mention_unread_count: 0,
      last_message_at: "2026-01-01T11:30:00Z",
    },
  ];

  it("keeps the sidebar preview and order when an older message is edited or reacted to", async () => {
    const old = sampleMessage("m-old", "2026-01-01T09:00:00Z");
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(old);
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), sidebar());
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([old]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m-old", created: false });

    const rooms = qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"));
    expect(rooms?.map((r) => r.id)).toEqual(["room1", "room2"]);
    expect(rooms?.[0]?.last_message_body).toBe("mới");
    expect(rooms?.[0]?.last_message_at).toBe("2026-01-01T12:00:00Z");
  });

  it("updates the preview when the latest message itself is edited", async () => {
    const latest = { ...sampleMessage("m-new", "2026-01-01T12:00:00Z"), body: "mới (đã sửa)" };
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(latest);
    const qc = new QueryClient();
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"), sidebar());
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([latest]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m-new", created: false });

    const rooms = qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"));
    expect(rooms?.map((r) => r.id)).toEqual(["room1", "room2"]);
    expect(rooms?.[0]?.last_message_body).toBe("mới (đã sửa)");
  });
});

describe("fetchAndPatchChatMessage timeline", () => {
  const twoPages = (): RoomTimeline => ({
    pages: [[sampleMessage("m3", "2026-01-01T10:03:00Z")], [sampleMessage("m1", "2026-01-01T10:01:00Z")]],
    pageParams: [null, { cursor: "c-m3" }],
  });

  it("appends a created message to the newest page", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(sampleMessage("m4", "2026-01-01T10:04:00Z"));
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), twoPages());

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m4", created: true });

    expect(timelineIds(qc, "room1")).toEqual(["m1", "m3", "m4"]);
  });

  // H4: an edit, reaction or vote on a message outside the loaded window used
  // to be inserted into it.
  it("never inserts an updated message that is not loaded", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(sampleMessage("m0", "2026-01-01T09:00:00Z"));
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), twoPages());

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m0", created: false });

    expect(timelineIds(qc, "room1")).toEqual(["m1", "m3"]);
  });

  it("updates a message on an older page in place", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue({
      ...sampleMessage("m1", "2026-01-01T10:01:00Z"),
      body: "edited",
    });
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), twoPages());

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m1", created: false });

    const data = qc.getQueryData<RoomTimeline>(chatKeys.roomMessages("ws1", "room1"));
    expect(data?.pages[1]?.[0]?.body).toBe("edited");
    expect(timelineIds(qc, "room1")).toEqual(["m1", "m3"]);
  });

  it("refetches instead of inserting a created message older than the newest page", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(sampleMessage("m2", "2026-01-01T10:02:00Z"));
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), twoPages());
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m2", created: true });

    expect(timelineIds(qc, "room1")).toEqual(["m1", "m3"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.roomMessages("ws1", "room1") });
  });
});

describe("patchChatMessageDeleted", () => {
  it("removes message from room cache", () => {
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), {
      pages: [[sampleMessage("m2", "2026-01-01T10:01:00Z")], [sampleMessage("m1", "2026-01-01T10:00:00Z")]],
      pageParams: [null, { cursor: "c" }],
    });
    patchChatMessageDeleted(qc, "ws1", "room1", "m1");
    expect(timelineIds(qc, "room1")).toEqual(["m2"]);
  });
});

// UNI-1077: an infinite query writes back the pages it started from when a
// fetch ends, so a patch applied meanwhile was lost.
describe("patches while the room timeline fetches", () => {
  const key = chatKeys.roomMessages("ws1", "room1");
  const m1 = sampleMessage("m1", "2026-01-01T10:01:00Z");
  const m3 = sampleMessage("m3", "2026-01-01T10:03:00Z");
  const m4 = sampleMessage("m4", "2026-01-01T10:04:00Z");

  function deferred() {
    let resolve!: (rows: ChatMessageRecord[]) => void;
    const promise = new Promise<ChatMessageRecord[]>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  function timelineQuery(qc: QueryClient, pages: { head: Promise<ChatMessageRecord[]>; older: Promise<ChatMessageRecord[]> }) {
    const observer = new InfiniteQueryObserver<ChatMessageRecord[], Error, RoomTimeline, typeof key, RoomMessagesPageParam>(qc, {
      queryKey: key,
      queryFn: ({ pageParam }) => (pageParam === null ? pages.head : pages.older),
      initialPageParam: null,
      getNextPageParam: (last) => (last[0] ? { cursor: `c-${last[0].id}` } : undefined),
    });
    observer.subscribe(() => {});
    return observer;
  }

  it("keeps a message created while an older page loads", async () => {
    const qc = new QueryClient();
    const older = deferred();
    const observer = timelineQuery(qc, { head: Promise.resolve([m3]), older: older.promise });
    await vi.waitFor(() => expect(timelineIds(qc, "room1")).toEqual(["m3"]));

    const next = observer.fetchNextPage();
    applyChatMessageResponse(qc, "ws1", "room1", m4, true);
    older.resolve([m1]);
    await next;

    await vi.waitFor(() => expect(timelineIds(qc, "room1")).toEqual(["m1", "m3", "m4"]));
  });

  it("keeps a message deleted while an older page loads deleted", async () => {
    const qc = new QueryClient();
    const older = deferred();
    const observer = timelineQuery(qc, { head: Promise.resolve([m3, m4]), older: older.promise });
    await vi.waitFor(() => expect(timelineIds(qc, "room1")).toEqual(["m3", "m4"]));

    const next = observer.fetchNextPage();
    patchChatMessageDeleted(qc, "ws1", "room1", "m4");
    older.resolve([m1]);
    await next;

    await vi.waitFor(() => expect(timelineIds(qc, "room1")).toEqual(["m1", "m3"]));
  });

  it("applies a frame that arrives during the first load after it", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(m4);
    const qc = new QueryClient();
    const head = deferred();
    timelineQuery(qc, { head: head.promise, older: Promise.resolve([]) });

    const patched = fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m4", created: true });
    head.resolve([m3]);
    await patched;

    expect(timelineIds(qc, "room1")).toEqual(["m3", "m4"]);
  });
});

// UNI-1078: a loaded timeline nobody shows cost one GET per frame.
describe("fetchAndPatchChatMessage for a timeline nobody shows", () => {
  it("asks nothing and marks the timeline stale", async () => {
    const get = vi.spyOn(chatApi, "getMessage");
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.roomMessages("ws1", "room1"), timelineOf([]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m1", created: true });

    expect(get).not.toHaveBeenCalled();
    expect(qc.getQueryState(chatKeys.roomMessages("ws1", "room1"))?.isInvalidated).toBe(true);
  });
});

describe("thread reply cache patches", () => {
  it("detects thread replies", () => {
    expect(isChatThreadReply(sampleMessage("m1", "2026-01-01T10:00:00Z"))).toBe(false);
    expect(
      isChatThreadReply({
        ...sampleMessage("m2", "2026-01-01T10:00:00Z"),
        thread_root_id: "root1",
      }),
    ).toBe(true);
  });

  it("bumps reply_count on the root", () => {
    const root = sampleMessage("root1", "2026-01-01T10:00:00Z");
    const reply = {
      ...sampleMessage("r1", "2026-01-01T10:01:00Z"),
      thread_root_id: "root1",
    };
    const next = bumpThreadRootReplyCount([root], reply);
    expect(next?.[0]?.reply_count).toBe(1);
    expect(next?.[0]?.last_reply_at).toBe(reply.created_at);
  });

  it("keeps thread replies off the main room list", async () => {
    const reply = {
      ...sampleMessage("r1", "2026-01-01T10:01:00Z"),
      thread_root_id: "root1",
      body: "in thread",
    };
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(reply);

    const qc = new QueryClient();
    const root = sampleMessage("root1", "2026-01-01T10:00:00Z");
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([root, reply]));
    seed(qc, chatKeys.threadMessages("ws1", "room1", "root1"), timelineOf([root]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "r1" });

    const main = flattenRoomTimeline(qc.getQueryData<RoomTimeline>(chatKeys.roomMessages("ws1", "room1"))!);
    expect(main.map((m) => m.id)).toEqual(["root1"]);
    expect(main[0]?.reply_count).toBe(1);
    expect(threadIds(qc)).toEqual(["root1", "r1"]);
  });

  it("counts a reply once when more frames for it reach an unloaded thread", async () => {
    const root = { ...sampleMessage("root1", "2026-01-01T10:00:00Z"), reply_count: 5, last_reply_at: "2026-01-01T10:00:30Z" };
    const r1 = { ...sampleMessage("r1", "2026-01-01T10:01:00Z"), thread_root_id: "root1" };
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(r1);

    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([root]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "r1", created: true });
    // A second frame for the same reply (an edit or a reaction).
    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "r1" });

    const main = flattenRoomTimeline(qc.getQueryData<RoomTimeline>(chatKeys.roomMessages("ws1", "room1"))!);
    expect(main[0]?.reply_count).toBe(6);
    expect(qc.getQueryData(chatKeys.threadMessages("ws1", "room1", "root1"))).toBeUndefined();
  });

  it("does not seed a thread cache nobody loaded", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(threadReply("r1", "2026-01-01T10:01:00Z"));
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([sampleMessage("root1", "2026-01-01T10:00:00Z")]));

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "r1" });

    expect(qc.getQueryData(chatKeys.threadMessages("ws1", "room1", "root1"))).toBeUndefined();
  });

  it("drops a deleted reply from an older page of the thread", () => {
    const qc = new QueryClient();
    const key = chatKeys.threadMessages("ws1", "room1", "root1");
    qc.setQueryData<RoomTimeline>(key, {
      pages: [
        [sampleMessage("root1", "2026-01-01T10:00:00Z"), threadReply("r3", "2026-01-01T10:03:00Z")],
        [threadReply("r1", "2026-01-01T10:01:00Z"), threadReply("r2", "2026-01-01T10:02:00Z")],
      ],
      pageParams: [null, { cursor: "c3" }],
    });

    patchChatMessageDeleted(qc, "ws1", "room1", "r1");

    expect(threadIds(qc)).toEqual(["root1", "r2", "r3"]);
  });

  it("refetches the thread for an edit of a reply older than its first page", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue({
      ...threadReply("r1", "2026-01-01T10:01:00Z"),
      body: "edited",
    });
    const qc = new QueryClient();
    const key = chatKeys.threadMessages("ws1", "room1", "root1");
    seed(qc, key, timelineOf([sampleMessage("root1", "2026-01-01T10:00:00Z"), threadReply("r3", "2026-01-01T10:03:00Z")]));
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "r1" });

    expect(threadIds(qc)).toEqual(["root1", "r3"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key, exact: true });
  });
});

const room = (id: string, extra: Partial<ChatRoomRecord> = {}): ChatRoomRecord => ({
  id,
  kind: "dm",
  name: id,
  workspace_id: "ws1",
  member_user_ids: [],
  member_count: 0,
  unread_count: 0,
  mention_unread_count: 0,
  ...extra,
});

describe("applyChatMessageResponse (a send's or an edit's answer)", () => {
  it("places a sent message and moves its room's preview", () => {
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([sampleMessage("m1", "2026-01-01T10:00:00Z")]));
    qc.setQueryData(chatKeys.rooms("ws1"), [room("other", { last_message_at: "2026-01-01T10:30:00Z" }), room("room1")]);
    applyChatMessageResponse(qc, "ws1", "room1", sampleMessage("m2", "2026-01-01T11:00:00Z"), true);
    expect(timelineIds(qc, "room1")).toEqual(["m1", "m2"]);
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.map((r) => r.id)).toEqual(["room1", "other"]);
  });

  it("leaves the preview alone for a thread reply and an edit, and refetches without an answer", () => {
    const qc = new QueryClient();
    const rooms = [room("room1")];
    qc.setQueryData(chatKeys.rooms("ws1"), rooms);
    applyChatMessageResponse(qc, "ws1", "room1", threadReply("r1", "2026-01-01T11:00:00Z"), true);
    applyChatMessageResponse(qc, "ws1", "room1", sampleMessage("m1", "2026-01-01T11:00:00Z"), false);
    expect(qc.getQueryData(chatKeys.rooms("ws1"))).toBe(rooms);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    applyChatMessageResponse(qc, "ws1", "room1", null, true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.roomMessages("ws1", "room1") });
  });

  it("does not count a message in the room open on screen", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("ws1"), [room("ws-room", { kind: "channel", is_default: true })]);
    await fetchAndPatchChatMessage(qc, "ws1", { userId: "u1", activeRoomId: "ws-room" }, { roomId: "ws-room", messageId: "m1", created: true });
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.unread_count).toBe(0);
  });

  it("asks nothing more when the message is gone by the time it is fetched", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(null);
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([]));
    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "m1", created: true });
    expect(timelineIds(qc, "room1")).toEqual([]);
  });

  it("skips the default-channel preview GET when the list is not on screen, the room is not the default or the message is a reply", async () => {
    const get = vi.spyOn(chatApi, "getMessage").mockResolvedValue(threadReply("r1", "2026-01-01T11:00:00Z"));
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("ws1"), [room("ws-room", { kind: "channel", is_default: true }), room("dm1")]);
    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "ws-room", messageId: "m1", created: true });
    expect(get).not.toHaveBeenCalled();
    new QueryObserver(qc, { queryKey: chatKeys.rooms("ws1"), enabled: false }).subscribe(() => {});
    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "dm1", messageId: "m1", created: true });
    expect(get).not.toHaveBeenCalled();
    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "ws-room", messageId: "r1", created: true });
    expect(get).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.last_message_body).toBeUndefined();
  });
});

describe("patchChatMentionCreated", () => {
  it("counts a mention locally only in the default channel, never one's own or the open room's", async () => {
    const { patchChatMentionCreated } = await import("./chat-cache");
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("ws1"), [room("ws-room", { kind: "channel", is_default: true }), room("dm1")]);
    patchChatMentionCreated(qc, "ws1", viewer, "ws-room", "u2");
    patchChatMentionCreated(qc, "ws1", viewer, "dm1", "u2");
    patchChatMentionCreated(qc, "ws1", viewer, "ws-room", "u1");
    patchChatMentionCreated(qc, "ws1", { userId: "u1", activeRoomId: "ws-room" }, "ws-room", "u2");
    patchChatMentionCreated(qc, "ws1", { userId: null, activeRoomId: null }, "ws-room", "u2");
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.map((r) => r.mention_unread_count)).toEqual([1, 0]);
    patchChatMentionCreated(new QueryClient(), "ws1", viewer, "ws-room", "u2");
  });
});

describe("patchChatRoomRead", () => {
  it("clears my own badges on any device's read, and moves a DM peer's Seen forward only", async () => {
    const { patchChatRoomRead } = await import("./chat-cache");
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("ws1"), [
      room("dm1", { unread_count: 3, mention_unread_count: 1, last_message_at: "2026-01-01T10:00:00Z" }),
      room("dm2", { last_message_at: "2026-01-01T10:00:00Z", peer_last_read_at: "2026-01-01T11:00:00Z" }),
      room("g1", { kind: "group", last_message_at: "2026-01-01T10:00:00Z" }),
      room("dm3"),
    ]);
    patchChatRoomRead(qc, "ws1", "u1", "dm1", "U1");
    patchChatRoomRead(qc, "ws1", "u1", "dm1", "u2");
    patchChatRoomRead(qc, "ws1", "u1", "dm2", "u2");
    patchChatRoomRead(qc, "ws1", "u1", "g1", "u2");
    patchChatRoomRead(qc, "ws1", "u1", "dm3", "u2");
    const rooms = qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"));
    expect(rooms?.[0]).toMatchObject({ unread_count: 0, mention_unread_count: 0, peer_last_read_at: "2026-01-01T10:00:00Z" });
    expect(rooms?.[1]?.peer_last_read_at).toBe("2026-01-01T11:00:00Z");
    expect(rooms?.[2]?.peer_last_read_at).toBeUndefined();
    expect(rooms?.[3]?.peer_last_read_at).toBeUndefined();
    patchChatRoomRead(new QueryClient(), "ws1", "u1", "dm1", "u2");
  });
});

describe("the page around a jumped-to message", () => {
  it("refetches on any change to the room's messages, since nothing patches it", () => {
    const qc = new QueryClient();
    const around = chatKeys.roomMessagesAround("ws1", "room1", "m1");
    qc.setQueryData(around, [sampleMessage("m1", "2026-01-01T10:00:00Z")]);
    applyChatMessageResponse(qc, "ws1", "room1", { ...sampleMessage("m1", "2026-01-01T10:00:00Z"), reactions: { "👍": 1 } }, false);
    expect(qc.getQueryState(around)?.isInvalidated).toBe(true);
    qc.setQueryData(around, []);
    patchChatMessageDeleted(qc, "ws1", "room1", "m1");
    expect(qc.getQueryState(around)?.isInvalidated).toBe(true);
  });
});

describe("list helpers at their edges", () => {
  it("reads a missing list as empty and sorts rooms without a message last", () => {
    expect(patchRoomSidebarFromMessage(undefined, "room1", sampleMessage("m1", "2026-01-01T10:00:00Z"))).toEqual([]);
    expect(removeMessageFromList(undefined, "m1")).toEqual([]);
    const next = patchRoomSidebarFromMessage([room("quiet"), room("room1"), room("quiet2")], "room1", sampleMessage("m1", "2026-01-01T10:00:00Z"));
    expect(next.map((r) => r.id)).toEqual(["room1", "quiet", "quiet2"]);
  });

  it("bumps only the root of the reply", () => {
    const other = sampleMessage("m0", "2026-01-01T09:00:00Z");
    expect(bumpThreadRootReplyCount([other], threadReply("r1", "2026-01-01T10:00:00Z"))[0]).toBe(other);
  });
});

describe("thread reply updates and deletes outside the loaded rows", () => {
  it("replaces a reply already in the open thread and leaves the root's count alone", async () => {
    const root = { ...sampleMessage("root1", "2026-01-01T10:00:00Z"), reply_count: 1 };
    const edited = { ...threadReply("r1", "2026-01-01T10:01:00Z"), body: "đã sửa" };
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(edited);
    const qc = new QueryClient();
    seed(qc, chatKeys.roomMessages("ws1", "room1"), timelineOf([root]));
    seed(qc, chatKeys.threadMessages("ws1", "room1", "root1"), timelineOf([root, threadReply("r1", "2026-01-01T10:01:00Z")]));
    await fetchAndPatchChatMessage(qc, "ws1", viewer, { roomId: "room1", messageId: "r1" });
    const thread = qc.getQueryData<RoomTimeline>(chatKeys.threadMessages("ws1", "room1", "root1"));
    expect(thread?.pages[0]?.[1]?.body).toBe("đã sửa");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(chatKeys.roomMessages("ws1", "room1"))!)[0]?.reply_count).toBe(1);
  });

  it("leaves timelines and threads that do not hold the deleted message as they are", () => {
    const qc = new QueryClient();
    const main = timelineOf([sampleMessage("m1", "2026-01-01T10:00:00Z")]);
    const thread = timelineOf([sampleMessage("root1", "2026-01-01T10:00:00Z")]);
    seed(qc, chatKeys.roomMessages("ws1", "room1"), main);
    qc.setQueryData(chatKeys.threadMessages("ws1", "room1", "root1"), thread);
    patchChatMessageDeleted(qc, "ws1", "room1", "gone");
    expect(qc.getQueryData(chatKeys.roomMessages("ws1", "room1"))).toBe(main);
    expect(qc.getQueryData(chatKeys.threadMessages("ws1", "room1", "root1"))).toBe(thread);
  });
});

