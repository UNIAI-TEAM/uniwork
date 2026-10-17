import { QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "../chat-api";
import { CHAT_HISTORY_PAGE_SIZE } from "../chat-timeline";
import {
  discoverableChannelsOptions,
  nicknamesOptions,
  roomAroundOptions,
  roomMembersOptions,
  roomSearchOptions,
  roomsOptions,
  roomTimelineOptions,
  threadTimelineOptions,
  workspaceMembersOptions,
} from "./chat";
import { chatKeys } from "./chat-keys";

const msg = (id: string, minute: number, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "r1",
  workspace_id: "w1",
  sender_id: "u1",
  sender_display_name: "An",
  kind: "text",
  body: id,
  created_at: `2026-10-17T10:${String(minute).padStart(2, "0")}:00Z`,
  cursor: `c-${id}`,
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe("chat query options", () => {
  it("loads a room's newest page without moving the read pointer, then pages older by cursor", async () => {
    const full = Array.from({ length: CHAT_HISTORY_PAGE_SIZE }, (_, i) => msg(`m${i + 10}`, i + 10));
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValueOnce(full).mockResolvedValueOnce([msg("m1", 1)]);
    const qc = new QueryClient();
    const options = roomTimelineOptions("w1", "r1");
    const data = await qc.fetchInfiniteQuery(options);
    expect(list).toHaveBeenLastCalledWith("w1", "r1", { limit: CHAT_HISTORY_PAGE_SIZE, markRead: false }, expect.anything());
    const next = options.getNextPageParam(data.pages[0]!, data.pages, null, data.pageParams);
    expect(next).toEqual({ cursor: "c-m10" });
    await options.queryFn!({ queryKey: options.queryKey, pageParam: next ?? null, signal: new AbortController().signal, direction: "forward", meta: undefined, client: qc });
    expect(list).toHaveBeenLastCalledWith("w1", "r1", { cursor: "c-m10", limit: CHAT_HISTORY_PAGE_SIZE, markRead: false }, expect.anything());
    expect(options.select?.({ pages: [[msg("b", 2)], [msg("a", 1)]], pageParams: [null, { cursor: "c" }] }).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("pages a thread from its replies only and lists it oldest first", async () => {
    const list = vi.spyOn(chatApi, "listThreadMessages").mockResolvedValue([]);
    const qc = new QueryClient();
    const options = threadTimelineOptions("w1", "r1", "root");
    await qc.fetchInfiniteQuery(options);
    expect(list).toHaveBeenCalledWith("w1", "r1", "root", { limit: CHAT_HISTORY_PAGE_SIZE });
    await options.queryFn!({ queryKey: options.queryKey, pageParam: { cursor: "c" }, signal: new AbortController().signal, direction: "forward", meta: undefined, client: qc });
    expect(list).toHaveBeenLastCalledWith("w1", "r1", "root", { cursor: "c", limit: CHAT_HISTORY_PAGE_SIZE });
    const replies = Array.from({ length: CHAT_HISTORY_PAGE_SIZE }, (_, i) => msg(`t${i}`, i + 2, { thread_root_id: "root" }));
    const firstPage = [msg("root", 1), ...replies];
    expect(options.getNextPageParam(firstPage, [firstPage], null, [null])).toEqual({ cursor: "c-t0" });
    expect(options.select?.({ pages: [[msg("root", 1), msg("t2", 3)], [msg("t1", 2)]], pageParams: [null, { cursor: "c" }] }).map((m) => m.id)).toEqual([
      "root",
      "t1",
      "t2",
    ]);
  });

  it("names every query by its key and calls the matching endpoint", async () => {
    const qc = new QueryClient();
    vi.spyOn(chatApi, "listRooms").mockResolvedValue([]);
    vi.spyOn(chatApi, "listMessagesAround").mockResolvedValue([]);
    vi.spyOn(chatApi, "listRoomMembers").mockResolvedValue([]);
    vi.spyOn(chatApi, "listNicknames").mockResolvedValue({});
    vi.spyOn(chatApi, "listWorkspaceMembers").mockResolvedValue([]);
    const channels = vi.spyOn(chatApi, "listChannels").mockResolvedValue([]);
    const search = vi.spyOn(chatApi, "searchMessages").mockResolvedValue([]);
    await qc.fetchQuery(roomsOptions("w1"));
    await qc.fetchQuery(roomAroundOptions("w1", "r1", "m1"));
    await qc.fetchQuery(roomMembersOptions("w1", "r1"));
    await qc.fetchQuery(nicknamesOptions("w1"));
    await qc.fetchQuery(workspaceMembersOptions("w1"));
    await qc.fetchQuery(discoverableChannelsOptions("w1"));
    await qc.fetchQuery(roomSearchOptions("w1", "r1", "  kế  "));
    expect(channels).toHaveBeenCalledWith("w1", "discoverable");
    expect(search).toHaveBeenCalledWith("w1", "r1", "kế");
    expect(roomSearchOptions("w1", "r1", " a ").enabled).toBe(false);
    expect(roomSearchOptions("w1", "r1", "kế").queryKey).toEqual(chatKeys.roomSearch("w1", "r1", "kế"));
    expect(chatApi.listMessagesAround).toHaveBeenCalledWith("w1", "r1", "m1");
  });
});
