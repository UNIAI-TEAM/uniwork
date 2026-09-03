import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import {
  createChatGroup,
  ensureWorkspaceChatRoom,
  getWorkspaceChatRoom,
  leaveChatRoom,
  listChatRoomMessages,
  listChatRooms,
  listWorkspaceChatMessages,
  lookupChatUser,
  resolveDMRoom,
  sendChatRoomMessage,
  sendWorkspaceChatMessage,
  signalChatTyping,
  signalChatVoiceAccept,
  signalChatVoiceHangup,
  signalChatVoiceInvite,
  toggleChatMessageReaction,
  getChatBlockStatus,
  blockChatUser,
  unblockChatUser,
} from "./chat";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("chat endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("getWorkspaceChatRoom degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await getWorkspaceChatRoom("ws1")).toBeNull();
  });

  it("getWorkspaceChatRoom returns workspace without room_id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ workspace_id: "ws1", enabled: true }),
    );
    expect(await getWorkspaceChatRoom("ws1")).toEqual({ workspace_id: "ws1", enabled: true });
  });

  it("getWorkspaceChatRoom returns null when chat is disabled on server", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ workspace_id: "ws1", enabled: false }),
    );
    expect(await getWorkspaceChatRoom("ws1")).toBeNull();
  });

  it("ensureWorkspaceChatRoom returns room on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ room_id: "01ROOM", workspace_id: "ws1", enabled: true }),
    );
    const room = await ensureWorkspaceChatRoom("ws1");
    expect(room?.room_id).toBe("01ROOM");
  });

  it("listWorkspaceChatMessages degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listWorkspaceChatMessages("ws1")).toEqual([]);
  });

  it("sendWorkspaceChatMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await sendWorkspaceChatMessage("ws1", { body: "hi" })).toBeNull();
  });

  it("lookupChatUser degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await lookupChatUser("ws1", "a@b.com")).toBeNull();
  });

  it("listChatRooms degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listChatRooms("ws1")).toEqual([]);
  });

  it("listChatRooms accepts null member_user_ids from Go", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        rooms: [
          {
            id: "room-dm",
            kind: "dm",
            name: "Peer",
            workspace_id: "ws1",
            member_user_ids: null,
            peer_user_id: "user-b",
            peer_email: "b@test.com",
            peer_display_name: "B",
          },
        ],
      }),
    );
    expect(await listChatRooms("ws1")).toEqual([
      {
        id: "room-dm",
        kind: "dm",
        name: "Peer",
        workspace_id: "ws1",
        member_user_ids: [],
        unread_count: 0,
        peer_user_id: "user-b",
        peer_email: "b@test.com",
        peer_display_name: "B",
      },
    ]);
  });

  it("resolveDMRoom degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await resolveDMRoom("ws1", "user1")).toBeNull();
  });

  it("createChatGroup degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await createChatGroup("ws1", { name: "G", member_user_ids: ["a", "b"] })).toBeNull();
  });

  it("listChatRoomMessages degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listChatRoomMessages("ws1", "room1")).toEqual([]);
  });

  it("sendChatRoomMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await sendChatRoomMessage("ws1", "room1", { body: "hi" })).toBeNull();
  });

  it("leaveChatRoom degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await leaveChatRoom("ws1", "room1")).toBe(false);
  });

  it("signalChatVoiceInvite degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await signalChatVoiceInvite("ws1", "room1", "call1")).toBe(false);
  });

  it("signalChatVoiceAccept degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await signalChatVoiceAccept("ws1", "room1", "call1")).toBe(false);
  });

  it("signalChatVoiceHangup degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await signalChatVoiceHangup("ws1", "room1", "call1")).toBe(false);
  });

  it("signalChatTyping degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await signalChatTyping("ws1", "room1")).toBe(false);
  });

  it("toggleChatMessageReaction degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await toggleChatMessageReaction("ws1", "room1", "msg1", "👍")).toBeNull();
  });

  it("getChatBlockStatus degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await getChatBlockStatus("ws1", "user1")).toEqual({
      blocked_by_me: false,
      blocked_me: false,
    });
  });

  it("blockChatUser degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await blockChatUser("ws1", "user1")).toBe(false);
  });

  it("unblockChatUser degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await unblockChatUser("ws1", "user1")).toBe(false);
  });
});
