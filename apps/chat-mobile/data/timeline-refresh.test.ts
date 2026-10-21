// The offline copy is kept current between opens: a push reads its room, and leaving the app reads
// the recent rooms whose cached timeline is behind; a timeline on screen is the socket's.
import { InfiniteQueryObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import type { RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "./chat-api";
import { roomTimelineOptions } from "./queries/chat";
import { chatKeys } from "./queries/chat-keys";
import { hydrateFromPush, refreshRoomHead, refreshStaleTimelines } from "./timeline-refresh";

const msg = (id: string, minute: number, roomId = "r1"): ChatMessageRecord =>
  ({ id, room_id: roomId, workspace_id: "w1", sender_id: "u2", kind: "text", body: id, created_at: `2026-10-22T10:${String(minute).padStart(2, "0")}:00Z`, reactions: {}, mentioned_user_ids: [] }) as unknown as ChatMessageRecord;
const room = (id: string, minute: number | null, unread = 0) =>
  ({ id, kind: "dm", unread_count: unread, mention_unread_count: 0, last_message_at: minute === null ? null : `2026-10-22T10:${String(minute).padStart(2, "0")}:00Z` }) as ChatRoomRecord;
const timeline = (...pages: ChatMessageRecord[][]): RoomTimeline => ({ pages, pageParams: pages.map((_, i) => (i === 0 ? null : { cursor: `p${i}` })) });
const env = { appUrl: "https://app.test", scheme: "uniworkchat" };
const workspaces = [{ id: "w1", slug: "ws", name: "W", organization_id: "o1", organization_slug: "org", organization_name: "O" }];

const listMessages = vi.spyOn(chatApi, "listMessages");
const listRooms = vi.spyOn(chatApi, "listRooms");
beforeEach(() => {
  listMessages.mockReset().mockImplementation(async (_ws, roomId) => [msg(`fresh-${roomId}`, 59, roomId)]);
  listRooms.mockReset().mockResolvedValue([room("r1", 59)]);
});

const pagesOf = (qc: QueryClient, roomId: string) => qc.getQueryData<RoomTimeline>(chatKeys.roomMessages("w1", roomId))?.pages.map((page) => page.map((m) => m.id));

describe("refreshRoomHead", () => {
  it("reads a room never loaded, and cuts one loaded back to its newest page before reading it once", async () => {
    const qc = new QueryClient();
    await refreshRoomHead(qc, "w1", "r1");
    expect(pagesOf(qc, "r1")).toEqual([["fresh-r1"]]);

    qc.setQueryData(chatKeys.roomMessages("w1", "r2"), timeline([msg("b", 2, "r2")], [msg("a", 1, "r2")]));
    listMessages.mockClear();
    await refreshRoomHead(qc, "w1", "r2");
    expect(listMessages).toHaveBeenCalledTimes(1);
    expect(pagesOf(qc, "r2")).toEqual([["fresh-r2"]]);
  });

  it("leaves a timeline on screen to the socket", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.roomMessages("w1", "r1"), timeline([msg("a", 1)]));
    const stop = new InfiniteQueryObserver(qc, { ...roomTimelineOptions("w1", "r1"), enabled: false }).subscribe(() => undefined);
    await refreshRoomHead(qc, "w1", "r1");
    expect(listMessages).not.toHaveBeenCalled();
    stop();
  });
});

describe("refreshStaleTimelines", () => {
  it("reads only the recent rooms whose timeline is behind: stale-marked, older than the preview, or unread and never loaded", async () => {
    // Ranked by activity: older 10:09, unread 10:08, quiet 10:07, current 10:05, marked 10:03, empty 10:02 — then past-limit.
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("w1"), [room("current", 5), room("older", 9), room("marked", 3), room("unread", 8, 2), room("quiet", 7), room("past-limit", null, 4), room("empty", 2)]);
    qc.setQueryData(chatKeys.roomMessages("w1", "current"), timeline([msg("c", 5, "current")]));
    qc.setQueryData(chatKeys.roomMessages("w1", "older"), timeline([msg("o", 4, "older")]));
    qc.setQueryData(chatKeys.roomMessages("w1", "marked"), timeline([msg("m", 3, "marked")]));
    await qc.invalidateQueries({ queryKey: chatKeys.roomMessages("w1", "marked"), refetchType: "none" });
    qc.setQueryData(chatKeys.roomMessages("w1", "empty"), { pages: [[]], pageParams: [null] });
    // Not a rooms list: ignored.
    qc.setQueryData(chatKeys.members("w1"), []);
    qc.setQueryData(["chat", "w2", "rooms"], "drift");

    await refreshStaleTimelines(qc, 6);
    // "empty" has a cached page with no message while the list says one came at 10:02.
    expect(listMessages.mock.calls.map(([, roomId]) => roomId).sort()).toEqual(["empty", "marked", "older", "unread"]);
  });

  it("a timeline on screen is never read by it", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("w1"), [room("r1", 9)]);
    qc.setQueryData(chatKeys.roomMessages("w1", "r1"), timeline([msg("a", 1)]));
    const stop = new InfiniteQueryObserver(qc, { ...roomTimelineOptions("w1", "r1"), enabled: false }).subscribe(() => undefined);
    await refreshStaleTimelines(qc);
    expect(listMessages).not.toHaveBeenCalled();
    stop();
  });
});

describe("hydrateFromPush", () => {
  it("reads the pushed room's newest page and its workspace's list", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["workspaces"], workspaces);
    await hydrateFromPush(qc, { url: "https://app.test/org/ws/chat?room=r1&message=m9" }, env);
    expect(pagesOf(qc, "r1")).toEqual([["fresh-r1"]]);
    expect(listRooms).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(chatKeys.rooms("w1"))).toEqual([room("r1", 59)]);
  });

  it("leaves a rooms list on screen to the socket", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["workspaces"], workspaces);
    qc.setQueryData(chatKeys.rooms("w1"), []);
    const stop = new QueryObserver(qc, { queryKey: chatKeys.rooms("w1"), enabled: false }).subscribe(() => undefined);
    await hydrateFromPush(qc, { url: "https://app.test/org/ws/chat?room=r1" }, env);
    expect(listRooms).not.toHaveBeenCalled();
    expect(listMessages).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does nothing for a push without a room, a call, another app's link or a workspace it does not know", async () => {
    const qc = new QueryClient();
    for (const data of [null, "x", {}, { url: 1 }, { url: "https://elsewhere.test/org/ws/chat?room=r1" }, { url: "https://app.test/org/ws/chat" }, { url: "https://app.test/org/ws/chat?room=r1&call=c1" }, { url: "https://app.test/org/ws/chat?room=r1" }]) {
      await hydrateFromPush(qc, data, env);
    }
    qc.setQueryData(["workspaces"], workspaces);
    await hydrateFromPush(qc, { url: "https://app.test/org/other/chat?room=r1" }, env);
    await hydrateFromPush(qc, { url: "https://app.test/other/ws/chat?room=r1" }, env);
    expect(listMessages).not.toHaveBeenCalled();
    expect(listRooms).not.toHaveBeenCalled();
  });
});
