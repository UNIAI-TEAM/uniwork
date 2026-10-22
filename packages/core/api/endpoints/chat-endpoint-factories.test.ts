import { describe, expect, it, vi } from "vitest";
import { createChatChannelsApi } from "./chat-channels-api";
import { createChatForwardApi } from "./chat-forward-api";
import { createChatMediaApi } from "./chat-media-api";
import { createChatMessagesApi } from "./chat-messages-api";
import { createChatPresenceApi } from "./chat-presence-api";
import { createChatRoomsApi } from "./chat-rooms-api";
import type { ChatRequest } from "./chat-schemas";
import { createChatThreadsApi } from "./chat-threads-api";
import { createChatUsersApi } from "./chat-users-api";
import { createChatVoiceApi } from "./chat-voice-api";

// The factories take the transport they are given (the phone hands its own,
// ADR 0011): every call goes through it, with a JSON body, never a string.
const transport = (...answers: unknown[]) => {
  const request = vi.fn<ChatRequest>();
  for (const answer of answers) request.mockResolvedValueOnce(answer);
  return request;
};

describe("createChatUsersApi", () => {
  it("sends block, unblock and nickname writes through the transport and reads their status", async () => {
    const request = transport({ status: "ok" }, { status: "ok" }, { nope: true });
    const api = createChatUsersApi(request);
    expect(await api.blockChatUser("w 1", "u1")).toBe(true);
    expect(await api.unblockChatUser("w 1", "u1")).toBe(true);
    expect(await api.setChatNickname("w 1", "u1", "Bé")).toBe(false);
    expect(request.mock.calls).toEqual([
      ["/api/v1/workspaces/w%201/chat/users/u1/block", { method: "POST", body: {} }],
      ["/api/v1/workspaces/w%201/chat/users/u1/block", { method: "DELETE" }],
      ["/api/v1/workspaces/w%201/chat/users/u1/nickname", { method: "PUT", body: { nickname: "Bé" } }],
    ]);
  });

  it("reads block status with the caller's signal, unreadable as not blocked", async () => {
    const signal = new AbortController().signal;
    const request = transport({ blocked_by_me: true, blocked_me: false }, "nope");
    const api = createChatUsersApi(request);
    expect(await api.getChatBlockStatus("w1", "u2", signal)).toEqual({ blocked_by_me: true, blocked_me: false });
    expect(await api.getChatBlockStatus("w1", "u2")).toEqual({ blocked_by_me: false, blocked_me: false });
    expect(request.mock.calls[0]).toEqual(["/api/v1/workspaces/w1/chat/users/u2/block", { signal }]);
  });

  it("looks a person up by email or id, null when the answer drifted", async () => {
    const request = transport({ user_id: "U1", email: "a@b.vn", display_name: "A" }, { user_id: 1 });
    const api = createChatUsersApi(request);
    expect(await api.lookupChatUser("w1", " A@B.vn ")).toEqual({ user_id: "U1", email: "a@b.vn", display_name: "A" });
    expect(await api.lookupChatUserById("w1", " u1 ")).toBeNull();
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/workspaces/w1/chat/users/lookup?email=a%40b.vn",
      "/api/v1/workspaces/w1/chat/users/lookup?user_id=U1",
    ]);
  });

  it("keys nicknames by the upper-cased id and drops a bad entry alone", async () => {
    const api = createChatUsersApi(transport({ nicknames: { u1: "Bé", " ": "x", u2: 3 } }, { nicknames: [1] }));
    expect(await api.listChatNicknames("w1")).toEqual({ U1: "Bé" });
    expect(await api.listChatNicknames("w1")).toEqual({});
  });
});

describe("createChatPresenceApi", () => {
  it("beats through the transport and reads the online ids, null when the answer has none", async () => {
    const request = transport({ online_user_ids: ["U1"] }, { online_user_ids: [1] });
    const api = createChatPresenceApi(request);
    expect(await api.beatChatPresence("w1", true)).toEqual(["U1"]);
    expect(await api.beatChatPresence("w1", false)).toBeNull();
    expect(request.mock.calls[1]).toEqual(["/api/v1/workspaces/w1/chat/presence", { method: "POST", body: { state: "online", visible: false } }]);
  });
});

// The room, message, thread, channel, media, forward and call factories: what
// each call hands the transport (a JSON value, never a string; the caller's
// signal) and that a drifted answer reads as the fallback, not a throw.
type FactoryCase = {
  name: string;
  call: (request: ChatRequest) => Promise<unknown>;
  sent: unknown[];
  good: unknown;
  read: unknown;
  fallback: unknown;
};

const W = "/api/v1/workspaces/w%201";
const R = `${W}/chat/rooms/r1`;
const msg = { id: "m1", room_id: "r1", workspace_id: "w1", sender_id: "u1", sender_display_name: "A", body: "hi", created_at: "2026-10-17T00:00:00Z" };
const room = { id: "r1", kind: "group", name: "A", workspace_id: "w1" };
const signal = new AbortController().signal;
const rooms = (r: ChatRequest) => createChatRoomsApi(r);
const messages = (r: ChatRequest) => createChatMessagesApi(r);
const threads = (r: ChatRequest) => createChatThreadsApi(r);
const channels = (r: ChatRequest) => createChatChannelsApi(r);
const media = (r: ChatRequest) => createChatMediaApi(r);
const voice = (r: ChatRequest) => createChatVoiceApi(r);

const factoryCases: FactoryCase[] = [
  { name: "listChatRooms", call: (r) => rooms(r).listChatRooms("w 1", signal), sent: [`${W}/chat/rooms`, { signal }], good: { rooms: [room, { id: 1 }] }, read: [expect.objectContaining({ id: "r1" })], fallback: [] },
  { name: "getChatUnreadSummary", call: (r) => rooms(r).getChatUnreadSummary(signal), sent: ["/api/v1/me/chat/unread-summary", { signal }], good: { workspaces: [] }, read: expect.any(Object), fallback: expect.any(Object) },
  { name: "resolveDMRoom", call: (r) => rooms(r).resolveDMRoom("w 1", "u2"), sent: [`${W}/chat/dm`, { method: "POST", body: { user_id: "u2" } }], good: { room }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "createChatGroup", call: (r) => rooms(r).createChatGroup("w 1", { name: "G", member_user_ids: ["u2"] }), sent: [`${W}/chat/groups`, { method: "POST", body: { name: "G", member_user_ids: ["u2"] } }], good: { room }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "inviteChatGroupMembers", call: (r) => rooms(r).inviteChatGroupMembers("w 1", "r1", ["u3"]), sent: [`${R}/members`, { method: "POST", body: { member_user_ids: ["u3"] } }], good: { room }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "removeChatRoomAvatar", call: (r) => rooms(r).removeChatRoomAvatar("w 1", "r1"), sent: [`${R}/avatar`, { method: "DELETE" }], good: { room }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "leaveChatRoom", call: (r) => rooms(r).leaveChatRoom("w 1", "r1"), sent: [`${R}/leave`, { method: "POST", body: {} }], good: { status: "ok" }, read: true, fallback: false },
  { name: "removeChatRoomMember", call: (r) => rooms(r).removeChatRoomMember("w 1", "r1", "u 2"), sent: [`${R}/members/u%202`, { method: "DELETE" }], good: { status: "ok" }, read: true, fallback: false },
  { name: "listChatRoomMembers", call: (r) => rooms(r).listChatRoomMembers("w 1", "r1"), sent: [`${R}/members`], good: { members: [{ user_id: "u1", role: "member", email: "a@x.vn", display_name: "A" }] }, read: [expect.objectContaining({ user_id: "u1" })], fallback: [] },
  { name: "patchChatRoomMember", call: (r) => rooms(r).patchChatRoomMember("w 1", "r1", "u2", { role: "admin" }), sent: [`${R}/members/u2`, { method: "PATCH", body: { role: "admin" } }], good: { status: "ok" }, read: true, fallback: false },
  { name: "getWorkspaceChatRoom", call: (r) => rooms(r).getWorkspaceChatRoom("w 1"), sent: [`${W}/chat/room`], good: { workspace_id: "w1", room_id: "r1" }, read: expect.objectContaining({ room_id: "r1" }), fallback: null },
  { name: "ensureWorkspaceChatRoom", call: (r) => rooms(r).ensureWorkspaceChatRoom("w 1"), sent: [`${W}/chat/room`, { method: "POST", body: {} }], good: { workspace_id: "w1", room_id: "r1" }, read: expect.objectContaining({ room_id: "r1" }), fallback: null },
  { name: "getChatRoom", call: (r) => rooms(r).getChatRoom("w 1", "r1"), sent: [R], good: { room }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "patchChatRoom", call: (r) => rooms(r).patchChatRoom("w 1", "r1", { topic: "" }), sent: [R, { method: "PATCH", body: { topic: "" } }], good: { allow_forward: false }, read: expect.objectContaining({ allow_forward: false }), fallback: expect.objectContaining({ allow_forward: true }) },
  { name: "listChatRoomMessages", call: (r) => messages(r).listChatRoomMessages("w 1", "r1"), sent: [`${R}/messages`], good: { messages: [msg, { id: 1 }] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  {
    name: "listChatRoomMessages paged, unread kept, aborted by its caller",
    call: (r) => messages(r).listChatRoomMessages("w 1", "r1", { cursor: "c", after: "a", before: "b", limit: 50, mark_read: false }, signal),
    sent: [`${R}/messages?cursor=c&after=a&before=b&limit=50&mark_read=0`, { signal }],
    good: { messages: [] },
    read: [],
    fallback: [],
  },
  { name: "markChatRoomRead", call: (r) => messages(r).markChatRoomRead("w 1", "r1"), sent: [`${R}/read`, { method: "POST", body: {} }], good: { status: "ok" }, read: true, fallback: false },
  { name: "setChatRoomMuted on", call: (r) => messages(r).setChatRoomMuted("w 1", "r1", true), sent: [`${R}/mute`, { method: "POST" }], good: { status: "ok" }, read: true, fallback: false },
  { name: "setChatRoomMuted off", call: (r) => messages(r).setChatRoomMuted("w 1", "r1", false), sent: [`${R}/mute`, { method: "DELETE" }], good: { status: "ok" }, read: true, fallback: false },
  { name: "getChatRoomMessage", call: (r) => messages(r).getChatRoomMessage("w 1", "r1", "m 1"), sent: [`${R}/messages/m%201`], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "searchChatRoomMessages", call: (r) => messages(r).searchChatRoomMessages("w 1", "r1", { q: "kế", before: "b", limit: 30 }), sent: [`${R}/messages/search?q=k%E1%BA%BF&before=b&limit=30`], good: { messages: [msg] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  { name: "searchChatMessages", call: (r) => messages(r).searchChatMessages("w 1", { q: "a", scope: "workspace", before: "b", limit: 5 }), sent: [`${W}/chat/messages/search?q=a&scope=workspace&before=b&limit=5`], good: { messages: [msg] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  { name: "listChatRoomMessagesAround", call: (r) => messages(r).listChatRoomMessagesAround("w 1", "r1", "m1"), sent: [`${R}/messages/around/m1?limit=50`], good: { messages: [msg] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  { name: "sendChatRoomMessage", call: (r) => messages(r).sendChatRoomMessage("w 1", "r1", { body: "hi", client_msg_id: "c1" }), sent: [`${R}/messages`, { method: "POST", body: { body: "hi", client_msg_id: "c1" } }], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "shareChatMessageAsDocument", call: (r) => messages(r).shareChatMessageAsDocument("w 1", "r1", "m1", { share_level: "view", client_msg_id: "c1" }), sent: [`${R}/messages/m1/share-as-document`, { method: "POST", body: { share_level: "view", client_msg_id: "c1" } }], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "voteChatPollMessage", call: (r) => messages(r).voteChatPollMessage("w 1", "r1", "m1", "o1"), sent: [`${R}/messages/m1/poll/vote`, { method: "POST", body: { option_id: "o1" } }], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "toggleChatMessageReaction", call: (r) => messages(r).toggleChatMessageReaction("w 1", "r1", "m1", "👍"), sent: [`${R}/messages/m1/reactions`, { method: "POST", body: { emoji: "👍" } }], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "editChatRoomMessage", call: (r) => messages(r).editChatRoomMessage("w 1", "r1", "m1", "x"), sent: [`${R}/messages/m1`, { method: "PATCH", body: { body: "x" } }], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "deleteChatRoomMessage", call: (r) => messages(r).deleteChatRoomMessage("w 1", "r1", "m1"), sent: [`${R}/messages/m1`, { method: "DELETE" }], good: { status: "ok" }, read: true, fallback: false },
  { name: "toggleChatMessagePin", call: (r) => messages(r).toggleChatMessagePin("w 1", "r1", "m1"), sent: [`${R}/messages/m1/pin`, { method: "POST", body: {} }], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "listWorkspaceChatMessages", call: (r) => messages(r).listWorkspaceChatMessages("w 1", { before: "b", limit: 10 }), sent: [`${W}/chat/messages?before=b&limit=10`], good: { messages: [msg] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  { name: "sendWorkspaceChatMessage", call: (r) => messages(r).sendWorkspaceChatMessage("w 1", { body: "hi" }), sent: [`${W}/chat/messages`, { method: "POST", body: { body: "hi" } }], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "listChatThreadMessages", call: (r) => threads(r).listChatThreadMessages("w 1", "r1", "t1", { limit: 0, cursor: "c" }), sent: [`${R}/threads/t1/messages?limit=0&cursor=c`], good: { messages: [msg, { id: 2 }] }, read: [expect.objectContaining({ id: "m1" })], fallback: [] },
  { name: "sendChatThreadMessage", call: (r) => threads(r).sendChatThreadMessage("w 1", "r1", "t1", { body: "hi" }), sent: [`${R}/threads/t1/messages`, { method: "POST", body: { body: "hi" } }], good: { message: msg }, read: expect.objectContaining({ id: "m1" }), fallback: null },
  { name: "followChatThread", call: (r) => threads(r).followChatThread("w 1", "t1"), sent: [`${W}/chat/threads/t1/follow`, { method: "POST" }], good: { ok: true }, read: undefined, fallback: undefined },
  { name: "unfollowChatThread", call: (r) => threads(r).unfollowChatThread("w 1", "t1"), sent: [`${W}/chat/threads/t1/follow`, { method: "DELETE" }], good: { ok: true }, read: undefined, fallback: undefined },
  { name: "markChatThreadRead", call: (r) => threads(r).markChatThreadRead("w 1", "t1"), sent: [`${W}/chat/threads/t1/read`, { method: "POST" }], good: { previous_read_at: "2026-10-01T00:00:00Z" }, read: "2026-10-01T00:00:00Z", fallback: null },
  { name: "listFollowedChatThreads", call: (r) => threads(r).listFollowedChatThreads("w 1", { unread: true, limit: 5 }), sent: [`${W}/chat/threads?unread=1&limit=5`], good: { threads: [{ thread_root_id: "t1", room_id: "r1", workspace_id: "w1" }] }, read: [expect.objectContaining({ thread_root_id: "t1", unread: false })], fallback: [] },
  { name: "createChatChannel", call: (r) => channels(r).createChatChannel("w 1", { name: "c", visibility: "public" }), sent: [`${W}/chat/channels`, { method: "POST", body: { name: "c", visibility: "public" } }], good: { room }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "listChatChannels", call: (r) => channels(r).listChatChannels("w 1", { scope: "mine" }), sent: [`${W}/chat/channels?scope=mine`], good: { rooms: [room] }, read: [expect.objectContaining({ id: "r1" })], fallback: [] },
  { name: "updateChatChannel", call: (r) => channels(r).updateChatChannel("w 1", "r1", { project_id: null }), sent: [`${W}/chat/channels/r1`, { method: "PATCH", body: { project_id: null } }], good: { room }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "joinChatChannel", call: (r) => channels(r).joinChatChannel("w 1", "r1"), sent: [`${W}/chat/channels/r1/join`, { method: "POST", body: {} }], good: { room }, read: expect.objectContaining({ id: "r1" }), fallback: null },
  { name: "archiveChatChannel", call: (r) => channels(r).archiveChatChannel("w 1", "r1"), sent: [`${W}/chat/channels/r1/archive`, { method: "POST", body: {} }], good: { status: "ok" }, read: true, fallback: false },
  { name: "unarchiveChatChannel", call: (r) => channels(r).unarchiveChatChannel("w 1", "r1"), sent: [`${W}/chat/channels/r1/archive`, { method: "DELETE" }], good: { status: "ok" }, read: true, fallback: false },
  { name: "listProjectChatChannels", call: (r) => channels(r).listProjectChatChannels("w 1", "p 1"), sent: [`${W}/projects/p%201/chat/channels`], good: { rooms: [room] }, read: [expect.objectContaining({ id: "r1" })], fallback: [] },
  { name: "searchChatGifs", call: (r) => media(r).searchChatGifs("w 1", "mèo"), sent: [`${W}/chat/gifs/search?q=m%C3%A8o&limit=48`], good: { items: [{ id: "g", label: "G", url: "u", preview_url: " " }] }, read: [{ id: "g", label: "G", url: "u", previewUrl: "u" }], fallback: [] },
  { name: "listTrendingChatGifs", call: (r) => media(r).listTrendingChatGifs("w 1", 5), sent: [`${W}/chat/gifs/trending?limit=5`], good: { items: [] }, read: [], fallback: [] },
  { name: "searchChatStickers", call: (r) => media(r).searchChatStickers("w 1", "a"), sent: [`${W}/chat/stickers/search?q=a&limit=48`], good: { items: [{ id: "s", label: "S", url: "u", preview_url: "p" }] }, read: [{ id: "s", label: "S", url: "u", previewUrl: "p" }], fallback: [] },
  { name: "listTrendingChatStickers", call: (r) => media(r).listTrendingChatStickers("w 1"), sent: [`${W}/chat/stickers/trending?limit=48`], good: { items: [] }, read: [], fallback: [] },
  { name: "getChatMediaStatus", call: (r) => media(r).getChatMediaStatus("w 1"), sent: [`${W}/chat/media/status`], good: { tenor_enabled: true }, read: { tenorEnabled: true }, fallback: { tenorEnabled: false } },
  { name: "getChatRoomSharedSummary", call: (r) => media(r).getChatRoomSharedSummary("w 1", "r1"), sent: [`${R}/shared-summary`], good: { counts: { photo: 2 } }, read: expect.objectContaining({ recent_photos: [] }), fallback: expect.objectContaining({ recent_photos: [] }) },
  { name: "getChatRoomSharedSummary aborted by its caller", call: (r) => media(r).getChatRoomSharedSummary("w 1", "r1", signal), sent: [`${R}/shared-summary`, { signal }], good: {}, read: expect.any(Object), fallback: expect.any(Object) },
  { name: "forwardChatMessage", call: (r) => createChatForwardApi(r).forwardChatMessage("w 1", "m1", { target_room_ids: ["r2"] }), sent: [`${W}/chat/messages/m1/forward`, { method: "POST", body: { target_room_ids: ["r2"] } }], good: { messages: [{ room_id: "r2", message_id: "m2" }, { room_id: 3 }] }, read: [{ room_id: "r2", message_id: "m2" }], fallback: [] },
  { name: "listPendingChatVoiceInvites", call: (r) => voice(r).listPendingChatVoiceInvites("w 1"), sent: [`${W}/chat/voice/pending`], good: { invites: [{ room_id: "r1", call_id: "c1", caller_id: "u2" }] }, read: [expect.objectContaining({ call_id: "c1" })], fallback: [] },
  { name: "mintChatVoiceToken", call: (r) => voice(r).mintChatVoiceToken(" r1 ", " c1 "), sent: ["/api/v1/chat/voice/token", { method: "POST", body: { room_id: "r1", call_id: "c1" } }], good: { url: "wss://lk", token: "t" }, read: expect.objectContaining({ token: "t" }), fallback: null },
  { name: "signalChatVoiceInvite", call: (r) => voice(r).signalChatVoiceInvite("w 1", "r1", "c1"), sent: [`${R}/voice/invite`, { method: "POST", body: { call_id: "c1" } }], good: { status: "ok" }, read: true, fallback: false },
  { name: "signalChatVoiceInvite video", call: (r) => voice(r).signalChatVoiceInvite("w 1", "r1", "c1", true), sent: [`${R}/voice/invite`, { method: "POST", body: { call_id: "c1", video: true } }], good: { status: "ok" }, read: true, fallback: false },
  { name: "signalChatVoiceAccept", call: (r) => voice(r).signalChatVoiceAccept("w 1", "r1", "c1"), sent: [`${R}/voice/accept`, { method: "POST", body: { call_id: "c1" } }], good: { status: "ok" }, read: true, fallback: false },
  { name: "signalChatVoiceHangup", call: (r) => voice(r).signalChatVoiceHangup("w 1", "r1", "c1", 0), sent: [`${R}/voice/hangup`, { method: "POST", body: { call_id: "c1" } }], good: { status: "ok" }, read: true, fallback: false },
  { name: "signalChatVoiceHangup timed", call: (r) => voice(r).signalChatVoiceHangup("w 1", "r1", "c1", 42), sent: [`${R}/voice/hangup`, { method: "POST", body: { call_id: "c1", duration_seconds: 42 } }], good: { status: "ok" }, read: true, fallback: false },
  { name: "signalChatTyping", call: (r) => voice(r).signalChatTyping("w 1", "r1"), sent: [`${R}/typing`, { method: "POST", body: {} }], good: { status: "ok" }, read: true, fallback: false },
];

describe("the shared chat endpoint factories", () => {
  it.each(factoryCases)("$name hands the transport its request and reads the answer", async ({ call, sent, good, read }) => {
    const request = transport(good);
    expect(await call(request)).toEqual(read);
    expect(request.mock.calls).toEqual([sent]);
  });

  it.each(factoryCases)("$name degrades to its fallback on a malformed answer", async ({ call, fallback }) => {
    expect(await call(transport("nope"))).toEqual(fallback);
  });
});
