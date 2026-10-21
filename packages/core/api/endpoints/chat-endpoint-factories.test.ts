import { describe, expect, it, vi } from "vitest";
import { createChatPresenceApi } from "./chat-presence-api";
import type { ChatRequest } from "./chat-schemas";
import { createChatUsersApi } from "./chat-users-api";

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
