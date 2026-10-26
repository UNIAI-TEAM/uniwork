// ADR 0039 phase 1 on the phone: a reconnect or a live check reads what changed from the change log and lands
// each change as a frame would; anything the log cannot answer leaves the old refetch to the caller.
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { flattenRoomTimeline, type RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ api: { request: vi.fn() } }));
const carried = vi.hoisted(() => ({ dropCarriedTimeline: vi.fn() }));
vi.mock("../query-persister", () => carried);

import { chatKeys } from "../queries/chat-keys";
import { REMOTE_CONFIG_FALLBACK, remoteConfigKey } from "../remote-config";
import type { ChatSyncPage } from "./api";
import type { ChatSyncHeads } from "./heads";
import { MAX_SYNC_PAGES, syncChat, type ChatSyncDeps } from "./sync";

const msg = (id: string, minute: number, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "r1",
  workspace_id: "w1",
  sender_id: "u2",
  sender_display_name: "Bình",
  kind: "text",
  body: id,
  created_at: `2026-10-22T10:${String(minute).padStart(2, "0")}:00Z`,
  cursor: `c-${id}`,
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...extra,
});

const show = (qc: QueryClient, key: QueryKey, data: unknown) => {
  qc.setQueryData(key, data);
  new QueryObserver(qc, { queryKey: key, enabled: false }).subscribe(() => {});
};
const mainKey = chatKeys.roomMessages("w1", "r1");
const shown = (qc: QueryClient) => flattenRoomTimeline(qc.getQueryData<RoomTimeline>(mainKey)!);

let stored: Map<string, number>;
const heads: ChatSyncHeads = {
  get: async (userId, wsId) => stored.get(`${userId}/${wsId}`) ?? null,
  set: async (userId, wsId, head) => void stored.set(`${userId}/${wsId}`, head),
};
const sync = vi.fn<ChatSyncDeps["api"]["sync"]>();
const getMessage = vi.fn<ChatSyncDeps["getMessage"]>();
const deps: ChatSyncDeps = { api: { sync }, heads, getMessage };
const page = (head: number, changes: ChatSyncPage["changes"] = [], reset = false, more?: boolean): ChatSyncPage => ({
  head,
  reset,
  changes,
  ...(more === undefined ? {} : { more }),
});

beforeEach(() => {
  stored = new Map([["u1/w1", 10]]);
  sync.mockReset();
  getMessage.mockReset();
  carried.dropCarriedTimeline.mockReset();
});

describe("syncChat", () => {
  it("lands each change as a frame would, then moves the head", async () => {
    const qc = new QueryClient();
    show(qc, mainKey, { pages: [[msg("m1", 1), msg("m2", 2)]], pageParams: [null] });
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("w1"), []);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    getMessage.mockResolvedValueOnce(msg("m1", 1, { body: "m1 (sửa)", reply_count: 1 }));
    sync.mockResolvedValueOnce(
      page(16, [
        { seq: 11, room_id: "r1", message_id: "m3", kind: "created", message: msg("m3", 3) },
        { seq: 12, room_id: "r1", message_id: "m1", kind: "updated", message: msg("m1", 1, { body: "m1 (sửa)" }) },
        { seq: 13, room_id: "r1", message_id: "m2", kind: "deleted", message: null },
        { seq: 14, room_id: "r1", message_id: "t1", kind: "created", message: msg("t1", 4, { thread_root_id: "m1" }) },
        { seq: 15, room_id: "r9", message_id: "x1", kind: "created", message: msg("x1", 5, { room_id: "r9" }) },
        { seq: 16, room_id: "r9", message_id: "x2", kind: "updated", message: msg("x2", 0, { room_id: "r9" }) },
      ]),
    );
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("synced");
    expect(sync).toHaveBeenCalledWith("w1", 10);
    expect(shown(qc).map((m) => [m.id, m.body, m.reply_count])).toEqual([
      ["m1", "m1 (sửa)", 1],
      ["m3", "m3", 0],
    ]);
    // The reply's thread refetches where shown; its root was read again for its count.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.threadMessages("w1", "r1", "m1"), exact: true });
    expect(getMessage).toHaveBeenCalledWith("w1", "r1", "m1");
    // A room nobody shows: the list follows a new message; an edit drops the copy only the disk holds.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("w1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.unreadSummary() });
    // (A delete drops it too, as a delete frame does: chat-cache.ts.)
    expect(carried.dropCarriedTimeline.mock.calls.filter(([, room]) => room === "r9")).toEqual([["w1", "r9"]]);
    expect(stored.get("u1/w1")).toBe(16);
  });

  it("a thread root nobody shows, or one that cannot be read, is left to the next open", async () => {
    const qc = new QueryClient();
    show(qc, mainKey, { pages: [[msg("m1", 1)]], pageParams: [null] });
    getMessage.mockRejectedValueOnce(new TypeError("Network request failed"));
    sync.mockResolvedValueOnce(
      page(12, [
        { seq: 11, room_id: "r1", message_id: "t1", kind: "created", message: msg("t1", 2, { thread_root_id: "m1" }) },
        { seq: 12, room_id: "r9", message_id: "t2", kind: "created", message: msg("t2", 2, { room_id: "r9", thread_root_id: "x" }) },
        { seq: 12, room_id: "r1", message_id: "t3", kind: "updated", message: msg("t3", 2, { thread_root_id: "m1" }) },
      ]),
    );
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("synced");
    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(shown(qc)[0]?.reply_count).toBe(0);
    expect(stored.get("u1/w1")).toBe(12);
  });

  it("a phone without a head, or one the log has moved past, starts from the head the log gives", async () => {
    const qc = new QueryClient();
    stored.clear();
    sync.mockResolvedValueOnce(page(30));
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("unavailable");
    expect(sync).toHaveBeenLastCalledWith("w1", null);
    expect(stored.get("u1/w1")).toBe(30);

    sync.mockResolvedValueOnce(page(900, [], true));
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("reset");
    expect(stored.get("u1/w1")).toBe(900);
  });

  // Review P2: past 200 changes the server used to answer reset, and every shown timeline reloaded every minute.
  it("follows the pages the log hands out, moving the head after each", async () => {
    const qc = new QueryClient();
    show(qc, mainKey, { pages: [[msg("m1", 1)]], pageParams: [null] });
    sync
      .mockResolvedValueOnce(page(210, [{ seq: 11, room_id: "r1", message_id: "m2", kind: "created", message: msg("m2", 2) }], false, true))
      .mockResolvedValueOnce(page(250, [{ seq: 240, room_id: "r1", message_id: "m3", kind: "created", message: msg("m3", 3) }], false, false));
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("synced");
    expect(sync.mock.calls.map(([, since]) => since)).toEqual([10, 210]);
    expect(shown(qc).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(stored.get("u1/w1")).toBe(250);
  });

  it("a backlog longer than the page budget is a reset from where it got to; a page that fails is no answer", async () => {
    const qc = new QueryClient();
    for (let i = 1; i <= MAX_SYNC_PAGES; i += 1) sync.mockResolvedValueOnce(page(10 + i * 200, [], false, true));
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("reset");
    expect(sync).toHaveBeenCalledTimes(MAX_SYNC_PAGES);
    expect(stored.get("u1/w1")).toBe(10 + MAX_SYNC_PAGES * 200);

    sync.mockReset().mockResolvedValueOnce(page(1_210, [], false, true)).mockResolvedValueOnce(null);
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("unavailable");
    expect(stored.get("u1/w1")).toBe(1_210);
  });

  it("switched off, failed or unreadable: nothing is applied and the head stays", async () => {
    const off = new QueryClient();
    off.setQueryData(remoteConfigKey, { ...REMOTE_CONFIG_FALLBACK, flags: { unichat_mobile_chat_sync: false } });
    expect(await syncChat(off, "w1", "u1", deps)).toBe("unavailable");
    expect(sync).not.toHaveBeenCalled();

    const qc = new QueryClient();
    sync.mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce(null);
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("unavailable");
    expect(await syncChat(qc, "w1", "u1", deps)).toBe("unavailable");
    expect(stored.get("u1/w1")).toBe(10);
  });

  it("runs once per person and workspace at a time; the app's wiring reads the real log", async () => {
    const qc = new QueryClient();
    let answer: (value: ChatSyncPage) => void = () => undefined;
    sync.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const first = syncChat(qc, "w1", "u1", deps);
    expect(syncChat(qc, "w1", "u1", deps)).toBe(first);
    answer(page(10));
    expect(await first).toBe("synced");
    expect(sync).toHaveBeenCalledTimes(1);

    // The default wiring: the transport is mocked to answer nothing, which is no answer.
    stored.clear();
    expect(await syncChat(qc, "w2", "u1")).toBe("unavailable");
  });
});
