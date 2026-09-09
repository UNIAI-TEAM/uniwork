import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import {
  createChatGroup,
  ensureWorkspaceChatRoom,
  getWorkspaceChatRoom,
  leaveChatRoom,
  removeWorkspaceChatRoomMember,
  removeChatRoomMember,
  listChatRoomMembers,
  patchChatRoomMember,
  listChatRoomMessages,
  searchChatRoomMessages,
  listChatRoomMessagesAround,
  listChatRooms,
  listWorkspaceChatMessages,
  lookupChatUser,
  lookupChatUserById,
  resolveDMRoom,
  sendChatRoomMessage,
  sendChatVoiceMessage,
  sendChatFileMessage,
  loadChatVoiceBlob,
  loadChatFileBlob,
  sendWorkspaceChatMessage,
  signalChatTyping,
  signalChatVoiceAccept,
  signalChatVoiceHangup,
  signalChatVoiceInvite,
  listPendingChatVoiceInvites,
  toggleChatMessageReaction,
  editChatRoomMessage,
  deleteChatRoomMessage,
  toggleChatMessagePin,
  getChatBlockStatus,
  getChatRoomMessage,
  blockChatUser,
  unblockChatUser,
  listChatNicknames,
  setChatNickname,
  searchChatGifs,
  listTrendingChatGifs,
  searchChatStickers,
  listTrendingChatStickers,
  getChatMediaStatus,
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
        mention_unread_count: 0,
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

  it("getChatRoomMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await getChatRoomMessage("ws1", "room1", "m1")).toBeNull();
  });

  it("listChatRoomMessages keeps the client_msg_id echo", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        messages: [
          {
            id: "m1",
            room_id: "room1",
            workspace_id: "ws1",
            sender_id: "u1",
            sender_display_name: "A",
            body: "hi",
            created_at: "2026-09-05T00:00:00Z",
            client_msg_id: "550e8400-e29b-41d4-a716-446655440000",
          },
        ],
      }),
    );
    const messages = await listChatRoomMessages("ws1", "room1");
    expect(messages[0]?.client_msg_id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("sendChatRoomMessage forwards client_msg_id in request body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        message: {
          id: "m1",
          room_id: "room1",
          workspace_id: "ws1",
          sender_id: "u1",
          sender_display_name: "A",
          body: "hi",
          created_at: "2026-09-05T00:00:00Z",
        },
      }),
    );
    await sendChatRoomMessage("ws1", "room1", {
      body: "hi",
      client_msg_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      body: "hi",
      client_msg_id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("sendChatRoomMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await sendChatRoomMessage("ws1", "room1", { body: "hi" })).toBeNull();
  });

  it("sendChatVoiceMessage sends multipart fields and degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const file = new Blob(["voice"], { type: "audio/webm;codecs=opus" });
    expect(
      await sendChatVoiceMessage("ws1", "room1", {
        file,
        duration_ms: 1234,
        client_msg_id: "client-1",
        reply_to_message_id: "reply-1",
      }),
    ).toBeNull();
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("duration_ms")).toBe("1234");
    expect(form.get("client_msg_id")).toBe("client-1");
    expect(form.get("reply_to_message_id")).toBe("reply-1");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("sendChatFileMessage sends multipart fields and degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const file = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    expect(
      await sendChatFileMessage("ws1", "room1", {
        file,
        filename: "sprint.pdf",
        client_msg_id: "client-file-1",
        reply_to_message_id: "reply-1",
      }),
    ).toBeNull();
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("client_msg_id")).toBe("client-file-1");
    expect(form.get("reply_to_message_id")).toBe("reply-1");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("loadChatVoiceBlob returns authenticated binary response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("voice", { headers: { "Content-Type": "audio/webm" } }),
    );
    const blob = await loadChatVoiceBlob("ws1", "room1", "message1");
    expect(blob.type).toBe("audio/webm");
    // jsdom Blob has size/type but no .text()/.arrayBuffer(); FileReader still works.
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsText(blob);
    });
    expect(text).toBe("voice");
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

  it("listPendingChatVoiceInvites degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listPendingChatVoiceInvites("ws1")).toEqual([]);
  });

  it("toggleChatMessageReaction degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await toggleChatMessageReaction("ws1", "room1", "msg1", "👍")).toBeNull();
  });

  it("removeWorkspaceChatRoomMember degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await removeWorkspaceChatRoomMember("ws1", "room1", "user1")).toBe(false);
  });

  it("listChatRoomMembers degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listChatRoomMembers("ws1", "room1")).toEqual([]);
  });

  it("patchChatRoomMember degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await patchChatRoomMember("ws1", "room1", "user1", { role: "admin" })).toBe(false);
  });

  it("editChatRoomMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await editChatRoomMessage("ws1", "room1", "msg1", "updated")).toBeNull();
  });

  it("deleteChatRoomMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await deleteChatRoomMessage("ws1", "room1", "msg1")).toBe(false);
  });

  it("toggleChatMessagePin degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await toggleChatMessagePin("ws1", "room1", "msg1")).toBeNull();
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

  it("searchChatRoomMessages degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await searchChatRoomMessages("ws1", "room1", { q: "hello" })).toEqual([]);
  });

  it("listChatRoomMessagesAround degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listChatRoomMessagesAround("ws1", "room1", "msg1")).toEqual([]);
  });

  it("listChatNicknames degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listChatNicknames("ws1")).toEqual({});
  });

  it("lookupChatUserById returns user on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ user_id: "U1", email: "a@b.com", display_name: "A" }),
    );
    expect(await lookupChatUserById("ws1", "u1")).toEqual({
      user_id: "U1",
      email: "a@b.com",
      display_name: "A",
    });
  });

  it("lookupChatUserById degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await lookupChatUserById("ws1", "u1")).toBeNull();
  });

  it("listChatNicknames maps lowercase ids to uppercase keys", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ nicknames: { abc: "Long", def: "Short" } }),
    );
    expect(await listChatNicknames("ws1")).toEqual({ ABC: "Long", DEF: "Short" });
  });

  it("listChatNicknames skips blank user ids", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ nicknames: { "   ": "Ghost", " u1 ": "Long" } }),
    );
    expect(await listChatNicknames("ws1")).toEqual({ U1: "Long" });
  });

  it("listChatNicknames degrades on non-string nicknames", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ nicknames: { U1: 123, U2: "Ok" } }),
    );
    expect(await listChatNicknames("ws1")).toEqual({});
  });

  it("setChatNickname degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await setChatNickname("ws1", "u1", "Long")).toBe(false);
  });

  it("searchChatGifs degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await searchChatGifs("ws1", "happy")).toEqual([]);
  });

  it("listTrendingChatGifs degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listTrendingChatGifs("ws1")).toEqual([]);
  });

  it("searchChatStickers degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await searchChatStickers("ws1", "happy")).toEqual([]);
  });

  it("listTrendingChatStickers degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await listTrendingChatStickers("ws1")).toEqual([]);
  });

  it("getChatMediaStatus degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await getChatMediaStatus("ws1")).toEqual({ tenorEnabled: false });
  });
});
