import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessageLinkRecord } from "../api/endpoints/chat-links";
import { chatKeys } from "./chat-keys";
import {
  chunkMessageIds,
  ensureRoomMessageLinksLoaded,
  mergeBatchIntoRoomLinksCache,
  messageIdsMissingFromCache,
  ROOM_MESSAGE_LINKS_BATCH,
  sliceRoomLinksCache,
} from "./room-message-links-cache";

const link = (
  partial: Partial<ChatMessageLinkRecord> & Pick<ChatMessageLinkRecord, "id" | "message_id" | "target_id">,
): ChatMessageLinkRecord => ({
  target_type: "task",
  relation: "mentions",
  created_by: "u1",
  created_at: "2026-09-10T10:00:00Z",
  ...partial,
});

describe("room message links cache", () => {
  it("chunks ids at the server batch size", () => {
    const ids = Array.from({ length: ROOM_MESSAGE_LINKS_BATCH + 3 }, (_, i) => `m${i}`);
    const batches = chunkMessageIds(ids, ROOM_MESSAGE_LINKS_BATCH);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(ROOM_MESSAGE_LINKS_BATCH);
    expect(batches[1]).toHaveLength(3);
  });

  it("records empty lists for messages with no links", () => {
    const merged = mergeBatchIntoRoomLinksCache(
      new Map(),
      ["m1", "m2"],
      [link({ id: "l1", message_id: "m1", target_id: "t1" })],
    );
    expect(merged.get("m1")).toHaveLength(1);
    expect(merged.get("m2")).toEqual([]);
  });

  it("finds ids missing from cache", () => {
    const cache = new Map([["m1", []]]);
    expect(messageIdsMissingFromCache(["m1", "m2"], cache)).toEqual(["m2"]);
  });

  it("slices cache to visible ids only", () => {
    const cache = new Map([
      ["m1", []],
      ["m2", [link({ id: "l1", message_id: "m2", target_id: "t1" })]],
    ]);
    const slice = sliceRoomLinksCache(cache, ["m2"]);
    expect(slice.size).toBe(1);
    expect(slice.get("m2")).toHaveLength(1);
  });

  it("fetches only missing ids and merges into the room cache", async () => {
    const qc = new QueryClient();
    const wsId = "ws1";
    const roomId = "r1";
    const roomKey = chatKeys.roomMessageLinksRoom(wsId, roomId);
    qc.setQueryData(roomKey, new Map([["m1", []]]));

    const listLinks = vi.fn(async (_ws: string, _room: string, ids: string[]) => {
      if (ids.join(",") === "m2,m3") {
        return [link({ id: "l1", message_id: "m2", target_id: "t1" })];
      }
      return [];
    });

    const visible = await ensureRoomMessageLinksLoaded(qc, {
      workspaceId: wsId,
      roomId,
      messageIds: ["m3", "m1", "m2"],
      listLinks,
    });

    expect(listLinks).toHaveBeenCalledTimes(1);
    expect(listLinks).toHaveBeenCalledWith(wsId, roomId, ["m2", "m3"]);
    expect(visible.get("m1")).toEqual([]);
    expect(visible.get("m2")).toHaveLength(1);
    expect(visible.get("m3")).toEqual([]);

    const stored = qc.getQueryData<Map<string, ChatMessageLinkRecord[]>>(roomKey);
    expect(stored?.has("m1")).toBe(true);
    expect(stored?.has("m2")).toBe(true);
    expect(stored?.has("m3")).toBe(true);
  });

  it("does not call the API when every id is already cached", async () => {
    const qc = new QueryClient();
    const wsId = "ws1";
    const roomId = "r1";
    const roomKey = chatKeys.roomMessageLinksRoom(wsId, roomId);
    qc.setQueryData(
      roomKey,
      new Map([
        ["m1", []],
        ["m2", []],
      ]),
    );

    const listLinks = vi.fn(async () => []);
    await ensureRoomMessageLinksLoaded(qc, {
      workspaceId: wsId,
      roomId,
      messageIds: ["m2", "m1"],
      listLinks,
    });

    expect(listLinks).not.toHaveBeenCalled();
  });
});
