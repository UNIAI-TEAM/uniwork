import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
vi.mock("../api", () => ({ api: apiMock }));

import {
  PRESENCE_BEAT_MS,
  beatChatPresence,
  chatNicknamesOptions,
  chatPresenceOptions,
  deactivatedMembersOptions,
  fetchChatNicknames,
  fetchDeactivatedUserIds,
  fetchWorkspaceMembers,
  workspaceMembersOptions,
} from "./contacts";

const paths = () => apiMock.request.mock.calls.map(([path]) => path);

beforeEach(() => apiMock.request.mockReset());

describe("fetchWorkspaceMembers", () => {
  it("reads the member list and drops a row without an id", async () => {
    apiMock.request.mockResolvedValueOnce({
      members: [{ user_id: "U1", email: "a@x.vn", display_name: "An", role: "member" }, { email: "ghost@x.vn" }, { user_id: "U2", display_name: 3 }],
    });
    expect(await fetchWorkspaceMembers("w1")).toEqual([
      { user_id: "U1", email: "a@x.vn", display_name: "An", avatar_url: undefined },
      { user_id: "U2", email: "", display_name: "", avatar_url: undefined },
    ]);
    expect(paths()).toEqual(["/api/v1/workspaces/w1/members"]);
  });

  it("degrades a malformed body to no one", async () => {
    apiMock.request.mockResolvedValueOnce("nope");
    expect(await fetchWorkspaceMembers("w1")).toEqual([]);
  });
});

describe("fetchDeactivatedUserIds", () => {
  it("follows next_cursor through every page of deactivated people", async () => {
    apiMock.request
      .mockResolvedValueOnce({ members: [{ user_id: "D1" }], next_cursor: "c 2" })
      .mockResolvedValueOnce({ members: [{ user_id: "D2" }], next_cursor: "" });
    expect(await fetchDeactivatedUserIds("acme")).toEqual(["D1", "D2"]);
    expect(paths()).toEqual([
      "/api/v1/orgs/acme/members?status=deactivated&limit=100",
      "/api/v1/orgs/acme/members?status=deactivated&limit=100&cursor=c%202",
    ]);
  });

  it("stops at the page cap even if the server keeps answering a cursor", async () => {
    apiMock.request.mockResolvedValue({ members: [], next_cursor: "again" });
    expect(await fetchDeactivatedUserIds("acme")).toEqual([]);
    expect(apiMock.request).toHaveBeenCalledTimes(10);
  });

  it("a malformed page hides no one", async () => {
    apiMock.request.mockResolvedValueOnce({ members: "x" });
    expect(await fetchDeactivatedUserIds("acme")).toEqual([]);
  });
});

describe("fetchChatNicknames", () => {
  it("upper-cases ids and keeps only string nicknames, like core listChatNicknames", async () => {
    apiMock.request.mockResolvedValueOnce({ nicknames: { " u1 ": "Bé", U2: 5, " ": "x" } });
    expect(await fetchChatNicknames("w1")).toEqual({ U1: "Bé" });
    apiMock.request.mockResolvedValueOnce({ nicknames: "drift" });
    expect(await fetchChatNicknames("w1")).toEqual({});
  });
});

describe("beatChatPresence", () => {
  it("posts a visible online beat and returns who is online", async () => {
    apiMock.request.mockResolvedValueOnce({ status: "ok", online_user_ids: ["U1", "U2"] });
    expect(await beatChatPresence("w1")).toEqual(["U1", "U2"]);
    expect(apiMock.request).toHaveBeenCalledWith("/api/v1/workspaces/w1/chat/presence", {
      method: "POST",
      body: JSON.stringify({ state: "online", visible: true }),
    });
  });

  it("an answer without the list is null, so the caller knows nothing", async () => {
    apiMock.request.mockResolvedValueOnce({ status: "ok" });
    expect(await beatChatPresence("w1")).toBeNull();
  });
});

describe("query options", () => {
  it("key every source by its workspace or organization and hand the signal through", async () => {
    const signal = new AbortController().signal;
    apiMock.request.mockResolvedValue({});
    const run = async (options: { queryKey: readonly unknown[]; queryFn?: unknown }) =>
      (options.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>)({ signal });

    expect(workspaceMembersOptions("w1").queryKey).toEqual(["workspace-members", "w1"]);
    await run(workspaceMembersOptions("w1"));
    expect(deactivatedMembersOptions("acme").queryKey).toEqual(["org-deactivated-members", "acme"]);
    await run(deactivatedMembersOptions("acme"));
    expect(chatNicknamesOptions("w1").queryKey).toEqual(["chat-nicknames", "w1"]);
    await run(chatNicknamesOptions("w1"));
    const presence = chatPresenceOptions("w1");
    expect(presence.queryKey).toEqual(["chat-presence", "w1"]);
    expect(presence.refetchInterval).toBe(PRESENCE_BEAT_MS);
    await run(presence);
    expect(paths()).toEqual([
      "/api/v1/workspaces/w1/members",
      "/api/v1/orgs/acme/members?status=deactivated&limit=100",
      "/api/v1/workspaces/w1/chat/nicknames",
      "/api/v1/workspaces/w1/chat/presence",
    ]);
    expect(apiMock.request.mock.calls[0]?.[1]).toEqual({ signal });
  });
});
