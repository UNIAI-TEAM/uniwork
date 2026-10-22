import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import * as chatApi from "../api/endpoints/chat";
import type { ChatMessageRecord } from "../api/endpoints/chat";
import { documentKeys } from "../documents/keys";
import { chatKeys } from "./chat-keys";
import {
  isChatMediaUrlFresh,
  useDeleteChatMessage,
  useEditChatMessage,
  useRefreshChatMessageMedia,
  useSendChatFileMessage,
  useSendChatDocumentLink,
  useSendChatDocumentMessage,
  useShareChatMessageAsDocument,
  useToggleChatMessagePin,
  useToggleChatReaction,
} from "./chat-hooks-messages";
import { flattenRoomTimeline, type RoomTimeline } from "./room-timeline-pages";
import { useSendChatThreadMessage } from "./thread-hooks";

const row = (id: string, minute: number, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u1",
  sender_display_name: "An",
  kind: "text",
  body: id,
  created_at: `2026-01-01T10:${String(minute).padStart(2, "0")}:00Z`,
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...extra,
});

const key = chatKeys.roomMessages("ws1", "room1");

function setup(rows: ChatMessageRecord[]) {
  const qc = new QueryClient();
  qc.setQueryData<RoomTimeline>(key, { pages: [rows], pageParams: [null] });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const timeline = () => flattenRoomTimeline(qc.getQueryData<RoomTimeline>(key)!);
  const refetchedTimeline = () => invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(key));
  return { qc, wrapper, timeline, refetchedTimeline };
}

// UNI-1077: each of these refetched every loaded page of the room, while the
// server's answer (and the realtime frame after it) already said what changed.
describe("chat message mutations patch the room timeline instead of refetching it", () => {
  afterEach(() => vi.restoreAllMocks());

  it("inserts a sent file message", async () => {
    vi.spyOn(chatApi, "sendChatFileMessage").mockResolvedValue(row("f1", 2, { kind: "file" }));
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useSendChatFileMessage("ws1"), { wrapper });

    await act(() =>
      result.current.mutateAsync({ roomId: "room1", file: new Blob(["x"]), filename: "x.txt", client_msg_id: "c1" }),
    );

    expect(timeline().map((m) => m.id)).toEqual(["m1", "f1"]);
    expect(refetchedTimeline()).toBe(false);
  });
  it("inserts a sent document message with its share level", async () => {
    const send = vi
      .spyOn(chatApi, "sendChatDocumentMessage")
      .mockResolvedValue(row("d1", 2, { kind: "document" }));
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useSendChatDocumentMessage("ws1"), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        roomId: "room1",
        file: new Blob(["x"]),
        filename: "plan.docx",
        share_level: "comment",
        client_msg_id: "c1",
      }),
    );

    expect(send).toHaveBeenCalledWith(
      "ws1",
      "room1",
      expect.objectContaining({ share_level: "comment", client_msg_id: "c1" }),
    );
    expect(timeline().map((m) => [m.id, m.kind])).toEqual([
      ["m1", "text"],
      ["d1", "document"],
    ]);
    expect(refetchedTimeline()).toBe(false);
  });

  it("inserts a document-link message with its level and reply, without refetching the timeline", async () => {
    const send = vi.spyOn(chatApi, "sendChatDocumentLink").mockResolvedValue(row("l1", 2, { kind: "document" }));
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useSendChatDocumentLink("ws1"), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        roomId: "room1",
        document_id: "D1",
        share_level: "view",
        client_msg_id: "c1",
        reply_to_message_id: "m1",
      }),
    );

    expect(send).toHaveBeenCalledWith("ws1", "room1", {
      document_id: "D1",
      share_level: "view",
      client_msg_id: "c1",
      reply_to_message_id: "m1",
    });
    expect(timeline().map((m) => [m.id, m.kind])).toEqual([
      ["m1", "text"],
      ["l1", "document"],
    ]);
    expect(refetchedTimeline()).toBe(false);
  });

  it("share-as-document replaces the message in place, never adds a row", async () => {
    const share = vi
      .spyOn(chatApi, "shareChatMessageAsDocument")
      .mockResolvedValue(row("m1", 1, { kind: "document" }));
    const { wrapper, timeline, refetchedTimeline } = setup([
      row("m1", 1, { kind: "file" }),
      row("m2", 2),
    ]);
    const { result } = renderHook(() => useShareChatMessageAsDocument("ws1", "room1"), { wrapper });

    await act(() =>
      result.current.mutateAsync({ messageId: "m1", share_level: "view", client_msg_id: "link-1" }),
    );

    expect(share).toHaveBeenCalledWith("ws1", "room1", "m1", {
      share_level: "view",
      client_msg_id: "link-1",
    });
    expect(timeline().map((m) => [m.id, m.kind])).toEqual([
      ["m1", "document"],
      ["m2", "text"],
    ]);
    expect(refetchedTimeline()).toBe(false);
  });

  it("replaces an edited message in place", async () => {
    vi.spyOn(chatApi, "editChatRoomMessage").mockResolvedValue(row("m1", 1, { body: "edited" }));
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useEditChatMessage("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "m1", body: "edited" }));

    expect(timeline()[0]?.body).toBe("edited");
    expect(refetchedTimeline()).toBe(false);
  });

  it("refetches when the server's answer carries no message", async () => {
    vi.spyOn(chatApi, "editChatRoomMessage").mockResolvedValue(null);
    const { wrapper, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useEditChatMessage("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "m1", body: "edited" }));

    expect(refetchedTimeline()).toBe(true);
  });

  it("drops a deleted message", async () => {
    vi.spyOn(chatApi, "deleteChatRoomMessage").mockResolvedValue(true);
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1), row("m2", 2)]);
    const { result } = renderHook(() => useDeleteChatMessage("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "m1" }));

    expect(timeline().map((m) => m.id)).toEqual(["m2"]);
    expect(refetchedTimeline()).toBe(false);
  });

  // UNI-2012 D8: the document may now be in the trash or lose its chat grants.
  it("invalidates the workspace's document keys and the room list after a delete", async () => {
    vi.spyOn(chatApi, "deleteChatRoomMessage").mockResolvedValue(true);
    const { qc, wrapper } = setup([row("d1", 1, { kind: "document" })]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteChatMessage("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "d1" }));

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(documentKeys.workspace("ws1"));
    expect(keys).toContainEqual(chatKeys.rooms("ws1"));
    expect(keys).not.toContainEqual(documentKeys.workspace("ws2"));
  });

  it("does not touch the document keys when the delete fails", async () => {
    vi.spyOn(chatApi, "deleteChatRoomMessage").mockRejectedValue(new Error("forbidden"));
    const { qc, wrapper } = setup([row("d1", 1, { kind: "document" })]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteChatMessage("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "d1" }).catch(() => undefined));

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).not.toContainEqual(documentKeys.workspace("ws1"));
  });

  it("counts a sent thread reply on its root", async () => {
    vi.spyOn(chatApi, "sendChatThreadMessage").mockResolvedValue(row("r1", 2, { thread_root_id: "m1" }));
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useSendChatThreadMessage("ws1", "room1"), { wrapper });

    await act(() => result.current.mutateAsync({ threadRootId: "m1", body: "r1" }));

    expect(timeline().map((m) => [m.id, m.reply_count])).toEqual([["m1", 1]]);
    expect(refetchedTimeline()).toBe(false);
  });
});

// UNI-1633: file and voice messages carry signed storage URLs that die.
describe("chat media URLs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("treats a URL as fresh only until a minute before it expires", () => {
    const now = Date.parse("2026-01-01T10:00:00Z");
    expect(isChatMediaUrlFresh("https://s/x", "2026-01-01T10:05:00Z", now)).toBe(true);
    expect(isChatMediaUrlFresh("https://s/x", "2026-01-01T10:00:30Z", now)).toBe(false);
    expect(isChatMediaUrlFresh("", "2026-01-01T10:05:00Z", now)).toBe(false);
    expect(isChatMediaUrlFresh("https://s/x", "", now)).toBe(false);
    expect(isChatMediaUrlFresh("https://s/x", "garbage", now)).toBe(false);
  });

  it("loads the message again and writes its fresh URLs into the room timeline", async () => {
    const fresh = row("f1", 1, { kind: "file", file: { filename: "a.png", content_type: "image/png", size_bytes: 1, url: "https://s/new", download_url: "", thumb_url: "", url_expires_at: "2026-01-01T11:00:00Z" } });
    vi.spyOn(chatApi, "getChatRoomMessage").mockResolvedValue(fresh);
    const { wrapper, timeline, refetchedTimeline } = setup([row("f1", 1, { kind: "file" })]);
    const { result } = renderHook(() => useRefreshChatMessageMedia("ws1", "room1"), { wrapper });

    await act(async () => {
      expect(await result.current("f1")).toEqual(fresh);
    });

    expect(chatApi.getChatRoomMessage).toHaveBeenCalledWith("ws1", "room1", "f1");
    expect(timeline()[0]?.file?.url).toBe("https://s/new");
    expect(refetchedTimeline()).toBe(false);
  });
});

// UNI-1966 (RFC-304): the server answers a reaction or pin on a converted
// message through the same resolver as a read, so the answer carries the
// document block. The cached card must keep its resolved block across it.
const resolvedBlock = {
  document_id: "doc1",
  viewer_has_access: true,
  viewer_level: "comment",
  title: "Báo cáo Q3",
  format: "docx",
  version_number: 3,
  revision: "42",
} as const;
const documentRow = (extra: Partial<ChatMessageRecord> = {}) =>
  row("d1", 1, { kind: "document", body: "Báo cáo Q3.docx", document: { ...resolvedBlock }, ...extra });

describe("a reaction or pin answer on a document message keeps the resolved block", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reaction: replaces the row in place, the card keeps its title and access, no row is added", async () => {
    vi.spyOn(chatApi, "toggleChatMessageReaction").mockResolvedValue(
      documentRow({ reactions: { "👍": 1 } }),
    );
    const { wrapper, timeline, refetchedTimeline } = setup([documentRow(), row("m2", 2)]);
    const { result } = renderHook(() => useToggleChatReaction("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "d1", emoji: "👍" }));

    const rows = timeline();
    expect(rows.map((m) => [m.id, m.kind])).toEqual([
      ["d1", "document"],
      ["m2", "text"],
    ]);
    expect(rows[0]?.reactions).toEqual({ "👍": 1 });
    expect(rows[0]?.document).toMatchObject({
      document_id: "doc1",
      title: "Báo cáo Q3",
      viewer_has_access: true,
      viewer_level: "comment",
      revision: "42",
    });
    expect(refetchedTimeline()).toBe(false);
  });

  it("pin: replaces the row in place, the card keeps its title and access, no row is added", async () => {
    vi.spyOn(chatApi, "toggleChatMessagePin").mockResolvedValue(documentRow({ pinned: true }));
    const { wrapper, timeline, refetchedTimeline } = setup([documentRow(), row("m2", 2)]);
    const { result } = renderHook(() => useToggleChatMessagePin("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "d1" }));

    const rows = timeline();
    expect(rows.map((m) => [m.id, m.kind, m.pinned])).toEqual([
      ["d1", "document", true],
      ["m2", "text", false],
    ]);
    expect(rows[0]?.document).toMatchObject({ title: "Báo cáo Q3", viewer_has_access: true });
    expect(refetchedTimeline()).toBe(false);
  });
});

describe("a malformed document block in a toggle answer degrades the card, never throws", () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const wire = (extra: Record<string, unknown>) => ({
    message: {
      id: "d1",
      room_id: "room1",
      workspace_id: "ws1",
      sender_id: "u1",
      sender_display_name: "An",
      kind: "document",
      body: "Báo cáo Q3.docx",
      created_at: "2026-01-01T10:01:00Z",
      ...extra,
      document: "not-an-object",
    },
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("reaction: the row stays (reactions applied), its block reads absent, nothing is added", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(wire({ reactions: { "👍": 1 } })));
    const { wrapper, timeline } = setup([documentRow(), row("m2", 2)]);
    const { result } = renderHook(() => useToggleChatReaction("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "d1", emoji: "👍" }));

    const rows = timeline();
    expect(rows.map((m) => [m.id, m.kind])).toEqual([
      ["d1", "document"],
      ["m2", "text"],
    ]);
    expect(rows[0]?.reactions).toEqual({ "👍": 1 });
    // The card then renders the neutral filename card (kind stays "document").
    expect(rows[0]?.document).toBeUndefined();
    expect(rows[0]?.body).toBe("Báo cáo Q3.docx");
  });

  it("pin: the row stays (pinned applied), its block reads absent, nothing is added", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(wire({ pinned: true })));
    const { wrapper, timeline } = setup([documentRow(), row("m2", 2)]);
    const { result } = renderHook(() => useToggleChatMessagePin("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "d1" }));

    const rows = timeline();
    expect(rows.map((m) => [m.id, m.kind, m.pinned])).toEqual([
      ["d1", "document", true],
      ["m2", "text", false],
    ]);
    expect(rows[0]?.document).toBeUndefined();
  });
});
