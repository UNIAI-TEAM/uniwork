// Every chat endpoint: the path, method and body it sends, what it reads from
// a good answer, and that a malformed answer degrades to the fallback instead
// of throwing (CLAUDE.md › API Compatibility).
import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
vi.mock("./api", () => ({ api: transport }));

import { chatApi, createChatApi, type ChatApi } from "./chat-api";

const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
const chat = createChatApi(request);

const msg = { id: "m1", room_id: "r1", workspace_id: "w1", sender_id: "u1", sender_display_name: "A", body: "hi", created_at: "2026-10-17T00:00:00Z" };
const roomRec = { id: "r1", kind: "dm", name: "A", workspace_id: "w1" };
const member = { user_id: "u1", role: "member", email: "a@x.vn", display_name: "A" };

beforeEach(() => {
  request.mockReset();
});

function sent(): { path: string; method: string; body: unknown } {
  const [path, init] = request.mock.calls[0] ?? [];
  const body = init?.body;
  return { path: String(path), method: init?.method ?? "GET", body: typeof body === "string" ? JSON.parse(body) : body };
}

type Case = {
  name: string;
  call: (api: ChatApi) => Promise<unknown>;
  path: string;
  method: string;
  body?: unknown;
  good: unknown;
  read: unknown;
  fallback: unknown;
};

const W = "/api/v1/workspaces/w1";
const R = `${W}/chat/rooms/r1`;

const cases: Case[] = [
  { name: "listRooms", call: (c) => c.listRooms("w1"), path: `${W}/chat/rooms`, method: "GET", good: { rooms: [roomRec, { id: 7 }] }, read: [expect.objectContaining({ id: "r1" })], fallback: [] },
  { name: "resolveDMRoom", call: (c) => c.resolveDMRoom("w1", "u2"), path: `${W}/chat/dm`, method: "POST", body: { user_id: "u2" }, good: { room: roomRec }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "leaveRoom", call: (c) => c.leaveRoom("w1", "r1"), path: `${R}/leave`, method: "POST", body: {}, good: { status: "ok" }, read: true, fallback: false },
  { name: "listRoomMembers", call: (c) => c.listRoomMembers("w1", "r1"), path: `${R}/members`, method: "GET", good: { members: [member] }, read: [expect.objectContaining({ user_id: "u1", is_creator: false })], fallback: [] },
  { name: "setRoomMuted on", call: (c) => c.setRoomMuted("w1", "r1", true), path: `${R}/mute`, method: "POST", good: { status: "ok" }, read: true, fallback: false },
  { name: "setRoomMuted off", call: (c) => c.setRoomMuted("w1", "r1", false), path: `${R}/mute`, method: "DELETE", good: { status: "ok" }, read: true, fallback: false },
  { name: "markRoomRead", call: (c) => c.markRoomRead("w1", "r1"), path: `${R}/read`, method: "POST", body: {}, good: { status: "ok" }, read: true, fallback: false },
  { name: "listMessages", call: (c) => c.listMessages("w1", "r1"), path: `${R}/messages`, method: "GET", good: { messages: [msg, { id: 1 }] }, read: [expect.objectContaining({ id: "m1", kind: "text" })], fallback: [] },
  {
    name: "listMessages with a cursor, unread kept",
    call: (c) => c.listMessages("w1", "r1", { cursor: "c 1", before: "b", after: "a", limit: 50, markRead: false }),
    path: `${R}/messages?cursor=c+1&after=a&before=b&limit=50&mark_read=0`,
    method: "GET",
    good: { messages: [] },
    read: [],
    fallback: [],
  },
  { name: "listMessagesAround", call: (c) => c.listMessagesAround("w1", "r1", "m 1"), path: `${R}/messages/around/m%201?limit=50`, method: "GET", good: { messages: [msg] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  { name: "getMessage", call: (c) => c.getMessage("w1", "r1", "m1"), path: `${R}/messages/m1`, method: "GET", good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "searchMessages", call: (c) => c.searchMessages("w1", "r1", "kế hoạch"), path: `${R}/messages/search?q=k%E1%BA%BF+ho%E1%BA%A1ch&limit=30`, method: "GET", good: { messages: [msg] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  {
    name: "sendMessage",
    call: (c) => c.sendMessage("w1", "r1", { body: "hi", client_msg_id: "c1", reply_to_message_id: "m0" }),
    path: `${R}/messages`,
    method: "POST",
    body: { body: "hi", client_msg_id: "c1", reply_to_message_id: "m0" },
    good: { message: msg },
    read: expect.objectContaining({ id: "m1" }),
    fallback: null,
  },
  { name: "toggleReaction", call: (c) => c.toggleReaction("w1", "r1", "m1", "👍"), path: `${R}/messages/m1/reactions`, method: "POST", body: { emoji: "👍" }, good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "editMessage", call: (c) => c.editMessage("w1", "r1", "m1", "sửa"), path: `${R}/messages/m1`, method: "PATCH", body: { body: "sửa" }, good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "deleteMessage", call: (c) => c.deleteMessage("w1", "r1", "m1"), path: `${R}/messages/m1`, method: "DELETE", good: { status: "ok" }, read: true, fallback: false },
  { name: "listThreadMessages", call: (c) => c.listThreadMessages("w1", "r1", "root"), path: `${R}/threads/root/messages`, method: "GET", good: { messages: [msg] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  {
    name: "listThreadMessages paged",
    call: (c) => c.listThreadMessages("w1", "r1", "root", { limit: 50, cursor: "c", before: "b" }),
    path: `${R}/threads/root/messages?limit=50&cursor=c&before=b`,
    method: "GET",
    good: { messages: [] },
    read: [],
    fallback: [],
  },
  { name: "sendThreadMessage", call: (c) => c.sendThreadMessage("w1", "r1", "root", { body: "hi", client_msg_id: "c1" }), path: `${R}/threads/root/messages`, method: "POST", body: { body: "hi", client_msg_id: "c1" }, good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "markThreadRead", call: (c) => c.markThreadRead("w1", "root"), path: `${W}/chat/threads/root/read`, method: "POST", good: { previous_read_at: "2026-10-01T00:00:00Z" }, read: "2026-10-01T00:00:00Z", fallback: null },
  { name: "listChannels", call: (c) => c.listChannels("w1", "discoverable"), path: `${W}/chat/channels?scope=discoverable`, method: "GET", good: { rooms: [{ ...roomRec, kind: "channel" }] }, read: [expect.objectContaining({ kind: "channel" })], fallback: [] },
  { name: "joinChannel", call: (c) => c.joinChannel("w1", "r1"), path: `${W}/chat/channels/r1/join`, method: "POST", body: {}, good: { room: roomRec }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "listNicknames", call: (c) => c.listNicknames("w1"), path: `${W}/chat/nicknames`, method: "GET", good: { nicknames: { u1: "Bé", " ": "x" } }, read: { U1: "Bé" }, fallback: {} },
  {
    name: "listWorkspaceMembers",
    call: (c) => c.listWorkspaceMembers("w1"),
    path: `${W}/members`,
    method: "GET",
    good: { members: [{ user_id: "u1", email: 5, display_name: "A", role: "owner" }, { email: "x" }] },
    read: [{ user_id: "u1", email: "", display_name: "A" }],
    fallback: [],
  },
  { name: "beatPresence", call: (c) => c.beatPresence("w1", true), path: `${W}/chat/presence`, method: "POST", body: { state: "online", visible: true }, good: { online_user_ids: ["u2"] }, read: ["u2"], fallback: null },
  { name: "leavePresence", call: (c) => c.leavePresence("w1"), path: `${W}/chat/presence`, method: "POST", body: { state: "offline" }, good: { status: "ok" }, read: true, fallback: false },
  { name: "signalTyping", call: (c) => c.signalTyping("w1", "r1"), path: `${R}/typing`, method: "POST", body: {}, good: { status: "ok" }, read: true, fallback: false },
  {
    name: "listPendingVoiceInvites",
    call: (c) => c.listPendingVoiceInvites("w1"),
    path: `${W}/chat/voice/pending`,
    method: "GET",
    good: { invites: [{ room_id: "r1", call_id: "c1", caller_id: "u2" }] },
    read: [{ room_id: "r1", call_id: "c1", caller_id: "u2", caller_name: "", call_kind: "dm", invited_at: "" }],
    fallback: [],
  },
  {
    name: "mintVoiceToken",
    call: (c) => c.mintVoiceToken(" r1 ", "c1"),
    path: "/api/v1/chat/voice/token",
    method: "POST",
    body: { room_id: "r1", call_id: "c1" },
    good: { token: "jwt", url: "wss://lk" },
    read: { token: "jwt", url: "wss://lk" },
    fallback: null,
  },
  { name: "signalVoiceInvite", call: (c) => c.signalVoiceInvite("w1", "r1", "c1", false), path: `${R}/voice/invite`, method: "POST", body: { call_id: "c1" }, good: { status: "ok" }, read: true, fallback: false },
  { name: "signalVoiceInvite video", call: (c) => c.signalVoiceInvite("w1", "r1", "c1", true), path: `${R}/voice/invite`, method: "POST", body: { call_id: "c1", video: true }, good: { status: "ok" }, read: true, fallback: false },
  { name: "signalVoiceAccept", call: (c) => c.signalVoiceAccept("w1", "r1", "c1"), path: `${R}/voice/accept`, method: "POST", body: { call_id: "c1" }, good: { status: "ok" }, read: true, fallback: false },
  { name: "signalVoiceHangup", call: (c) => c.signalVoiceHangup("w1", "r1", "c1"), path: `${R}/voice/hangup`, method: "POST", body: { call_id: "c1" }, good: { status: "ok" }, read: true, fallback: false },
  { name: "signalVoiceHangup timed", call: (c) => c.signalVoiceHangup("w1", "r1", "c1", 42), path: `${R}/voice/hangup`, method: "POST", body: { call_id: "c1", duration_seconds: 42 }, good: { status: "ok" }, read: true, fallback: false },
];

describe("chat endpoints", () => {
  it.each(cases)("$name sends the web's request and reads its answer", async ({ call, path, method, body, good, read }) => {
    request.mockResolvedValueOnce(good);
    expect(await call(chat)).toEqual(read);
    expect(sent()).toMatchObject({ path, method, ...(body === undefined ? {} : { body }) });
  });

  it.each(cases)("$name degrades a malformed answer to its fallback", async ({ call, fallback }) => {
    request.mockResolvedValueOnce("<html>proxy error</html>");
    expect(await call(chat)).toEqual(fallback);
  });

  it("reads an absent member list as empty", async () => {
    request.mockResolvedValueOnce({});
    expect(await chat.listRoomMembers("w1", "r1")).toEqual([]);
    request.mockResolvedValueOnce({ members: null });
    expect(await chat.listWorkspaceMembers("w1")).toEqual([]);
  });

  it("uploads a file as a multipart part from disk with the idempotency key", async () => {
    request.mockResolvedValueOnce({ message: msg });
    const file = { uri: "file:///a.pdf", name: "a.pdf", mimeType: "application/pdf" };
    expect(await chat.sendFileMessage("w1", "r1", { file, client_msg_id: "c1", reply_to_message_id: "m0" })).toMatchObject({ id: "m1" });
    const [path, init] = request.mock.calls[0] ?? [];
    expect(path).toBe(`${R}/messages/file`);
    expect(init?.method).toBe("POST");
    const form = init?.body as FormData;
    expect(form.get("client_msg_id")).toBe("c1");
    expect(form.get("reply_to_message_id")).toBe("m0");
    expect(form.has("file")).toBe(true);

    request.mockResolvedValueOnce(null);
    expect(await chat.sendFileMessage("w1", "r1", { file: { uri: "file:///b", name: "b" }, client_msg_id: "c2" })).toBeNull();
    const second = request.mock.calls[1]?.[1]?.body as FormData;
    expect(second.has("reply_to_message_id")).toBe(false);
  });

  it("the shared instance goes through the app's API client", async () => {
    transport.request.mockResolvedValueOnce({ rooms: [] });
    const controller = new AbortController();
    expect(await chatApi.listRooms("w1", controller.signal)).toEqual([]);
    expect(transport.request).toHaveBeenCalledWith(`${W}/chat/rooms`, { signal: controller.signal });
  });
});
