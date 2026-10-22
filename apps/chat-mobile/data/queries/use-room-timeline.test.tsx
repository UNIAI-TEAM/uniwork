// A room's timeline as its screen reads it: the newest page and the local
// sends merged in, the unread snapshot taken before the open marks the room
// read, a reopened room cut back to its newest page, and the page around an
// anchored message while the screen shows it.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatMessageSchema, ChatRoomSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { chatApi } from "@/data/chat-api";
import { chatKeys } from "@/data/queries/chat-keys";
import { useChatSendStore } from "@/data/stores/chat-send-store";
import { usePendingOpsStore } from "@/data/stores/pending-ops-store";
import { useRoomTimeline } from "./use-room-timeline";

const T0 = Date.UTC(2026, 9, 21, 2, 0);
const record = (id: string, minute: number) =>
  ChatMessageSchema.parse({
    id,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: "U2",
    sender_display_name: "Bình",
    kind: "text",
    body: `message ${id}`,
    created_at: new Date(T0 + minute * 60_000).toISOString(),
  });
const room = (id: string, extra: Record<string, unknown> = {}) =>
  ChatRoomSchema.parse({ id, kind: "dm", name: id, workspace_id: "w1", member_count: 2, member_user_ids: ["ME", "U2"], ...extra });

function setup(seed?: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  seed?.(qc);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

const rooms = [
  room("r1", { unread_count: 3, last_read_at: "2026-10-21T02:05:00Z" }),
  room("r2", { unread_count: 2 }),
  room("r3", { unread_count: 1 }),
];

beforeEach(() => {
  jest.spyOn(chatApi, "listRooms").mockResolvedValue(rooms);
  jest.spyOn(chatApi, "listMessages").mockResolvedValue([record("m1", 1), record("m2", 2)]);
  jest.spyOn(chatApi, "listMessagesAround").mockResolvedValue([record("old1", -60), record("old2", -59)]);
  useChatSendStore.setState({ entries: [] });
  usePendingOpsStore.setState({ ops: [] });
});
afterEach(() => jest.restoreAllMocks());

describe("useRoomTimeline", () => {
  it("reads the newest page, the unread snapshot from the inbox and the other rooms' unread", async () => {
    const { wrapper } = setup((qc) => qc.setQueryData(chatKeys.rooms("w1"), rooms));
    const { result } = await renderHook(() => useRoomTimeline({ wsId: "w1", roomId: "r1", userId: "ME", anchorId: null }), { wrapper });
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]));
    expect(result.current.unread).toEqual({ since: "2026-10-21T02:05:00Z", count: 3 });
    expect(result.current.otherUnread).toBe(3);
    expect(result.current.newestId).toBe("m2");
    expect(result.current.anchorRows).toBeNull();
    expect(result.current.anchorPending).toBe(false);
    expect(result.current.historyComplete).toBe(true);
  });

  it("opens with no snapshot and no other unread while the inbox is not loaded", async () => {
    jest.mocked(chatApi.listRooms).mockReturnValue(new Promise(() => undefined));
    const { wrapper } = setup();
    const { result } = await renderHook(() => useRoomTimeline({ wsId: "w1", roomId: "r1", userId: "ME", anchorId: null }), { wrapper });
    expect(result.current.unread).toBeNull();
    expect(result.current.otherUnread).toBe(0);
    expect(result.current.newestId).toBeNull();
  });

  it("cuts a reopened room back to its newest page and refreshes it", async () => {
    const key = chatKeys.roomMessages("w1", "r1");
    const { qc, wrapper } = setup((client) =>
      client.setQueryData(key, { pages: [[record("m1", 1)], [record("m0", 0)]], pageParams: [null, { cursor: "c" }] }),
    );
    const invalidate = jest.spyOn(qc, "invalidateQueries");
    await renderHook(() => useRoomTimeline({ wsId: "w1", roomId: "r1", userId: "ME", anchorId: null }), { wrapper });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  });

  it("shows the page around an anchor outside the loaded window, and the local sends on the newest page", async () => {
    useChatSendStore.setState({
      entries: [{ workspaceId: "w1", roomId: "r1", senderId: "ME", clientMsgId: "c1", body: "đang gửi", createdAt: T0 + 3 * 60_000, status: "queued" }],
    });
    const { wrapper } = setup();
    const anchored = await renderHook(() => useRoomTimeline({ wsId: "w1", roomId: "r1", userId: "ME", anchorId: "old1" }), { wrapper });
    await waitFor(() => expect(anchored.result.current.anchorRows?.map((m) => m.id)).toEqual(["old1", "old2"]));
    expect(anchored.result.current.messages.map((m) => m.id)).toEqual(["old1", "old2"]);

    const latest = await renderHook(() => useRoomTimeline({ wsId: "w1", roomId: "r1", userId: "ME", anchorId: "m2" }), { wrapper });
    await waitFor(() => expect(latest.result.current.messages.map((m) => m.body)).toEqual(["message m1", "message m2", "đang gửi"]));
    expect(latest.result.current.anchorRows).toBeNull();
  });

  // Audit P2: a refetch on the network-back edge, landing before the queued wishes go, must not undo them on screen.
  it("lays the queued edit and delete over a refetched server copy, on the newest page and the anchored one", async () => {
    const base = { workspaceId: "w1", roomId: "r1", userId: "ME", createdAt: T0, rev: 1, verify: false };
    usePendingOpsStore.setState({
      ops: [
        { ...base, kind: "edit", key: "edit/w1/m1", messageId: "m1", body: "đã sửa" },
        { ...base, kind: "delete", key: "delete/w1/m2", messageId: "m2" },
        { ...base, kind: "delete", key: "delete/w1/old2", messageId: "old2" },
        { ...base, kind: "delete", key: "delete/w1/x", messageId: "x", roomId: "r9" },
      ],
    });
    const { qc, wrapper } = setup();
    const { result } = await renderHook(() => useRoomTimeline({ wsId: "w1", roomId: "r1", userId: "ME", anchorId: null }), { wrapper });
    await waitFor(() => expect(result.current.messages.map((m) => m.body)).toEqual(["đã sửa"]));
    // The server's older copy comes back (a refetch): the wishes still show.
    await act(async () => {
      await qc.refetchQueries({ queryKey: chatKeys.roomMessages("w1", "r1") });
    });
    expect(result.current.messages.map((m) => [m.id, m.body])).toEqual([["m1", "đã sửa"]]);
    // Delivered: the overlay steps aside and the server's copy shows as it is.
    await act(async () => usePendingOpsStore.setState({ ops: [] }));
    await waitFor(() => expect(result.current.messages.map((m) => m.body)).toEqual(["message m1", "message m2"]));

    await act(async () => usePendingOpsStore.setState({ ops: [{ ...base, kind: "delete", key: "delete/w1/old2", messageId: "old2" }] }));
    const anchored = await renderHook(() => useRoomTimeline({ wsId: "w1", roomId: "r1", userId: "ME", anchorId: "old1" }), { wrapper });
    await waitFor(() => expect(anchored.result.current.anchorRows?.map((m) => m.id)).toEqual(["old1"]));
  });
});
